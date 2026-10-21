'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  maxChars: 12000,
  exposure: 'direct',
  timeoutSeconds: 20,
  allowPrivate: false,
  allowedDomains: [],
  blockedDomains: [],
  search: { provider: 'brave', apiKeyEnv: 'BRAVE_API_KEY', maxResults: 5 },
});

function domainList(value) {
  return Array.isArray(value) ? [...new Set(value.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim().toLowerCase().replace(/^\.+|\.+$/g, '')))] : [];
}

function bounded(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function parseConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULTS);
  const search = raw.search && typeof raw.search === 'object' ? raw.search : {};
  return {
    maxChars: bounded(raw.maxChars, DEFAULTS.maxChars, 500, 50000),
    exposure: ['direct', 'deferred'].includes(raw.exposure) ? raw.exposure : DEFAULTS.exposure,
    timeoutSeconds: bounded(raw.timeoutSeconds, DEFAULTS.timeoutSeconds, 1, 120),
    allowPrivate: raw.allowPrivate === true,
    allowedDomains: domainList(raw.allowedDomains),
    blockedDomains: domainList(raw.blockedDomains),
    denyAllDomains: false,
    search: {
      provider: ['brave', 'tavily'].includes(search.provider) ? search.provider : DEFAULTS.search.provider,
      apiKeyEnv: typeof search.apiKeyEnv === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(search.apiKeyEnv) ? search.apiKeyEnv : DEFAULTS.search.apiKeyEnv,
      maxResults: bounded(search.maxResults, DEFAULTS.search.maxResults, 1, 10),
    },
  };
}

function isWithin(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
function narrowAllowed(parent, child) {
  if (!parent.length) return child;
  if (!child.length) return parent;
  return [...new Set(parent.flatMap((a) => child.map((b) => isWithin(a, b) ? a : isWithin(b, a) ? b : null).filter(Boolean)))];
}

function mergeConfigs(userRaw, projectRaw) {
  const user = parseConfig(userRaw);
  const project = projectRaw && typeof projectRaw === 'object' && !Array.isArray(projectRaw) ? projectRaw : {};
  const projectMax = bounded(project.maxChars, user.maxChars, 500, 50000);
  const projectTimeout = bounded(project.timeoutSeconds, user.timeoutSeconds, 1, 120);
  const projectAllowed = domainList(project.allowedDomains);
  const allowedDomains = narrowAllowed(user.allowedDomains, projectAllowed);
  return {
    ...user,
    // Exposure is user-controlled; project files cannot force a tool-loading policy.
    exposure: user.exposure,
    maxChars: Math.min(user.maxChars, projectMax),
    timeoutSeconds: Math.min(user.timeoutSeconds, projectTimeout),
    allowedDomains,
    denyAllDomains: user.allowedDomains.length > 0 && projectAllowed.length > 0 && allowedDomains.length === 0,
    blockedDomains: [...new Set([...user.blockedDomains, ...domainList(project.blockedDomains)])],
  };
}

function agentDir(env = process.env, home = os.homedir()) {
  const dir = env.PI_CODING_AGENT_DIR;
  return !dir ? path.join(home, '.pi', 'agent') : dir === '~' ? home : dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir;
}

function readJson(file, readFile, warnings) {
  try { return JSON.parse(readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.push(`${file}: invalid JSON (${error.message})`);
    return null;
  }
}

function loadConfig({ cwd, env = process.env, home, readFile = fs.readFileSync } = {}) {
  const warnings = [];
  const userFile = path.join(agentDir(env, home), 'web.json');
  const projectFile = cwd ? path.join(cwd, '.pi', 'web.json') : null;
  const user = readJson(userFile, readFile, warnings);
  const project = projectFile ? readJson(projectFile, readFile, warnings) : null;
  return { config: mergeConfigs(user, project), warnings, userFile, projectFile };
}

module.exports = { DEFAULTS, agentDir, parseConfig, mergeConfigs, loadConfig, narrowAllowed };
