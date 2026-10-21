'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hasNotebook } = require('../activation.js');

test('git listing uses untracked-aware flags with timeout and buffer limits', async () => {
  let seen;
  const found = await hasNotebook('/x', { exec: async (file, args, options) => { seen = { file, args, options }; return 'a.ipynb\0'; } });
  assert.equal(found, true);
  assert.deepEqual(seen.args.slice(0, 4), ['ls-files', '-co', '--exclude-standard', '-z']);
  assert.ok(seen.options.timeout > 0 && seen.options.maxBuffer > 0);
});

test('falls back to the bounded walk on git errors and misses', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-act-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'b', 'N.IPYNB'), '{}');
  assert.equal(await hasNotebook(dir, { exec: async () => { throw new Error('no git'); } }), true);
  assert.equal(await hasNotebook(dir, { exec: async () => '' }), true);
  fs.rmSync(path.join(dir, 'a'), { recursive: true });
  assert.equal(await hasNotebook(dir, { exec: async () => '' }), false);
});

test('finds an untracked notebook in a real git repo', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  try { execFileSync('git', ['init', '-q'], { cwd: dir }); } catch { t.skip('git unavailable'); return; }
  assert.equal(await hasNotebook(dir), false);
  fs.writeFileSync(path.join(dir, 'new.ipynb'), '{}');
  assert.equal(await hasNotebook(dir), true);
});
