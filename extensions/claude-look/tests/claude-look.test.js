const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { stripAnsi, visibleWidth, truncate } = require('../ansi.js');
const { spinnerFrames, pingPong, pickVerb, workingIndicator } = require('../spinner.js');
const { transformMarkdown } = require('../markdown.js');
const { renderHeader } = require('../header.js');
const tools = require('../tools.js');

test('spinner ping-pongs glyphs in teal at 120ms', () => {
  assert.deepEqual(pingPong(['a', 'b', 'c']), ['a', 'b', 'c', 'b']);
  const frames = spinnerFrames().map(stripAnsi);
  assert.deepEqual(frames, ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']);
  assert.match(spinnerFrames()[1], /38;2;83;224;224/);
  assert.equal(workingIndicator().intervalMs, 120);
  assert.equal(pickVerb(() => 0), 'Thinking…');
});

test('markdown transformer prefixes paragraphs only', () => {
  assert.equal(transformMarkdown('Hello\nworld', { messageType: 'assistant' }), '⏺ Hello\nworld');
  assert.equal(transformMarkdown('\n\nHi', { messageType: 'assistant' }), '\n\n⏺ Hi');
  assert.equal(transformMarkdown('Hi', { messageType: 'user' }), '❯ Hi');
  for (const s of ['```js\ncode\n```', '# Title', '- item', '1. one', '> quote', '| a | b |', '    indented']) {
    assert.equal(transformMarkdown(s, { messageType: 'assistant' }), s);
  }
  assert.equal(transformMarkdown('think', { messageType: 'assistant-thinking' }), 'think');
  assert.equal(transformMarkdown('', { messageType: 'user' }), '');
});

test('truncate respects visible width and keeps ANSI', () => {
  const s = `\u001b[31m${'x'.repeat(50)}\u001b[39m`;
  const t = truncate(s, 10);
  assert.ok(visibleWidth(t) <= 10);
  assert.ok(t.endsWith('…'));
  assert.equal(truncate('short', 10), 'short');
});

test('header fits width', () => {
  for (const w of [20, 40, 80, 200]) {
    for (const l of renderHeader(w, { cwd: '/home/u/proj', home: '/home/u' })) assert.ok(visibleWidth(l) <= w, `w=${w}`);
  }
  assert.match(stripAnsi(renderHeader(80, { cwd: '/home/u/p', home: '/home/u' }).join('\n')), /Welcome to Pi[\s\S]*~\/p/);
});

test('call line formatting', () => {
  assert.equal(stripAnsi(tools.formatCallLine('bash', { command: 'ls -la' })), '⏺ Bash(ls -la)');
  assert.equal(stripAnsi(tools.formatCallLine('read', { path: '/w/a.ts' }, { cwd: '/w' })), '⏺ Read(a.ts)');
  assert.equal(stripAnsi(tools.formatCallLine('grep', { pattern: 'foo' })), '⏺ Search(pattern: "foo")');
  assert.equal(stripAnsi(tools.formatCallLine('bash', undefined)), '⏺ Bash');
  assert.match(tools.formatCallLine('bash', { command: 'x' }, { state: 'success' }), /38;2;78;186;101/);
  assert.match(tools.formatCallLine('bash', { command: 'x' }, { state: 'error' }), /38;2;255;107;128/);
  assert.ok(visibleWidth(tools.formatCallLine('bash', { command: 'y'.repeat(300) }, { width: 40 })) <= 40);
});

test('result collapses to 3 lines with fold hint, expands fully', () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  const c = tools.formatResult('bash', { content: [{ type: 'text', text }] }, { width: 80 }).map(stripAnsi);
  assert.deepEqual(c, ['  ⎿  line 1', '     line 2', '     line 3', '     … +7 lines (ctrl+o to expand)']);
  const e = tools.formatResult('bash', { content: [{ type: 'text', text }] }, { width: 80, expanded: true }).map(stripAnsi);
  assert.equal(e.length, 10);
  assert.equal(e[9], '     line 10');
});

test('partial and empty results', () => {
  assert.equal(stripAnsi(tools.formatResult('bash', {}, { isPartial: true })[0]), '  ⎿  Running…');
  assert.equal(stripAnsi(tools.formatResult('bash', { content: [] }, {})[0]), '  ⎿  (No content)');
});

test('error results are red', () => {
  const l = tools.formatResult('bash', { content: [{ type: 'text', text: 'boom' }] }, { isError: true })[0];
  assert.match(l, /38;2;255;107;128/);
});

