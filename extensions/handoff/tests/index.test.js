// Import-check of index.ts with a fake pi/ctx; skipped when Node cannot strip types.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');

test('handoff index.ts registers /handoff and rejects non-tui / missing goal', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const commands = {};
  const tools = {};
  mod.default({ registerCommand: (n, o) => (commands[n] = o), registerTool: (t) => (tools[t.name] = t) });
  assert.ok(commands.handoff);
  assert.ok(tools.read_session);

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

test('read_session tool reads the linked parent and refuses other paths', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const tools = {};
  mod.default({ registerCommand() {}, registerTool: (t) => (tools[t.name] = t) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-rs-'));
  const parent = path.join(dir, 'parent.jsonl');
  fs.writeFileSync(parent, JSON.stringify({ type: 'message', message: { role: 'user', content: 'hello parent' } }) + '\n');
  const ctx = { sessionManager: { getHeader: () => ({ parentSession: parent }), getSessionDir: () => path.join(dir, 'none') } };
  const ok = await tools.read_session.execute('1', {}, null, null, ctx);
  assert.match(ok.content[0].text, /\[user\] hello parent/);
  const bad = await tools.read_session.execute('1', { path: '/etc/passwd' }, null, null, ctx);
  assert.match(bad.content[0].text, /Error/);
});

test('/handoff in a UI-less mode is refused', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const commands = {};
  mod.default({ registerCommand: (n, o) => (commands[n] = o), registerTool() {} });
  const notes = [];
  await commands.handoff.handler('--no-review x', { mode: 'json', hasUI: false, ui: { notify: (m) => notes.push(m) } });
  assert.match(notes[0], /interactive or RPC/);
});
