'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODES = ['auto', 'ask', 'off'];
// Higher = stricter.
const STRICTNESS = { off: 0, auto: 1, ask: 2 };

function emptyConfig() {
  return { mode: 'auto', allow: [], ask: [], deny: [], protectedPaths: [], protectedBranches: ['main', 'master'], warnings: [] };
}

function readJson(file, warnings) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // missing is fine
  }
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    warnings.push(`${file}: expected a JSON object`);
  } catch (err) {
    warnings.push(`${file}: invalid JSON (${err.message})`);
  }
  return null;
}

function compileList(list, key, file, warnings) {
  const out = [];
  if (list === undefined) return out;
  if (!Array.isArray(list)) {
    warnings.push(`${file}: "${key}" must be an array`);
    return out;
  }
  for (const src of list) {
    if (typeof src !== 'string') { warnings.push(`${file}: "${key}" entries must be strings`); continue; }
    try {
      out.push({ source: src, re: new RegExp(src) });
    } catch {
      warnings.push(`${file}: invalid regex in "${key}": ${src}`);
    }
  }
  return out;
}

function strings(list, key, file, warnings) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { warnings.push(`${file}: "${key}" must be an array`); return []; }
  return list.filter((x) => typeof x === 'string');
}

// Merge a user-level and a project-level config object.
// SECURITY: project config can only tighten: it never contributes "allow" and
// can only move the mode towards "ask".
function mergeConfigs(user, project, warnings = []) {
  const cfg = emptyConfig();
  cfg.warnings = warnings;
  const u = user || {};
  const p = project || {};

  if (u.mode !== undefined) {
    if (MODES.includes(u.mode)) cfg.mode = u.mode;
    else warnings.push(`user config: unknown mode "${u.mode}"`);
  }
  if (p.mode !== undefined) {
    if (!MODES.includes(p.mode)) warnings.push(`project config: unknown mode "${p.mode}"`);
    else if (STRICTNESS[p.mode] > STRICTNESS[cfg.mode]) cfg.mode = p.mode;
    else if (p.mode !== cfg.mode) warnings.push(`project config: mode "${p.mode}" ignored (project config may only be stricter)`);
  }
  if (p.allow !== undefined && (!Array.isArray(p.allow) || p.allow.length)) {
    warnings.push('project config: "allow" ignored (only the user-level config may allow)');
  }

  cfg.allow = compileList(u.allow, 'allow', 'user config', warnings);
  cfg.ask = [...compileList(u.ask, 'ask', 'user config', warnings), ...compileList(p.ask, 'ask', 'project config', warnings)];
  cfg.deny = [...compileList(u.deny, 'deny', 'user config', warnings), ...compileList(p.deny, 'deny', 'project config', warnings)];
  cfg.protectedPaths = [
    ...strings(u.protectedPaths, 'protectedPaths', 'user config', warnings),
    ...strings(p.protectedPaths, 'protectedPaths', 'project config', warnings),
  ];
  // Branch guard: the user list replaces the default, the project list only adds.
  cfg.protectedBranches = u.protectedBranches === undefined ? cfg.protectedBranches : strings(u.protectedBranches, 'protectedBranches', 'user config', warnings);
  for (const b of strings(p.protectedBranches, 'protectedBranches', 'project config', warnings)) if (!cfg.protectedBranches.includes(b)) cfg.protectedBranches.push(b);
  return cfg;
}

function loadConfig({ cwd, home = os.homedir() } = {}) {
  const warnings = [];
  const user = readJson(path.join(home, '.pi', 'agent', 'auto-mode.json'), warnings);
  const project = cwd ? readJson(path.join(cwd, '.pi', 'auto-mode.json'), warnings) : null;
  return mergeConfigs(user, project, warnings);
}

module.exports = { MODES, emptyConfig, mergeConfigs, loadConfig };
