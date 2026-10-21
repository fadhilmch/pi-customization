const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ck = require('../git.js');
const fmt = require('../format.js');

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-test-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'T');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.log\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a1\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b1\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', 'init');
  return fs.realpathSync(dir);
}
const w = (dir, f, s) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), s);
};
const r = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const exists = (dir, f) => fs.existsSync(path.join(dir, f));
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function fingerprint(dir) {
  return {
    stash: sh(dir, 'stash', 'list'),
    index: sh(dir, 'ls-files', '--stage'),
    status: sh(dir, 'status', '--porcelain=v1'),
    head: sh(dir, 'rev-parse', 'HEAD'),
    branches: sh(dir, 'branch', '--format=%(refname) %(objectname)'),
    reflog: sh(dir, 'reflog', 'show', 'HEAD'),
  };
}

test('checkpoint + restore round trip, user git state untouched', async () => {
  const dir = makeRepo();
  try {
    // dirty state: modified tracked, staged change, untracked, ignored
    w(dir, 'a.txt', 'a2\n');
    w(dir, 'b.txt', 'b-staged\n');
    sh(dir, 'add', 'b.txt');
    w(dir, 'new/untracked.txt', 'u1\n');
    w(dir, 'ignored.log', 'secret\n');

    const before = fingerprint(dir);
    const res = await ck.createCheckpoint(dir, { session: 'sess-1', prompt: 'first prompt\nsecond line' });
    assert.equal(res.status, 'created');
    assert.equal(res.checkpoint.turn, 1);
    assert.equal(res.checkpoint.prompt, 'first prompt second line');
    assert.deepEqual(fingerprint(dir), before, 'creating a checkpoint must not change stash/index/HEAD/status');
    assert.match(sh(dir, 'for-each-ref', 'refs/pi-checkpoints'), /refs\/pi-checkpoints\/sess-1\/1/);

    // modify everything after the checkpoint
    w(dir, 'a.txt', 'a3\n');
    fs.rmSync(path.join(dir, 'new/untracked.txt'));
    w(dir, 'created-later.txt', 'later\n');
    w(dir, 'deep/er/created-later.txt', 'later\n');
    w(dir, 'ignored.log', 'changed ignored\n');
    w(dir, 'unrelated.txt', 'x\n'); // also created later

    const mid = fingerprint(dir);
    const [cp] = await ck.listCheckpoints(dir);
    const plan = await ck.planRestore(dir, cp);
    assert.deepEqual(plan.write.sort(), ['a.txt', 'new/untracked.txt']);
    assert.deepEqual(plan.remove.sort(), ['created-later.txt', 'deep/er/created-later.txt', 'unrelated.txt']);
    assert.deepEqual(fingerprint(dir), mid, 'planning must not change anything');

    const out = await ck.restoreCheckpoint(dir, cp, { session: 'sess-1' });
    assert.equal(r(dir, 'a.txt'), 'a2\n');
    assert.equal(r(dir, 'b.txt'), 'b-staged\n');
    assert.equal(r(dir, 'new/untracked.txt'), 'u1\n');
    assert.ok(!exists(dir, 'created-later.txt'));
    assert.ok(!exists(dir, 'deep'), 'emptied dirs are removed');
    assert.equal(r(dir, 'ignored.log'), 'changed ignored\n', 'ignored files are never touched');
    assert.ok(out.undo, 'pre-restore checkpoint recorded');
    assert.equal(out.undo.kind, 'pre-restore');

    const after = fingerprint(dir);
    assert.equal(after.stash, before.stash);
    assert.equal(after.index, before.index, 'index unchanged by restore');
    assert.equal(after.head, before.head);
    assert.equal(after.branches, before.branches);
    assert.equal(after.reflog, before.reflog);

    // undo the restore using the pre-restore checkpoint
    const all = await ck.listCheckpoints(dir);
    const undo = all.find((c) => c.kind === 'pre-restore');
    await ck.restoreCheckpoint(dir, undo, { session: 'sess-1' });
    assert.equal(r(dir, 'a.txt'), 'a3\n');
    assert.ok(exists(dir, 'created-later.txt'));
    assert.ok(exists(dir, 'deep/er/created-later.txt'));
    assert.ok(!exists(dir, 'new/untracked.txt'));
    assert.equal(fingerprint(dir).index, before.index);
  } finally {
    rm(dir);
  }
});

