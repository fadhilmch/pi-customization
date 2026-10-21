'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function hasNotebook(cwd, { exec = execFileSync, fsApi = fs } = {}) {
  if (!cwd) return false;
  try { return Boolean(exec('git', ['ls-files', '--', '*.ipynb'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { /* outside a git worktree: walk only a few levels */ }
  function walk(dir, depth) {
    let entries;
    try { entries = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.ipynb')) return true;
      if (entry.isDirectory() && depth > 0 && !['.git', 'node_modules', '.venv', 'venv', '.ipynb_checkpoints'].includes(entry.name)) {
        if (walk(path.join(dir, entry.name), depth - 1)) return true;
      }
    }
    return false;
  }
  return walk(cwd, 3);
}

module.exports = { hasNotebook };
