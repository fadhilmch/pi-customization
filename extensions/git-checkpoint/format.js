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

/** Files a restore would touch, as a short phrase. `restores` = number of files that differ from the current tree. */
function restoreText(restores) {
  if (restores === 0) return 'no changes since';
  return `restores ${restores} file${restores === 1 ? '' : 's'}`;
}

/** "+12 −3, 2 files" (changes made after the checkpoint), or "no changes since". */
function statText(s) {
  if (!s || s.files === 0) return 'no changes since';
  return `+${s.added} −${s.deleted}, ${s.files} file${s.files === 1 ? '' : 's'}`;
}

/**
 * One select row: "3. turn 4 · 5m ago · +12 −3, 2 files · fix the parser".
 * `stats` = {added, deleted, files} of checkpoint -> current tree; falls back to `restores`, then files-in-snapshot.
 * `index` = 1-based list position, the `<n>` accepted by /rewind diff <n> and /rewind <n> <path>.
 */
function checkpointLabel(c, { now = Date.now(), currentSession = '', restores, stats, index } = {}) {
  const what = stats
    ? statText(stats)
    : Number.isInteger(restores)
      ? restoreText(restores)
      : `${c.files} file${c.files === 1 ? '' : 's'}`;
  const parts = [`turn ${c.turn}`, timeAgo(c.time, now), what];
  if (c.kind === 'pre-restore') parts.push('before rewind');
  if (currentSession && c.session && c.session !== currentSession) parts.push(`session ${c.session.slice(0, 8)}`);
  const head = index ? `${index}. ` : '';
  return `${head}${parts.join(' · ')} · ${c.prompt ? clip(c.prompt, 70) : '(no prompt)'}`;
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

/** Cap long text for a notification; says how much was cut. */
function capText(text, { maxLines = 120, maxChars = 12000 } = {}) {
  let lines = String(text).split('\n');
  let cut = 0;
  if (lines.length > maxLines) {
    cut = lines.length - maxLines;
    lines = lines.slice(0, maxLines);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    cut = Math.max(cut, 1);
  }
  return cut ? `${out.trimEnd()}\n… truncated (${cut} more line${cut === 1 ? '' : 's'}); use git diff for the full patch` : out;
}

/** Text for `/rewind diff <n>`: header, stat, capped patch. */
function diffReport(c, d, { paths = [] } = {}) {
  const scope = paths.length ? ` (${paths.join(', ')})` : '';
  const head = `Changes since checkpoint turn ${c.turn}${scope} (checkpoint -> current work tree)`;
  if (!d.stat.trim()) return `${head}\nNo differences.`;
  return `${head}\n\n${d.stat.trimEnd()}\n\n${capText(d.patch)}`;
}

/** Split a command line on whitespace, keeping "quoted segments" (single or double) together. */
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const statusText = (c) => DIM(`⏺ checkpoint ${c.turn}`);
const skipText = (reason) => DIM(`⏺ checkpoint skipped (${reason})`);

module.exports = { splitArgs, statText, capText, diffReport, restoreText, timeAgo, checkpointLabel, describePlan, listPaths, statusText, skipText };