test('unchanged tree does not create another checkpoint', async () => {
  const dir = makeRepo();
  try {
    w(dir, 'a.txt', 'changed\n');
    const one = await ck.createCheckpoint(dir, { session: 's', prompt: 'p1' });
    const two = await ck.createCheckpoint(dir, { session: 's', prompt: 'p2' });
    assert.equal(one.status, 'created');
    assert.equal(two.status, 'unchanged');
    assert.equal(two.checkpoint.ref, one.checkpoint.ref);
    w(dir, 'a.txt', 'changed again\n');
    const three = await ck.createCheckpoint(dir, { session: 's', prompt: 'p3' });
    assert.equal(three.status, 'created');
    assert.equal(three.checkpoint.turn, 2);
    assert.equal((await ck.listCheckpoints(dir)).length, 2);
  } finally {
    rm(dir);
  }
});

test('skips outside a git repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-norepo-'));
  try {
    const res = await ck.createCheckpoint(fs.realpathSync(dir), { session: 's' });
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'not-a-repo');
    assert.deepEqual(await ck.listCheckpoints(dir), []);
  } finally {
    rm(dir);
  }
});

test('skips during merge and rebase', async () => {
  const dir = makeRepo();
  try {
    const gitDir = path.join(dir, '.git');
    fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), sh(dir, 'rev-parse', 'HEAD'));
    w(dir, 'a.txt', 'dirty\n');
    let res = await ck.createCheckpoint(dir, { session: 's' });
    assert.equal(res.status, 'skipped');
    assert.match(res.reason, /merge/);
    await assert.rejects(ck.planRestore(dir, { tree: 'x' }), /merge/);
    fs.rmSync(path.join(gitDir, 'MERGE_HEAD'));
    fs.mkdirSync(path.join(gitDir, 'rebase-merge'));
    res = await ck.createCheckpoint(dir, { session: 's' });
    assert.equal(res.status, 'skipped');
    assert.match(res.reason, /rebase/);
    fs.rmdirSync(path.join(gitDir, 'rebase-merge'));
    res = await ck.createCheckpoint(dir, { session: 's' });
    assert.equal(res.status, 'created');
  } finally {
    rm(dir);
  }
});

test('works from a subdirectory and in a repo with no commits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-unborn-'));
  try {
    const real = fs.realpathSync(dir);
    sh(real, 'init', '-q', '-b', 'main');
    w(real, 'sub/x.txt', 'x1\n');
    const sub = path.join(real, 'sub');
    const res = await ck.createCheckpoint(sub, { session: 's', prompt: 'p' });
    assert.equal(res.status, 'created');
    assert.equal(res.checkpoint.files, 1);
    w(real, 'sub/x.txt', 'x2\n');
    w(real, 'y.txt', 'y\n');
    await ck.restoreCheckpoint(sub, (await ck.listCheckpoints(sub))[0], { session: 's' });
    assert.equal(r(real, 'sub/x.txt'), 'x1\n');
    assert.ok(!exists(real, 'y.txt'));
    assert.equal(sh(real, 'stash', 'list'), '');
  } finally {
    rm(dir);
  }
});

test('handles filenames with spaces and unicode', async () => {
  const dir = makeRepo();
  try {
    w(dir, 'my file ü.txt', 'one\n');
    await ck.createCheckpoint(dir, { session: 's', prompt: 'p' });
    w(dir, 'my file ü.txt', 'two\n');
    w(dir, 'other file.txt', 'o\n');
    await ck.restoreCheckpoint(dir, (await ck.listCheckpoints(dir))[0], { session: 's' });
    assert.equal(r(dir, 'my file ü.txt'), 'one\n');
    assert.ok(!exists(dir, 'other file.txt'));
  } finally {
    rm(dir);
  }
});

