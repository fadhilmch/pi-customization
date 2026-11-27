'use strict';
// Background runs: a call with background: true returns at once with an id; the work continues in this process
// and is collected with subagent_wait. No Pi imports. Completion is announced through emit(name, payload).
const { capText, formatUsage, formatDuration, totalUsage } = require('./output.js');
const { worktreeNote } = require('./worktree.js');

const FINISHED_EVENT = 'subagent:finished';

function createRegistry({ emit = () => {}, now = Date.now, onChange = () => {} } = {}) {
  const entries = new Map();
  let seq = 0;

  // task({ signal, onUpdate }) -> Promise of an executeSubagent result.
  function start({ label, task }) {
    const id = `bg-${++seq}`;
    const controller = new AbortController();
    const entry = { id, label, status: 'running', startedAt: now(), endedAt: undefined, text: '', runs: [], controller, collected: false, promise: null };
    entries.set(id, entry);
    const settle = (status, result) => {
      entry.status = status;
      entry.endedAt = now();
      if (result) {
        entry.text = result.content?.[0]?.text || '';
        entry.runs = result.details?.runs || entry.runs;
      }
      onChange(entry);
      let payload;
      try {
        payload = completionPayload(entry);
        emit(FINISHED_EVENT, payload);
      } catch { /* a listener must not break the run */ }
    };
    entry.promise = Promise.resolve()
      .then(() => task({ signal: controller.signal, onUpdate: (u) => { entry.runs = u?.details?.runs || entry.runs; onChange(entry); } }))
      .then((result) => settle(controller.signal.aborted ? 'cancelled' : result?.isError ? 'failed' : 'done', result))
      .catch((err) => settle('failed', { content: [{ type: 'text', text: `Subagent failed: ${err?.message || err}` }] }));
    return entry;
  }

  const get = (id) => entries.get(id);
  const list = () => [...entries.values()];

  // Entries to report on: the named ids, or every run whose result has not been collected yet.
  function select(ids) {
    if (Array.isArray(ids) && ids.length) {
      return { entries: ids.map((i) => entries.get(String(i))).filter(Boolean), unknown: ids.map(String).filter((i) => !entries.has(i)) };
    }
    return { entries: list().filter((e) => e.status === 'running' || !e.collected), unknown: [] };
  }

  // Resolves when every selected run has finished, the timeout passes or the signal aborts.
  function wait(selected, timeoutMs, signal) {
    const running = selected.filter((e) => e.status === 'running');
    if (!running.length || timeoutMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', done);
        resolve();
      };
      timer = setTimeout(done, timeoutMs);
      signal?.addEventListener?.('abort', done, { once: true });
      Promise.all(running.map((e) => e.promise)).then(done);
    });
  }

  function cancel(selected) {
    for (const e of selected) if (e.status === 'running') e.controller.abort();
  }

  const killAll = () => cancel(list());

  return { start, get, list, select, wait, cancel, killAll };
}

function costOf(entry) {
  return totalUsage(entry.runs).cost;
}

// What other extensions (notify, ...) receive on pi.events "subagent:finished".
function completionPayload(entry) {
  return {
    id: entry.id,
    label: entry.label,
    status: entry.status, // done | failed | cancelled
    agents: [...new Set(entry.runs.map((r) => r.agent))],
    durationMs: (entry.endedAt || Date.now()) - entry.startedAt,
    cost: costOf(entry),
    summary: String(entry.text).replace(/\s+/g, ' ').trim().slice(0, 200),
    worktrees: entry.runs.filter((r) => r.worktree?.kept).map((r) => ({ branch: r.worktree.branch, path: r.worktree.dir })),
  };
}

// Text for subagent_wait. Finished reports are capped, and a multi-run answer shares about twice one budget.
function formatWait(selected, unknown, { maxChars = 12000 } = {}) {
  const cap = selected.length <= 1 ? maxChars : Math.max(1500, Math.floor((2 * maxChars) / selected.length));
  const parts = selected.map((e) => {
    const head = `## ${e.id} ${e.label}`;
    if (e.status === 'running') {
      const tools = e.runs.reduce((n, r) => n + r.toolCount, 0);
      const usage = formatUsage({ cost: costOf(e) });
      return `${head}\nstill running (${formatDuration(Date.now() - e.startedAt)}, ${tools} tool${tools === 1 ? '' : 's'}${usage ? `, ${usage}` : ''})`;
    }
    e.collected = true;
    return `${head}\n${e.status}\n\n${capText(e.text || '(no output)', cap)}`;
  });
  if (unknown.length) parts.push(`Unknown run id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
  return parts.length ? parts.join('\n\n') : 'No background subagent runs.';
}

module.exports = { FINISHED_EVENT, createRegistry, completionPayload, formatWait };
