'use strict';
// Git plumbing for git-checkpoint. Pure CommonJS, no Pi imports.
// Every call goes through execFile with an argument array (never a shell) and a timeout.
// Snapshots are built with a *temporary copy* of the index, so the user's real index,
// HEAD, branches and stash list are never touched. Checkpoints live under
// refs/pi-checkpoints/<session>/<n>.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REF_ROOT = 'refs/pi-checkpoints';
const DEFAULT_KEEP = 50;
const DEFAULT_TIMEOUT = 30000;
const SNAPSHOT_TIMEOUT = 120000;

const IDENT_ENV = {
  GIT_AUTHOR_NAME: 'pi-checkpoint',
  GIT_AUTHOR_EMAIL: 'pi-checkpoint@localhost',
  GIT_COMMITTER_NAME: 'pi-checkpoint',
  GIT_COMMITTER_EMAIL: 'pi-checkpoint@localhost',
};

function git(cwd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(opts.env || {}) },
        timeout: opts.timeout || DEFAULT_TIMEOUT,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          err.message = `git ${args[0]} failed: ${(stderr || err.message).trim()}`;
          reject(err);
        } else resolve(stdout);
      },
    );
    if (opts.input !== undefined) child.stdin.end(opts.input);
  });
}

const STATE_PATHS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
const BUSY_LABEL = {
  MERGE_HEAD: 'merge in progress',
  CHERRY_PICK_HEAD: 'cherry-pick in progress',
  REVERT_HEAD: 'revert in progress',
  'rebase-merge': 'rebase in progress',
  'rebase-apply': 'rebase in progress',
};

/** Returns {root, indexPath, busy} or null when cwd is not inside a work tree. */
async function repoInfo(cwd) {
  let root;
  try {
    root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }
  if (!root) return null;
  const args = ['rev-parse', '--git-path', 'index'];
  for (const p of STATE_PATHS) args.push('--git-path', p);
  const lines = (await git(cwd, args)).split('\n');
  const abs = (p) => path.resolve(cwd, p);
  let busy = null;
  STATE_PATHS.forEach((name, i) => {
    if (!busy && lines[i + 1] && fs.existsSync(abs(lines[i + 1]))) busy = name;
  });
  return { root, indexPath: abs(lines[0]), busy: busy ? BUSY_LABEL[busy] : null };
}

