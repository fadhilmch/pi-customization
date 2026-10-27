'use strict';
// Runs one child `pi --mode json -p` and folds its event stream into a small result object.
const fs = require('node:fs');
const { spawn: nodeSpawn } = require('node:child_process');

const MAX_TOOL_CALLS = 200; // kept for display; older ones are dropped
const MAX_STDERR = 4000;
const UPDATE_INTERVAL_MS = 150;
const KILL_GRACE_MS = 3000; // SIGTERM -> SIGKILL
const EXIT_GRACE_MS = 250; // after 'exit', how long to wait for 'close' (stdout flush) before settling

function formatTimeout(ms) {
  return ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60000)} min`;
}

// cmd.exe needs its own quoting when a .cmd shim is started through a shell.
function winQuote(arg) {
  return `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1').replace(/%/g, '%%')}"`;
}

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

// truncated: we stopped the child at its turn limit; the partial report counts as a result, not a failure.
function finish(run, { exitCode, aborted = false, timedOut = false, truncated = false } = {}) {
  run.exitCode = exitCode;
  run.endedAt = Date.now();
  if (aborted) run.status = 'aborted';
  else if (timedOut) {
    run.status = 'failed';
    run.errorMessage = run.errorMessage || 'timed out';
  } else if (truncated) {
    run.status = 'done';
    run.truncated = true;
  } else if (exitCode !== 0 || run.stopReason === 'error' || run.stopReason === 'aborted') run.status = 'failed';
  else run.status = 'done';
  return run;
}

// Spawn the child and resolve with the finished run (never rejects).
// opts: { command, args, cwd, env, signal, timeoutMs, maxTurns, onUpdate(run), spawn }
function runChild(run, { command, args, cwd, env, signal, timeoutMs = 0, maxTurns = 0, onUpdate, spawn = nodeSpawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    // Never start a child for a call that was already cancelled (queued parallel tasks, chain steps).
    if (signal?.aborted) return resolve(finish(run, { exitCode: 1, aborted: true }));
    if (cwd && !fs.existsSync(cwd)) {
      run.errorMessage = `working directory does not exist: ${cwd}`;
      return resolve(finish(run, { exitCode: 1 }));
    }
    const win = platform === 'win32';
    const viaShell = win && /\.(cmd|bat)$/i.test(command);
    const detached = !win; // own process group on POSIX, so abort and timeout reach grandchildren
    let proc;
    try {
      proc = viaShell
        ? spawn(command, args.map(winQuote), { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        : spawn(command, args, { cwd, env, shell: false, detached, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      run.errorMessage = `could not start pi: ${err.message}`;
      return resolve(finish(run, { exitCode: 1 }));
    }

    let buffer = '';
    let aborted = false;
    let timedOut = false;
    let turnLimited = false;
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
      // The turn ended with tool calls pending, so the child would go on: stop it here.
      if (maxTurns > 0 && !turnLimited && run.turns >= maxTurns && run.stopReason === 'toolUse' && event.type === 'message_end') {
        turnLimited = true;
        kill();
      }
    };

    const signalTree = (sig) => {
      try {
        if (detached && proc.pid) process.kill(-proc.pid, sig);
        else proc.kill(sig);
      } catch {
        try { proc.kill(sig); } catch { /* already gone */ }
      }
    };
    let killTimer = null;
    const kill = () => {
      if (settled || killTimer) return;
      signalTree('SIGTERM');
      // Escalate even if the leader already exited: grandchildren may still hold the group.
      killTimer = setTimeout(() => signalTree('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref?.();
    };

    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; run.errorMessage = `timed out after ${formatTimeout(timeoutMs)}`; kill(); }, timeoutMs) : null;
    timer?.unref?.();

    // Decode as a stream: a multi-byte character can be split across chunks.
    proc.stdout.setEncoding?.('utf8');
    proc.stderr.setEncoding?.('utf8');
    proc.stdout.on('data', (d) => {
      buffer += d;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) processLine(l);
    });
    proc.stderr.on('data', (d) => {
      if (run.stderr.length < MAX_STDERR) run.stderr = (run.stderr + d).slice(0, MAX_STDERR);
    });

    let exitTimer = null;
    const done = (code, sig) => {
      if (settled) return;
      settled = true;
      if (buffer.trim()) processLine(buffer);
      if (timer) clearTimeout(timer);
      if (pending) clearTimeout(pending);
      if (exitTimer) clearTimeout(exitTimer);
      signal?.removeEventListener?.('abort', onAbort);
      finish(run, { exitCode: code ?? (aborted || timedOut || sig || turnLimited ? 1 : 0), aborted, timedOut, truncated: turnLimited });
      emit(true);
      resolve(run);
    };
    proc.on('error', (err) => {
      run.errorMessage = run.errorMessage || `could not start pi: ${err.message}`;
      done(1);
    });
    // 'close' waits for every stdio stream to end, which a surviving grandchild can hold open forever.
    // So settle shortly after 'exit' even if 'close' never comes.
    proc.on('exit', (code, sig) => {
      exitTimer = setTimeout(() => { proc.stdout.destroy?.(); proc.stderr.destroy?.(); done(code, sig); }, EXIT_GRACE_MS);
      exitTimer.unref?.();
    });
    proc.on('close', (code, sig) => done(code, sig));
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
