'use strict';
// Agent definitions: Markdown files with a small frontmatter block, the body is the agent's system prompt.
// Three layers, later wins by name: bundled (./agents) < user (~/.pi/agent/agents) < project (.pi/agents, trusted only).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUNDLED_DIR = path.join(__dirname, 'agents');
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function agentDir(env = process.env, home = os.homedir()) {
  return env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) return t.slice(1, -1);
  return t;
}

// Drop a trailing " # comment" unless the value is quoted.
function stripComment(raw) {
  const v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) return v;
  return v.replace(/\s+#.*$/, '').trim();
}

// Scalars, "a, b" / "[a, b]" lists and "- item" block lists. Enough for agent files; not a YAML parser.
function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  let listKey = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) || (listKey && /^-\s*(.*)$/.exec(line));
    if (item && listKey) {
      data[listKey].push(unquote(stripComment(item[1])));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw.trim() === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    const v = stripComment(raw);
    data[key] = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map(unquote).filter(Boolean) : unquote(v);
  }
  return { data, body: src.slice(m[0].length) };
}

function list(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function bool(v, fallback) {
  if (v === true || v === 'true' || v === 'yes') return true;
  if (v === false || v === 'false' || v === 'no') return false;
  return fallback;
}

function expandHome(p, home = os.homedir()) {
  return p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

// One agent file -> config, or { error } when it cannot be used.
function parseAgent(text, { filePath = '', source = 'user' } = {}) {
  const { data, body } = parseFrontmatter(text);
  const name = typeof data.name === 'string' ? data.name.trim() : path.basename(filePath, '.md');
  if (!NAME_RE.test(name)) return { error: `${filePath}: invalid agent name "${name}"` };
  if (typeof data.description !== 'string' || !data.description.trim()) return { error: `${filePath}: missing description` };
  const thinking = typeof data.thinking === 'string' ? data.thinking.trim().toLowerCase() : undefined;
  if (thinking && !THINKING_LEVELS.includes(thinking)) return { error: `${filePath}: thinking must be one of ${THINKING_LEVELS.join(', ')}` };
  const maxOutput = Number(data.maxOutput);
  return {
    name,
    description: data.description.trim(),
    tools: list(data.tools),
    model: typeof data.model === 'string' && data.model.trim() && data.model.trim() !== 'inherit' ? data.model.trim() : undefined,
    thinking,
    skills: list(data.skills),
    extensions: list(data.extensions),
    mcp: bool(data.mcp, false),
    contextFiles: bool(data.contextFiles, true),
    maxOutput: Number.isFinite(maxOutput) && maxOutput > 0 ? Math.floor(maxOutput) : undefined,
    systemPrompt: body.trim(),
    source,
    filePath,
    dir: path.dirname(filePath),
  };
}

function loadDir(dir, source, readDir = fs.readdirSync, readFile = fs.readFileSync) {
  const agents = [];
  const errors = [];
  let names;
  try {
    names = readDir(dir);
  } catch {
    return { agents, errors };
  }
  for (const n of names.filter((x) => x.endsWith('.md')).sort()) {
    const filePath = path.join(dir, n);
    let text;
    try {
      text = readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const a = parseAgent(text, { filePath, source });
    if (a.error) errors.push(a.error);
    else agents.push(a);
  }
  return { agents, errors };
}

function findProjectAgentsDir(cwd, isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, '.pi', 'agents');
    if (isDir(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Merge layers by name. Project agents only load when the project is trusted: they are repo-controlled prompts.
function discoverAgents({ cwd, trusted = false, env = process.env, home = os.homedir(), bundledDir = BUNDLED_DIR } = {}) {
  const layers = [loadDir(bundledDir, 'bundled'), loadDir(path.join(agentDir(env, home), 'agents'), 'user')];
  const projectDir = cwd ? findProjectAgentsDir(cwd) : null;
  if (projectDir && trusted) layers.push(loadDir(projectDir, 'project'));
  const byName = new Map();
  const errors = [];
  for (const layer of layers) {
    errors.push(...layer.errors);
    for (const a of layer.agents) byName.set(a.name, a);
  }
  return { agents: [...byName.values()], errors, projectDir, projectSkipped: Boolean(projectDir && !trusted) };
}

// User config (~/.pi/agent/subagent.json) can pin a model or thinking level per agent without copying the file.
function applyOverrides(agent, config = {}) {
  const out = { ...agent };
  const model = config.models?.[agent.name];
  const thinking = config.thinking?.[agent.name];
  if (typeof model === 'string' && model.trim()) out.model = model.trim() === 'inherit' ? undefined : model.trim();
  if (typeof thinking === 'string' && THINKING_LEVELS.includes(thinking)) out.thinking = thinking;
  return out;
}

function describeAgent(a) {
  const tools = a.tools.length ? a.tools.join(',') : 'default';
  return `${a.name} (${a.source}) · model: ${a.model || 'inherit'}${a.thinking ? `:${a.thinking}` : ''} · tools: ${tools} · ${a.description}`;
}

module.exports = {
  BUNDLED_DIR,
  THINKING_LEVELS,
  agentDir,
  parseFrontmatter,
  parseAgent,
  loadDir,
  findProjectAgentsDir,
  discoverAgents,
  applyOverrides,
  describeAgent,
  expandHome,
};
