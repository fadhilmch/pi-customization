'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// User config only (~/.pi/agent/claude-look.json): { "mode": "on" | "compact" | "off" }.
// There is no project config; a repo cannot change how your terminal looks.
const MODES = ['on', 'compact', 'off'];
const DEFAULT_MODE = 'on';

const isMode = (m) => MODES.includes(m);

function agentDir(env = process.env, home = os.homedir()) {
  const d = env.PI_CODING_AGENT_DIR;
  if (!d) return path.join(home, '.pi', 'agent');
  return d === '~' ? home : d.startsWith('~/') ? path.join(home, d.slice(2)) : d;
}

const configPath = (env, home) => path.join(agentDir(env, home), 'claude-look.json');

function loadMode({ env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
  try {
    const raw = JSON.parse(readFile(configPath(env, home), 'utf8'));
    return raw && isMode(raw.mode) ? raw.mode : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function saveMode(mode, { env = process.env, home = os.homedir(), writeFile = fs.writeFileSync, mkdir = fs.mkdirSync } = {}) {
  if (!isMode(mode)) throw new Error(`bad mode: ${mode}`);
  const file = configPath(env, home);
  mkdir(path.dirname(file), { recursive: true });
  writeFile(file, `${JSON.stringify({ mode }, null, 2)}\n`);
  return file;
}

module.exports = { MODES, DEFAULT_MODE, isMode, agentDir, loadMode, saveMode };
