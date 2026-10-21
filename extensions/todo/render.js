'use strict';
const { COLORS, fg, bold, strike, dim, truncate } = require('./ansi.js');

const GLYPHS = { completed: '☒', in_progress: '◼', pending: '☐' };
const RESULT_PREFIX = '  ⎿  ';
const CONT_PREFIX = '     ';
const MAX_WIDGET_ITEMS = 12;

// One list row without indentation: "☒ done", "◼ doing", "☐ later".
function itemText(todo) {
  const g = GLYPHS[todo.status] || GLYPHS.pending;
  if (todo.status === 'completed') return `${dim(g)} ${dim(strike(todo.content))}`;
  if (todo.status === 'in_progress') return `${fg(COLORS.accent, g)} ${bold(todo.content)}`;
  return `${g} ${todo.content}`;
}

// Lines for the widget above the editor. Long lists keep unfinished items first and fold the rest.
function widgetLines(todos, { width = 80, max = MAX_WIDGET_ITEMS } = {}) {
  let shown = todos;
  let hidden = 0;
  if (todos.length > max) {
    const keep = new Set();
    let budget = max;
    for (const t of todos) if (t.status !== 'completed' && budget > 0) { keep.add(t); budget--; }
    for (const t of todos) if (t.status === 'completed' && budget > 0) { keep.add(t); budget--; }
    shown = todos.filter((t) => keep.has(t));
    hidden = todos.length - shown.length;
  }
  const out = shown.map((t) => truncate(`  ${itemText(t)}`, width));
  if (hidden > 0) out.push(truncate(`  ${dim(`… +${hidden} more`)}`, width));
  return out;
}

// Tool call header: "⏺ Update Todos". state: pending | success | error
function formatCallLine({ state = 'pending', width = 80, pad = 0 } = {}) {
  const bullet = state === 'error' ? fg(COLORS.error, '⏺') : state === 'success' ? fg(COLORS.success, '⏺') : dim('⏺');
  return truncate(`${' '.repeat(pad)}${bullet} ${bold('Update Todos')}`, width);
}

// Tool result: "  ⎿  ☒ first" then aligned continuation rows.
function formatResult(todos, { isError = false, errorText = '', isPartial = false, width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  if (isPartial) return [truncate(`${p}${RESULT_PREFIX}${dim('Updating…')}`, width)];
  if (isError) return [truncate(`${p}${RESULT_PREFIX}${fg(COLORS.error, errorText || 'Invalid todo list')}`, width)];
  if (!todos || todos.length === 0) return [truncate(`${p}${RESULT_PREFIX}${dim('Todo list cleared')}`, width)];
  return todos.map((t, i) => truncate(`${p}${i === 0 ? RESULT_PREFIX : CONT_PREFIX}${itemText(t)}`, width));
}

// Plain multi-line text for notifications.
function plainList(todos) {
  if (!todos.length) return 'No todos.';
  return todos.map((t) => `${GLYPHS[t.status] || GLYPHS.pending} ${t.content}`).join('\n');
}

module.exports = { GLYPHS, itemText, widgetLines, formatCallLine, formatResult, plainList };
