const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const output = require('../output.js');

test('formatResult returns requested section and headings when the section is missing', async () => {
  const page = { url: 'https://docs.test/x', text: '# One\n\nA\n\n## Two\n\nB', elapsedMs: 7, bodyTruncated: false };
  assert.equal((await output.formatResult(page, { section: 'two', maxChars: 300 })).text, 'Source: https://docs.test/x · 19 chars\n\n## Two\n\nB');
  assert.match((await output.formatResult(page, { section: 'missing', maxChars: 300 })).text, /No section matched.*One.*Two/s);
});

test('formatResult keeps a hard cap and saves the complete Markdown with private permissions', async () => {
  const page = { url: 'https://docs.test/x', text: '# Title\n\n' + 'x'.repeat(1000), elapsedMs: 5, bodyTruncated: false };
  const result = await output.formatResult(page, { maxChars: 300 });
  assert.ok(result.text.length <= 300);
  assert.match(result.text, /Truncated\. Full text:/);
  const file = result.text.match(/Truncated\. Full text: (.+)$/m)[1];
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), page.text);
  fs.rmSync(require('node:path').dirname(file), { recursive: true, force: true });
});

test('formatResult rejects caps that cannot fit the truncation reference', async () => {
  await assert.rejects(output.formatResult({ url: 'https://x.test', text: 'x'.repeat(300), elapsedMs: 0 }, { maxChars: 1 }), /at least 256/);
});

test('formatError keeps hostile long error text under the configured cap', () => {
  assert.ok(output.formatError(new Error('x'.repeat(2000)), 128).length <= 128);
});

test('capText hard-caps non-page output and saves its full contents', async () => {
  const value = 'result '.repeat(100);
  const result = await output.capText(value, 300);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 300);
  assert.equal(fs.readFileSync(result.file, 'utf8'), value);
  fs.rmSync(require('node:path').dirname(result.file), { recursive: true, force: true });
});
