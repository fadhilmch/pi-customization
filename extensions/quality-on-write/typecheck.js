"use strict";
// Typecheck planning, output parsing, batching and feedback. Pure (env-injected).
const path = require("node:path");
const { findUp, localBin, venvBin } = require("./formatters.js");
const { isDisabled } = require("./config.js");

const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const PY_EXTS = new Set([".py", ".pyi"]);

/**
 * Decide which checker covers `file`.
 * Returns { name, bin, args, cwd, key, files? } or undefined. `key` groups files into one run.
 */
function planCheck(file, config, env) {
  if (!config.typecheck) return undefined;
  const ext = path.extname(file).toLowerCase();
  const dir = path.dirname(file);

  if (TS_EXTS.has(ext) && !isDisabled(config, "tsc")) {
    const root = findUp(dir, ["tsconfig.json"], env);
    const bin = root && localBin(root, "tsc", env);
    if (root && bin) return { name: "tsc", bin, args: ["--noEmit", "--pretty", "false", "-p", path.join(root, "tsconfig.json")], cwd: root, key: "tsc:" + root };
    return undefined;
  }

  if (PY_EXTS.has(ext)) {
    if (!isDisabled(config, "pyright")) {
      const root = findUp(dir, ["pyrightconfig.json"], env) || pyprojectSection(dir, "tool.pyright", env);
      const bin = root && (localBin(root, "pyright", env) || venvBin(dir, "pyright", env) || env.which("pyright"));
      if (root && bin) return { name: "pyright", bin, args: [], cwd: root, key: "pyright:" + root };
    }
    if (!isDisabled(config, "mypy")) {
      const root = findUp(dir, ["mypy.ini", ".mypy.ini"], env) || pyprojectSection(dir, "tool.mypy", env) || setupCfgMypy(dir, env);
      const bin = root && (venvBin(dir, "mypy", env) || env.which("mypy"));
      if (root && bin) return { name: "mypy", bin, args: ["--no-color-output", "--no-error-summary"], cwd: root, key: "mypy:" + root, appendFiles: true };
    }
  }
  return undefined;
}

function pyprojectSection(dir, section, env) {
  const root = findUp(dir, ["pyproject.toml"], env);
  return root && (env.read(path.join(root, "pyproject.toml")) || "").includes(`[${section}`) ? root : undefined;
}

function setupCfgMypy(dir, env) {
  const root = findUp(dir, ["setup.cfg"], env);
  return root && (env.read(path.join(root, "setup.cfg")) || "").includes("[mypy") ? root : undefined;
}

/** Collects touched files between runs, grouped by checker plan. */
class Batch {
  constructor() {
    this.groups = new Map();
  }
  add(plan, file) {
    let g = this.groups.get(plan.key);
    if (!g) this.groups.set(plan.key, (g = { plan, files: new Set() }));
    g.files.add(file);
  }
  get size() {
    return this.groups.size;
  }
  /** Return the pending groups and reset. */
  take() {
    const out = [...this.groups.values()].map((g) => ({ plan: g.plan, files: [...g.files] }));
    this.groups.clear();
    return out;
  }
}

/** tsc --pretty false: `path(line,col): error TS1234: msg` with indented continuation lines. */
function parseTsc(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);
    if (m) {
      if (m[4] === "error") out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: `${m[5]}: ${m[6]}` });
    } else if (/^\s+\S/.test(line) && out.length) {
      out[out.length - 1].text += " " + line.trim();
    }
  }
  return out;
}

/** mypy: `path:line: error: msg` (optionally `path:line:col:`). */
function parseMypy(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^(.+?):(\d+):(?:\d+:)? error: (.*)$/.exec(line);
    if (m) out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: m[3] });
  }
  return out;
}

/** pyright: `  /abs/path.py:12:5 - error: msg`; continuation lines are indented. */
function parsePyright(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^\s*(.+?):(\d+):\d+ - error: (.*)$/.exec(line);
    if (m) out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: m[3] });
    else if (/^\s{4,}\S/.test(line) && out.length) out[out.length - 1].text += " " + line.trim();
  }
  return out;
}

const PARSERS = { tsc: parseTsc, mypy: parseMypy, pyright: parsePyright };

function parseOutput(name, output, baseDir) {
  return (PARSERS[name] || (() => []))(output, baseDir);
}

/**
 * Policy: only errors located in files the agent touched are reported.
 * Pre-existing errors elsewhere are counted but not shown, so the agent is not sent
 * chasing problems it did not cause.
 */
function selectErrors(errors, touchedFiles) {
  const touched = new Set(touchedFiles.map((f) => path.resolve(f)));
  const mine = errors.filter((e) => touched.has(e.file));
  return { mine, others: errors.length - mine.length };
}

/** Compact feedback message for the model. Caps at maxLines lines. */
function buildFeedback({ name, cwd, errors, others, maxLines = 30 }) {
  const rel = (f) => path.relative(cwd, f) || f;
  const lines = errors.map((e) => `${rel(e.file)}:${e.line} ${e.text}`.slice(0, 300));
  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;
  const head = `${name} found ${errors.length} error${errors.length === 1 ? "" : "s"} in files you edited. Fix them:`;
  const tail = [];
  if (hidden > 0) tail.push(`... and ${hidden} more`);
  if (others > 0) tail.push(`(${others} other pre-existing error${others === 1 ? "" : "s"} in untouched files ignored)`);
  return [head, ...shown, ...tail].join("\n");
}

/**
 * Loop guard for auto-feedback. A run of feedback rounds ends after `maxRounds`, or when the
 * same error set comes back unchanged. Call reset() on each new user input.
 */
class FeedbackGuard {
  constructor(maxRounds = 3) {
    this.maxRounds = maxRounds;
    this.reset();
  }
  reset() {
    this.rounds = 0;
    this.lastSignature = undefined;
  }
  /** A clean run: the next failure is new, so allow it even if it equals an earlier one. */
  passed() {
    this.lastSignature = undefined;
  }
  /** True if feedback with this signature may be sent now (and records it). */
  allow(signature) {
    if (this.rounds >= this.maxRounds || signature === this.lastSignature) return false;
    this.rounds++;
    this.lastSignature = signature;
    return true;
  }
}

function signatureOf(errors) {
  return errors.map((e) => `${e.file}:${e.line}:${e.text}`).sort().join("\n");
}

module.exports = { planCheck, Batch, parseTsc, parseMypy, parsePyright, parseOutput, selectErrors, buildFeedback, FeedbackGuard, signatureOf };
