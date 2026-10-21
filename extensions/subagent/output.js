'use strict';
// What the parent model receives (kept small on purpose) and the usage numbers shown to the user.
const { isFailed } = require('./run.js');

function capText(text, maxChars) {
  const s = String(text ?? '').trim();
  if (!maxChars || s.length <= maxChars) return s;
  const omitted = s.length - maxChars;
  return `${s.slice(0, maxChars).trimEnd()}\n\n[… ${omitted} more characters truncated. Delegate a narrower task if you need the rest.]`;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function totalUsage(runs) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const r of runs) for (const k of Object.keys(t)) t[k] += r.usage?.[k] || 0;
  return t;
}

// "↑18k ↓640 R12k $0.012"
function formatUsage(u) {
  if (!u) return '';
  const parts = [];
  if (u.input) parts.push(`↑${formatTokens(u.input)}`);
  if (u.output) parts.push(`↓${formatTokens(u.output)}`);
  if (u.cacheRead) parts.push(`R${formatTokens(u.cacheRead)}`);
  if (u.cost) parts.push(`$${u.cost < 0.01 ? u.cost.toFixed(4) : u.cost.toFixed(3)}`);
  return parts.join(' ');
}

function failureReason(run) {
  if (run.status === 'aborted') return 'aborted';
  const raw = run.errorMessage || run.stderr.trim().split('\n').slice(-5).join('\n') || run.output || `exit code ${run.exitCode}`;
  return capText(raw, 1500);
}

// The cap for one report: the call-level limit, lowered by the run's own budget (agent maxOutput).
function reportCap(run, maxChars) {
  return Math.min(...[run.budget, maxChars].filter((n) => Number.isFinite(n) && n > 0)) || undefined;
}

function runReport(run, maxChars) {
  return isFailed(run) ? `FAILED: ${failureReason(run)}` : capText(run.output || '(no output)', reportCap(run, maxChars));
}

// Text for the parent model. Single and chain return only the (last) report; parallel labels each one.
function modelText(mode, runs, { maxChars } = {}) {
  if (mode === 'parallel') {
    const ok = runs.filter((r) => !isFailed(r)).length;
    const parts = runs.map((r, i) => `## ${i + 1}. ${r.agent}${isFailed(r) ? ' (failed)' : ''}\n\n${runReport(r, maxChars)}`);
    return `${ok}/${runs.length} subagents succeeded.\n\n${parts.join('\n\n')}`;
  }
  if (mode === 'chain') {
    const last = runs[runs.length - 1];
    if (!last) return 'Chain did not run.';
    if (isFailed(last)) return `Chain stopped at step ${runs.length} (${last.agent}): ${failureReason(last)}`;
    return capText(last.output || '(no output)', reportCap(last, maxChars));
  }
  const r = runs[0];
  if (!r) return 'Subagent did not run.';
  return isFailed(r) ? `Subagent ${r.agent} failed: ${failureReason(r)}` : capText(r.output || '(no output)', reportCap(r, maxChars));
}

module.exports = { capText, formatTokens, formatDuration, totalUsage, formatUsage, failureReason, runReport, modelText };
