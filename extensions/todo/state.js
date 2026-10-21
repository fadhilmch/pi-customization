'use strict';
// Pure todo state helpers (Claude Code TodoWrite semantics: the model sends the whole list each time).

const STATUSES = ['pending', 'in_progress', 'completed'];
const SESSION_ENTRY_TYPE = 'todo-state'; // custom session entry written by /todos clear and plan-mode seeding
const SEED_EVENT = 'todo:set'; // pi.events channel: { items: [{ content, status?, activeForm? }] }

// Validate + normalise a list sent by the model. Returns { ok, todos, warnings } or { ok:false, error }.
function normalizeTodos(input) {
  if (!Array.isArray(input)) return { ok: false, error: '`todos` must be an array of { content, status, activeForm? }.' };
  const todos = [];
  for (let i = 0; i < input.length; i++) {
    const t = input[i];
    if (!t || typeof t !== 'object') return { ok: false, error: `todos[${i}] must be an object.` };
    const content = typeof t.content === 'string' ? t.content.trim().replace(/\s+/g, ' ') : '';
    if (!content) return { ok: false, error: `todos[${i}].content must be a non-empty string.` };
    const status = t.status === undefined ? 'pending' : t.status;
    if (!STATUSES.includes(status)) {
      return { ok: false, error: `todos[${i}].status must be one of ${STATUSES.join(', ')} (got ${JSON.stringify(t.status)}).` };
    }
    const item = { content, status };
    if (typeof t.activeForm === 'string' && t.activeForm.trim()) item.activeForm = t.activeForm.trim();
    todos.push(item);
  }
  const warnings = [];
  const active = todos.filter((t) => t.status === 'in_progress').length;
  if (active > 1) warnings.push(`${active} tasks are in_progress; exactly one should be in_progress at a time.`);
  return { ok: true, todos, warnings };
}

const counts = (todos) => ({
  total: todos.length,
  pending: todos.filter((t) => t.status === 'pending').length,
  inProgress: todos.filter((t) => t.status === 'in_progress').length,
  completed: todos.filter((t) => t.status === 'completed').length,
});

const allDone = (todos) => todos.length > 0 && todos.every((t) => t.status === 'completed');

// Widget is shown while a turn runs (so finished lists stay visible), and afterwards only while work remains.
const widgetVisible = (todos, turnActive) => todos.length > 0 && (turnActive || !allDone(todos));

// Rebuild the list for the current branch: last todo tool result or todo-state entry wins.
function restoreFromBranch(entries) {
  let todos = [];
  for (const e of entries || []) {
    if (!e) continue;
    let raw;
    if (e.type === 'message' && e.message && e.message.role === 'toolResult' && e.message.toolName === 'todo') {
      const d = e.message.details;
      if (d && !d.error) raw = d.todos;
    } else if (e.type === 'custom' && e.customType === SESSION_ENTRY_TYPE) {
      raw = e.data && e.data.todos;
    }
    if (raw === undefined) continue;
    const r = normalizeTodos(raw);
    if (r.ok) todos = r.todos;
  }
  return todos;
}

// Turn plan steps into a fresh list: first step in_progress, the rest pending.
function seedFromSteps(steps) {
  return (steps || [])
    .map((s) => (typeof s === 'string' ? { content: s } : s))
    .map((s, i) => ({ ...s, status: s.status || (i === 0 ? 'in_progress' : 'pending') }));
}

// Text the model sees after a successful update.
function resultText(todos, warnings = []) {
  const c = counts(todos);
  let text = 'Todos have been modified successfully. Keep using the todo list to track progress and continue with the current task.';
  text += `\n${c.completed}/${c.total} completed, ${c.inProgress} in progress, ${c.pending} pending.`;
  if (allDone(todos)) text += '\nAll tasks are completed.';
  for (const w of warnings) text += `\nWarning: ${w}`;
  return text;
}

module.exports = { STATUSES, SESSION_ENTRY_TYPE, SEED_EVENT, normalizeTodos, counts, allDone, widgetVisible, restoreFromBranch, seedFromSteps, resultText };
