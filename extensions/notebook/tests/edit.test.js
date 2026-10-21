'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEdit } = require('../edit.js');
const { serializeNotebook } = require('../nbio.js');

function nb(minor = 5) { return { cells: [
  { cell_type: 'markdown', metadata: {}, source: ['intro\n'] },
  { cell_type: 'code', execution_count: 4, id: 'code1234', metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['old\n'] }], source: ['x = 1\n'] },
], metadata: {}, nbformat: 4, nbformat_minor: minor }; }

test('replaces by number and id and clears stale code outputs', () => {
  const byNumber = applyEdit(nb(), { cell: 2, mode: 'replace', source: 'x = 2\nprint(x)' });
  assert.deepEqual(byNumber.cells[1].source, ['x = 2\n', 'print(x)']);
  assert.deepEqual(byNumber.cells[1].outputs, []);
  assert.equal(byNumber.cells[1].execution_count, null);
  const byId = applyEdit(nb(), { cell: 'code1234', mode: 'replace', source: '## New', cellType: 'markdown' });
  assert.equal(byId.cells[1].cell_type, 'markdown');
  assert.deepEqual(byId.cells[1].source, ['## New']);
  assert.equal('outputs' in byId.cells[1], false);
});

test('inserts at top, middle, and end; creates ids only for 4.5+', () => {
  for (const [cell, expectedIndex] of [[0, 0], [1, 1], [2, 2]]) {
    const edited = applyEdit(nb(), { cell, mode: 'insert', source: 'new cell' });
    assert.equal(edited.cells[expectedIndex].source[0], 'new cell');
    assert.match(edited.cells[expectedIndex].id, /^[a-f0-9]{8}$/);
  }
  const old = applyEdit(nb(4), { cell: 0, mode: 'insert', source: 'legacy', cellType: 'code' });
  assert.equal(old.cells[0].id, undefined);
  assert.deepEqual(old.cells[0].outputs, []);
  const byId = applyEdit(nb(), { cell: 'code1234', mode: 'insert', source: 'after id' });
  assert.equal(byId.cells[2].source[0], 'after id');
});

test('deletes by id and reports valid locations for unknown cells', () => {
  const edited = applyEdit(nb(), { cell: 'code1234', mode: 'delete' });
  assert.equal(edited.cells.length, 1);
  assert.throws(() => applyEdit(nb(), { cell: 'missing', mode: 'delete' }), /Valid cells: 1, 2 \(id=code1234\)/);
});

test('round-trip serialization preserves standard nbformat bytes', () => {
  const notebook = nb();
  const bytes = JSON.stringify(notebook, null, 1) + '\n';
  assert.equal(serializeNotebook(JSON.parse(bytes)), bytes);
});
