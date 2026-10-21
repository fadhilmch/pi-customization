// Headless wiring check: load index.ts with a fake pi/ctx.
// index.ts mixes `export default`, `import` and `require` (Pi's loader allows it, plain Node ESM does not),
// so it is type-stripped, the typebox import is stubbed, and it is evaluated as CommonJS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const canStrip = typeof Module.stripTypeScriptTypes === 'function';

function loadExtension(file) {
  const src = fs.readFileSync(file, 'utf8');
  const stub = '{ Type: new Proxy({}, { get: () => () => ({}) }) }';
  const js = Module.stripTypeScriptTypes(src)
    .replace(/import \{ Type \} from "typebox";/, `const { Type } = ${stub};`)
    .replace('export default function', 'module.exports = function');
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(js, file);
  return m.exports;
}

function fakePi(active) {
  const tools = {};
  const commands = {};
  const handlers = {};
  return {
    tools, commands, handlers,
    registerTool: (t) => { tools[t.name] = t; },
    registerCommand: (n, o) => { commands[n] = o; },
    on: (n, fn) => { (handlers[n] ||= []).push(fn); },
    getActiveTools: () => active.slice(),
  };
}

const ctx = (cwd, extra = {}) => ({ cwd, hasUI: false, isProjectTrusted: () => false, model: { provider: 'p', id: 'm' }, ...extra });

test('subagent index: registers the tool and /agents, refuses risky agents when write/edit are off', { skip: !canStrip && 'needs Module.stripTypeScriptTypes' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-idx-'));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home; // no user config, no user agents
  try {
    const active = ['read', 'bash', 'grep', 'subagent', 'exit_plan_mode']; // plan mode: write/edit removed
    const pi = fakePi(active);
    loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
    assert.ok(pi.tools.subagent, 'subagent tool registered');
    assert.match(pi.tools.subagent.description, /scout/);
    assert.ok(pi.commands.agents, '/agents registered');
    assert.ok(pi.handlers.session_start);

    // plan mode: the worker (write/edit/bash) is refused without starting a process
    let r = await pi.tools.subagent.execute('1', { agent: 'worker', task: 'edit a file' }, undefined, undefined, ctx(home));
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /read-only/);
    assert.deepEqual(r.details.runs, []);
    // the reviewer has bash: refused too
    r = await pi.tools.subagent.execute('2', { chain: [{ agent: 'scout', task: 'x' }, { agent: 'reviewer', task: 'y' }] }, undefined, undefined, ctx(home));
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /"reviewer"/);

    // with write available the same call is not refused for being read-only (bad params keep it from spawning)
    active.push('write', 'edit');
    r = await pi.tools.subagent.execute('3', { agent: 'worker' }, undefined, undefined, ctx(home));
    assert.match(r.content[0].text, /needs both/);

    // /agents outside the TUI prints plain text
    const notes = [];
    await pi.commands.agents.handler('', { ...ctx(home), mode: 'print', ui: { notify: (m, t) => notes.push([m, t]) } });
    assert.match(notes[0][0], /scout \(bundled\)/);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});
