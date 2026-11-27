const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const s = require('../session.js');

const user = (t) => ({ type: 'message', message: { role: 'user', content: t } });
const asst = (content) => ({ type: 'message', message: { role: 'assistant', content } });
const result = (name, text, isError) => ({ type: 'message', message: { role: 'toolResult', toolName: name, content: [{ type: 'text', text }], isError } });

test('formatTranscript renders user, assistant, one-line tool calls and trimmed results', () => {
  const out = s.formatTranscript([
    { type: 'message', message: { role: 'system', content: '' } },
    user('fix the bug'),
    asst([{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'on it' }, { type: 'toolCall', name: 'read', arguments: { path: 'a.ts' } }]),
    result('read', 'l1\nl2\nl3\nl4\nl5'),
  ]);
  assert.match(out, /\[user\] fix the bug/);
  assert.match(out, /\[assistant\] on it\n {2}-> read\(\{"path":"a.ts"\}\)/);
  assert.doesNotMatch(out, /secret|system/);
  assert.match(out, /l3\n {4}… \(2 more lines\)/);
  assert.doesNotMatch(out, /l4/);
});

test('formatTranscript query filter, limit keeps newest, and size cap', () => {
  const entries = [user('alpha one'), user('beta'), user('alpha two')];
  const q = s.formatTranscript(entries, { query: 'ALPHA' });
  assert.match(q, /2 of 2 matching \(3 total\)/);
  assert.doesNotMatch(q, /beta/);
  const l = s.formatTranscript(entries, { limit: 1 });
  assert.match(l, /alpha two/);
  assert.doesNotMatch(l, /alpha one/);
  assert.match(s.formatTranscript(entries, { query: 'zzz' }), /No message matches/);
  assert.match(s.formatTranscript([]), /empty/);
  const big = s.formatTranscript(Array.from({ length: 200 }, () => user('x'.repeat(1400))), { limit: 200 });
  assert.ok(big.length < s.MAX_CHARS + 300);
  assert.match(big, /trimmed to size/);
});

test('parseSessionText skips corrupt lines', () => {
  assert.equal(s.parseSessionText('{"a":1}\nnot json\n\n{"b":2}').length, 2);
});

test('resolveSessionPath: parent default, sessions dir allowed, others refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-sess-'));
  const root = path.join(dir, 'sessions');
  fs.mkdirSync(root);
  const inside = path.join(root, 'a.jsonl');
  const outsideParent = path.join(dir, 'parent.jsonl');
  const outside = path.join(dir, 'other.jsonl');
  const txt = path.join(root, 'a.txt');
  for (const f of [inside, outsideParent, outside, txt]) fs.writeFileSync(f, '');
  const ctx = { parentSession: outsideParent, roots: s.sessionRoots({ sessionDir: root, env: {}, home: dir }) };
  assert.equal(s.resolveSessionPath('', ctx).path, fs.realpathSync(outsideParent));
  assert.equal(s.resolveSessionPath(inside, ctx).path, fs.realpathSync(inside));
  assert.match(s.resolveSessionPath(outside, ctx).error, /outside/);
  assert.match(s.resolveSessionPath(txt, ctx).error, /\.jsonl/);
  assert.match(s.resolveSessionPath(path.join(root, '..', 'other.jsonl'), ctx).error, /outside/);
  assert.match(s.resolveSessionPath(path.join(root, 'missing.jsonl'), ctx).error, /not found/);
  assert.match(s.resolveSessionPath('', { roots: ctx.roots }).error, /no linked parent/);
  // symlink escaping the sessions dir is refused
  const link = path.join(root, 'link.jsonl');
  fs.symlinkSync(outside, link);
  assert.match(s.resolveSessionPath(link, ctx).error, /outside/);
});
