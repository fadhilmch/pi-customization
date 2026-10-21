const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeStatusText, collectStatuses, fitSegments } = require('../statuses.js');

test('sanitizeStatusText strips colors, control chars and extra spaces', () => {
  assert.equal(sanitizeStatusText('\u001b[32m⏵⏵  auto\tmode\u001b[0m\n'), '⏵⏵ auto mode');
  assert.equal(sanitizeStatusText(undefined), '');
});

test('collectStatuses sorts by key and drops empty values', () => {
  const map = new Map([
    ['plan-mode', '⏸ plan'],
    ['auto-mode', '⏵⏵ auto mode'],
    ['blank', '  '],
  ]);
  assert.deepEqual(collectStatuses(map), ['⏵⏵ auto mode', '⏸ plan']);
  assert.deepEqual(collectStatuses(null), []);
  assert.deepEqual(collectStatuses(new Map()), []);
});

test('fitSegments drops trailing segments that do not fit', () => {
  const segs = ['aaaa', 'bbbb', 'cccc'];
  assert.equal(fitSegments(segs, 100, { sep: '|' }), 'aaaa|bbbb|cccc');
  assert.equal(fitSegments(segs, 9, { sep: '|' }), 'aaaa|bbbb');
  assert.equal(fitSegments(segs, 8, { sep: '|' }), 'aaaa');
});

test('fitSegments cuts a first segment that is too long and skips empties', () => {
  assert.equal(fitSegments(['abcdefgh'], 3), 'abc');
  assert.equal(fitSegments(['', 'ab', ''], 10), 'ab');
  assert.equal(fitSegments([], 10), '');
  assert.equal(fitSegments(['ab'], 0), '');
});
