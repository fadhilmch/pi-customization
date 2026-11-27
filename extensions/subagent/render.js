'use strict';
// Claude-Code-style rows: "⏺ Subagent(scout: …)" then "  ⎿  ✓ scout · 7 tools · ↑18k ↓640 · 14s".
const { COLORS, fg, bold, dim, charWidth, truncate } = require('./ansi.js');
const { isFailed } = require('./run.js');
const { formatUsage, formatDuration, totalUsage } = require('./output.js');

const RESULT_PREFIX = '  ⎿  ';
const CONT_PREFIX = '     ';
const COLLAPSED_OUTPUT_LINES = 3;
const TASK_PREVIEW = 40;
const TOOL_NAMES = { bash: 'Bash', read: 'Read', edit: 'Update', write: 'Write', grep: 'Search', find: 'Search', ls: 'List' };

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function bulletFor(state) {
  if (state === 'error') return fg(COLORS.error, '⏺');
  if (state === 'success') return fg(COLORS.success, '⏺');
  return dim('⏺');
}

function callSummary(args) {
  const a = args || {};
  if (Array.isArray(a.chain) && a.chain.length) return `chain: ${a.chain.map((s) => s?.agent || '?').join(' → ')}`;
  if (Array.isArray(a.tasks) && a.tasks.length) {
    const counts = new Map();
    for (const t of a.tasks) counts.set(t?.agent || '?', (counts.get(t?.agent || '?') || 0) + 1);
    return `parallel: ${[...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')}`;
  }
  if (a.agent) return `${a.agent}${a.task ? `: ${oneLine(a.task)}` : ''}`;
  return '';
}

// state: pending | success | error
function formatCallLine(args, { state = 'pending', width = 80, pad = 0 } = {}) {
  const s = callSummary(args);
  return truncate(`${' '.repeat(pad)}${bulletFor(state)} ${bold('Subagent')}${s ? `${dim('(')}${s}${dim(')')}` : ''}`, width);
}

function glyph(run) {
  if (run.status === 'running') return fg(COLORS.accent, '◌');
  return isFailed(run) ? fg(COLORS.error, '✗') : fg(COLORS.success, '✓');
}

function toolLabel(call) {
  const name = TOOL_NAMES[call.name] || call.name;
  return call.arg ? `${name}(${call.arg})` : name;
}

// "✓ scout · 7 tools · ↑18k ↓640 $0.012 · 14s"; with withTask the task's start follows the name,
// so parallel rows for the same agent can be told apart.
function runHeader(run, { withStep = false, withTask = false } = {}) {
  let head = `${glyph(run)} ${withStep && run.step ? `${dim(`${run.step}.`)} ` : ''}${bold(run.agent)}`;
  if (withTask) {
    const t = oneLine(run.task);
    head += ` ${dim(t.length > TASK_PREVIEW ? `${t.slice(0, TASK_PREVIEW - 1)}…` : t)}`;
  }
  const parts = [head];
  if (run.toolCount) parts.push(`${run.toolCount} tool${run.toolCount === 1 ? '' : 's'}`);
  const usage = formatUsage(run.usage);
  if (usage) parts.push(usage);
  const end = run.endedAt || Date.now();
  if (run.status !== 'running') parts.push(formatDuration(end - run.startedAt));
  if (run.truncated) parts.push(dim(`stopped at ${run.maxTurns} turns`));
  if (run.worktree?.kept) parts.push(dim(`⎇ ${run.worktree.branch}`));
  if (isFailed(run)) parts.push(fg(COLORS.error, run.status === 'aborted' ? 'aborted' : run.errorMessage ? oneLine(run.errorMessage) : 'failed'));
  return parts.join(dim(' · '));
}

// Wrap plain text to a visible width; long words are split.
function wrapPlain(text, width) {
  const out = [];
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let row = '';
    let w = 0;
    for (const ch of line.replace(/\t/g, '  ')) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > width && row) {
        out.push(row);
        row = '';
        w = 0;
      }
      row += ch;
      w += cw;
    }
    out.push(row);
  }
  return out;
}

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

// Result rows for the tool. details: { mode, runs }.
function formatResult(details, { expanded = false, width = 80, pad = 0, fallbackText = '', isError = false } = {}) {
  const p = ' '.repeat(pad);
  const room = Math.max(10, width - pad - CONT_PREFIX.length);
  const rows = [];
  const push = (s) => rows.push(truncate(`${p}${rows.length === 0 ? RESULT_PREFIX : CONT_PREFIX}${s}`, width));
  const runs = details?.runs || [];

  if (!runs.length) {
    const text = oneLine(fallbackText) || 'Starting…';
    push(isError ? fg(COLORS.error, text) : dim(text));
    return rows;
  }

  const multi = details.mode !== 'single';
  for (const run of runs) {
    push(runHeader(run, { withStep: details.mode === 'chain', withTask: multi && !expanded }));
    if (expanded) {
      for (const l of wrapPlain(`Task: ${run.task}`, room - 2)) push(`  ${dim(l)}`);
      for (const c of run.toolCalls) push(`  ${dim(`→ ${toolLabel(c)}`)}`);
      if (run.status !== 'running') {
        const text = isFailed(run) ? run.errorMessage || run.stderr || run.output : run.output;
        for (const l of trimBlank(wrapPlain(text || '(no output)', room - 2))) push(`  ${isFailed(run) ? fg(COLORS.error, l) : fg(COLORS.muted, l)}`);
      }
      continue;
    }
    if (run.status === 'running') {
      const last = run.toolCalls.at(-1);
      push(`  ${dim(last ? `→ ${toolLabel(last)}` : 'Starting…')}`);
    } else if (!multi && !isFailed(run)) {
      const lines = trimBlank(wrapPlain(run.output || '(no output)', room));
      for (const l of lines.slice(0, COLLAPSED_OUTPUT_LINES)) push(fg(COLORS.muted, l));
      const hidden = lines.length - COLLAPSED_OUTPUT_LINES;
      if (hidden > 0) push(dim(`… +${hidden} line${hidden === 1 ? '' : 's'} (ctrl+o to expand)`));
    }
  }
  if (multi && runs.every((r) => r.status !== 'running')) {
    const total = formatUsage(totalUsage(runs));
    if (total) push(dim(`Total ${total}`));
    if (!expanded) push(dim('(ctrl+o to expand)'));
  }
  return rows;
}

module.exports = { RESULT_PREFIX, callSummary, formatCallLine, runHeader, toolLabel, wrapPlain, formatResult };
