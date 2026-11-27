'use strict';
// Wiring check: load index.ts with a fake pi/ctx. Pi packages are stubbed; index.ts mixes import and require,
// so it is type-stripped and evaluated as CommonJS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const canStrip = typeof Module.stripTypeScriptTypes === 'function';
const skip = !canStrip && 'needs Module.stripTypeScriptTypes';

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = Module.stripTypeScriptTypes(src)
    .replace(/^import .*$/gm, '')
    .replace('export default function', 'module.exports = function');
  const stubs = `const Type = new Proxy({}, { get: () => () => ({}) }); const getMarkdownTheme = () => ({}); class Markdown { render() { return []; } }\n`;
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(stubs + js, file);
  return m.exports;
}

function setup({ active = ['read', 'bash', 'write', 'edit'], entries = [], flag = false } = {}) {
  const tools = {};
  const handlers = {};
  const appended = [];
  const pi = {
    tools, handlers, appended, active,
    registerFlag() {}, registerCommand(n, o) { pi.cmd = { ...pi.cmd, [n]: o }; }, registerShortcut() {},
    registerTool: (t) => { tools[t.name] = t; },
    on: (n, fn) => { (handlers[n] ||= []).push(fn); },
    getActiveTools: () => pi.active.slice(),
    setActiveTools: (next) => { pi.active = next.slice(); },
    getFlag: () => flag,
    appendEntry: (type, data) => appended.push({ type, data }),
    events: { emit() {} },
  };
  load(path.join(__dirname, '..', 'index.ts'))(pi);
  const confirms = [];
  const ctx = {
    hasUI: true,
    ui: { notify() {}, setStatus() {}, setWidget() {}, confirm: async (title, body) => { confirms.push([title, body]); return true; }, select: async () => 'Approve & keep asking', input: async () => '' },
    sessionManager: { getBranch: () => entries },
  };
  return { pi, ctx, confirms, call: (toolName, input) => pi.handlers.tool_call[0]({ toolName, input }, ctx) };
}

const enterPlan = (h) => h.pi.cmd.plan.handler('on', h.ctx);

test('plan mode blocks notebook_edit, bash_bg start and unsafe bash; allows bash_bg read actions and safe bash', { skip }, async () => {
  const h = setup();
  await enterPlan(h);
  assert.ok(!h.pi.active.includes('write') && !h.pi.active.includes('edit'));
  assert.ok(h.pi.active.includes('exit_plan_mode'));
  assert.equal((await h.call('notebook_edit', { path: 'a.ipynb' })).block, true);
  assert.equal((await h.call('write', { path: 'a' })).block, true);
  assert.equal((await h.call('bash_bg', { action: 'start', command: 'npm run dev' })).block, true);
  for (const action of ['output', 'list', 'stop']) assert.equal(await h.call('bash_bg', { action, id: 'x' }), undefined, action);
  const unsafe = await h.call('bash', { command: 'rm -rf x' });
  assert.equal(unsafe.block, true);
  assert.match(unsafe.reason, /rm -rf x/);
  assert.equal(await h.call('bash', { command: 'git status' }), undefined);
});

test('approved-plan ask gate confirms bash_bg start with its command', { skip }, async () => {
  const h = setup();
  await enterPlan(h);
  await h.pi.tools.exit_plan_mode.execute('1', { plan: '1. do it' }, undefined, undefined, h.ctx);
  assert.equal(await h.call('bash_bg', { action: 'start', command: 'npm run dev' }), undefined);
  assert.deepEqual(h.confirms.at(-1), ['Plan approved: allow this step?', 'npm run dev']);
  await h.call('bash', { command: 'rm x' });
  assert.equal(h.confirms.at(-1)[1], 'rm x');
  await h.call('bash_bg', { action: 'list' });
  await h.call('bash', { command: 'ls' });
  assert.equal(h.confirms.length, 2, 'read-only calls are not confirmed');
  await h.call('write', { path: 'f.txt' });
  assert.equal(h.confirms.at(-1)[1], 'write f.txt');
});

test('entering plan mode keeps tools activated by other extensions (tool_search) and strips write tools', { skip }, async () => {
  // session restore: stored savedTools predates tool_search being activated by another extension
  const entries = [{ type: 'custom', customType: 'plan-mode', data: { enabled: true, savedTools: ['read', 'bash', 'write', 'edit'] } }];
  const h = setup({ active: ['read', 'bash', 'write', 'edit', 'tool_search'], entries });
  await h.pi.handlers.session_start[0]({}, h.ctx);
  assert.ok(h.pi.active.includes('tool_search'));
  assert.ok(h.pi.active.includes('exit_plan_mode'));
  assert.ok(!h.pi.active.includes('write') && !h.pi.active.includes('edit') && !h.pi.active.includes('notebook_edit'));
});

test('leaving plan mode keeps tools activated during it, restores write tools, drops exit_plan_mode', { skip }, async () => {
  const h = setup({ active: ['read', 'bash', 'write', 'edit', 'notebook_edit'] });
  await enterPlan(h);
  assert.ok(!h.pi.active.includes('notebook_edit'));
  h.pi.active = [...h.pi.active, 'ask_user']; // loaded via tool_search while planning
  await h.pi.cmd.plan.handler('off', h.ctx);
  for (const t of ['read', 'bash', 'write', 'edit', 'notebook_edit', 'ask_user']) assert.ok(h.pi.active.includes(t), t);
  assert.ok(!h.pi.active.includes('exit_plan_mode'));
});

test('a write tool re-added during plan mode is not carried out of it by the union', { skip }, async () => {
  const h = setup({ active: ['read', 'bash'] });
  await enterPlan(h);
  h.pi.active = [...h.pi.active, 'write']; // another extension re-adds it
  await h.pi.cmd.plan.handler('off', h.ctx);
  assert.ok(!h.pi.active.includes('write'));
});
