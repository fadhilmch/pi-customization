'use strict';
// Validates every theme shipped by the package (root themes/ and extensions/*/themes/).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dirs = [path.join(root, 'themes')];
for (const e of fs.readdirSync(path.join(root, 'extensions'))) dirs.push(path.join(root, 'extensions', e, 'themes'));
const files = dirs
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => path.join(d, f)));

// Optional: validate against the schema of a local Pi install when present.
const schemaPath = path.join(os.homedir(), '.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json');
const schema = fs.existsSync(schemaPath) ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null;

test('themes are found', () => assert.ok(files.length >= 2));

test('theme names are unique (no theme loads twice)', () => {
  const names = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).name);
  assert.equal(new Set(names).size, names.length);
});

for (const f of files) {
  test(`theme ${path.relative(root, f)} is valid`, () => {
    const theme = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(theme.name, path.basename(f, '.json'));
    const vars = Object.keys(theme.vars || {});
    for (const [k, v] of Object.entries(theme.colors)) {
      assert.ok(v === '' || typeof v === 'number' || /^#[0-9a-fA-F]{6}$/.test(v) || vars.includes(v), `${k}: bad value ${v}`);
    }
    if (schema) {
      const cs = schema.properties.colors;
      const have = Object.keys(theme.colors);
      assert.deepEqual((cs.required || []).filter((k) => !have.includes(k)), [], 'missing colour keys');
      assert.deepEqual(have.filter((k) => !Object.keys(cs.properties || {}).includes(k)), [], 'unknown colour keys');
    }
  });
}
