'use strict';
// Git worktree isolation: a child runs in its own checkout on its own branch, so parallel workers cannot
// overwrite each other. Git access is injected (git(args, cwd) -> stdout, throws on failure) for tests.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function realGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
}

function gitMessage(err) {
  return String(err?.stderr || err?.message || err).trim().split('\n').slice(-2).join(' ');
}

// Top level of the repository that contains cwd, or null (not a repo, or git is missing).
function repoRoot(cwd, git = realGit) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd) || null;
  } catch {
    return null;
  }
}

function shortId() {
  return crypto.randomBytes(3).toString('hex');
}

// Create <tmp>/pi-subagent-worktrees/<repo>-<id> on a new branch pi-subagent/<agent>-<id>, starting at HEAD.
// childCwd (inside the repo) maps to the same relative folder inside the worktree.
// Returns { worktree } or { error }. Uncommitted changes in the main checkout are not copied.
function createWorktree({ cwd, agent, git = realGit, tmpRoot = path.join(os.tmpdir(), 'pi-subagent-worktrees'), id = shortId() } = {}) {
  if (!fs.existsSync(cwd)) return { error: `working directory does not exist: ${cwd}` };
  const root = repoRoot(cwd, git);
  if (!root) return { error: `isolation "worktree" needs a git repository, and ${cwd} is not inside one` };
  let base;
  try {
    base = git(['rev-parse', 'HEAD'], root);
  } catch {
    return { error: 'isolation "worktree" needs a repository with at least one commit' };
  }
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(cwd));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { error: `${cwd} is outside the repository ${root}` };
  const branch = `pi-subagent/${String(agent).replace(/[^A-Za-z0-9_-]/g, '-')}-${id}`;
  const dir = path.join(tmpRoot, `${path.basename(root)}-${id}`);
  try {
    fs.mkdirSync(tmpRoot, { recursive: true });
    git(['worktree', 'add', '-b', branch, dir, base], root);
  } catch (err) {
    return { error: `git worktree add failed: ${gitMessage(err)}` };
  }
  return { worktree: { root, dir, branch, base, cwd: path.join(dir, rel) } };
}

// After the child ends: no changes and no new commits -> remove worktree and branch; else keep both.
// Returns { kept, dirty, commits } and never throws (a failed cleanup counts as kept).
function finalizeWorktree(wt, git = realGit) {
  let dirty = true;
  let commits = 1;
  try {
    dirty = git(['status', '--porcelain'], wt.dir).length > 0;
    commits = Number(git(['rev-list', '--count', `${wt.base}..HEAD`], wt.dir)) || 0;
  } catch {
    return { kept: true, dirty, commits };
  }
  if (dirty || commits > 0) return { kept: true, dirty, commits };
  try {
    git(['worktree', 'remove', '--force', wt.dir], wt.root);
    git(['branch', '-D', wt.branch], wt.root);
    return { kept: false, dirty: false, commits: 0 };
  } catch {
    return { kept: true, dirty, commits };
  }
}

// One line for the report: where the work went.
function worktreeNote(run) {
  const w = run.worktree;
  if (!w) return '';
  if (!w.kept) return '';
  const what = [w.commits ? `${w.commits} commit${w.commits === 1 ? '' : 's'}` : '', w.dirty ? 'uncommitted changes' : ''].filter(Boolean).join(' and ');
  return `Changes in branch ${w.branch} at path ${w.dir}${what ? ` (${what})` : ''}.`;
}

module.exports = { repoRoot, createWorktree, finalizeWorktree, worktreeNote, shortId };