async function headSha(cwd) {
  try {
    return (await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD'])).trim() || null;
  } catch {
    return null;
  }
}

/** Build a tree object of the current work tree (tracked + untracked, not ignored) without touching the real index. */
async function writeWorkTree(cwd, info) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-ckpt-'));
  const indexFile = path.join(dir, 'index');
  try {
    try {
      await fs.promises.copyFile(info.indexPath, indexFile); // reuse stat cache so unchanged files are not rehashed
      // Keep the original index mtime. Git rehashes "racily clean" entries (file mtime >= index mtime); a fresh
      // mtime on the copy would make a same-size edit in the same second as the last index write look unchanged.
      const st = await fs.promises.stat(info.indexPath);
      await fs.promises.utimes(indexFile, st.atime, st.mtime);
    } catch {
      /* no index yet (fresh repo): start empty */
    }
    const env = { GIT_INDEX_FILE: indexFile };
    await git(cwd, ['add', '-A', '--', ':/'], { env, timeout: SNAPSHOT_TIMEOUT });
    return (await git(cwd, ['write-tree'], { env })).trim();
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function oneLine(text, max = 200) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildMessage(meta) {
  return [
    `pi-checkpoint: turn ${meta.turn}${meta.kind === 'pre-restore' ? ' (before rewind)' : ''}`,
    '',
    `Pi-Session: ${meta.session}`,
    `Pi-Turn: ${meta.turn}`,
    `Pi-Kind: ${meta.kind}`,
    `Pi-Files: ${meta.files}`,
    `Pi-Prompt: ${oneLine(meta.prompt)}`,
    '',
  ].join('\n');
}

function parseMessage(body) {
  const out = {};
  for (const line of String(body || '').split('\n')) {
    const m = /^Pi-(Session|Turn|Kind|Files|Prompt): ?(.*)$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return {
    session: out.session || '',
    turn: Number(out.turn) || 0,
    kind: out.kind || 'auto',
    files: Number(out.files) || 0,
    prompt: out.prompt || '',
  };
}

function safeSegment(id) {
  return String(id || 'session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'session';
}

/** All checkpoints in this repo, newest first. */
async function listCheckpoints(cwd) {
  const fmt = ['%(refname)', '%(objectname)', '%(tree)', '%(creatordate:unix)', '%(contents)'].join('%1f') + '%1e';
  let out;
  try {
    out = await git(cwd, ['for-each-ref', `--format=${fmt}`, REF_ROOT + '/']);
  } catch {
    return [];
  }
  const items = [];
  for (const rec of out.split('\x1e')) {
    const r = rec.replace(/^\n/, '');
    if (!r.trim()) continue;
    const [ref, sha, tree, time, body] = r.split('\x1f');
    items.push({ ref, sha, tree, time: Number(time) * 1000, ...parseMessage(body) });
  }
  items.sort((a, b) => b.time - a.time || b.turn - a.turn);
  return items;
}

async function diffFiles(cwd, fromTree, toTree) {
  const out = await git(cwd, ['diff-tree', '-r', '--no-renames', '-z', '--name-status', fromTree, toTree]);
  const parts = out.split('\0');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!parts[i]) break;
    changes.push({ status: parts[i][0], path: parts[i + 1] });
  }
  return changes;
}

async function countFilesVsHead(cwd, tree, head) {
  if (!head) {
    const out = await git(cwd, ['ls-tree', '-r', '--name-only', '-z', tree]);
    return out.split('\0').filter(Boolean).length;
  }
  const headTree = (await git(cwd, ['rev-parse', `${head}^{tree}`])).trim();
  return (await diffFiles(cwd, headTree, tree)).length;
}

async function pruneCheckpoints(cwd, keep = DEFAULT_KEEP) {
  const all = await listCheckpoints(cwd);
  const doomed = all.slice(Math.max(0, keep));
  for (const c of doomed) await git(cwd, ['update-ref', '-d', c.ref]);
  return doomed.length;
}

async function deleteAllCheckpoints(cwd) {
  const all = await listCheckpoints(cwd);
  for (const c of all) await git(cwd, ['update-ref', '-d', c.ref]);
  return all.length;
}

/**
 * Create a checkpoint of the work tree.
 * Returns {status, checkpoint?, reason?}; status is one of
 *   'created'   new ref written
 *   'unchanged' tree identical to the latest checkpoint (checkpoint = that one; nothing written)
 *   'skipped'   not a repo / merge or rebase in progress (reason set)
 */
async function createCheckpoint(cwd, { session, prompt = '', kind = 'auto', keep = DEFAULT_KEEP } = {}) {
  const info = await repoInfo(cwd);
  if (!info) return { status: 'skipped', reason: 'not-a-repo' };
  if (info.busy) return { status: 'skipped', reason: info.busy };

  const tree = await writeWorkTree(cwd, info);
  const all = await listCheckpoints(cwd);
  const seg = safeSegment(session);
  const mine = all.filter((c) => c.ref.startsWith(`${REF_ROOT}/${seg}/`));
  const latest = mine[0] || all[0];
  if (latest && latest.tree === tree) return { status: 'unchanged', checkpoint: latest };

  const head = await headSha(cwd);
  const turn = mine.reduce((m, c) => Math.max(m, c.turn), 0) + 1;
  const files = await countFilesVsHead(cwd, tree, head);
  const message = buildMessage({ session: seg, turn, kind, files, prompt });
  const args = ['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-m', message];
  if (head) args.push('-p', head);
  const sha = (await git(cwd, args, { env: IDENT_ENV })).trim();
  const ref = `${REF_ROOT}/${seg}/${turn}`;
  await git(cwd, ['update-ref', ref, sha]);
  await pruneCheckpoints(cwd, keep);
  return {
    status: 'created',
    checkpoint: { ref, sha, tree, time: Date.now(), session: seg, turn, kind, files, prompt: oneLine(prompt) },
  };
}

/** Tree object of the current work tree (same temp-index method as a checkpoint; writes only loose objects). */
async function currentTree(cwd) {
  const info = await repoInfo(cwd);
  if (!info) throw new Error('not a git repository');
  return writeWorkTree(cwd, info);
}

/** Line stats of what changed after a checkpoint: {added, deleted, files}. Binary files count as a file, 0 lines. */
async function numstat(cwd, fromTree, toTree) {
  const out = await git(cwd, ['diff', '--numstat', '--no-renames', '-z', fromTree, toTree]);
  let added = 0;
  let deleted = 0;
  let files = 0;
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const [a, d] = rec.split('\t');
    files++;
    added += Number(a) || 0; // '-' for binary files
    deleted += Number(d) || 0;
  }
  return { added, deleted, files };
}

/** Stat + patch of checkpoint -> tree, for display. Optionally limited to repo-relative paths. */
async function diffText(cwd, fromTree, toTree, paths = []) {
  const tail = paths.length ? ['--', ...paths.map((p) => `:(top,literal)${p}`)] : [];
  const base = ['diff', '--no-renames', '--no-color', '--no-ext-diff'];
  const stat = await git(cwd, [...base, '--stat', fromTree, toTree, ...tail]);
  const patch = await git(cwd, [...base, fromTree, toTree, ...tail], { timeout: SNAPSHOT_TIMEOUT });
  return { stat, patch };
}

/**
 * Turn user-typed paths (relative to cwd or absolute) into repo-relative paths.
 * Throws when a path is empty or resolves outside the repository. '' means the repo root (everything).
 */
function resolveRepoPaths(cwd, root, inputs) {
  const rootReal = fs.realpathSync(root);
  const cwdReal = fs.realpathSync(cwd);
  return inputs.map((input) => {
    if (!input || input.includes('\0')) throw new Error('empty path');
    const rel = path.relative(rootReal, path.resolve(cwdReal, input));
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`path is outside the repository: ${input}`);
    }
    return rel.split(path.sep).join('/');
  });
}