test('edit diff gets coloured backgrounds and a summary', () => {
  const diff = ' 1 keep\n-2 old\n+2 new\n+3 more';
  const out = tools.formatResult('edit', { content: [], details: { diff } }, { width: 60 });
  assert.equal(stripAnsi(out[0]), '  ⎿  Updated with 2 additions and 1 removal');
  assert.match(out[2], /48;2;122;41;54/);
  assert.match(out[3], /48;2;34;92;43/);
  for (const l of out) assert.ok(visibleWidth(l) <= 60);
});

test('unhandled tools fall through', () => {
  assert.equal(tools.isHandled('mcp__x__y'), false);
  assert.equal(tools.isHandled('bash'), true);
});

test('claude-dark theme has all required keys and no unknown ones', () => {
  const root = path.join(__dirname, '..'); // theme lives in extensions/claude-look/themes
  const theme = JSON.parse(fs.readFileSync(path.join(root, 'themes', 'claude-dark.json'), 'utf8'));
  const schemaPath = path.join(process.env.HOME, '.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json');
  if (!fs.existsSync(schemaPath)) return; // Pi not installed here
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const colorsSchema = schema.properties.colors;
  const required = colorsSchema.required || [];
  const known = Object.keys(colorsSchema.properties || {});
  const have = Object.keys(theme.colors);
  assert.deepEqual(required.filter((k) => !have.includes(k)), [], 'missing colour keys');
  assert.deepEqual(have.filter((k) => !known.includes(k)), [], 'unknown colour keys');
  const vars = Object.keys(theme.vars);
  for (const [k, v] of Object.entries(theme.colors)) {
    assert.ok(v === '' || v.startsWith('#') || vars.includes(v), `${k}: bad ref ${v}`);
  }
});

test('wrapAnsi wraps at spaces, hard-breaks, handles wide chars and carries colour', () => {
  const { wrapAnsi } = require('../ansi.js');
  assert.deepEqual(wrapAnsi('aaa bbb ccc', 7).map(stripAnsi), ['aaa bbb', 'ccc']);
  assert.deepEqual(wrapAnsi('abcdefghij', 4).map(stripAnsi), ['abcd', 'efgh', 'ij']);
  const wide = wrapAnsi('日本語日本語', 6).map(stripAnsi);
  assert.deepEqual(wide, ['日本語', '日本語']);
  const coloured = wrapAnsi(`\u001b[31m${'word '.repeat(10)}\u001b[39m`, 12);
  assert.ok(coloured.length > 1);
  for (const r of coloured) { assert.ok(visibleWidth(r) <= 12); assert.ok(r.startsWith('\u001b[31m')); }
  assert.equal(stripAnsi(coloured.join(' ')).replace(/\s+/g, ' ').trim(), 'word '.repeat(10).trim());
});

test('long result lines wrap instead of truncating, collapsed and expanded', () => {
  const long = 'The quick brown fox jumps over the lazy dog. '.repeat(4).trim();
  const run = (o) => tools.formatTextResult(long, { width: 40, ...o }).map(stripAnsi);
  for (const expanded of [false, true]) {
    const rows = run({ expanded });
    assert.ok(rows.length > 3);
    assert.ok(rows[0].startsWith('  ⎿  ') && rows[1].startsWith('     '));
    for (const r of rows) assert.ok(visibleWidth(r) <= 40);
    assert.ok(!rows.join('').includes('…'));
    assert.equal(rows.map((r) => r.slice(5)).join(' ').replace(/\s+/g, ' ').trim(), long);
  }
});

test('collapsed fold counts source lines and wraps within the 3-line budget', () => {
  const text = ['x'.repeat(100), 'b', 'c', 'd', 'e'].join('\n');
  const rows = tools.formatTextResult(text, { width: 40 }).map(stripAnsi);
  assert.equal(rows[rows.length - 1], '     … +2 lines (ctrl+o to expand)');
  assert.ok(rows.join('\n').includes('c'));
});

test('leading and trailing blank lines are trimmed (no dangling ⎿)', () => {
  const rows = tools.formatTextResult('\n\n  \n> test\nok\n\n', { width: 80 }).map(stripAnsi);
  assert.deepEqual(rows, ['  ⎿  > test', '     ok']);
  assert.deepEqual(tools.formatTextResult('\n\n', {}).map(stripAnsi), ['  ⎿  (No content)']);
});

test('streaming call line shows only the name until the arg arrives', () => {
  for (const t of ['edit', 'write', 'read', 'ls']) assert.equal(stripAnsi(tools.formatCallLine(t, {})), `⏺ ${tools.displayName(t)}`);
  assert.equal(stripAnsi(tools.formatCallLine('bash', {})), '⏺ Bash');
  assert.equal(stripAnsi(tools.formatCallLine('edit', { path: 'a.js' })), '⏺ Update(a.js)');
});
