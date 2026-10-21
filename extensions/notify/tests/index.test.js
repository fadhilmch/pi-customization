// Headless wiring check: load index.ts with a fake pi/ctx and exercise the handlers.
// index.ts mixes `export default` and `require` (Pi's loader allows it, plain Node ESM does not),
// so it is type-stripped and evaluated as CommonJS here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadExtension(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = Module.stripTypeScriptTypes(src).replace('export default function', 'module.exports = function');
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(js, file);
  return m.exports;
}

function fakePi() {
  const handlers = {};
  return { handlers, on: (name, fn) => { (handlers[name] ||= []).push(fn); return () => {}; } };
}

function fakeCtx(cwd) {
  const ui = { notifications: [], statuses: [], notify(m, t) { this.notifications.push([m, t]); }, setStatus(k, v) { this.statuses.push([k, v]); } };
  return { cwd, hasUI: true, ui, signal: undefined };
}

test('notify: handlers notify only for long, non-aborted runs; prompt timer cancels', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-home-'));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  const writes = [];
  const origWrite = process.stdout.write;
  try {
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'notify.json'), JSON.stringify({ method: 'osc', minSeconds: 0.05 }));
    const pi = fakePi();
    loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
    assert.deepEqual(Object.keys(pi.handlers).sort(), ['agent_settled', 'agent_start', 'session_shutdown', 'ui_prompt_end', 'ui_prompt_start']);
    process.stdout.write = (s) => { if (String(s).startsWith('\x1b]')) writes.push(String(s)); else return origWrite.call(process.stdout, s); return true; };
    const ctx = fakeCtx('/x/proj');

    await pi.handlers.agent_start[0]({});
    await pi.handlers.agent_settled[0]({ aborted: false }, ctx); // too quick
    assert.equal(writes.length, 0);
    await new Promise((r) => setTimeout(r, 70));
    await pi.handlers.agent_settled[0]({ aborted: true }, ctx);
    assert.equal(writes.length, 0);
    await pi.handlers.agent_settled[0]({ aborted: false }, ctx);
    assert.equal(writes.length, 1);
    assert.match(writes[0], /Pi - proj;Ready for input/);

    await pi.handlers.ui_prompt_start[0]({ title: 'Allow?' }, ctx);
    await pi.handlers.ui_prompt_end[0]({}, ctx); // answered quickly
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(writes.length, 1);
    await pi.handlers.ui_prompt_start[0]({ title: 'Allow?' }, ctx);
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(writes.length, 2);
    assert.match(writes[1], /Waiting for you: Allow\?/);
    await pi.handlers.session_shutdown[0]({}, ctx);
  } finally {
    process.stdout.write = origWrite;
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
