'use strict';
// Runs one child `pi --mode json -p` and folds its event stream into a small result object.
const { spawn: nodeSpawn } = require('node:child_process');

const MAX_TOOL_CALLS = 200; // kept for display; older ones are dropped
const MAX_STDERR = 4000;
const UPDATE_INTERVAL_MS = 150;

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
}

function createRun({ agent, source = 'unknown', task, model, step, cwd } = {}) {
  return {
    agent, source, task, model, step, cwd,
    status: 'running', // running | done | failed | aborted
    startedAt: Date.now(), endedAt: undefined,
    turns: 0, toolCount: 0, toolCalls: [],
    output: '', usage: emptyUsage(),
    stopReason: undefined, errorMessage: undefined, stderr: '', exitCode: undefined, warnings: [],
  };
}

// One-line argument summary for display; never the whole payload (write contents, etc.).
function argSummary(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  let s;
  switch (name) {
    case 'bash': s = a.command; break;
    case 'read': case 'edit': case 'write': case 'ls': s = a.path ?? a.file_path; break;
    case 'grep': case 'find': s = a.pattern; break;
    default: {
      const first = Object.values(a).find((v) => typeof v === 'string');
      s = first;
    }
  }
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n').trim();
}

// Fold one JSON event into the run. Returns true when something visible changed.
function applyEvent(run, event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'tool_execution_start') {
    run.toolCount++;
    run.toolCalls.push({ name: String(event.toolName || '?'), arg: argSummary(event.toolName, event.args) });
    if (run.toolCalls.length > MAX_TOOL_CALLS) run.toolCalls.shift();
    return true;
  }
  if (event.type === 'message_end' && event.message?.role === 'assistant') {
    const m = event.message;
    run.turns++;
    const u = m.usage || {};
    run.usage.input += u.input || 0;
    run.usage.output += u.output || 0;
    run.usage.cacheRead += u.cacheRead || 0;
    run.usage.cacheWrite += u.cacheWrite || 0;
    run.usage.cost += u.cost?.total || 0;
    if (u.totalTokens) run.usage.contextTokens = u.totalTokens;
    if (m.model) run.model = m.provider ? `${m.provider}/${m.model}` : m.model;
    if (m.stopReason) run.stopReason = m.stopReason;
    if (m.errorMessage) run.errorMessage = m.errorMessage;
    const text = textOf(m);
    if (text) run.output = text;
    return true;
  }
  return false;
}

function isFailed(run) {
  return run.status === 'failed' || run.status === 'aborted';
}

function finish(run, { exitCode, aborted = false, timedOut = false } = {}) {
  run.exitCode = exitCode;
  run.endedAt = Date.now();
  if (aborted) run.status = 'aborted';
  else if (timedOut) {
    run.status = 'failed';
    run.errorMessage = run.errorMessage || 'timed out';
  } else if (exitCode !== 0 || run.stopReason === 'error' || run.stopReason === 'aborted') run.status = 'failed';
  else run.status = 'done';
  return run;
}

// Spawn the child and resolve with the finished run (never rejects).
// opts: { command, args, cwd, env, signal, timeoutMs, onUpdate(run), spawn }
function runChild(run, { command, args, cwd, env, signal, timeoutMs = 0, onUpdate, spawn = nodeSpawn } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      run.errorMessage = `could not start pi: ${err.message}`;
      return resolve(finish(run, { exitCode: 1 }));
    }

    let buffer = '';
    let aborted = false;
    let timedOut = false;
    let settled = false;
    let lastEmit = 0;
    let pending = null;

    const emit = (force) => {
      if (!onUpdate) return;
      const now = Date.now();
      if (!force && now - lastEmit < UPDATE_INTERVAL_MS) {
        if (!pending) pending = setTimeout(() => { pending = null; emit(true); }, UPDATE_INTERVAL_MS);
        return;
      }
      lastEmit = now;
      onUpdate(run);
    };

    const processLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (applyEvent(run, event)) emit(false);
    };

    const kill = () => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      }, 3000).unref?.();
    };

    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; run.errorMessage = `timed out after ${Math.round(timeoutMs / 60000)} min`; kill(); }, timeoutMs) : null;
    timer?.unref?.();

    proc.stdout.on('data', (d) => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) processLine(l);
    });
    proc.stderr.on('data', (d) => {
      if (run.stderr.length < MAX_STDERR) run.stderr = (run.stderr + d.toString()).slice(0, MAX_STDERR);
    });

    const done = (code) => {
      if (settled) return;
      settled = true;
      if (buffer.trim()) processLine(buffer);
      if (timer) clearTimeout(timer);
      if (pending) clearTimeout(pending);
      signal?.removeEventListener?.('abort', onAbort);
      finish(run, { exitCode: code ?? (aborted || timedOut ? 1 : 0), aborted, timedOut });
      emit(true);
      resolve(run);
    };
    proc.on('error', (err) => {
      run.errorMessage = run.errorMessage || `could not start pi: ${err.message}`;
      done(1);
    });
    proc.on('close', (code) => done(code));
  });
}

// Run fn over items with at most `limit` in flight; results keep input order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { createRun, argSummary, textOf, applyEvent, isFailed, finish, runChild, mapLimit, emptyUsage };
