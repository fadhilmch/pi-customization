'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadExtension(file) {
  const source = fs.readFileSync(file, 'utf8');
  const js = Module.stripTypeScriptTypes(source).replace('export default function', 'module.exports = function');
  const mod = new Module(file, null); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'typebox') return { Type: {
      Object: (properties) => ({ properties }), String: (options) => ({ type: 'string', ...options }),
      Integer: (options) => ({ type: 'integer', ...options }), Optional: (schema) => ({ optional: true, ...schema }),
      Union: (anyOf) => ({ anyOf }), Literal: (constValue) => ({ const: constValue }),
    } };
    if (id === '@earendil-works/pi-coding-agent') return { withFileMutationQueue: (_file, fn) => fn() };
    return originalLoad.call(this, id, parent, isMain);
  };
  try { mod._compile(js, file); } finally { Module._load = originalLoad; }
  return mod.exports;
}

function harness(dir) {
  const registered = {}; const handlers = {}; const active = ['read'];
  const pi = {
    registerTool: (tool) => { registered[tool.name] = tool; },
    registerCommand() {},
    getActiveTools: () => [...active], setActiveTools: (value) => { active.splice(0, active.length, ...value); },
    getAllTools: () => [...Object.keys(registered).map((name) => ({ name })), ...(process.env.TEST_TOOL_SEARCH === 'true' ? [{ name: 'tool_search' }] : [])],
    on: (name, fn) => { (handlers[name] ||= []).push(fn); },
  };
  loadExtension(path.join(__dirname, '..', 'index.ts'))(pi);
  return { registered, handlers, active };
}

test('registers inactive cell editor with a compact description', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(dir);
  assert.equal(h.registered.notebook_edit.defaultActive, false);
  assert.ok(JSON.stringify([h.registered.notebook_edit.name, h.registered.notebook_edit.description, h.registered.notebook_edit.parameters, h.registered.notebook_edit.promptSnippet, h.registered.notebook_edit.promptGuidelines]).length / 4 < 350);
  assert.deepEqual(h.active, ['read']);
});

test('deferred notebook editor does not become active when notebook is detected', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-deferred-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-deferred-home-'));
  const oldHome = process.env.PI_CODING_AGENT_DIR; const oldSearch = process.env.TEST_TOOL_SEARCH;
  process.env.PI_CODING_AGENT_DIR = home; process.env.TEST_TOOL_SEARCH = 'true';
  fs.writeFileSync(path.join(home, 'notebook.json'), JSON.stringify({ exposure: 'deferred' }));
  fs.writeFileSync(path.join(dir, 'a.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
  t.after(() => { if (oldHome === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldHome; if (oldSearch === undefined) delete process.env.TEST_TOOL_SEARCH; else process.env.TEST_TOOL_SEARCH = oldSearch; fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const h = harness(dir);
  assert.equal(h.registered.notebook_edit.exposure, 'deferred');
  await h.handlers.session_start[0]({}, { cwd: dir, hasUI: false });
  assert.ok(h.active.includes('tool_search'));
  assert.ok(!h.active.includes('notebook_edit'));
  await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'a.ipynb' } }, { cwd: dir });
  assert.ok(!h.active.includes('notebook_edit'));
  await h.handlers.session_shutdown[0]();
});

test('activates on startup in notebook projects and on the first .ipynb read', async (t) => {
  const withNotebook = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-project-'));
  const withoutNotebook = fs.mkdtempSync(path.join(os.tmpdir(), 'no-notebook-project-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-home-'));
  t.after(() => { for (const d of [withNotebook, withoutNotebook, home]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(withNotebook, 'test.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  try {
    const a = harness(withNotebook);
    await a.handlers.session_start[0]({}, { cwd: withNotebook });
    assert.ok(a.active.includes('notebook_edit'));
    const b = harness(withoutNotebook);
    await b.handlers.session_start[0]({}, { cwd: withoutNotebook });
    assert.equal(b.active.includes('notebook_edit'), false);
    fs.writeFileSync(path.join(withoutNotebook, 'read.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
    await b.handlers.tool_result[0]({ toolName: 'read', input: { path: 'read.ipynb' }, content: [{ type: 'text', text: 'truncated' }], structuredContent: { stale: true } }, { cwd: withoutNotebook });
    assert.ok(b.active.includes('notebook_edit'));
  } finally { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; }
});

test('read hook renders the full disk notebook and clears stale structured content', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-large-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-large-home-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const nb = { cells: [{ cell_type: 'code', execution_count: 1, id: 'large001', metadata: {}, outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['Z'.repeat(60000)] }, metadata: {} }], source: ['print(1)'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 };
  fs.writeFileSync(path.join(dir, 'large.ipynb'), JSON.stringify(nb));
  const h = harness(dir);
  const event = { toolName: 'read', input: { path: 'large.ipynb' }, content: [{ type: 'text', text: 'truncated JSON' }], structuredContent: { stale: true }, details: { path: 'large.ipynb' } };
  const result = await h.handlers.tool_result[0](event, { cwd: dir });
  assert.ok(result.content[0].text.length <= 12000);
  assert.match(result.content[0].text, /Full rendered notebook:/);
  assert.equal(result.structuredContent, undefined);
  assert.equal(fs.statSync(result.details.notebook.fullOutputPath).mode & 0o777, 0o600);
  const jsonFile = await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'other.json' }, content: [] }, { cwd: dir });
  assert.equal(jsonFile, undefined);
  await h.handlers.session_shutdown[0]();
  assert.equal(fs.existsSync(result.details.notebook.fullOutputPath), false);
});

test('notebook_edit changes one cell under Pi file mutation queue', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-edit-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-edit-home-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const file = path.join(dir, 'edit.ipynb');
  fs.writeFileSync(file, JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 4, id: 'edit0001', metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['old'] }], source: ['x=1'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
  const h = harness(dir);
  const result = await h.registered.notebook_edit.execute('id', { path: file, cell: 'edit0001', mode: 'replace', source: 'x=2' }, undefined, undefined, { cwd: dir });
  assert.match(result.content[0].text, /Replaced cell 1 \(code\)/);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.cells[0].outputs, []);
  assert.equal(saved.cells[0].execution_count, null);
});

test('caps oversized edit results and valid-cell errors with private full text paths', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-cap-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-cap-home-'));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const cells = Array.from({ length: 1000 }, (_, i) => ({ cell_type: 'markdown', id: `id${String(i).padStart(6, '0')}`, metadata: {}, source: ['x'] }));
  cells[0] = { cell_type: 'code', execution_count: 1, id: 'large001', metadata: {}, outputs: [], source: ['x'.repeat(15000)] };
  const file = path.join(dir, 'large-edit.ipynb');
  fs.writeFileSync(file, JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }));
  const h = harness(dir);
  const success = await h.registered.notebook_edit.execute('id', { path: file, cell: 'large001', mode: 'replace', source: 'y'.repeat(15000) }, undefined, undefined, { cwd: dir });
  assert.ok(success.content[0].text.length <= 12000);
  assert.equal(fs.statSync(success.details.fullOutputPath).mode & 0o777, 0o600);
  const error = await h.registered.notebook_edit.execute('id', { path: file, cell: 'missing', mode: 'delete' }, undefined, undefined, { cwd: dir });
  assert.ok(error.content[0].text.length <= 12000);
  assert.equal(fs.statSync(error.details.fullOutputPath).mode & 0o777, 0o600);
  await h.handlers.session_shutdown[0]();
  assert.equal(fs.existsSync(success.details.fullOutputPath), false);
  assert.equal(fs.existsSync(error.details.fullOutputPath), false);
});
