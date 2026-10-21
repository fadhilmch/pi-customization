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
  const many = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
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
