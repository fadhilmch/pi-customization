'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { capOutput } = require('../output.js');

test('caps output with a full log pointer', async () => {
  const output = await capOutput('x'.repeat(1000), { maxChars: 256 });
  assert.ok(output.text.length <= 256);
  assert.match(output.text, /full log:/);
  assert.equal((await fs.stat(output.logPath)).mode & 0o777, 0o600);
});

test('folds long output while retaining error lines and the tail', async () => {
  const text = ['start', ...Array.from({ length: 100 }, (_, i) => i === 47 ? 'ERROR: keep this' : `line ${i}`), 'end'].join('\n');
  const output = await capOutput(text, { maxChars: 800, logPath: '/tmp/job.log' });
  assert.equal(output.folded, true);
  assert.match(output.text, /ERROR: keep this/);
  assert.match(output.text, /end/);
  assert.ok(output.text.length <= 800);
});
