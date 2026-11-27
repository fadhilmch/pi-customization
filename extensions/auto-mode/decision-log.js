'use strict';
// Per-session decision log (JSONL in the OS temp dir, like output-diet) plus the
// text for `/auto log` and `/auto test`. No Pi imports.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TARGET = 200;
const safeId = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'x';

// Commands can carry secrets: mask the obvious ones, then truncate. Best effort, not a guarantee.
function redact(text) {
  let t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, '$1 ***');
  t = t.replace(/((?:token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|credential)[A-Za-z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1***');
  t = t.replace(/(--?(?:token|password|passwd|secret|api-key|auth)[= ])\S+/gi, '$1***');
  t = t.replace(/(\/\/[^\/\s:@]+:)[^@\s]+@/g, '$1***@');
  return t.length > MAX_TARGET ? t.slice(0, MAX_TARGET - 3) + '...' : t;
}

function targetOf(toolName, input) {
  const i = input || {};
  if (toolName === 'bash' || toolName === 'powershell') return redact(i.command);
  const p = i.path || i.file_path;
  return p ? redact(p) : '';
}

function logFile(state, ctx) {
  if (state.logFile) return state.logFile;
  const session = safeId((ctx && ctx.sessionManager && ctx.sessionManager.getSessionId && ctx.sessionManager.getSessionId()) || `pid-${process.pid}`);
  const dir = path.join(state.logRoot || os.tmpdir(), 'pi-auto-mode', session);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  state.logFile = path.join(dir, 'decisions.jsonl');
  return state.logFile;
}

// Never throws: a broken log must not break the gate.
function appendDecision(state, ctx, toolName, input, decision, outcome) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      tool: toolName,
      target: targetOf(toolName, input),
      rule: decision.findings.map((f) => f.id).filter((v, i, a) => a.indexOf(v) === i).join(',') || null,
      reason: decision.reason || null,
      verdict: decision.action,
      outcome: outcome || null,
    };
    fs.appendFileSync(logFile(state, ctx), JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch { /* ignore */ }
}

function readDecisions(state, ctx, n) {
  let text;
  try { text = fs.readFileSync(logFile(state, ctx), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n').slice(-(n + 1))) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out.slice(-n);
}

function formatLog(entries) {
  if (!entries.length) return 'auto-mode: no decisions logged yet';
  return entries.map((e) => {
    const rule = e.rule ? ` [${e.rule}]` : '';
    const out = e.outcome ? ` -> ${e.outcome}` : '';
    return `${String(e.ts).slice(11, 19)} ${e.verdict.toUpperCase().padEnd(5)} ${e.tool} ${e.target}${rule}${out}`;
  }).join('\n');
}

// Dry run text for `/auto test`: decision is classifyToolCall's result.
function formatTest(toolName, input, decision, mode) {
  const lines = [`auto-mode test (${mode} mode): ${toolName} ${targetOf(toolName, input)}`, `verdict: ${decision.action}`];
  const ids = decision.findings.map((f) => f.id).filter((v, i, a) => a.indexOf(v) === i);
  lines.push(`category/rule: ${ids.length ? ids.join(', ') : decision.action === 'deny' ? 'hard denial' : 'none matched'}`);
  if (decision.reason) lines.push(`reason: ${decision.reason}`);
  return lines.join('\n');
}

module.exports = { redact, targetOf, appendDecision, readDecisions, formatLog, formatTest, logFile };
