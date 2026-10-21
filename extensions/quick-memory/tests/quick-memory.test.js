const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { parseNote, agentDir, appendBullet, saveNote, projectFile, userFile } = require('../memory.js');

test('parseNote accepts "# note" on one line only', () => {
  assert.equal(parseNote('# use pnpm here'), 'use pnpm here');
  assert.equal(parseNote('  #   spaced  '), 'spaced');
  assert.equal(parseNote('#\ttabbed'), 'tabbed');
});

test('parseNote ignores markdown headings, tags, empty and multi-line input', () => {
  for (const t of ['## heading', '### h', '#hashtag', '#', '# ', 'fix issue # 12', 'see # note', '# a\nsecond line', '#!/bin/sh', '', undefined]) {
    assert.equal(parseNote(t), null, JSON.stringify(t));
  }
});

test('agentDir honours PI_CODING_AGENT_DIR and ~', () => {
  assert.equal(agentDir({}, '/h'), path.join('/h', '.pi', 'agent'));
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: '/x/y' }, '/h'), '/x/y');
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: '~/cfg' }, '/h'), path.join('/h', 'cfg'));
  assert.equal(userFile({ PI_CODING_AGENT_DIR: '/x' }, '/h'), path.join('/x', 'AGENTS.md'));
  assert.equal(projectFile('/p'), path.join('/p', 'AGENTS.md'));
});

test('appendBullet: new file, bullet list, prose ending, missing trailing newline', () => {
  assert.equal(appendBullet(null, 'a'), '## Notes\n\n- a\n');
  assert.equal(appendBullet('', 'a'), '## Notes\n\n- a\n');
  assert.equal(appendBullet('- x\n', 'b'), '- x\n- b\n');
  assert.equal(appendBullet('# Title\n\nSome prose.\n\n', 'b'), '# Title\n\nSome prose.\n\n- b\n');
  assert.equal(appendBullet('- x', 'b  c\t d'), '- x\n- b c d\n');
});

test('saveNote creates dirs/files and appends to existing ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
  const file = path.join(dir, 'nested', 'AGENTS.md');
  assert.deepEqual(saveNote(file, 'one', fs), { created: true });
  assert.deepEqual(saveNote(file, 'two', fs), { created: false });
  assert.equal(fs.readFileSync(file, 'utf8'), '## Notes\n\n- one\n- two\n');
  fs.rmSync(dir, { recursive: true });
});

test('saveNote rethrows errors other than ENOENT', () => {
  const bad = { readFileSync: () => { throw Object.assign(new Error('nope'), { code: 'EACCES' }); } };
  assert.throws(() => saveNote('/x', 'n', bad), /nope/);
});

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');
test('index.ts input handler saves to the chosen file and handles/continues correctly', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-'));
  const agent = path.join(dir, 'agent');
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(proj);
  process.env.PI_CODING_AGENT_DIR = agent;
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  let handler;
  mod.default({ on: (e, h) => { if (e === 'input') handler = h; } });
  assert.ok(handler);

  const notes = [];
  let pick;
  let editor;
  const ctx = (extra = {}) => ({
    mode: 'tui', hasUI: true, cwd: proj,
    ui: { notify: (m, t) => notes.push([m, t]), select: async (_t, opts) => (pick === 'user' ? opts[1] : pick === 'project' ? opts[0] : undefined), setEditorText: (t) => (editor = t) },
    ...extra,
  });
  const ev = (text, extra = {}) => ({ type: 'input', text, source: 'interactive', ...extra });

  // project
  pick = 'project';
  assert.deepEqual(await handler(ev('# use pnpm'), ctx()), { action: 'handled' });
  assert.equal(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), '## Notes\n\n- use pnpm\n');
  assert.match(notes.at(-1)[0], /Created .*AGENTS\.md: use pnpm/);
  // user, honours PI_CODING_AGENT_DIR
  pick = 'user';
  await handler(ev('# be terse'), ctx());
  assert.equal(fs.readFileSync(path.join(agent, 'AGENTS.md'), 'utf8'), '## Notes\n\n- be terse\n');
  // cancel keeps text in editor, writes nothing
  pick = undefined;
  assert.deepEqual(await handler(ev('# nope'), ctx()), { action: 'handled' });
  assert.equal(editor, '# nope');
  assert.doesNotMatch(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), /nope/);
  // pass-through cases
  for (const [e, c] of [
    [ev('## heading'), ctx()],
    [ev('hello # there'), ctx()],
    [ev('# rpc', { source: 'rpc' }), ctx()],
    [ev('# ext', { source: 'extension' }), ctx()],
    [ev('# print'), ctx({ mode: 'print', hasUI: false })],
    [ev('# json'), ctx({ mode: 'json', hasUI: false })],
    [ev('# img', { images: [{}] }), ctx()],
  ]) assert.deepEqual(await handler(e, c), { action: 'continue' });
  delete process.env.PI_CODING_AGENT_DIR;
  fs.rmSync(dir, { recursive: true });
});

test('memoryFile picks the file Pi loads: first existing candidate, AGENTS.md only when none exists', () => {
  const { memoryFile, CANDIDATES } = require('../memory.js');
  assert.deepEqual(CANDIDATES, ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-cand-'));
  assert.equal(memoryFile(dir), path.join(dir, 'AGENTS.md'), 'nothing exists: default');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# rules\n');
  assert.equal(memoryFile(dir), path.join(dir, 'CLAUDE.md'), 'a lone CLAUDE.md must not be shadowed by a new AGENTS.md');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '');
  assert.equal(memoryFile(dir), path.join(dir, 'AGENTS.md'));
  fs.writeFileSync(path.join(dir, 'AGENTS.override.md'), '');
  assert.equal(memoryFile(dir), path.join(dir, 'AGENTS.override.md'));
  // a directory with a candidate's name is not a file Pi loads
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-cand-'));
  fs.mkdirSync(path.join(dir2, 'AGENTS.md'));
  assert.equal(memoryFile(dir2), path.join(dir2, 'AGENTS.md'));
  assert.equal(memoryFile(dir2, (p) => p.endsWith('CLAUDE.MD')), path.join(dir2, 'CLAUDE.MD'));
  // user-level file follows the same rule
  const agent = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-agent-'));
  fs.writeFileSync(path.join(agent, 'CLAUDE.md'), 'x\n');
  assert.equal(userFile({ PI_CODING_AGENT_DIR: agent }, '/h'), path.join(agent, 'CLAUDE.md'));
  assert.equal(projectFile(dir), path.join(dir, 'AGENTS.override.md'));
  // the note lands in the existing file, appended
  saveNote(userFile({ PI_CODING_AGENT_DIR: agent }), 'be terse', fs);
  assert.equal(fs.readFileSync(path.join(agent, 'CLAUDE.md'), 'utf8'), 'x\n\n- be terse\n');
  assert.ok(!fs.existsSync(path.join(agent, 'AGENTS.md')));
});
