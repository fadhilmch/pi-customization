// Import-check + behaviour of index.ts with a fake pi/ctx. Needs `node --experimental-strip-types`;
// skipped when this Node cannot strip types.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

test('git-checkpoint index.ts registers hooks and /rewind, checkpoints per prompt', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const handlers = {};
  const commands = {};
  mod.default({
    on: (name, fn) => (handlers[name] = fn),
    registerCommand: (name, opts) => (commands[name] = opts),
  });
  assert.deepEqual(Object.keys(handlers).sort(), ['before_agent_start', 'message_end', 'session_before_fork', 'session_before_tree']);
  assert.ok(commands.rewind);

  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-idx-')));
  try {
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'config', 'user.email', 't@e.com');
    sh(dir, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'f.txt'), '1\n');
    sh(dir, 'add', '.');
    sh(dir, 'commit', '-qm', 'i');

    const notes = [];
    const status = [];
    let selectAnswer = (title, opts) => opts[0];
    const ctx = {
      cwd: dir,
      hasUI: true,
      sessionManager: {
        getSessionId: () => 'sess-x',
        getLeafId: () => 'u1',
        getEntry: (id) => (id === 'u1' ? { type: 'message', message: { role: 'user', content: 'edit f' } } : undefined),
      },
      ui: {
        setStatus: (k, v) => status.push(v),
        notify: (m, t) => notes.push([m, t]),
        select: async (t, o) => selectAnswer(t, o),
        confirm: async () => true,
      },
    };

    fs.writeFileSync(path.join(dir, 'f.txt'), '2\n');
    await handlers.before_agent_start({ messageType: 'user', prompt: 'edit f' }, ctx);
    await handlers.message_end({ message: { role: 'user' } }, ctx);
    assert.match(status.at(-1), /checkpoint 1/);

    fs.writeFileSync(path.join(dir, 'f.txt'), '3\n');
    fs.writeFileSync(path.join(dir, 'extra.txt'), 'x\n');
    await handlers.session_before_fork({ entryId: 'u1', position: 'before' }, ctx);
    assert.equal(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8'), '2\n');
    assert.ok(!fs.existsSync(path.join(dir, 'extra.txt')));
    assert.match(notes.at(-1)[0], /restored/);

    // declining leaves code alone
    fs.writeFileSync(path.join(dir, 'f.txt'), '4\n');
    selectAnswer = (t, o) => o[1];
    await handlers.session_before_fork({ entryId: 'u1', position: 'before' }, ctx);
    assert.equal(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8'), '4\n');

    // /rewind <n> <path> restores one file; diff shows changes; outside-repo path is refused
    fs.writeFileSync(path.join(dir, 'f.txt'), '5\n');
    fs.writeFileSync(path.join(dir, 'g.txt'), 'g\n');
    notes.length = 0;
    const oldest = sh(dir, 'for-each-ref', 'refs/pi-checkpoints').trim().split('\n').length; // list is newest first; oldest = turn 1
    await commands.rewind.handler(`diff ${oldest}`, ctx);
    assert.match(notes.at(-1)[0], /Changes since checkpoint turn 1[\s\S]*f\.txt/);
    await commands.rewind.handler(`${oldest} ../outside.txt`, ctx);
    assert.match(notes.at(-1)[0], /outside the repository/);
    await commands.rewind.handler(`${oldest} f.txt`, ctx);
    assert.match(notes.at(-1)[0], /Restored from turn/);
    assert.equal(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8'), '2\n');
    assert.equal(fs.readFileSync(path.join(dir, 'g.txt'), 'utf8'), 'g\n', 'other files untouched');
    await commands.rewind.handler('diff 99', ctx);
    assert.match(notes.at(-1)[0], /No checkpoint 99/);

    // full /rewind: list shows line stats; "code + conversation" navigates the tree without a second prompt
    fs.writeFileSync(path.join(dir, 'f.txt'), '6\n');
    let shown;
    const navigated = [];
    ctx.navigateTree = async (id) => {
      navigated.push(id);
      await handlers.session_before_tree({ preparation: { targetId: id } }, ctx); // Pi fires this hook
      return { cancelled: false };
    };
    selectAnswer = (t, o) => {
      if (/Rewind code to/.test(t)) {
        shown = o;
        return o.find((x) => /^\d+\. turn 1 /.test(x));
      }
      return o[1]; // code + conversation
    };
    await commands.rewind.handler('', ctx);
    assert.match(shown[0], /^1\. turn \d+ · .* · \+\d+ −\d+, \d+ files? · /);
    assert.deepEqual(navigated, ['u1']);
    assert.equal(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8'), '2\n');

    // /rewind lists and clean works
    selectAnswer = (t, o) => undefined;
    await commands.rewind.handler('', ctx);
    await commands.rewind.handler('clean', ctx);
    assert.equal(sh(dir, 'for-each-ref', 'refs/pi-checkpoints'), '');
    assert.equal(sh(dir, 'stash', 'list'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
