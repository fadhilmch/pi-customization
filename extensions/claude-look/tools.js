'use strict';
const { COLORS, fg, bg, bold, truncate, padTo, wrapAnsi } = require('./ansi.js');

const HANDLED = new Set(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']);
const DISPLAY_NAMES = { bash: 'Bash', read: 'Read', edit: 'Update', write: 'Write', grep: 'Search', find: 'Search', ls: 'List' };
const COLLAPSED_LINES = 3;
const COLLAPSED_DIFF_LINES = 20;
// palette (optional, hex): overrides COLORS.{success,error,muted,dim,text,addBg,remBg}; see palette.js.
const pal = (palette) => ({ ...COLORS, ...(palette || {}) });
const COMPACT_LINES = 1; // /claude-look compact: fold to one line, diffs to one row
const RESULT_PREFIX = '  ⎿  ';
const CONT_PREFIX = '     ';

const isHandled = (toolName) => HANDLED.has(toolName);
const displayName = (toolName) => DISPLAY_NAMES[toolName] || toolName;

function relPath(p, cwd) {
  if (typeof p !== 'string') return '';
  if (cwd && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1);
  return p;
}

function primaryArg(toolName, args, cwd) {
  const a = args || {};
  switch (toolName) {
    case 'bash': return String(a.command ?? '').replace(/\s*\n\s*/g, ' ');
    case 'read': case 'edit': case 'write': case 'ls': return relPath(a.path ?? '', cwd);
    case 'grep': return a.pattern != null ? `pattern: "${a.pattern}"` : '';
    case 'find': return a.pattern != null ? `pattern: "${a.pattern}"` : relPath(a.path ?? '', cwd);
    default: return '';
  }
}

// state: 'pending' | 'success' | 'error'
function bulletFor(state, palette) {
  const c = pal(palette);
  if (state === 'error') return fg(c.error, '⏺');
  if (state === 'success') return fg(c.success, '⏺');
  return fg(c.dim, '⏺');
}

function formatCallLine(toolName, args, { state = 'pending', cwd = '', width = 80, pad = 0, palette } = {}) {
  const d = (x) => fg(pal(palette).dim, x);
  const arg = primaryArg(toolName, args, cwd);
  const line = `${' '.repeat(pad)}${bulletFor(state, palette)} ${bold(displayName(toolName))}${arg ? d('(') + arg + d(')') : ''}`;
  return truncate(line, width);
}

function foldLine(hidden, palette) {
  return fg(pal(palette).dim, `… +${hidden} line${hidden === 1 ? '' : 's'} (ctrl+o to expand)`);
}

// Generic text result: first row gets "  ⎿  ", the rest indent 5 spaces. Long lines wrap (never truncate),
// leading/trailing blank lines are dropped. Collapsed: first 3 source lines (1 when compact), then a fold line counted in source lines.
function formatTextResult(text, { expanded = false, isError = false, width = 80, pad = 0, compact = false, palette } = {}) {
  const raw = String(text ?? '').replace(/\r/g, '').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
  const all = raw.trim() === '' ? ['(No content)'] : raw.split('\n');
  const shown = expanded ? all : all.slice(0, compact ? COMPACT_LINES : COLLAPSED_LINES);
  const color = (l) => (isError ? fg(pal(palette).error, l) : fg(pal(palette).muted, l));
  const room = Math.max(1, width - pad - CONT_PREFIX.length);
  const p = ' '.repeat(pad);
  const out = [];
  for (const l of shown) {
    for (const row of wrapAnsi(l, room)) out.push(p + (out.length === 0 ? RESULT_PREFIX : CONT_PREFIX) + color(row));
  }
  if (!expanded && all.length > shown.length) out.push(p + CONT_PREFIX + foldLine(all.length - shown.length, palette));
  return out.map((l) => truncate(l, width));
}

// Display diff from Pi's edit tool: lines start with '+', '-' or ' ' followed by line number and text.
function parseDiffLine(line) {
  const c = line[0];
  if (c === '+') return 'add';
  if (c === '-') return 'rem';
  return 'ctx';
}

function formatDiffResult(diff, { expanded = false, width = 80, pad = 0, compact = false, palette } = {}) {
  const c = pal(palette);
  const lines = String(diff ?? '').replace(/\n+$/, '').split('\n');
  const added = lines.filter((l) => parseDiffLine(l) === 'add').length;
  const removed = lines.filter((l) => parseDiffLine(l) === 'rem').length;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const summary = `Updated with ${plural(added, 'addition')} and ${plural(removed, 'removal')}`;
  const shown = expanded ? lines : lines.slice(0, compact ? COMPACT_LINES : COLLAPSED_DIFF_LINES);
  const body = shown.map((l) => {
    const kind = parseDiffLine(l);
    const room = Math.max(1, width - pad - CONT_PREFIX.length);
    const cell = padTo(l.replace(/\t/g, '  '), room);
    if (kind === 'add') return CONT_PREFIX + bg(c.addBg, fg(c.text, cell));
    if (kind === 'rem') return CONT_PREFIX + bg(c.remBg, fg(c.text, cell));
    return CONT_PREFIX + fg(c.dim, cell);
  });
  const out = [RESULT_PREFIX + summary, ...body];
  if (!expanded && lines.length > shown.length) out.push(CONT_PREFIX + foldLine(lines.length - shown.length, palette));
  return out.map((l) => truncate(' '.repeat(pad) + l, width));
}

function formatResult(toolName, result, opts = {}) {
  const content = (result && result.content) || [];
  const text = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  if (opts.isPartial) return [truncate(' '.repeat(opts.pad || 0) + RESULT_PREFIX + fg(pal(opts.palette).dim, 'Running…'), opts.width || 80)];
  const diff = result && result.details && result.details.diff;
  if (toolName === 'edit' && !opts.isError && typeof diff === 'string' && diff) return formatDiffResult(diff, opts);
  return formatTextResult(text, opts);
}

module.exports = { isHandled, displayName, primaryArg, formatCallLine, formatResult, formatTextResult, formatDiffResult, bulletFor };
