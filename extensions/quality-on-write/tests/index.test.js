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

test('quality-on-write: handlers format, note, typecheck, feed back, loop-guard', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'qow-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qow-home-'));
  const realHome = process.env.HOME;
  process.env.HOME = home; // os.homedir() honours HOME on POSIX
  try {
    fs.mkdirSync(path.join(proj, 'node_modules', '.bin'), { recursive: true });
    // Fake local prettier: uppercases the file. Fake tsc: fails when file contains "BAD".
    const bin = (name, body) => { const p = path.join(proj, 'node_modules', '.bin', name); fs.writeFileSync(p, '#!/usr/bin/env node\n' + body); fs.chmodSync(p, 0o755); };
    bin('prettier', 'const fs=require("fs");const f=process.argv.at(-1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/bad/g,"BAD"));');
    bin('tsc', 'const fs=require("fs");const t=fs.readFileSync("a.ts","utf8");if(t.includes("BAD")){console.log("a.ts(1,1): error TS2304: Cannot find name BAD.");console.log("old.ts(1,1): error TS1: legacy");process.exit(2)}');
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(proj, '.prettierrc'), '{}');
    const file = path.join(proj, 'a.ts');
    fs.writeFileSync(file, 'let x = bad;\n');

    const pi = fakePi();
    loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
    assert.deepEqual(Object.keys(pi.handlers).sort(), ['agent_before_settle', 'input', 'tool_result']);
    const ctx = fakeCtx(proj);
    const [toolResult] = pi.handlers.tool_result;
    const [settle] = pi.handlers.agent_before_settle;

    // ignored: other tools, errors
    assert.equal(await toolResult({ toolName: 'read', isError: false, input: { path: 'a.ts' }, content: [] }, ctx), undefined);
    assert.equal(await toolResult({ toolName: 'write', isError: true, input: { path: 'a.ts' }, content: [] }, ctx), undefined);
    assert.equal(await settle({}, ctx), undefined); // nothing queued

    const orig = [{ type: 'text', text: 'Successfully wrote' }];
    const res = await toolResult({ toolName: 'write', isError: false, input: { path: 'a.ts' }, content: orig }, ctx);
    assert.equal(fs.readFileSync(file, 'utf8'), 'let x = BAD;\n');
    assert.equal(res.content.length, 2);
    assert.match(res.content[1].text, /prettier reformatted a\.ts/);

    // settle: typecheck fails in touched file only -> one injected message + continue
    const out = await settle({}, ctx);
    assert.equal(out.continue, true);
    assert.equal(out.entries[0].type, 'custom_message');
    assert.match(out.entries[0].content, /tsc found 1 error in files you edited/);
    assert.match(out.entries[0].content, /a\.ts:1 TS2304/);
    assert.match(out.entries[0].content, /1 other pre-existing error/);
    assert.ok(!out.entries[0].content.includes('old.ts:'));
    assert.deepEqual(ctx.ui.statuses.at(-1), ['quality-on-write', undefined]);

    // same failure again with no change: guard stops the loop
    await toolResult({ toolName: 'edit', isError: false, input: { path: '@a.ts' }, content: [] }, ctx);
    assert.equal(await settle({}, ctx), undefined);
    assert.match(ctx.ui.notifications.at(-1)[0], /not re-sending/);

    // fix -> passes -> ok notification
    fs.writeFileSync(file, 'let x = 1;\n');
    await toolResult({ toolName: 'edit', isError: false, input: { path: 'a.ts' }, content: [] }, ctx);
    assert.equal(await settle({}, ctx), undefined);
    assert.match(ctx.ui.notifications.at(-1)[0], /typecheck ok/);

    // project config can disable typecheck
    fs.mkdirSync(path.join(proj, '.pi'));
    fs.writeFileSync(path.join(proj, '.pi', 'quality.json'), '{"typecheck":false}');
    fs.writeFileSync(file, 'bad');
    await toolResult({ toolName: 'write', isError: false, input: { path: 'a.ts' }, content: [] }, ctx);
    assert.equal(await settle({}, ctx), undefined);
  } finally {
    process.env.HOME = realHome;
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
