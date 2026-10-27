const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../handoff.js');

const msg = (id, text) => ({ id, type: 'message', message: { role: 'user', content: text } });

test('getHandoffMessages without compaction maps message entries and drops others', () => {
  const branch = [msg('1', 'a'), { id: 'x', type: 'label' }, msg('2', 'b')];
  assert.deepEqual(h.getHandoffMessages(branch).map((m) => m.content), ['a', 'b']);
});

test('getHandoffMessages with compaction keeps summary, kept tail, and later entries', () => {
  const branch = [
    msg('1', 'old'),
    msg('2', 'kept'),
    { id: 'c', type: 'compaction', summary: 'S', tokensBefore: 10, firstKeptEntryId: '2', timestamp: '2026-01-01T00:00:00Z' },
    msg('3', 'new'),
  ];
  const out = h.getHandoffMessages(branch);
  assert.equal(out[0].role, 'compactionSummary');
  assert.equal(out[0].summary, 'S');
  assert.equal(out[0].timestamp, Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(out.slice(1).map((m) => m.content), ['kept', 'new']);
});

test('compaction with unknown firstKeptEntryId falls back to summary + later entries', () => {
  const branch = [msg('1', 'old'), { id: 'c', type: 'compaction', summary: 'S', firstKeptEntryId: 'zzz', timestamp: 0 }, msg('3', 'new')];
  assert.deepEqual(h.getHandoffMessages(branch).map((m) => m.content ?? m.summary), ['S', 'new']);
});

test('user message text, text extraction, parent reference', () => {
  const t = h.buildUserMessageText('CONV', 'do X');
  assert.match(t, /## Conversation History\n\nCONV/);
  assert.match(t, /## User's Goal for New Thread\n\ndo X$/);
  assert.equal(h.extractText([{ type: 'text', text: 'a' }, { type: 'thinking', thinking: 'z' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(h.extractText(undefined), '');
  assert.equal(h.withParentReference(' hi ', undefined), 'hi');
  assert.match(h.withParentReference('hi', '/s/file.jsonl'), /hi\n\n---\n.*\/s\/file\.jsonl\n/);
  assert.equal(h.parseGoal('  go  '), 'go');
  assert.deepEqual(h.previewStats('a\nb'), { chars: 3, lines: 2 });
  assert.match(h.SYSTEM_PROMPT, /self-contained/);
});

test('parseArgs recognises --no-review only as the leading flag', () => {
  assert.deepEqual(h.parseArgs('--no-review do x'), { goal: 'do x', noReview: true });
  assert.deepEqual(h.parseArgs('  --no-review  '), { goal: '', noReview: true });
  assert.deepEqual(h.parseArgs('do x --no-review'), { goal: 'do x --no-review', noReview: false });
  assert.deepEqual(h.parseArgs('--no-reviewer'), { goal: '--no-reviewer', noReview: false });
});

test('footer points at read_session', () => {
  assert.match(h.withParentReference('hi', '/s/f.jsonl'), /read_session/);
});

test('todosFromBranch and planModeFromBranch read other extensions state without importing them', () => {
  const branch = [
    { type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { todos: [{ content: 'a', status: 'pending' }] } } },
    { type: 'custom', customType: 'todo-state', data: { todos: [{ content: 'b', status: 'in_progress' }] } },
    { type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { error: 'x', todos: [] } } },
    { type: 'custom', customType: 'plan-mode', data: { enabled: true } },
  ];
  assert.deepEqual(h.todosFromBranch(branch), [{ content: 'b', status: 'in_progress' }]);
  assert.equal(h.planModeFromBranch(branch), true);
  assert.equal(h.todosFromBranch([]), undefined);
  assert.equal(h.planModeFromBranch([]), undefined);
});

test('buildLiveState skips missing pieces and caps long lists', () => {
  assert.equal(h.buildLiveState({}), '');
  assert.equal(h.buildLiveState(), '');
  const out = h.buildLiveState({
    branchName: 'feat/x',
    statusLines: Array.from({ length: 20 }, (_, i) => ` M f${i}`),
    todos: [{ content: 'do it', status: 'in_progress' }],
    planMode: true,
  });
  assert.match(out, /Git branch: feat\/x/);
  assert.match(out, /… and 5 more/);
  assert.match(out, /- \[in_progress\] do it/);
  assert.match(out, /Plan mode: active/);
  assert.match(h.buildLiveState({ branchName: 'm', statusLines: [] }), /clean/);
  assert.doesNotMatch(h.buildLiveState({ planMode: false, todos: [] }), /Plan|Todo/);
  assert.match(h.buildUserMessageText('C', 'g', 'LIVE'), /## Live State\n\nLIVE\n\n## User's Goal/);
  assert.doesNotMatch(h.buildUserMessageText('C', 'g'), /Live State/);
});
