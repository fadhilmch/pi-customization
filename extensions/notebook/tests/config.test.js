'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfig } = require('../config.js');

test('user config sets the output cap and project config only lowers it', () => {
  assert.deepEqual(mergeConfig({ maxChars: 40000 }, { maxChars: 1000 }), { maxChars: 1000, exposure: 'direct' });
  assert.deepEqual(mergeConfig({ maxChars: 3000 }, { maxChars: 9000 }), { maxChars: 3000, exposure: 'direct' });
  assert.deepEqual(mergeConfig({ maxChars: 100000 }, {}), { maxChars: 50000, exposure: 'direct' });
  assert.equal(mergeConfig({ exposure: 'deferred' }, { exposure: 'direct' }).exposure, 'deferred');
});
