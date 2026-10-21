'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig } = require('../config.js');

test('ask-user exposure defaults direct and rejects invalid values', () => {
  assert.deepEqual(parseConfig(undefined), { exposure: 'direct' });
  assert.deepEqual(parseConfig({ exposure: 'deferred' }), { exposure: 'deferred' });
  assert.deepEqual(parseConfig({ exposure: 'hidden' }), { exposure: 'direct' });
});
