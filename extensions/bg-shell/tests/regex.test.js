'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMatcher } = require('../regex.js');

test('matches case-insensitively and filters whole lines', () => {
  const m = createMatcher('ready', 'waitFor');
  assert.equal(m.test('Server READY'), true);
  assert.equal(m.test('nope'), false);
  assert.equal(m.filterLines('a\nready b\nc\nREADY'), 'ready b\nREADY');
});

test('rejects invalid and over-long patterns', () => {
  assert.throws(() => createMatcher('(', 'filter'), /filter must be a valid regular expression/);
  assert.throws(() => createMatcher('a'.repeat(201), 'filter'), /limited to 200/);
});

test('only the first 2000 characters of a line are tested, the whole line is kept', () => {
  const m = createMatcher('needle', 'filter');
  assert.equal(m.filterLines(`${'x'.repeat(100)}needle\n`), `${'x'.repeat(100)}needle\n`);
  const far = `${'x'.repeat(3000)}needle\n`;
  assert.equal(m.filterLines(far), '');
});

test('catastrophic backtracking is interrupted by the timeout', () => {
  for (const pattern of ['(a|a)*$', '^(\\w+\\s?)*$', '(a|aa)+$']) {
    const m = createMatcher(pattern, 'filter', { timeoutMs: 300 });
    const start = Date.now();
    assert.throws(() => m.filterLines(`${'a'.repeat(40)}!\n`), /filter regex took too long; use a simpler pattern/);
    assert.ok(Date.now() - start < 5000);
    // The matcher stays usable afterwards.
    assert.equal(typeof m.test('b'), 'boolean');
  }
});
