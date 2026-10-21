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
  const root = path.join(__dirname, '..', '..', '..');
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