function pathSelected(p, specs) {
  return specs.some((s) => s === '' || p === s || p.startsWith(s + '/'));
}

/** What restoring `checkpoint` would do right now (writes only loose objects). `paths` limits it to those repo-relative paths. */
async function planRestore(cwd, checkpoint, { paths } = {}) {
  const info = await repoInfo(cwd);
  if (!info) throw new Error('not a git repository');
  if (info.busy) throw new Error(`refusing to rewind: ${info.busy}`);
  const current = await writeWorkTree(cwd, info);
  let changes = await diffFiles(cwd, current, checkpoint.tree);
  if (paths && paths.length) changes = changes.filter((c) => pathSelected(c.path, paths));
  return {
    root: info.root,
    write: changes.filter((c) => c.status !== 'D').map((c) => c.path), // changed or deleted since: put back as at checkpoint
    remove: changes.filter((c) => c.status === 'D').map((c) => c.path), // exist now, absent at checkpoint
  };
}

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * Restore the work tree to a checkpoint.
 *  1. checkpoint the current state first (kind 'pre-restore') so the restore is undoable
 *  2. for every path that differs (or only the selected `paths`, if given) between now and the checkpoint: rewrite it from the checkpoint,
 *     or delete it if the checkpoint does not contain it
 * Nothing else is touched: index, HEAD, branches, stash list, ignored files, files identical in both states.
 */
async function restoreCheckpoint(cwd, checkpoint, { session, keep = DEFAULT_KEEP, paths } = {}) {
  const plan = await planRestore(cwd, checkpoint, { paths });
  const safety = await createCheckpoint(cwd, {
    session,
    prompt: `before rewind to turn ${checkpoint.turn}${paths && paths.length ? ' (selected files)' : ''}`,
    kind: 'pre-restore',
    keep,
  });
  if (safety.status === 'skipped') throw new Error(`cannot save current state first (${safety.reason})`);

  for (const group of chunk(plan.write, 100)) {
    await git(cwd, ['restore', `--source=${checkpoint.sha}`, '--worktree', '--', ...group.map((p) => `:(top,literal)${p}`)], {
      timeout: SNAPSHOT_TIMEOUT,
    });
  }
  const rootReal = path.resolve(plan.root);
  for (const rel of plan.remove) {
    const target = path.resolve(rootReal, rel);
    if (!target.startsWith(rootReal + path.sep)) continue; // never leave the repo
    await fs.promises.rm(target, { force: true, recursive: true });
    let dir = path.dirname(target); // tidy now-empty parent directories (never the root)
    while (dir.startsWith(rootReal + path.sep)) {
      try {
        await fs.promises.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
  return { written: plan.write, removed: plan.remove, undo: safety.checkpoint || null };
}

module.exports = {
  REF_ROOT,
  DEFAULT_KEEP,
  git,
  repoInfo,
  createCheckpoint,
  listCheckpoints,
  planRestore,
  currentTree,
  numstat,
  diffText,
  resolveRepoPaths,
  restoreCheckpoint,
  pruneCheckpoints,
  deleteAllCheckpoints,
  parseMessage,
  buildMessage,
  safeSegment,
  oneLine,
};
