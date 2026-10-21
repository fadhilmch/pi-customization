'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function load(file) {
  const source = fs.readFileSync(file, 'utf8');
  const js = Module.stripTypeScriptTypes(source).replace('export default function', 'module.exports = function');
  const mod = new Module(file, null); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  const original = Module._load;
  Module._load = function (id, parent, main) {
    if (id === 'typebox') return { Type: { Object: (properties) => ({ properties }), String: () => ({ type: 'string' }), Array: (items) => ({ items }), Boolean: () => ({ type: 'boolean' }), Optional: (schema) => ({ optional: true, ...schema }) } };
    return original.call(this, id, parent, main);
  };
  try { mod._compile(js, file); } finally { Module._load = original; }
  return mod.exports;
}

test('ask_user registers direct by default and deferred on user config', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-user-exposure-'));
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; fs.rmSync(home, { recursive: true, force: true }); });
  const file = path.join(__dirname, '..', 'index.ts');
  function register(search = true) { const tools = {}; const events = {}; const pi = { registerTool: (tool) => { tools[tool.name] = tool; }, on: (name, fn) => { (events[name] ||= []).push(fn); }, getActiveTools: () => pi.active || ['read'], getAllTools: () => search ? [{ name: 'tool_search' }] : [], setActiveTools: (next) => { pi.active = next; } }; load(file)(pi); return { tools, events, pi }; }
  assert.equal(register().tools.ask_user.exposure, 'direct');
  const direct = register();
  assert.ok(JSON.stringify([direct.tools.ask_user.name, direct.tools.ask_user.description, direct.tools.ask_user.parameters, direct.tools.ask_user.promptSnippet, direct.tools.ask_user.promptGuidelines]).length / 4 < 350);
  fs.writeFileSync(path.join(home, 'ask-user.json'), JSON.stringify({ exposure: 'deferred' }));
  const h = register();
  assert.equal(h.tools.ask_user.exposure, 'deferred');
  const notices = [];
  await h.events.session_start[0]({}, { hasUI: true, ui: { notify: (message) => notices.push(message) } });
  assert.ok(h.pi.active.includes('tool_search'));
  assert.equal(notices.length, 1);
  const noSearch = register(false);
  await noSearch.events.session_start[0]({}, { hasUI: false });
  assert.ok(noSearch.pi.active.includes('ask_user'));
});
