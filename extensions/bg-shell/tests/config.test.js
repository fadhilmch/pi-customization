'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfig } = require('../config.js');

test('user config is bounded and project config can only tighten limits', () => {
  assert.deepEqual(mergeConfig({ maxJobs: 9, maxChars: 90000 }, { maxJobs: 2, maxChars: 500 }), { maxJobs: 2, maxChars: 500, exposure: 'direct' });
  assert.deepEqual(mergeConfig({ maxJobs: 2, maxChars: 4000 }, { maxJobs: 4, maxChars: 7000 }), { maxJobs: 2, maxChars: 4000, exposure: 'direct' });
  assert.deepEqual(mergeConfig({ maxJobs: -5, maxChars: 2 }, {}), { maxJobs: 1, maxChars: 256, exposure: 'direct' });
  assert.equal(mergeConfig({ exposure: 'deferred' }, { exposure: 'direct' }).exposure, 'deferred');
});
