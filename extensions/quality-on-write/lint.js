"use strict";
// Lint lane: planning and output parsing for eslint, ruff check, go vet and cargo check.
// Same rules as typecheck: only errors in touched files are reported (see typecheck.selectErrors).
// Plans have the same shape as typecheck plans, so Batch and runChecks handle both.
const path = require("node:path");
const { findUp, localBin, venvBin } = require("./formatters.js");
const { isDisabled } = require("./config.js");
const { registerParsers } = require("./typecheck.js");

const JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const PY_EXTS = new Set([".py", ".pyi"]);
const ESLINT_CONFIGS = [
  "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts",
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml",
];
const CARGO_TIMEOUT_MS = 120000;

function eslintRoot(dir, env) {
  const root = findUp(dir, ESLINT_CONFIGS, env);
  if (root) return root;
  const pkg = findUp(dir, ["package.json"], env);
  return pkg && /"eslintConfig"\s*:/.test(env.read(path.join(pkg, "package.json")) || "") ? pkg : undefined;
}

function ruffRoot(dir, env) {
  const root = findUp(dir, ["ruff.toml", ".ruff.toml"], env);
  if (root) return root;
  const py = findUp(dir, ["pyproject.toml"], env);
  return py && (env.read(path.join(py, "pyproject.toml")) || "").includes("[tool.ruff") ? py : undefined;
}

/**
 * Linters covering `file`. Returns an array of plans (possibly empty):
 * { name, bin, args, cwd, key, appendFiles?, timeoutMs? }.
 */
function planLint(file, config, env) {
  if (!config.lint) return [];
  const ext = path.extname(file).toLowerCase();
  const dir = path.dirname(file);
  const plans = [];

  if (JS_EXTS.has(ext) && !isDisabled(config, "eslint")) {
    const root = eslintRoot(dir, env);
    const bin = root && localBin(dir, "eslint", env);
    if (root && bin) plans.push({ name: "eslint", bin, args: ["-f", "json"], cwd: root, key: "eslint:" + root, appendFiles: true });
  }

  if (PY_EXTS.has(ext) && !isDisabled(config, "ruff-check")) {
    const root = ruffRoot(dir, env);
    const bin = root && (venvBin(dir, "ruff", env) || env.which("ruff"));
    if (root && bin) plans.push({ name: "ruff-check", bin, args: ["check", "--output-format", "concise", "--no-fix"], cwd: root, key: "ruff-check:" + root, appendFiles: true });
  }

  if (ext === ".go" && !isDisabled(config, "go-vet")) {
    const root = findUp(dir, ["go.mod"], env);
    const bin = root && env.which("go");
    if (root && bin) plans.push({ name: "go-vet", bin, args: ["vet", "./..."], cwd: root, key: "go-vet:" + root });
  }

  // Slow, so only for touched .rs files and with a longer timeout.
  if (ext === ".rs" && !isDisabled(config, "cargo-check")) {
    const root = findUp(dir, ["Cargo.toml"], env);
    const bin = root && env.which("cargo");
    if (root && bin) plans.push({ name: "cargo-check", bin, args: ["check", "--message-format", "short", "--quiet"], cwd: root, key: "cargo-check:" + root, timeoutMs: CARGO_TIMEOUT_MS });
  }
  return plans;
}

/** eslint -f json: one JSON array on a line; severity 2 = error. */
function parseEslint(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    if (!line.startsWith("[")) continue;
    let results;
    try {
      results = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (!r || typeof r.filePath !== "string") continue;
      for (const m of r.messages || []) {
        if (m.severity === 2) out.push({ file: path.resolve(baseDir, r.filePath), line: m.line || 1, text: m.ruleId ? `${m.ruleId}: ${m.message}` : String(m.message) });
      }
    }
  }
  return out;
}

/** ruff --output-format concise: `path:line:col: CODE message`. */
function parseRuff(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^(.+?):(\d+):\d+: (\S.*)$/.exec(line);
    if (m) out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: m[3] });
  }
  return out;
}

/** go vet: `./pkg/a.go:12:3: msg` (also `vet: a.go:12:3: msg`); `# pkg` header lines are skipped. */
function parseGoVet(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^(?:vet: )?(.+?\.go):(\d+):(?:\d+:)? (.*)$/.exec(line);
    if (m) out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: m[3] });
  }
  return out;
}

/** cargo check --message-format short: `src/a.rs:3:5: error[E0425]: msg`. Warnings are ignored. */
function parseCargo(output, baseDir) {
  const out = [];
  for (const line of String(output).split("\n")) {
    const m = /^(.+?\.rs):(\d+):\d+: error(?:\[(\w+)\])?: (.*)$/.exec(line);
    if (m) out.push({ file: path.resolve(baseDir, m[1]), line: +m[2], text: m[3] ? `${m[3]}: ${m[4]}` : m[4] });
  }
  return out;
}

const LINT_PARSERS = { eslint: parseEslint, "ruff-check": parseRuff, "go-vet": parseGoVet, "cargo-check": parseCargo };
registerParsers(LINT_PARSERS);

module.exports = { planLint, parseEslint, parseRuff, parseGoVet, parseCargo, CARGO_TIMEOUT_MS };
