'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadExtension(file, queued = []) {
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
    if (id === '@earendil-works/pi-coding-agent') return { withFileMutationQueue: (queuedFile, fn) => { queued.push(queuedFile); return fn(); } };
    return originalLoad.call(this, id, parent, isMain);
  };
  try { mod._compile(js, file); } finally { Module._load = originalLoad; }
  return mod.exports;
}

function harness(dir, tools = ['read', 'write', 'edit']) {
  const registered = {}; const handlers = {}; const active = [...tools]; const queued = [];
  const pi = {
    registerTool: (tool) => { registered[tool.name] = tool; },
    registerCommand() {},
    getActiveTools: () => [...active], setActiveTools: (value) => { active.splice(0, active.length, ...value); },
    getAllTools: () => [...Object.keys(registered).map((name) => ({ name })), ...(process.env.TEST_TOOL_SEARCH === 'true' ? [{ name: 'tool_search' }] : [])],
    on: (name, fn) => { (handlers[name] ||= []).push(fn); },
  };
  loadExtension(path.join(__dirname, '..', 'index.ts'), queued)(pi);
  return { registered, handlers, active, queued };
}

test('registers inactive cell editor with a compact description', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(dir);
  assert.equal(h.registered.notebook_edit.defaultActive, false);
  assert.ok(JSON.stringify([h.registered.notebook_edit.name, h.registered.notebook_edit.description, h.registered.notebook_edit.parameters, h.registered.notebook_edit.promptSnippet, h.registered.notebook_edit.promptGuidelines]).length / 4 < 350);
  assert.deepEqual(h.active, ['read', 'write', 'edit']);
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

const NB5 = (cells) => JSON.stringify({ cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } }, nbformat: 4, nbformat_minor: 5 });
const CODE = (id, source = 'x = 1') => ({ cell_type: 'code', execution_count: null, id, metadata: {}, outputs: [], source: [source] });

