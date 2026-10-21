'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function agentDir(env = process.env, home = os.homedir()) {
  const dir = env.PI_CODING_AGENT_DIR;
  return !dir ? path.join(home, '.pi', 'agent') : dir === '~' ? home : dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir;
}
function parseConfig(raw) { return { exposure: raw && ['direct', 'deferred'].includes(raw.exposure) ? raw.exposure : 'direct' }; }
function loadConfig({ env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
  try { return parseConfig(JSON.parse(readFile(path.join(agentDir(env, home), 'ask-user.json'), 'utf8'))); }
  catch { return parseConfig(undefined); }
}

module.exports = { agentDir, parseConfig, loadConfig };
