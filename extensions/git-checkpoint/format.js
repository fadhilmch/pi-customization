'use strict';
// Pure presentation helpers for git-checkpoint (no I/O).

const DIM = (s) => `\x1b[2m${s}\x1b[22m`;

function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** One select row: "turn 4 · 5m ago · 3 files · fix the parser" */
function checkpointLabel(c, { now = Date.now(), currentSession = '' } = {}) {
  const parts = [`turn ${c.turn}`, timeAgo(c.time, now), `${c.files} file${c.files === 1 ? '' : 's'}`];
  if (c.kind === 'pre-restore') parts.push('before rewind');
  if (currentSession && c.session && c.session !== currentSession) parts.push(`session ${c.session.slice(0, 8)}`);
  return `${parts.join(' · ')} · ${c.prompt ? clip(c.prompt, 70) : '(no prompt)'}`;
}

function listPaths(paths, max = 8) {
  const shown = paths.slice(0, max).map((p) => `    ${p}`);
  if (paths.length > max) shown.push(`    … and ${paths.length - max} more`);
  return shown.join('\n');
}

/** Confirmation text describing exactly what a restore will do. */
function describePlan(plan) {
  if (plan.write.length === 0 && plan.remove.length === 0) return 'Working tree already matches this checkpoint.';
  const lines = [];
  if (plan.write.length) lines.push(`Rewrite ${plan.write.length} file(s) to their checkpoint contents:`, listPaths(plan.write));
  if (plan.remove.length) lines.push(`Delete ${plan.remove.length} file(s) that did not exist at the checkpoint:`, listPaths(plan.remove));
  lines.push('Current state is saved first (undo via /rewind). Index, HEAD, branches, stash and git-ignored files are not touched.');
  return lines.join('\n');
}

const statusText = (c) => DIM(`⏺ checkpoint ${c.turn}`);
const skipText = (reason) => DIM(`⏺ checkpoint skipped (${reason})`);

module.exports = { timeAgo, checkpointLabel, describePlan, listPaths, statusText, skipText };