function sandbox(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}home-`));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = home;
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  return dir;
}

test('resolves @ and ~ paths like Pi, and queues the absolute path', async (t) => {
  const dir = sandbox(t, 'notebook-paths-');
  fs.writeFileSync(path.join(dir, 'ok.ipynb'), NB5([CODE('aaaa0001')]));
  const homeDir = fs.mkdtempSync(path.join(os.homedir(), '.nbtest-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(homeDir, 'h.ipynb'), NB5([CODE('aaaa0002')]));
  const h = harness(dir);
  const at = await h.handlers.tool_result[0]({ toolName: 'read', input: { path: '@ok.ipynb' }, content: [] }, { cwd: dir });
  assert.match(at.content[0].text, /\[1\] code · id=aaaa0001/);
  const tilde = await h.handlers.tool_result[0]({ toolName: 'read', input: { path: `~/${path.basename(homeDir)}/h.ipynb` }, content: [] }, { cwd: dir });
  assert.match(tilde.content[0].text, /id=aaaa0002/);
  const edit = await h.registered.notebook_edit.execute('id', { path: '@ok.ipynb', cell: 1, mode: 'replace', source: 'y = 2' }, undefined, undefined, { cwd: dir });
  assert.match(edit.content[0].text, /Replaced cell 1/);
  const edit2 = await h.registered.notebook_edit.execute('id', { path: `~/${path.basename(homeDir)}/h.ipynb`, cell: 1, mode: 'delete' }, undefined, undefined, { cwd: dir });
  assert.match(edit2.content[0].text, /Deleted cell 1/);
  assert.deepEqual(h.queued, [path.join(dir, 'ok.ipynb'), path.join(homeDir, 'h.ipynb')]);
  assert.match(fs.readFileSync(path.join(dir, 'ok.ipynb'), 'utf8'), /y = 2/);
});

test('read hook leaves Pi result for malformed, empty, nbformat 3 and missing notebooks; handles BOM and .IPYNB', async (t) => {
  const dir = sandbox(t, 'notebook-leave-');
  fs.writeFileSync(path.join(dir, 'bad.ipynb'), '{not json');
  fs.writeFileSync(path.join(dir, 'empty.ipynb'), '');
  fs.writeFileSync(path.join(dir, 'v3.ipynb'), JSON.stringify({ nbformat: 3, worksheets: [] }));
  fs.writeFileSync(path.join(dir, 'bom.ipynb'), `\uFEFF${NB5([CODE('bbbb0001')])}`);
  fs.writeFileSync(path.join(dir, 'UP.IPYNB'), NB5([CODE('bbbb0002')]));
  const h = harness(dir);
  for (const name of ['bad.ipynb', 'empty.ipynb', 'v3.ipynb', 'missing.ipynb']) {
    assert.equal(await h.handlers.tool_result[0]({ toolName: 'read', input: { path: name }, content: [{ type: 'text', text: 'pi' }] }, { cwd: dir }), undefined, name);
  }
  assert.equal(h.active.includes('notebook_edit'), false);
  assert.match((await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'bom.ipynb' }, content: [] }, { cwd: dir })).content[0].text, /id=bbbb0001/);
  assert.match((await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'UP.IPYNB' }, content: [] }, { cwd: dir })).content[0].text, /id=bbbb0002/);
});

test('editing a BOM-prefixed notebook keeps the BOM', async (t) => {
  const dir = sandbox(t, 'notebook-bom-');
  const file = path.join(dir, 'bom.ipynb');
  fs.writeFileSync(file, `\uFEFF${NB5([CODE('cccc0001'), CODE('cccc0002')])}`);
  const h = harness(dir);
  await h.registered.notebook_edit.execute('id', { path: file, cell: 2, mode: 'replace', source: 'z' }, undefined, undefined, { cwd: dir });
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(saved.charCodeAt(0), 0xFEFF);
  assert.equal(JSON.parse(saved.slice(1)).cells[1].source[0], 'z');
});

test('bad offset and limit return a clear message through the hook', async (t) => {
  const dir = sandbox(t, 'notebook-offset-');
  fs.writeFileSync(path.join(dir, 'a.ipynb'), NB5([CODE('dddd0001'), CODE('dddd0002')]));
  const h = harness(dir);
  const beyond = await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'a.ipynb', offset: 9 }, content: [] }, { cwd: dir });
  assert.match(beyond.content[0].text, /Offset 9 is beyond the last cell \(2 cells\)/);
  assert.doesNotMatch(beyond.content[0].text, /dddd/);
});

test('notebook_edit is not re-activated by reads in a read-only (plan mode) session', async (t) => {
  const dir = sandbox(t, 'notebook-plan-');
  fs.writeFileSync(path.join(dir, 'a.ipynb'), NB5([CODE('eeee0001')]));
  const h = harness(dir, ['read', 'bash']);
  const result = await h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'a.ipynb' }, content: [] }, { cwd: dir });
  assert.match(result.content[0].text, /id=eeee0001/);
  await h.handlers.session_start[0]({}, { cwd: dir });
  assert.deepEqual(h.active, ['read', 'bash']);
});

test('capped paged reads reuse one saved file per notebook version', async (t) => {
  const dir = sandbox(t, 'notebook-cache-');
  const file = path.join(dir, 'big.ipynb');
  fs.writeFileSync(file, NB5(Array.from({ length: 40 }, (_, i) => CODE(`ffff${String(i).padStart(4, '0')}`, 'x'.repeat(800)))));
  const h = harness(dir);
  const read = (offset) => h.handlers.tool_result[0]({ toolName: 'read', input: { path: 'big.ipynb', offset }, content: [] }, { cwd: dir });
  const first = await read(1); const second = await read(5);
  assert.ok(first.details.notebook.fullOutputPath);
  assert.equal(second.details.notebook.fullOutputPath, first.details.notebook.fullOutputPath);
  assert.match(fs.readFileSync(first.details.notebook.fullOutputPath, 'utf8'), /\[40\] code/);
  fs.writeFileSync(file, NB5(Array.from({ length: 41 }, (_, i) => CODE(`ffff${String(i).padStart(4, '0')}`, 'x'.repeat(800)))));
  const third = await read(1);
  assert.notEqual(third.details.notebook.fullOutputPath, first.details.notebook.fullOutputPath);
  assert.equal(fs.existsSync(first.details.notebook.fullOutputPath), false);
  await h.handlers.session_shutdown[0]();
  assert.equal(fs.existsSync(third.details.notebook.fullOutputPath), false);
});

test('markdown and code cell types convert through the tool', async (t) => {
  const dir = sandbox(t, 'notebook-type-');
  const file = path.join(dir, 't.ipynb');
  fs.writeFileSync(file, NB5([{ cell_type: 'markdown', id: 'gggg0001', metadata: {}, source: ['# hi'] }, CODE('gggg0002')]));
  const h = harness(dir);
  await h.registered.notebook_edit.execute('id', { path: file, cell: 1, mode: 'replace', source: 'print(1)', cellType: 'code' }, undefined, undefined, { cwd: dir });
  await h.registered.notebook_edit.execute('id', { path: file, cell: 2, mode: 'replace', source: '## md', cellType: 'markdown' }, undefined, undefined, { cwd: dir });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved.cells[0]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source']);
  assert.equal(saved.cells[0].cell_type, 'code');
  assert.deepEqual(saved.cells[1], { cell_type: 'markdown', id: 'gggg0002', metadata: {}, source: ['## md'] });
});

test('python-style notebook: an edit leaves every other byte unchanged', async (t) => {
  const dir = sandbox(t, 'notebook-py-');
  const file = path.join(dir, 'py.ipynb');
  const original = fs.readFileSync(path.join(__dirname, 'fixtures', 'python.ipynb'), 'utf8');
  const cells = JSON.parse(original).cells.length;
  const h = harness(dir);
  const run = (params) => h.registered.notebook_edit.execute('id', { path: file, ...params }, undefined, undefined, { cwd: dir });
  const cellStart = (text, n) => { let at = -1; for (let k = 0; k <= n; k++) at = text.indexOf('\n  {\n', at + 1); return at + 1; };

  fs.writeFileSync(file, original);
  await run({ cell: 2, mode: 'replace', source: 'print("héllo")' });
  const replaced = fs.readFileSync(file, 'utf8');
  assert.equal(replaced.slice(0, cellStart(replaced, 1)), original.slice(0, cellStart(original, 1)));
  assert.equal(replaced.slice(replaced.lastIndexOf('\n  {\n')), original.slice(original.lastIndexOf('\n  {\n')));
  assert.match(replaced, /"print\(\\"héllo\\"\)"/);

  fs.writeFileSync(file, original);
  await run({ cell: 1, mode: 'insert', source: 'new' });
  const inserted = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(inserted).cells.length, cells + 1);
  assert.match(inserted, /\{\n {3}"cell_type": "code",\n {3}"execution_count": null,\n {3}"id": "[0-9a-f]{8}",\n {3}"metadata": \{\},\n {3}"outputs": \[\],\n {3}"source": \[\n {4}"new"\n {3}\]\n {2}\}/);
  fs.writeFileSync(file, original);
  await run({ cell: 1, mode: 'insert', source: 'new' });
  await run({ cell: 2, mode: 'delete' });
  assert.equal(fs.readFileSync(file, 'utf8'), original);

  for (const cell of [1, cells]) {
    fs.writeFileSync(file, original);
    await run({ cell, mode: 'insert', source: 'edge' });
    await run({ cell: cell === 1 ? 2 : cells + 1, mode: 'delete' });
    assert.equal(fs.readFileSync(file, 'utf8'), original, `insert/delete at ${cell}`);
  }
});
