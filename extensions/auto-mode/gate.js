'use strict';
// Glue between the pure classifier and Pi's UI: mode state, session allow-list,
// confirmation prompt. Kept free of Pi imports so it can be unit-tested.
const os = require('node:os');
const path = require('node:path');
const { classifyToolCall } = require('./classify.js');
const { spawnSync } = require('node:child_process');
const { loadConfig, MODES } = require('./config.js');
const { appendDecision, readDecisions, formatLog, formatTest } = require('./decision-log.js');

const ALLOW_ONCE = 'Allow once';
const ALLOW_SESSION = 'Allow for this session';
const DENY = 'Deny';
const STATUS_KEY = 'auto-mode';
const CYCLE = ['auto', 'ask', 'off'];

function createState(overrides = {}) {
  return Object.assign({
    mode: 'auto',
    config: null,
    configCwd: null,
    modeFromUser: false, // true once the user switched mode at runtime
    sessionAllow: new Set(),
    home: os.homedir(),
    env: process.env,
    logRoot: null, // temp dir override (tests)
    logFile: null,
  }, overrides);
}

function ensureConfig(state, cwd) {
  if (state.config && state.configCwd === cwd) return state.config;
  state.config = loadConfig({ cwd, home: state.home });
  state.configCwd = cwd;
  if (!state.modeFromUser) state.mode = state.config.mode;
  return state.config;
}

function statusText(mode) {
  return mode === 'auto' ? '⏵⏵ auto mode' : mode === 'ask' ? '⏸ ask mode (confirm all)' : '⚠ auto-mode off';
}

function nextMode(mode) {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
}

// Current git branch of cwd, or null (not a repo, detached HEAD). state.branch overrides it (tests).
function currentBranch(state, cwd) {
  if (state.branch !== undefined) return state.branch;
  try {
    const r = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd, encoding: 'utf8', timeout: 2000 });
    return r.status === 0 ? r.stdout.trim() || null : null;
  } catch { return null; }
}

function parseModeArg(arg) {
  const raw = String(arg || '').trim();
  const a = raw.toLowerCase();
  if (!a) return { cycle: true };
  let m = /^log(?:\s+(\S+))?$/.exec(a);
  if (m) {
    const n = m[1] === undefined ? 20 : Number(m[1]);
    if (!Number.isInteger(n) || n < 1) return { error: 'Usage: /auto log [n]' };
    return { log: Math.min(n, 500) };
  }
  m = /^test\s+([\s\S]+)$/i.exec(raw);
  if (m) {
    let body = m[1].trim();
    let tool = 'bash';
    const f = /^(write|edit)\s+([\s\S]+)$/i.exec(body);
    if (f) { tool = f[1].toLowerCase(); body = f[2].trim(); }
    const w = /^(["'])([\s\S]*)\1$/.exec(body);
    if (w) body = w[2];
    return body ? { test: { tool, text: body } } : { error: 'Usage: /auto test "<command>" | /auto test write <path>' };
  }
  if (a === 'test') return { error: 'Usage: /auto test "<command>" | /auto test write <path>' };
  if (MODES.includes(a)) return { mode: a };
  if (a === 'status') return { status: true };
  return { error: `Unknown mode "${a}". Use: /auto [auto|ask|off|status|log [n]|test "<cmd>"]` };
}

function showStatus(state, ctx) {
  if (ctx && ctx.ui && typeof ctx.ui.setStatus === 'function') ctx.ui.setStatus(STATUS_KEY, statusText(state.mode));
}

function setMode(state, mode, ctx, { notify = true } = {}) {
  state.mode = mode;
  state.modeFromUser = true;
  showStatus(state, ctx);
  if (notify && ctx && ctx.ui && typeof ctx.ui.notify === 'function') {
    const note = mode === 'auto' ? 'auto mode: risky actions ask, the rest run freely'
      : mode === 'ask' ? 'ask mode: every bash/write/edit asks'
        : 'auto-mode OFF: nothing asks (catastrophic commands are still blocked)';
    ctx.ui.notify(note, mode === 'off' ? 'warning' : 'info');
  }
}

function preview(toolName, input) {
  const i = input || {};
  let text;
  if (toolName === 'bash' || toolName === 'powershell') text = String(i.command || '');
  else if (i.path || i.file_path) text = `${toolName} ${i.path || i.file_path}`;
  else text = toolName;
  text = text.trim();
  return text.length > 400 ? text.slice(0, 397) + '...' : text;
}

function classifyWith(state, cwd, toolName, input) {
  return classifyToolCall(toolName, input, {
    cwd, mode: state.mode, config: state.config, home: state.home, env: state.env, tmpRoots: state.tmpRoots,
    currentBranch: (dir) => currentBranch(state, dir ? path.resolve(cwd, dir) : cwd),
  });
}

// Prints via the UI, or to stdout in print mode (no UI).
function say(ctx, text) {
  if (ctx && ctx.hasUI !== false && ctx.ui && typeof ctx.ui.notify === 'function') ctx.ui.notify(text, 'info');
  else console.log(text);
}

function showLog(state, ctx, n) {
  say(ctx, formatLog(readDecisions(state, ctx, n)));
}

// Dry run: classify only, execute nothing.
function runTest(state, ctx, { tool, text }) {
  const cwd = (ctx && ctx.cwd) || process.cwd();
  ensureConfig(state, cwd);
  const input = tool === 'bash' ? { command: text } : { path: text, content: '' };
  say(ctx, formatTest(tool, input, classifyWith(state, cwd, tool, input), state.mode));
}

// Returns undefined to allow, or {block:true, reason} to block (Pi tool_call result).
async function gate(event, ctx, state) {
  const cwd = ctx.cwd || process.cwd();
  ensureConfig(state, cwd);
  const decision = classifyWith(state, cwd, event.toolName, event.input);
  const record = (outcome) => appendDecision(state, ctx, event.toolName, event.input, decision, outcome);

  if (decision.action === 'allow') { record(null); return undefined; }

  if (decision.action === 'deny') {
    record(null);
    return {
      block: true,
      reason: `Blocked by auto-mode (never allowed): ${decision.reason}. Do not retry this; pick a safer approach or ask the user to do it manually.`,
    };
  }

  // ask
  if (decision.signatures.length && decision.signatures.every((s) => state.sessionAllow.has(s))) { record('allowed (session rule)'); return undefined; }

  if (!ctx.hasUI) {
    record('blocked (no UI)');
    return {
      block: true,
      reason: `Blocked by auto-mode: needs user confirmation but no UI is available (${decision.reason}).`,
    };
  }

  const title = `${decision.severity === 'high' ? '⚠ ' : ''}Auto mode: ${decision.reason}\n\n  ${preview(event.toolName, event.input)}\n`;
  let choice;
  try {
    choice = await ctx.ui.select(title, [ALLOW_ONCE, ALLOW_SESSION, DENY]);
  } catch {
    choice = undefined;
  }
  if (choice === ALLOW_ONCE) { record('allowed once'); return undefined; }
  if (choice === ALLOW_SESSION) {
    for (const s of decision.signatures) state.sessionAllow.add(s);
    record('allowed for session');
    return undefined;
  }
  record('denied');
  return {
    block: true,
    reason: `The user declined this action (${decision.reason}). Do not retry it as-is; adapt your plan, use a safer alternative, or ask the user how to proceed.`,
  };
}

module.exports = {
  createState, ensureConfig, gate, showLog, runTest, setMode, nextMode, parseModeArg, showStatus, statusText, preview,
  ALLOW_ONCE, ALLOW_SESSION, DENY, STATUS_KEY,
};