test('prune keeps the newest N; clean removes all refs', async () => {
  const dir = makeRepo();
  try {
    for (let i = 1; i <= 5; i++) {
      w(dir, 'a.txt', `v${i}\n`);
      const res = await ck.createCheckpoint(dir, { session: 's', prompt: `p${i}`, keep: 3 });
      assert.equal(res.status, 'created');
    }
    let list = await ck.listCheckpoints(dir);
    assert.deepEqual(list.map((c) => c.turn).sort(), [3, 4, 5]);
    assert.equal(await ck.pruneCheckpoints(dir, 1), 2);
    list = await ck.listCheckpoints(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].turn, 5);
    assert.equal(await ck.deleteAllCheckpoints(dir), 1);
    assert.equal(sh(dir, 'for-each-ref', 'refs/pi-checkpoints'), '');
    assert.equal(sh(dir, 'stash', 'list'), '');
  } finally {
    rm(dir);
  }
});

test('metadata round trip', () => {
  const msg = ck.buildMessage({ session: 'abc', turn: 7, kind: 'auto', files: 3, prompt: 'hello\nworld' });
  assert.deepEqual(ck.parseMessage(msg), { session: 'abc', turn: 7, kind: 'auto', files: 3, prompt: 'hello world' });
  assert.equal(ck.safeSegment('a/b c..'), 'a_b_c__');
});

test('format helpers', () => {
  const now = 1_000_000_000;
  assert.equal(fmt.timeAgo(now - 5000, now), '5s ago');
  assert.equal(fmt.timeAgo(now - 5 * 60000, now), '5m ago');
  assert.equal(fmt.timeAgo(now - 3 * 3600000, now), '3h ago');
  const label = fmt.checkpointLabel({ turn: 4, time: now - 60000, files: 1, prompt: 'fix it', session: 'x', kind: 'auto' }, { now });
  assert.equal(label, 'turn 4 · 1m ago · 1 file · fix it');
  assert.match(fmt.checkpointLabel({ turn: 1, time: now, files: 2, prompt: '', session: 'abcdefghij', kind: 'pre-restore' }, { now, currentSession: 'zzz' }), /before rewind · session abcdefgh · \(no prompt\)/);
  assert.equal(fmt.checkpointLabel({ turn: 4, time: now, files: 0, prompt: 'fix it', session: 'x', kind: 'auto' }, { now, restores: 1 }), 'turn 4 · 0s ago · restores 1 file · fix it');
  assert.match(fmt.checkpointLabel({ turn: 4, time: now, files: 0, prompt: 'p', session: 'x', kind: 'auto' }, { now, restores: 3 }), /restores 3 files/);
  assert.match(fmt.checkpointLabel({ turn: 4, time: now, files: 5, prompt: 'p', session: 'x', kind: 'auto' }, { now, restores: 0 }), /no changes since/);
  const plan = { write: ['a'], remove: Array.from({ length: 10 }, (_, i) => `f${i}`) };
  const text = fmt.describePlan(plan);
  assert.match(text, /Rewrite 1 file/);
  assert.match(text, /Delete 10 file/);
  assert.match(text, /and 2 more/);
  assert.match(text, /not touched/);
  assert.match(fmt.describePlan({ write: [], remove: [] }), /already matches/);
});

// Racy git: a same-size edit with the same mtime as the index entry is only caught because git rehashes
// entries whose mtime is not older than the index file. The snapshot's temporary index copy must keep the
// original index mtime, or the edit is silently missing from the checkpoint (flaky CI before the fix).
test('checkpoint catches a same-size edit in the same second as the last index write', async () => {
  const dir = makeRepo();
  try {
    sh(dir, 'config', 'core.trustctime', 'false'); // ctime cannot be set; take it out so only mtime/size decide
    const T = Math.floor(Date.now() / 1000) - 60; // whole seconds: no sub-second mismatch
    const file = path.join(dir, 'a.txt');
    fs.utimesSync(file, T, T);
    sh(dir, 'add', 'a.txt'); // index entry now records mtime T
    w(dir, 'a.txt', 'a9\n'); // same size as 'a1\n'
    fs.utimesSync(file, T, T);
    const index = sh(dir, 'rev-parse', '--git-path', 'index').trim();
    fs.utimesSync(path.resolve(dir, index), T, T); // index written "in the same second"

    const res = await ck.createCheckpoint(dir, { session: 's', prompt: 'p' });
    assert.equal(res.status, 'created');
    assert.equal(sh(dir, 'show', `${res.checkpoint.ref}:a.txt`), 'a9\n');
  } finally {
    rm(dir);
  }
});
