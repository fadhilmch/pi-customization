'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SKIP = ['.git', 'node_modules', '.venv', 'venv', '.ipynb_checkpoints'];

function gitExec(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

async function hasNotebook(cwd, { exec = gitExec, fsApi = fs.promises } = {}) {
  if (!cwd) return false;
  try {
    // Tracked and untracked (not ignored) notebooks; bounded in time and output size.
    const out = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', '*.ipynb'], { cwd, encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (String(out).length) return true;
  } catch { /* outside a git worktree, git missing or too slow: walk only a few levels */ }
  async function walk(dir, depth) {
    let entries;
    try { entries = await fsApi.readdir(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.ipynb')) return true;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && depth > 0 && !SKIP.includes(entry.name) && await walk(path.join(dir, entry.name), depth - 1)) return true;
    }
    return false;
  }
  return walk(cwd, 3);
}

module.exports = { hasNotebook };
