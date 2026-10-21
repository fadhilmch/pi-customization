"use strict";
// Formatter detection. Pure: all file-system / PATH access goes through `env`.
//   env = { exists(path) -> bool, read(path) -> string|undefined, which(bin) -> abs path|undefined }
const path = require("node:path");
const { normExt, isDisabled } = require("./config.js");

const PRETTIER_EXTS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json", ".jsonc", ".css", ".scss", ".less",
  ".md", ".mdx", ".yaml", ".yml", ".html", ".vue",
]);
const BIOME_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json", ".jsonc", ".css"]);
const PRETTIER_CONFIGS = [
  ".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.json5", ".prettierrc.js",
  ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.toml", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
  "prettier.config.ts",
];
const SHELL_EXTS = new Set([".sh", ".bash"]);

/** Nearest ancestor directory (inclusive) containing any of `names`, or undefined. */
function findUp(startDir, names, env) {
  let d = startDir;
  for (;;) {
    for (const n of names) if (env.exists(path.join(d, n))) return d;
    const parent = path.dirname(d);
    if (parent === d) return undefined;
    d = parent;
  }
}

/** Nearest node_modules/.bin/<name> walking up from startDir. */
function localBin(startDir, name, env) {
  const dir = findUp(startDir, [path.join("node_modules", ".bin", name)], env);
  return dir ? path.join(dir, "node_modules", ".bin", name) : undefined;
}

/** Python venv binary (.venv/bin or venv/bin) walking up from startDir. */
function venvBin(startDir, name, env) {
  for (const v of [".venv", "venv"]) {
    const dir = findUp(startDir, [path.join(v, "bin", name)], env);
    if (dir) return path.join(dir, v, "bin", name);
  }
  return undefined;
}

function pyprojectHas(startDir, section, env) {
  const dir = findUp(startDir, ["pyproject.toml"], env);
  if (!dir) return undefined;
  const text = env.read(path.join(dir, "pyproject.toml")) || "";
  return text.includes(`[${section}`) ? dir : undefined;
}

function cargoEdition(startDir, env) {
  const dir = findUp(startDir, ["Cargo.toml"], env);
  if (!dir) return { dir: undefined };
  const m = /^\s*edition\s*=\s*"(\d{4})"/m.exec(env.read(path.join(dir, "Cargo.toml")) || "");
  return { dir, edition: m ? m[1] : undefined };
}

/** Substitute {file} in an override command, or append the file. */
function applyOverride(cmd, file) {
  const args = cmd.slice(1);
  return args.some((a) => a.includes("{file}")) ? args.map((a) => a.replaceAll("{file}", file)) : [...args, file];
}

/**
 * Pick a formatter for `file`.
 * Returns { name, bin, args, cwd } or undefined. `bin` is an absolute path or a bare name for PATH lookup.
 */
function detectFormatter(file, config, env) {
  if (!config.format) return undefined;
  const ext = path.extname(file).toLowerCase();
  const dir = path.dirname(file);

  const override = config.formatters[normExt(ext)];
  if (override) {
    const name = path.basename(override[0]);
    if (isDisabled(config, name)) return undefined;
    return { name, bin: override[0], args: applyOverride(override, file), cwd: findUp(dir, [".git", "package.json"], env) || dir };
  }

  const ok = (name) => !isDisabled(config, name);

  if (BIOME_EXTS.has(ext) && ok("biome")) {
    const root = findUp(dir, ["biome.json", "biome.jsonc"], env);
    const bin = root && localBin(dir, "biome", env);
    if (root && bin) return { name: "biome", bin, args: ["format", "--write", file], cwd: root };
  }

  if (PRETTIER_EXTS.has(ext) && ok("prettier")) {
    const local = localBin(dir, "prettier", env);
    const cfgRoot = findUp(dir, PRETTIER_CONFIGS, env);
    const global = !local && cfgRoot ? env.which("prettier") : undefined;
    const bin = local || global;
    if (bin) {
      const root = local ? path.resolve(local, "..", "..", "..") : cfgRoot;
      return { name: "prettier", bin, args: ["--write", "--ignore-unknown", "--log-level=silent", file], cwd: root };
    }
  }

  if (ext === ".py") {
    if (ok("ruff")) {
      const root = findUp(dir, ["ruff.toml", ".ruff.toml"], env) || pyprojectHas(dir, "tool.ruff", env);
      const bin = root && (venvBin(dir, "ruff", env) || env.which("ruff"));
      if (root && bin) return { name: "ruff", bin, args: ["format", file], cwd: root };
    }
    if (ok("black")) {
      const root = pyprojectHas(dir, "tool.black", env);
      const bin = root && (venvBin(dir, "black", env) || env.which("black"));
      if (root && bin) return { name: "black", bin, args: ["--quiet", file], cwd: root };
    }
    return undefined;
  }

  if (ext === ".go" && ok("gofmt")) {
    const bin = env.which("gofmt");
    if (bin) return { name: "gofmt", bin, args: ["-w", file], cwd: findUp(dir, ["go.mod"], env) || dir };
  }

  if (ext === ".rs" && ok("rustfmt")) {
    const bin = env.which("rustfmt");
    if (bin) {
      const { dir: root, edition } = cargoEdition(dir, env);
      return { name: "rustfmt", bin, args: [...(edition ? ["--edition", edition] : []), file], cwd: root || dir };
    }
  }

  if (SHELL_EXTS.has(ext) && ok("shfmt")) {
    const bin = env.which("shfmt");
    if (bin) return { name: "shfmt", bin, args: ["-w", file], cwd: dir };
  }

  return undefined;
}

module.exports = { findUp, localBin, venvBin, detectFormatter, applyOverride };
