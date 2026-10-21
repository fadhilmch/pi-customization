const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dirs = [path.join(root, 'prompts'), ...fs.readdirSync(path.join(root, 'extensions')).map((e) => path.join(root, 'extensions', e, 'prompts'))].filter((d) => fs.existsSync(d));
const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));

// Pi built-in slash commands (docs/slash-commands.md); a template with one of these names would be shadowed or confusing.
const BUILTIN = ['settings', 'model', 'thinking', 'scoped-models', 'login', 'logout', 'llama', 'new', 'resume', 'name', 'session', 'tree', 'fork', 'clone', 'compact', 'import', 'copy', 'export', 'share', 'bug', 'trust', 'reload', 'hotkeys', 'changelog', 'quit'];

test('prompt templates are found', () => {
  assert.ok(files.length >= 3);
});

test('prompt template names are unique and not built-in commands', () => {
  const names = files.map((f) => path.basename(f, '.md'));
  assert.equal(new Set(names).size, names.length, `duplicate names: ${names}`);
  for (const n of names) assert.ok(!BUILTIN.includes(n), `${n} collides with a built-in command`);
});

for (const f of files) {
  test(`prompt ${path.relative(root, f)} has a description in front matter and a body`, () => {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
    assert.ok(m, 'front matter missing');
    assert.match(m[1], /^description: .+/m);
    assert.ok(m[2].trim().length > 20);
  });
}
