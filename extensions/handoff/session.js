'use strict';
// Helpers for the read_session tool: path guard + compact transcript of a Pi session JSONL file.
// Node built-ins only, so they are unit-testable without Pi.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const MAX_CHARS = 20000; // hard cap on the returned transcript
const MAX_TEXT = 1500; // per user/assistant text block
const MAX_RESULT_LINES = 3;
const MAX_LINE = 200;

function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const abs = path.resolve(p);
    const dir = path.dirname(abs);
    return dir === abs ? abs : path.join(realOrResolved(dir), path.basename(abs)); // missing file: still resolve symlinked parents
  }
}

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Directories Pi stores sessions in: this session's dir, the env override and the default root. */
function sessionRoots({ sessionDir, env = process.env, home = os.homedir() } = {}) {
  const agentDir = env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
  return [sessionDir, env.PI_CODING_AGENT_SESSION_DIR, path.join(agentDir, 'sessions')].filter(Boolean).map(realOrResolved);
}

/**
 * Resolve the file read_session may open. No path -> the linked parent. Anything else must be a
 * .jsonl file inside a Pi sessions dir (or be the linked parent itself). Returns { path } or { error }.
 */
function resolveSessionPath(requested, { parentSession, roots }) {
  const wanted = String(requested || '').trim() || parentSession;
  if (!wanted) return { error: 'No session path given and this session has no linked parent session.' };
  const file = realOrResolved(wanted);
  const isParent = Boolean(parentSession) && file === realOrResolved(parentSession);
  if (!isParent) {
    if (!file.endsWith('.jsonl')) return { error: 'Only Pi session files (.jsonl) can be read.' };
    if (!roots.some((r) => isInside(r, file))) return { error: 'Refusing to read outside the Pi sessions directory.' };
  }
  if (!fs.existsSync(file)) return { error: `Session file not found: ${wanted}` };
  return { path: file };
}

function parseSessionText(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a torn or corrupt line
    }
  }
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s, n) => clip(String(s).replace(/\s+/g, ' ').trim(), n);

function textOf(content) {
  if (typeof content === 'string') return content.trim();
  return (Array.isArray(content) ? content : [])
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function describeCall(call) {
  let args = '';
  try {
    args = JSON.stringify(call.arguments ?? {});
  } catch {
    // ignore unserializable args
  }
  return `  -> ${call.name}(${oneLine(args, MAX_LINE)})`;
}

/** One rendered block per message; system/thinking parts are dropped. */
function renderMessage(m) {
  if (!m) return undefined;
  if (m.role === 'user') {
    const t = textOf(m.content);
    return t ? `[user] ${clip(t, MAX_TEXT)}` : undefined;
  }
  if (m.role === 'assistant') {
    const parts = [];
    const t = textOf(m.content);
    if (t) parts.push(`[assistant] ${clip(t, MAX_TEXT)}`);
    for (const c of Array.isArray(m.content) ? m.content : []) if (c && c.type === 'toolCall') parts.push(describeCall(c));
    return parts.length ? parts.join('\n') : undefined;
  }
  if (m.role === 'toolResult') {
    const lines = textOf(m.content).split('\n').filter((l) => l.trim());
    const shown = lines.slice(0, MAX_RESULT_LINES).map((l) => `    ${clip(l, MAX_LINE)}`);
    if (lines.length > MAX_RESULT_LINES) shown.push(`    … (${lines.length - MAX_RESULT_LINES} more lines)`);
    return `[result ${m.toolName || '?'}${m.isError ? ' error' : ''}]${shown.length ? `\n${shown.join('\n')}` : ' (empty)'}`;
  }
  return undefined;
}

/**
 * Compact transcript of the session file's entries. With a query, only blocks containing it
 * (case-insensitive) are kept. Keeps the most recent `limit` blocks, then caps total size.
 */
function formatTranscript(entries, { query, limit } = {}) {
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT));
  let blocks = [];
  for (const e of entries) {
    if (!e) continue;
    const b = e.type === 'message' ? renderMessage(e.message) : e.type === 'compaction' && e.summary ? `[compaction summary] ${clip(String(e.summary), MAX_TEXT)}` : undefined;
    if (b) blocks.push(b);
  }
  const total = blocks.length;
  const q = String(query || '').trim().toLowerCase();
  if (q) blocks = blocks.filter((b) => b.toLowerCase().includes(q));
  const matched = blocks.length;
  blocks = blocks.slice(-n);

  let out = blocks.join('\n');
  let truncated = false;
  if (out.length > MAX_CHARS) {
    out = `…${out.slice(out.length - MAX_CHARS)}`; // keep the newest part
    truncated = true;
  }
  const head = `Session transcript: ${blocks.length} of ${q ? `${matched} matching (${total} total)` : total} messages${truncated ? ', trimmed to size' : ''}.`;
  return blocks.length ? `${head}\n\n${out}` : `${head}${q ? ' No message matches the query.' : ' Session is empty.'}`;
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, MAX_CHARS, sessionRoots, resolveSessionPath, parseSessionText, renderMessage, formatTranscript };
