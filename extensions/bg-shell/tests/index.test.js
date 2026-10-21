'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadExtension(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = Module.stripTypeScriptTypes(src).replace('export default function', 'module.exports = function');
  const m = new Module(file, null); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'typebox') return { Type: {
      Object: (properties) => ({ properties }), String: (options) => ({ type: 'string', ...options }),
      Integer: (options) => ({ type: 'integer', ...options }), Number: (options) => ({ type: 'number', ...options }),
      Optional: (schema) => ({ optional: true, ...schema }), Literal: (value) => ({ const: value }),
      Union: (anyOf) => ({ anyOf }), Unsafe: (schema) => schema,
    } };
    if (id === '@earendil-works/pi-tui') return { matchesKey: (data, key) => key === 'escape' ? data === '\u001b' : data === '\r' };
    return originalLoad.call(this, id, parent, isMain);
  };
  try { m._compile(js, file); } finally { Module._load = originalLoad; }
  return m.exports;
}

test('registers one bounded process tool, jobs command, notices and shutdown', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-shell-home-'));
  const envBefore = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (envBefore === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = envBefore; fs.rmSync(dir, { recursive: true, force: true }); });
  const registered = {}; const commands = {}; const handlers = {};
  const active = ['read'];
  const pi = { registerTool: (tool) => { registered[tool.name] = tool; }, registerCommand: (name, command) => { commands[name] = command; }, on: (name, fn) => { (handlers[name] ||= []).push(fn); }, getActiveTools: () => active.slice(), getAllTools: () => Object.keys(registered).map((name) => ({ name })), setActiveTools: (next) => active.splice(0, active.length, ...next) };
  loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
  assert.deepEqual(Object.keys(registered), ['bash_bg']);
  assert.ok(JSON.stringify([registered.bash_bg.name, registered.bash_bg.description, registered.bash_bg.parameters, registered.bash_bg.promptSnippet, registered.bash_bg.promptGuidelines]).length / 4 < 350);
  assert.deepEqual(Object.keys(commands), ['jobs']);
  const result = await registered.bash_bg.execute('id', { action: 'start', command: "printf ready" }, undefined, undefined, { cwd: dir });
  assert.match(result.content[0].text, /Started bg1/);
  assert.equal(await handlers.session_shutdown[0](), undefined);
  assert.equal(fs.existsSync(result.details.logPath), false);
});

test('deferred bash_bg activates itself directly if tool_search is unavailable', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-shell-deferred-'));
  const envBefore = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  fs.writeFileSync(path.join(dir, 'bg-shell.json'), JSON.stringify({ exposure: 'deferred' }));
  t.after(() => { if (envBefore === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = envBefore; fs.rmSync(dir, { recursive: true, force: true }); });
  const tools = {}; const handlers = {}; const active = ['read'];
  const pi = { registerTool: (tool) => { tools[tool.name] = tool; }, registerCommand() {}, on: (name, fn) => { (handlers[name] ||= []).push(fn); }, getActiveTools: () => active.slice(), getAllTools: () => Object.keys(tools).map((name) => ({ name })), setActiveTools: (next) => active.splice(0, active.length, ...next) };
  loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
  assert.equal(tools.bash_bg.exposure, 'deferred');
  await handlers.session_start[0]({}, { hasUI: false });
  assert.ok(active.includes('bash_bg'));
  await handlers.session_shutdown[0]();
});

test('exit notices appear on only the next pre-agent hook', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-shell-notice-'));
  const envBefore = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (envBefore === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = envBefore; fs.rmSync(dir, { recursive: true, force: true }); });
  const registered = {}; const handlers = {};
  loadExtension(path.join(__dirname, '..', 'index.ts'))({ registerTool: (tool) => { registered[tool.name] = tool; }, registerCommand() {}, on: (name, fn) => { (handlers[name] ||= []).push(fn); } });
  await registered.bash_bg.execute('id', { action: 'start', command: 'exit 7' }, undefined, undefined, { cwd: dir });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const first = await handlers.before_agent_start[0]({}, { hasUI: false });
  const second = await handlers.before_agent_start[0]({}, { hasUI: false });
  assert.match(first.message.content, /exited with code 7/);
  assert.equal(second, undefined);
  await handlers.session_shutdown[0]();
});

function makePi(registered, handlers) {
  return { registerTool: (tool) => { registered[tool.name] = tool; }, registerCommand() {}, on: (name, fn) => { (handlers[name] ||= []).push(fn); } };
}
function withAgentDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('parameters are one object schema with an action enum, and actions are validated', async (t) => {
  const dir = withAgentDir(t, 'bg-shell-params-');
  const registered = {}; const handlers = {};
  loadExtension(path.join(__dirname, '..', 'index.ts'))(makePi(registered, handlers));
  const schema = registered.bash_bg.parameters;
  assert.ok(schema.properties, 'root schema is an object with properties');
  assert.equal(schema.anyOf, undefined);
  assert.deepEqual(schema.properties.action.enum, ['start', 'output', 'stop', 'list']);
  const run = (params) => registered.bash_bg.execute('id', params, undefined, undefined, { cwd: dir });
  for (const [params, message] of [[{ action: 'start' }, /start requires command/], [{ action: 'output' }, /output requires id/], [{ action: 'stop' }, /stop requires id/], [{ action: 'nope' }, /action must be one of/]]) {
    const result = await run(params);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, message);
  }
  const bad = await run({ action: 'start', command: 'echo x', cwd: path.join(dir, 'missing') });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /cwd does not exist/);
  assert.equal((await run({ action: 'list' })).content[0].text, 'No background jobs.');
  await handlers.session_shutdown[0]();
});

test('repeated session_start replaces the status timer instead of stacking', async (t) => {
  withAgentDir(t, 'bg-shell-timer-');
  const registered = {}; const handlers = {};
  loadExtension(path.join(__dirname, '..', 'index.ts'))(makePi(registered, handlers));
  const realSet = globalThis.setInterval; const realClear = globalThis.clearInterval;
  const created = []; const cleared = [];
  globalThis.setInterval = () => { const timer = { unref() {} }; created.push(timer); return timer; };
  globalThis.clearInterval = (timer) => { cleared.push(timer); };
  try {
    await handlers.session_start[0]({}, { hasUI: false });
    await handlers.session_start[0]({}, { hasUI: false });
    await handlers.session_shutdown[0]();
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
  assert.equal(created.length, 2);
  assert.deepEqual(cleared, [created[0], created[1]]);
});
