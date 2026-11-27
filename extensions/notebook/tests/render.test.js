'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseNotebook } = require('../nbio.js');
const { renderNotebook } = require('../render.js');

function nb(cells, minor = 5) { return { cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } }, nbformat: 4, nbformat_minor: minor }; }
function code(source, outputs = [], id = 'a1b2c3d4') { return { cell_type: 'code', execution_count: 3, id, metadata: {}, outputs, source: [source] }; }

test('renders markdown and code cells with source, cell ranges and footer', () => {
  const text = renderNotebook(nb([
    { cell_type: 'markdown', metadata: {}, source: ['# Model training\n'] },
    code('print("hello")'),
    code('model.fit(x)', [], 'c3d4e5f6'),
  ]), { fileName: 'train.ipynb', from: 2, limit: 1 });
  assert.match(text, /Notebook: train\.ipynb · python3 · 3 cells \(showing 2–2 of 3\)/);
  assert.match(text, /\[2\] code · id=a1b2c3d4 · exec 3/);
  assert.match(text, /```python\nprint\("hello"\)\n```/);
  assert.match(text, /Showing cells 2–2 of 3\. Read with offset 3 for more\./);
  assert.doesNotMatch(text, /model\.fit/);
});

test('renders stream output caps, image placeholders, HTML fallback, and error tails', () => {
  const many = Array.from({ length: 30 }, (_, i) => `line ${i + 1}\n`);
  const text = renderNotebook(nb([
    code('print(1)', [
      { output_type: 'stream', name: 'stdout', text: many },
      { output_type: 'display_data', data: { 'image/png': 'a'.repeat(80), 'text/plain': ['chart\n'], 'text/html': '<b>ignored</b>' }, metadata: {} },
      { output_type: 'display_data', data: { 'text/html': '<div><b>only</b> html</div>' }, metadata: {} },
      { output_type: 'error', ename: 'ValueError', evalue: 'bad shape', traceback: ['ansi\u001b[31mold\u001b[0m', ...Array.from({ length: 8 }, (_, i) => `trace ${i}`)] },
    ]),
  ]));
  assert.match(text, /line 1\n\s+line 2/);
  assert.match(text, /line 29\n\s+line 30/);
  assert.match(text, /10 lines omitted/);
  assert.match(text, /\[image\/png 60 bytes omitted\]/);
  assert.match(text, /only html/);
  assert.doesNotMatch(text, /ignored/);
  assert.match(text, /ValueError: bad shape/);
  assert.match(text, /trace 6\n\s+trace 7/);
  assert.doesNotMatch(text, /\u001b/);
});

test('enforces total cap and pages by cell number', () => {
  const text = renderNotebook(nb(Array.from({ length: 20 }, (_, i) => code('x'.repeat(200) + i, [], `id00000${i}`))), { maxChars: 1000 });
  assert.ok(text.length <= 1000);
  assert.match(text, /Showing cells 1–\d+ of 20\. Read with offset \d+ for more\./);
});

test('nbformat 4.4 renders without cell ids', () => {
  const cell = code('print(1)'); delete cell.id;
  const text = renderNotebook(nb([cell], 4));
  assert.match(text, /\[1\] code · exec 3/);
  assert.doesNotMatch(text, /id=undefined/);
});

test('fixture files parse and render without exposing image payloads', () => {
  const dir = path.join(__dirname, 'fixtures');
  for (const name of ['small.ipynb', 'image.ipynb', 'error.ipynb', 'nbformat44.ipynb', 'nbformat45.ipynb']) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    const text = renderNotebook(parseNotebook(raw), { fileName: name });
    assert.match(text, /Notebook:/);
    assert.doesNotMatch(text, /iVBORw0KGgo/);
  }
});

test('strips ANSI from streams, text/plain, ename and evalue', () => {
  const text = renderNotebook(nb([code('x', [
    { output_type: 'stream', name: 'stderr', text: ['\u001b[31mred\u001b[0m\n'] },
    { output_type: 'execute_result', data: { 'text/plain': '\u001b[1mbold\u001b[0m' }, metadata: {} },
    { output_type: 'error', ename: '\u001b[31mE\u001b[0m', evalue: '\u001b[31mbad\u001b[0m', traceback: [] },
  ])]));
  assert.doesNotMatch(text, /\u001b/);
  assert.match(text, /red/); assert.match(text, /bold/); assert.match(text, /E: bad/);
});

test('offset beyond the last cell and non-positive limits give clear messages', () => {
  const book = nb([code('a'), code('b'), code('c')]);
  const beyond = renderNotebook(book, { from: 99 });
  assert.match(beyond, /Offset 99 is beyond the last cell \(3 cells\)/);
  assert.doesNotMatch(beyond, /\[3\]/);
  assert.match(renderNotebook(book, { from: 2, limit: 0 }), /Limit must be at least 1/);
  assert.doesNotMatch(renderNotebook(book, { from: 2, limit: 0 }), /\[2\]/);
  assert.match(renderNotebook(book, { from: -4, limit: 1 }), /showing 1–1 of 3/);
  assert.match(renderNotebook(nb([])), /0 cells \(showing 0 of 0\)/);
});

test('multiline strings join without extra newlines', () => {
  const text = renderNotebook(nb([code('x', [{ output_type: 'stream', name: 'stdout', text: ['a\n', 'b'] }, { output_type: 'stream', name: 'stdout', text: ['ab', 'cd'] }])]));
  assert.match(text, /   a\n   b/);
  assert.match(text, /   abcd/);
});

test('json, svg, markdown and latex outputs, ids on all cells, fences and languages', () => {
  const text = renderNotebook({ cells: [
    { cell_type: 'markdown', id: 'mdid0001', metadata: {}, source: ['hi'] },
    { cell_type: 'raw', id: 'rawid001', metadata: {}, source: ['raw'] },
    code('print("```")', [
      { output_type: 'display_data', data: { 'application/json': { a: 1 }, 'image/svg+xml': ['<svg>', '</svg>'] }, metadata: {} },
      { output_type: 'display_data', data: { 'text/markdown': ['**md**'], 'text/latex': '$x$' }, metadata: {} },
      { output_type: 'display_data', data: { 'text/latex': '$y$' }, metadata: {} },
    ]),
  ], metadata: { language_info: { name: 'julia' } }, nbformat: 4, nbformat_minor: 5 });
  assert.match(text, /\[1\] markdown · id=mdid0001/);
  assert.match(text, /\[2\] raw · id=rawid001/);
  assert.match(text, /````julia\nprint\("```"\)\n````/);
  assert.match(text, /application\/json \{"a":1\}/);
  assert.match(text, /\[image\/svg\+xml 11 bytes omitted\]/);
  assert.match(text, /text\/markdown\n   \*\*md\*\*/);
  assert.match(text, /text\/latex\n   \$y\$/);
  assert.doesNotMatch(text, /\$x\$/);
  assert.doesNotMatch(text, /object Object/);
  assert.match(renderNotebook({ cells: [code('1')], metadata: {} , nbformat: 4}), /```\n1\n```/);
});
