"use strict";
// Config loading for quality-on-write. No Pi imports.
//
// SECURITY: the user config (~/.pi/agent/quality.json) is trusted and may define
// custom formatter commands. The project config (<cwd>/.pi/quality.json) comes from
// a repo that may be cloned from anywhere, so it can ONLY turn things off:
// `format: false`, `typecheck: false` and `disable: [...]`. Its `formatters` field
// and any `true` values are ignored.
const path = require("node:path");

const DEFAULTS = Object.freeze({ format: true, typecheck: true, formatters: {}, disable: [] });

function asStringList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
}

/** Normalize extension keys: "ts", ".TS" -> ".ts". */
function normExt(k) {
  const e = String(k).trim().toLowerCase();
  return e.startsWith(".") ? e : "." + e;
}

function parseUser(raw) {
  const out = { format: true, typecheck: true, formatters: {}, disable: [] };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.format === "boolean") out.format = raw.format;
  if (typeof raw.typecheck === "boolean") out.typecheck = raw.typecheck;
  out.disable = asStringList(raw.disable);
  if (raw.formatters && typeof raw.formatters === "object") {
    for (const [k, v] of Object.entries(raw.formatters)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") && v[0]) out.formatters[normExt(k)] = v;
    }
  }
  return out;
}

/** Project config reduced to the restrictive subset. */
function parseProject(raw) {
  const out = { format: true, typecheck: true, formatters: {}, disable: [] };
  if (!raw || typeof raw !== "object") return out;
  if (raw.format === false) out.format = false;
  if (raw.typecheck === false) out.typecheck = false;
  out.disable = asStringList(raw.disable);
  return out;
}

function mergeConfig(user, project) {
  return {
    format: user.format && project.format,
    typecheck: user.typecheck && project.typecheck,
    formatters: { ...user.formatters },
    disable: [...new Set([...user.disable, ...project.disable].map((s) => s.toLowerCase()))],
  };
}

function readJson(readFile, p) {
  try {
    return JSON.parse(readFile(p, "utf8"));
  } catch {
    return undefined;
  }
}

function loadConfig({ home, cwd, readFile }) {
  const user = parseUser(readJson(readFile, path.join(home, ".pi", "agent", "quality.json")));
  const project = parseProject(cwd ? readJson(readFile, path.join(cwd, ".pi", "quality.json")) : undefined);
  return mergeConfig(user, project);
}

function isDisabled(config, name) {
  return config.disable.includes(String(name).toLowerCase());
}

module.exports = { DEFAULTS, normExt, parseUser, parseProject, mergeConfig, loadConfig, isDisabled };
