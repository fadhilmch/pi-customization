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

async function newLog(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-bg-buffer-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return createLog(dir, 'bg1');
}

test('escape sequences split across reads are stripped, not leaked', async (t) => {
  const log = await newLog(t);
  await log.write('\u001b[3');
  assert.equal(await log.read(), '');
  await log.write('1mred\u001b[0');
  assert.equal(await log.read(), 'red');
  await log.write('m\n');
  assert.equal(await log.read(), '\n');
});

test('OSC sequences ended by BEL or ESC backslash are stripped, including when split', async (t) => {
  const log = await newLog(t);
  await log.write('a\u001b]0;window title\u0007b\u001b]8;;http://x\u001b\\c');
  assert.equal(await log.read(), 'abc');
  await log.write('d\u001b]0;spl');
  assert.equal(await log.read(), 'd');
  await log.write('it\u0007e\u001b');
  assert.equal(await log.read(), 'e');
  await log.write(']0;x\u001b');
  assert.equal(await log.read(), '');
  await log.write('\\f');
  assert.equal(await log.read(), 'f');
});

test('wholeLines holds a partial last line until it completes or flush releases it', async (t) => {
  const log = await newLog(t);
  await log.write('one\ntw');
  assert.equal(await log.read({ wholeLines: true }), 'one\n');
  await log.write('o\nthr');
  assert.equal(await log.read({ wholeLines: true }), 'two\n');
  assert.equal(await log.read({ wholeLines: true }), '');
  assert.equal(log.flush(), 'thr');
  assert.equal(log.flush(), '');
});
