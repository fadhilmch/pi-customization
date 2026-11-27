'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = Object.freeze({ maxJobs: 5, maxChars: 8000, exposure: 'direct' });
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function read(readFile, file) { try { return JSON.parse(readFile(file, 'utf8')); } catch { return undefined; } }
function agentDir(env = process.env, home = os.homedir()) {
  const d = env.PI_CODING_AGENT_DIR;
  return !d ? path.join(home, '.pi', 'agent') : d === '~' ? home : d.startsWith('~/') ? path.join(home, d.slice(2)) : d;
}
function mergeConfig(user, project) {
  const cfg = { ...DEFAULTS };
  if (object(user)) {
    cfg.exposure = ['direct', 'deferred'].includes(user.exposure) ? user.exposure : DEFAULTS.exposure;
    if (Number.isInteger(user.maxJobs)) cfg.maxJobs = Math.max(1, Math.min(5, user.maxJobs));
    if (Number.isInteger(user.maxChars)) cfg.maxChars = Math.max(256, Math.min(8000, user.maxChars));
  }
  if (object(project)) {
    if (Number.isInteger(project.maxJobs) && project.maxJobs > 0) cfg.maxJobs = Math.min(cfg.maxJobs, project.maxJobs);
    if (Number.isInteger(project.maxChars) && project.maxChars >= 256) cfg.maxChars = Math.min(cfg.maxChars, project.maxChars);
  }
  return cfg;
}
function loadConfig({ cwd, env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
  const user = read(readFile, path.join(agentDir(env, home), 'bg-shell.json'));
  const project = cwd && read(readFile, path.join(cwd, '.pi', 'bg-shell.json'));
  return mergeConfig(user, project);
}

module.exports = { DEFAULTS, agentDir, mergeConfig, loadConfig };
