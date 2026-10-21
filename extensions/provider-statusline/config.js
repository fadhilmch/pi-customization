const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every key is a boolean toggle; the defaults reproduce the original footer.
const DEFAULTS = Object.freeze({
  providerSymbol: true,     // playful mark before the model name (◉ ✳ ✦ ◆)
  contextBar: true,         // "Ctx ████░░░░ 42%"
  quota: true,              // 5h / 7d quota bars for Claude and Codex
  cost: true,               // session cost when no quota is shown
  cwd: true,                // working directory on the second line
  gitBranch: true,          // git branch on the second line
  pullRequest: true,        // open PR label (needs `gh`; runs in the background)
  extensionStatuses: true,  // ctx.ui.setStatus() values from other extensions
  codexQuotaFetch: true,    // call chatgpt.com usage endpoint with the local Codex token
  hotkeysShortcut: true,    // F1 fills the editor with /hotkeys
});

const KEYS = Object.keys(DEFAULTS);

function toSnake(key) {
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

// Env var for a key: PI_STATUSLINE_<SNAKE_KEY>, e.g. PI_STATUSLINE_CODEX_QUOTA_FETCH=0
function envName(key) {
  return `PI_STATUSLINE_${toSnake(key)}`;
}

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return undefined;
}

// Later layers win; unknown keys and non-boolean values are ignored.
function mergeConfig(...layers) {
  const result = { ...DEFAULTS };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    for (const key of KEYS) {
      const value = parseBool(layer[key]);
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

function configFromEnv(env = process.env) {
  const out = {};
  for (const key of KEYS) {
    const value = parseBool(env[envName(key)]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function configPath(env = process.env) {
  return env.PI_STATUSLINE_CONFIG || path.join(os.homedir(), '.pi', 'agent', 'statusline.json');
}

function readConfigFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null; // missing or malformed: fall back to defaults
  }
}

// env overrides file, file overrides defaults.
function loadConfig(env = process.env) {
  return mergeConfig(readConfigFile(configPath(env)), configFromEnv(env));
}

module.exports = { DEFAULTS, KEYS, envName, parseBool, mergeConfig, configFromEnv, configPath, loadConfig };
