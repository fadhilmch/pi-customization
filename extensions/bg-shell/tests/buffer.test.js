'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLog } = require('../buffer.js');

test('decodes UTF-8 split across incremental reads and strips ANSI', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-bg-buffer-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const log = await createLog(dir, 'bg1');
  const char = Buffer.from('€');
  await log.write(Buffer.concat([Buffer.from('\u001b[31m'), char.subarray(0, 1)]));
  assert.equal(await log.read(), '');
  await log.write(Buffer.concat([char.subarray(1), Buffer.from(' ready\n\u001b[0m')]));
  assert.equal(await log.read(), '€ ready\n');
  assert.equal(await log.read(), '');
});
