const test = require('node:test');
const assert = require('node:assert/strict');

const { stripAnsi, visibleWidth } = require('../ansi.js');
const state = require('../state.js');
const render = require('../render.js');

const list = [
  { content: 'Read code', status: 'completed' },
  { content: 'Write fix', status: 'in_progress', activeForm: 'Writing fix' },
  { content: 'Run tests', status: 'pending' },
];

test('normalizeTodos validates and trims', () => {
  const r = state.normalizeTodos([{ content: '  a   b ', status: 'pending' }, { content: 'c' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.todos, [{ content: 'a b', status: 'pending' }, { content: 'c', status: 'pending' }]);
  assert.deepEqual(r.warnings, []);
  assert.equal(state.normalizeTodos('x').ok, false);
  assert.equal(state.normalizeTodos([{ content: '', status: 'pending' }]).ok, false);
  assert.match(state.normalizeTodos([{ content: 'a', status: 'done' }]).error, /status must be one of/);
  assert.equal(state.normalizeTodos([]).ok, true);
});

test('normalizeTodos warns on several in_progress', () => {
  const r = state.normalizeTodos([{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }]);
  assert.equal(r.ok, true);
  assert.match(r.warnings[0], /exactly one/);
  assert.match(state.resultText(r.todos, r.warnings), /Warning/);
});

test('counts, allDone, widgetVisible', () => {
  assert.deepEqual(state.counts(list), { total: 3, pending: 1, inProgress: 1, completed: 1 });
  const done = [{ content: 'a', status: 'completed' }];
  assert.equal(state.allDone(done), true);
  assert.equal(state.allDone([]), false);
  assert.equal(state.widgetVisible([], true), false);
  assert.equal(state.widgetVisible(done, true), true);
  assert.equal(state.widgetVisible(done, false), false);
  assert.equal(state.widgetVisible(list, false), true);
});

test('restoreFromBranch: last tool result or state entry wins, errors ignored', () => {
  const entries = [
    { type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { todos: [{ content: 'a', status: 'pending' }] } } },
    { type: 'message', message: { role: 'toolResult', toolName: 'bash', details: {} } },
    { type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { todos: [], error: 'bad' } } },
  ];
  assert.deepEqual(state.restoreFromBranch(entries), [{ content: 'a', status: 'pending' }]);
  entries.push({ type: 'custom', customType: 'todo-state', data: { todos: [] } });
  assert.deepEqual(state.restoreFromBranch(entries), []);
  assert.deepEqual(state.restoreFromBranch(undefined), []);
});

test('seedFromSteps makes first step in_progress', () => {
  assert.deepEqual(state.seedFromSteps(['a', 'b']), [
    { content: 'a', status: 'in_progress' },
    { content: 'b', status: 'pending' },
  ]);
});

test('widgetLines glyphs and styling', () => {
  const out = render.widgetLines(list, { width: 80 });
  assert.deepEqual(out.map(stripAnsi), ['  ☒ Read code', '  ◼ Write fix', '  ☐ Run tests']);
  assert.match(out[0], /\u001b\[9m/); // strikethrough
  assert.match(out[1], /\u001b\[1m/); // bold
  assert.match(out[1], /38;2;83;224;224/); // accent glyph
  assert.doesNotMatch(out[2], /\u001b\[/);
});

test('widgetLines truncates to width and folds long lists', () => {
  const out = render.widgetLines([{ content: 'x'.repeat(100), status: 'pending' }], { width: 20 });
  assert.ok(visibleWidth(out[0]) <= 20);
  const many = Array.from({ length: 15 }, (_, i) => ({ content: `t${i}`, status: i < 3 ? 'completed' : 'pending' }));
  const folded = render.widgetLines(many, { width: 80, max: 12 }).map(stripAnsi);
  assert.equal(folded.length, 13);
  assert.equal(folded.at(-1), '  … +3 more');
  assert.ok(!folded.includes('  ☒ t0')); // completed dropped first
});

test('call line and result lines', () => {
  assert.equal(stripAnsi(render.formatCallLine({ state: 'success' })), '⏺ Update Todos');
  assert.equal(stripAnsi(render.formatCallLine({ pad: 2 })), '  ⏺ Update Todos');
  assert.match(render.formatCallLine({ state: 'error' }), /38;2;255;107;128/);
  assert.deepEqual(render.formatResult(list, {}).map(stripAnsi), ['  ⎿  1/3 done · ◼ Write fix']);
  assert.equal(stripAnsi(render.formatResult([{ content: 'a', status: 'completed' }], {})[0]), '  ⎿  1/1 done');
  const out = render.formatResult(list, { expanded: true }).map(stripAnsi);
  assert.deepEqual(out, ['  ⎿  ☒ Read code', '     ◼ Write fix', '     ☐ Run tests']);
  assert.equal(stripAnsi(render.formatResult([], {})[0]), '  ⎿  Todo list cleared');
  assert.equal(stripAnsi(render.formatResult(null, { isError: true, errorText: 'nope' })[0]), '  ⎿  nope');
  assert.equal(stripAnsi(render.formatResult(list, { isPartial: true })[0]), '  ⎿  Updating…');
  assert.equal(render.plainList(list), '☒ Read code\n◼ Write fix\n☐ Run tests');
});

test('todo list survives compaction: rebuilt from the full branch, not the compacted context', () => {
  // getBranch() returns every entry on the path (compaction does not delete them); the todo result sits
  // BEFORE the compaction entry and outside the kept messages.
  const entries = [
    { type: 'message', id: '1', message: { role: 'user', content: 'go' } },
    { type: 'message', id: '2', message: { role: 'toolResult', toolName: 'todo', details: { todos: list } } },
    { type: 'message', id: '3', message: { role: 'assistant', content: 'working' } },
    { type: 'compaction', id: '4', summary: 'summary', firstKeptEntryId: '3', tokensBefore: 1000 },
    { type: 'message', id: '5', message: { role: 'user', content: 'continue' } },
  ];
  assert.deepEqual(state.restoreFromBranch(entries), list);
  // A later update after compaction still wins.
  const next = [{ content: 'Read code', status: 'completed' }];
  entries.push({ type: 'message', id: '6', message: { role: 'toolResult', toolName: 'todo', details: { todos: next } } });
  assert.deepEqual(state.restoreFromBranch(entries), next);
});

test('setItemStatus toggles by 1-based number and rejects bad numbers', () => {
  const done = state.setItemStatus(list, '3', 'completed');
  assert.equal(done.ok, true);
  assert.equal(done.todos[2].status, 'completed');
  assert.equal(list[2].status, 'pending', 'input is not mutated');
  const undo = state.setItemStatus(list, 1, 'pending');
  assert.equal(undo.todos[0].status, 'pending');
  for (const n of ['0', '4', 'x', '1.5']) assert.equal(state.setItemStatus(list, n, 'completed').ok, false, n);
});
