'use strict';
// User config: ~/.pi/agent/subagent.json (or $PI_CODING_AGENT_DIR/subagent.json). No Pi imports.
//
// SECURITY: only the user config is read. It may add extensions to every child process, so a
// project-level file (which a cloned repo controls) is deliberately not supported.
const fs = require('node:fs');
const path = require('node:path');
const { agentDir, THINKING_LEVELS } = require('./agents.js');

const DEFAULTS = Object.freeze({
  extensions: [], // loaded into every child, e.g. a custom provider extension the child needs to reach its model
  models: {}, // { agentName: "provider/model" | "inherit" }
  thinking: {}, // { agentName: thinking level }
  maxOutputChars: 12000, // per child result returned to the parent model (about 3k tokens)
  maxParallel: 6,
  concurrency: 3,
  timeoutMinutes: 20,
  maxDepth: 1, // children cannot delegate further
});

function int(v, fallback, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function stringMap(v, allowed) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string' || !x.trim()) continue;
    if (allowed && !allowed.includes(x.trim())) continue;
    out[k] = x.trim();
  }
  return out;
}

function parseConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULTS };
  return {
    extensions: Array.isArray(raw.extensions) ? raw.extensions.filter((x) => typeof x === 'string' && x.trim()) : [],
    models: stringMap(raw.models),
    thinking: stringMap(raw.thinking, THINKING_LEVELS),
    maxOutputChars: int(raw.maxOutputChars, DEFAULTS.maxOutputChars, 500, 200000),
    maxParallel: int(raw.maxParallel, DEFAULTS.maxParallel, 1, 16),
    concurrency: int(raw.concurrency, DEFAULTS.concurrency, 1, 8),
    timeoutMinutes: int(raw.timeoutMinutes, DEFAULTS.timeoutMinutes, 0, 24 * 60),
    maxDepth: int(raw.maxDepth, DEFAULTS.maxDepth, 0, 3),
  };
}

function configPath(env = process.env, home) {
  return path.join(agentDir(env, home), 'subagent.json');
}

function loadConfig({ env = process.env, home, readFile = fs.readFileSync } = {}) {
  const file = configPath(env, home);
  let text;
  try {
    text = readFile(file, 'utf8');
  } catch {
    return { config: parseConfig(undefined), warning: undefined, file };
  }
  try {
    return { config: parseConfig(JSON.parse(text)), warning: undefined, file };
  } catch (err) {
    return { config: parseConfig(undefined), warning: `${file}: invalid JSON (${err.message})`, file };
  }
}

module.exports = { DEFAULTS, parseConfig, configPath, loadConfig };
