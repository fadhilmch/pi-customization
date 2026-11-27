'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FOLDER_NAMES } = require('./folders.js');

// SECURITY: the user config (~/.pi/agent/output-diet.json) is trusted. The project config
// (<cwd>/.pi/output-diet.json) comes from a repo you may not own: it can only TIGHTEN, i.e. turn
// the extension or read dedupe off, or fold more aggressively (lower thresholds, smaller head/tail,
// fewer matches), or switch a command folder ON (enableFolders). It can never add allowlist entries or
// patterns, raise a limit, or switch a folder off.

const DEFAULTS = Object.freeze({
  enabled: true,
  thresholdLines: 150,
  thresholdBytes: 12 * 1024,
  headLines: 30,
  tailLines: 60,
  context: 1,
  maxMatches: 40,
  maxLineChars: 400,
  patterns: [
    '\\berror\\b', '\\bfail(ed|s|ure|ures|ing)?\\b', 'traceback', 'exception', '\\bpanic\\b', '\\bfatal\\b',
    'assertionerror', '[✗✘✖×]', 'exit (code|status)\\s*[1-9]', 'exited with [1-9]', 'segmentation fault',
    'oomkilled', 'crashloopbackoff', 'errimagepull', '^npm err!',
  ],
  ignore: ['\\b0 (errors?|failed|failures?)\\b', '\\bno errors?\\b', '\\berrors?[:=]\\s*0\\b', '\\bfailed[:=]\\s*0\\b'],
  allowlist: ['^\\s*cat\\s', '^\\s*git\\s+(diff|show|log)\\b', '^\\s*(head|tail|sed|awk|jq|wc|echo|printf)\\b'],
  dedupeReads: true,
  minDedupeChars: 400,
  disableFolders: [],
});

const NUMERIC = ['thresholdLines', 'thresholdBytes', 'headLines', 'tailLines', 'context', 'maxMatches', 'maxLineChars', 'minDedupeChars'];
// For these a SMALLER value folds more, so a project may lower them but not raise them.
const TIGHTEN_DOWN = ['thresholdLines', 'thresholdBytes', 'headLines', 'tailLines', 'maxMatches', 'maxLineChars'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v, min) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : undefined);
const strList = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : undefined);

function validRegexes(list) {
  return list.filter((s) => {
    try { new RegExp(s, 'i'); return true; } catch { return false; }
  });
}

function sanitize(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.dedupeReads === 'boolean') out.dedupeReads = raw.dedupeReads;
  for (const k of NUMERIC) {
    const v = posInt(raw[k], k === 'context' || k === 'minDedupeChars' ? 0 : 1);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ['disableFolders', 'enableFolders']) {
    const l = strList(raw[k]);
    if (l) out[k] = [...new Set(l.filter((n) => FOLDER_NAMES.includes(n)))];
  }
  for (const k of ['patterns', 'ignore', 'allowlist']) {
    const l = strList(raw[k]);
    if (l) out[k] = validRegexes(l);
  }
  return out;
}

// user: parsed ~/.pi/agent/output-diet.json (or undefined); project: parsed <cwd>/.pi/output-diet.json.
function mergeConfig(user, project) {
  const u = sanitize(user);
  const cfg = { ...DEFAULTS, ...u, disableFolders: u.disableFolders || [] };
  delete cfg.enableFolders;
  const p = sanitize(project);
  if (p.enabled === false) cfg.enabled = false;
  if (p.dedupeReads === false) cfg.dedupeReads = false;
  if (p.enableFolders) cfg.disableFolders = cfg.disableFolders.filter((n) => !p.enableFolders.includes(n));
  for (const k of TIGHTEN_DOWN) if (p[k] !== undefined && p[k] < cfg[k]) cfg[k] = p[k];
  return cfg;
}

function readJson(readFile, file) {
  try { return JSON.parse(readFile(file, 'utf8')); } catch { return undefined; }
}

function agentDir(env = process.env, home = os.homedir()) {
  const d = env.PI_CODING_AGENT_DIR;
  if (!d) return path.join(home, '.pi', 'agent');
  return d === '~' ? home : d.startsWith('~/') ? path.join(home, d.slice(2)) : d;
}

function loadConfig({ cwd, env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
  const user = readJson(readFile, path.join(agentDir(env, home), 'output-diet.json'));
  const project = cwd ? readJson(readFile, path.join(cwd, '.pi', 'output-diet.json')) : undefined;
  return mergeConfig(user, project);
}

module.exports = { DEFAULTS, mergeConfig, loadConfig, sanitize, agentDir };
