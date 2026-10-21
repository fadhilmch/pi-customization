'use strict';

const crypto = require('node:crypto');
const { sourceText } = require('./render.js');

function sourceLines(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (!text) return [];
  const parts = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  return parts;
}

function clone(nb) { return JSON.parse(JSON.stringify(nb)); }

function resolveCell(cells, cell, { insertion = false } = {}) {
  if (typeof cell === 'string') {
    const index = cells.findIndex((entry) => entry.id === cell);
    if (index >= 0) return insertion ? index + 1 : index;
  } else if (Number.isInteger(cell)) {
    if (insertion && cell === 0) return 0;
    if (insertion && cell >= 1 && cell <= cells.length) return cell;
    if (!insertion && cell >= 1 && cell <= cells.length) return cell - 1;
  }
  const valid = cells.map((entry, i) => `${i + 1}${entry.id ? ` (id=${entry.id})` : ''}`).join(', ') || '(none)';
  throw new Error(`Unknown cell ${String(cell)}. Valid cells: ${valid}`);
}

function applyEdit(input, { cell, mode, source, cellType } = {}) {
  const nb = clone(input);
  if (cellType !== undefined && !['code', 'markdown'].includes(cellType)) throw new Error('cellType must be code or markdown');
  if (!['replace', 'insert', 'delete'].includes(mode)) throw new Error('mode must be replace, insert, or delete');
  if (mode !== 'delete' && typeof source !== 'string') throw new Error('source is required for replace and insert');
  const index = resolveCell(nb.cells, cell, { insertion: mode === 'insert' });
  if (mode === 'delete') {
    nb.cells.splice(index, 1);
    return nb;
  }
  if (mode === 'insert') {
    const newType = cellType || 'code';
    const added = { cell_type: newType, metadata: {}, source: sourceLines(source) };
    if (newType === 'code') { added.execution_count = null; added.outputs = []; }
    if (Number(nb.nbformat_minor) >= 5) {
      let id;
      do { id = crypto.randomBytes(4).toString('hex'); } while (nb.cells.some((entry) => entry.id === id));
      added.id = id;
    }
    nb.cells.splice(index, 0, added);
    return nb;
  }
  const target = nb.cells[index];
  target.cell_type = cellType || target.cell_type;
  target.source = sourceLines(source);
  if (target.cell_type === 'code') { target.outputs = []; target.execution_count = null; }
  else { delete target.outputs; delete target.execution_count; }
  return nb;
}

module.exports = { sourceLines, resolveCell, applyEdit, cellSource: sourceText };
