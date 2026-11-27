'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function obj(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function read(readFile, file) { try { return JSON.parse(readFile(file, 'utf8')); } catch { return undefined; } }
function agentDir(env = process.env, home = os.homedir()) {
  const d = env.PI_CODING_AGENT_DIR;
  return !d ? path.join(home, '.pi', 'agent') : d === '~' ? home : d.startsWith('~/') ? path.join(home, d.slice(2)) : d;
}
function mergeConfig(user, project) {
  let maxChars = obj(user) && Number.isInteger(user.maxChars) ? Math.max(512, Math.min(50000, user.maxChars)) : 12000;
  if (obj(project) && Number.isInteger(project.maxChars) && project.maxChars >= 512) maxChars = Math.min(maxChars, project.maxChars);
  const exposure = obj(user) && ['direct', 'deferred'].includes(user.exposure) ? user.exposure : 'direct';
  return { maxChars, exposure };
}
function loadConfig({ cwd, env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
  return mergeConfig(read(readFile, path.join(agentDir(env, home), 'notebook.json')), cwd && read(readFile, path.join(cwd, '.pi', 'notebook.json')));
}

module.exports = { agentDir, mergeConfig, loadConfig };
