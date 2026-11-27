'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'bench', 'auto-mode');

test('auto-mode benchmark fixtures are well formed', () => {
  const rows = fs.readFileSync(path.join(dir, 'fixtures.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ids = new Set();
  for (const r of rows) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(['safe', 'risky', 'block'].includes(r.label), `${r.id}: bad label ${r.label}`);
    assert.ok(typeof r.group === 'string' && r.group, `${r.id}: missing group`);
    assert.ok(['bash', 'powershell'].includes(r.tool) ? typeof r.command === 'string' : typeof r.path === 'string', `${r.id}: needs command or path`);
  }
  assert.ok(rows.length >= 100);
});

test('auto-mode rules match every benchmark label that is not a known gap', () => {
  const r = spawnSync(process.execPath, [path.join(dir, 'run.js'), '--strict'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('output-diet benchmark has no unexpected losses', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bench', 'output-diet', 'run.js'), '--strict'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
