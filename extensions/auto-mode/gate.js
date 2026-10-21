'use strict';
// Glue between the pure classifier and Pi's UI: mode state, session allow-list,
// confirmation prompt. Kept free of Pi imports so it can be unit-tested.
const os = require('node:os');
const { classifyToolCall } = require('./classify.js');
const { loadConfig, MODES } = require('./config.js');

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

function parseModeArg(arg) {
  const a = String(arg || '').trim().toLowerCase();
  if (!a) return { cycle: true };
  if (MODES.includes(a)) return { mode: a };
  if (a === 'status') return { status: true };
  return { error: `Unknown mode "${a}". Use: /auto [auto|ask|off|status]` };
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

// Returns undefined to allow, or {block:true, reason} to block (Pi tool_call result).
async function gate(event, ctx, state) {
  const cwd = ctx.cwd || process.cwd();
  ensureConfig(state, cwd);
  const decision = classifyToolCall(event.toolName, event.input, {
    cwd, mode: state.mode, config: state.config, home: state.home, env: state.env, tmpRoots: state.tmpRoots,
  });

  if (decision.action === 'allow') return undefined;

  if (decision.action === 'deny') {
    return {
      block: true,
      reason: `Blocked by auto-mode (never allowed): ${decision.reason}. Do not retry this; pick a safer approach or ask the user to do it manually.`,
    };
  }

  // ask
  if (decision.signatures.length && decision.signatures.every((s) => state.sessionAllow.has(s))) return undefined;

  if (!ctx.hasUI) {
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
  if (choice === ALLOW_ONCE) return undefined;
  if (choice === ALLOW_SESSION) {
    for (const s of decision.signatures) state.sessionAllow.add(s);
    return undefined;
  }
  return {
    block: true,
    reason: `The user declined this action (${decision.reason}). Do not retry it as-is; adapt your plan, use a safer alternative, or ask the user how to proceed.`,
  };
}

module.exports = {
  createState, ensureConfig, gate, setMode, nextMode, parseModeArg, showStatus, statusText, preview,
  ALLOW_ONCE, ALLOW_SESSION, DENY, STATUS_KEY,
};
