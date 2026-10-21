// Import-check of index.ts with a fake pi/ctx; skipped when Node cannot strip types.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');

test('handoff index.ts registers /handoff and rejects non-tui / missing goal', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const commands = {};
  mod.default({ registerCommand: (n, o) => (commands[n] = o) });
  assert.ok(commands.handoff);

  const notes = [];
  const ui = { notify: (m, t) => notes.push([m, t]), input: async () => '' };
  await commands.handoff.handler('x', { mode: 'print', ui });
  assert.match(notes.at(-1)[0], /interactive/);
  await commands.handoff.handler('x', { mode: 'tui', ui, model: undefined });
  assert.match(notes.at(-1)[0], /No model/);
  await commands.handoff.handler('', { mode: 'tui', ui, model: {}, sessionManager: { getBranch: () => [] } });
  assert.match(notes.at(-1)[0], /Usage/);
  await commands.handoff.handler('go', { mode: 'tui', ui, model: {}, sessionManager: { getBranch: () => [] } });
  assert.match(notes.at(-1)[0], /No conversation/);
});
