'use strict';

// Numbers that JSON.stringify would not print identically (1.0, 1e5, integers above 2^53) keep their source text.
class RawNumber {
  constructor(raw) { this.raw = raw; }
  toString() { return this.raw; }
  valueOf() { return Number(this.raw); }
  toJSON() { return Number(this.raw); }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

// Strict JSON parser that also records where the elements of the root "cells" array sit in the text.
function parseJson(text) {
  let i = 0;
  let cells = null;
  const fail = (what) => { throw new SyntaxError(`Invalid JSON at position ${i}: ${what}`); };
  const ws = () => { while (i < text.length) { const c = text.charCodeAt(i); if (c === 32 || c === 10 || c === 13 || c === 9) i++; else break; } };
  function string() {
    const start = i++;
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text.charCodeAt(i);
      if (c === 34) { i++; break; }
      if (c === 92) i += 2;
      else if (c < 0x20) fail('control character in string');
      else i++;
    }
    try { return JSON.parse(text.slice(start, i)); } catch { return fail('bad string'); }
  }
  function array(track) {
    const out = [];
    const spans = track ? { open: i, close: -1, items: [] } : null;
    i++; ws();
    if (text[i] === ']') { i++; if (spans) { spans.close = i - 1; cells = spans; } return out; }
    for (;;) {
      ws();
      const start = i;
      out.push(value());
      if (spans) spans.items.push({ start, end: i });
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; break; }
      fail('expected , or ]');
    }
    if (spans) { spans.close = i - 1; cells = spans; }
    return out;
  }
  function object(root) {
    const out = {};
    i++; ws();
    if (text[i] === '}') { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('expected key');
      const key = string();
      ws();
      if (text[i] !== ':') fail('expected :');
      i++; ws();
      if (root && key === 'cells') cells = null;
      const v = root && key === 'cells' && text[i] === '[' ? array(true) : value();
      Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; break; }
      fail('expected , or }');
    }
    return out;
  }
  function value(root = false) {
    ws();
    const c = text[i];
    if (c === '{') return object(root);
    if (c === '[') return array(false);
    if (c === '"') return string();
    for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) { i += word.length; return v; }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) return fail('unexpected token');
    i += m[0].length;
    const n = Number(m[0]);
    return JSON.stringify(n) === m[0] ? n : new RawNumber(m[0]);
  }
  const result = value(true);
  ws();
  if (i < text.length) fail('trailing characters');
  return { value: result, cells };
}

// Parses a notebook and keeps what is needed to write back only the edited cell.
function parseDocument(text) {
  let body = String(text);
  let bom = '';
  if (body.charCodeAt(0) === 0xFEFF) { bom = '﻿'; body = body.slice(1); }
  const { value: nb, cells } = parseJson(body);
  if (!nb || typeof nb !== 'object' || !Array.isArray(nb.cells) || Number(nb.nbformat) !== 4) throw new Error('Invalid notebook: expected nbformat 4 with a cells array');
  return { nb, bom, body, spans: cells && cells.items.length === nb.cells.length ? cells : null };
}

function parseNotebook(text) { return parseDocument(text).nb; }

// Matches Python's json.dumps(indent=1, ensure_ascii=False); unit null means compact.
function serialize(value, unit = ' ', depth = 0, sortKeys = false) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof RawNumber) return value.raw;
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  const pad = (n) => (unit === null ? '' : `\n${unit.repeat(n)}`);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[${value.map((item, k) => `${k ? ',' : ''}${pad(depth + 1)}${serialize(item, unit, depth + 1)}`).join('')}${pad(depth)}]`;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (sortKeys) keys.sort();
  if (!keys.length) return '{}';
  return `{${keys.map((key, k) => `${k ? ',' : ''}${pad(depth + 1)}${JSON.stringify(key)}:${unit === null ? '' : ' '}${serialize(value[key], unit, depth + 1)}`).join('')}${pad(depth)}}`;
}

function serializeNotebook(nb) { return `${serialize(nb)}\n`; }

// Splices one cell change into the original text so every other byte (number formats, escapes, key order) is untouched.
// Returns undefined when the layout cannot be located; callers then fall back to serializeNotebook.
function spliceCell(doc, { mode, index, cell }) {
  const { body, spans } = doc;
  if (!spans) return undefined;
  const { items, open, close } = spans;
  const root = /^\s*\{(\n[ \t]*)"/.exec(body);
  let unit;
  let between = '';
  if (items.length) {
    between = body.slice(open + 1, items[0].start);
    const lineIndent = between.slice(between.lastIndexOf('\n') + 1);
    unit = !between.includes('\n') ? null : lineIndent.length && lineIndent.length % 2 === 0 ? lineIndent.slice(0, lineIndent.length / 2) : ' ';
  } else unit = root ? root[1].slice(1) : null;
  if (unit === '') unit = ' ';
  const text = mode === 'delete' ? '' : serialize(cell, unit, 2, true);
  let result;
  if (!items.length) {
    if (mode !== 'insert') return undefined;
    result = unit === null ? `[${text}]` : `[\n${unit.repeat(2)}${text}\n${unit}]`;
    return body.slice(0, open) + result + body.slice(close + 1);
  }
  const sep = items.length > 1 ? body.slice(items[0].end, items[1].start) : `,${between}`;
  if (mode === 'replace') return body.slice(0, items[index].start) + text + body.slice(items[index].end);
  if (mode === 'insert') {
    if (index < items.length) return body.slice(0, items[index].start) + text + sep + body.slice(items[index].start);
    const last = items[items.length - 1];
    return body.slice(0, last.end) + sep + text + body.slice(last.end);
  }
  if (items.length === 1) return body.slice(0, open) + '[]' + body.slice(close + 1);
  if (index === items.length - 1) return body.slice(0, items[index - 1].end) + body.slice(items[index].end);
  return body.slice(0, items[index].start) + body.slice(items[index + 1].start);
}

module.exports = { RawNumber, parseNotebook, parseDocument, serialize, serializeNotebook, spliceCell };
