'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument, parseNotebook, serializeNotebook, spliceCell } = require('../nbio.js');
const { resolvePath } = require('../paths.js');
const { applyEdit } = require('../edit.js');

const python = fs.readFileSync(path.join(__dirname, 'fixtures', 'python.ipynb'), 'utf8');

test('Python-written notebooks (sorted keys, ensure_ascii=False, 1.0, big ints) round-trip byte for byte', () => {
  assert.equal(serializeNotebook(parseNotebook(python)), python);
  for (const name of fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => f.endsWith('.ipynb'))) {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
    if (raw === serializeNotebook(JSON.parse(raw))) assert.equal(serializeNotebook(parseNotebook(raw)), raw, name);
  }
});

test('parser accepts a BOM, rejects invalid JSON and non-nbformat-4', () => {
  assert.equal(parseDocument(`﻿${python}`).bom, '﻿');
  for (const bad of ['', '{not json', '{"cells":[],"nbformat":3}', '[]', '{"cells":[],"nbformat":4} x', '{"cells":[01],"nbformat":4}']) assert.throws(() => parseNotebook(bad), undefined, bad);
});

test('splice insert, replace and delete keep the surrounding bytes and match full serialization', () => {
  const doc = parseDocument(python);
  for (const params of [{ cell: 0, mode: 'insert', source: 'a' }, { cell: 2, mode: 'insert', source: 'b' }, { cell: 3, mode: 'insert', source: 'c' }, { cell: 2, mode: 'replace', source: 'd', cellType: 'markdown' }, { cell: 1, mode: 'delete' }, { cell: 3, mode: 'delete' }]) {
    const edited = applyEdit(doc.nb, params);
    const index = params.mode === 'insert' ? (params.cell === 0 ? 0 : params.cell) : params.cell - 1;
    const text = spliceCell(doc, { mode: params.mode, index, cell: edited.cells[index] });
    assert.equal(serializeNotebook(parseNotebook(text)), serializeNotebook(edited), JSON.stringify(params));
    if (params.mode !== 'replace') assert.ok(text.includes('12345678901234567890') && text.includes('"ratio": 1.0'), JSON.stringify(params));
  }
});

test('splice handles empty and minified cell arrays', () => {
  const empty = parseDocument('{\n "cells": [],\n "metadata": {},\n "nbformat": 4,\n "nbformat_minor": 5\n}\n');
  const added = applyEdit(empty.nb, { cell: 0, mode: 'insert', source: 'x' });
  const text = spliceCell(empty, { mode: 'insert', index: 0, cell: added.cells[0] });
  assert.match(text, /"cells": \[\n  \{\n   "cell_type": "code"/);
  assert.equal(serializeNotebook(parseNotebook(text)), serializeNotebook(added));
  const one = parseDocument(text);
  assert.equal(spliceCell(one, { mode: 'delete', index: 0 }), '{\n "cells": [],\n "metadata": {},\n "nbformat": 4,\n "nbformat_minor": 5\n}\n');
  const mini = parseDocument('{"cells":[{"cell_type":"code","id":"a1"}],"nbformat":4,"nbformat_minor":5}');
  const out = spliceCell(mini, { mode: 'insert', index: 1, cell: { cell_type: 'markdown', id: 'z' } });
  assert.equal(out, '{"cells":[{"cell_type":"code","id":"a1"},{"cell_type":"markdown","id":"z"}],"nbformat":4,"nbformat_minor":5}');
});

test('inserted and replaced cells have alphabetically sorted keys', () => {
  const nb = parseNotebook(python);
  assert.deepEqual(Object.keys(applyEdit(nb, { cell: 1, mode: 'insert', source: 'a' }).cells[1]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source']);
  assert.deepEqual(Object.keys(applyEdit(nb, { cell: 1, mode: 'replace', source: 'a', cellType: 'code' }).cells[0]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source']);
});

test('resolvePath follows Pi: strips @, expands ~, normalizes unicode spaces', () => {
  assert.equal(resolvePath('@a/b.ipynb', '/w'), path.resolve('/w/a/b.ipynb'));
  assert.equal(resolvePath('~/x.ipynb', '/w', '/home/u'), path.resolve('/home/u/x.ipynb'));
  assert.equal(resolvePath('@~/x.ipynb', '/w', '/home/u'), path.resolve('/home/u/x.ipynb'));
  assert.equal(resolvePath('a b.ipynb', '/w'), path.resolve('/w/a b.ipynb'));
  assert.equal(resolvePath('/abs/y.ipynb', '/w'), '/abs/y.ipynb');
});
