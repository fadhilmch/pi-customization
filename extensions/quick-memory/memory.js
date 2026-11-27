'use strict';
// Pure helpers for "# note" quick memory. File access is injected so tests need no disk.
const path = require('node:path');
const os = require('node:os');
const nodeFs = require('node:fs');

// "# remember to use pnpm" -> "remember to use pnpm". Anything else (markdown "## h", "#tag", multi-line paste) -> null.
function parseNote(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.includes('\n')) return null;
  const m = /^#[ \t]+(\S.*)$/.exec(t);
  return m ? m[1].trim() : null;
}

function agentDir(env = process.env, home = os.homedir()) {
  const d = env.PI_CODING_AGENT_DIR;
  if (!d) return path.join(home, '.pi', 'agent');
  if (d === '~') return home;
  return d.startsWith('~/') || d.startsWith(`~${path.sep}`) ? path.join(home, d.slice(2)) : d;
}

// Pi loads the first of these that exists in a directory and ignores the rest, so a note written to
// AGENTS.md next to an existing AGENTS.override.md would never be read.
const CANDIDATES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];

const isFile = (p) => {
  try {
    return nodeFs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// The file Pi will read in `dir`: the first existing candidate, else AGENTS.md (created on save).
function memoryFile(dir, exists = isFile) {
  for (const name of CANDIDATES) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return path.join(dir, 'AGENTS.md');
}

const projectFile = (cwd, exists) => memoryFile(cwd, exists);
const userFile = (env, home, exists) => memoryFile(agentDir(env, home), exists);

// New content for the file: appends "- note" (own bullet list under "## Notes" in a new file).
function appendBullet(existing, note) {
  const bullet = `- ${note.replace(/\s+/g, ' ').trim()}\n`;
  if (existing == null || !existing.trim()) return `## Notes\n\n${bullet}`;
  const base = existing.replace(/\s+$/, '');
  const lastLine = base.split('\n').pop();
  const sep = /^\s*([-*+]|\d+\.)\s/.test(lastLine) ? '\n' : '\n\n';
  return `${base}${sep}${bullet}`;
}

const bulletLine = (note) => `- ${note.replace(/\s+/g, ' ').trim()}`;

// True if the file already has a bullet (-, * or +) with exactly this text.
function hasBullet(existing, note) {
  const want = bulletLine(note).slice(2);
  return String(existing ?? '')
    .split('\n')
    .some((l) => {
      const m = /^\s*[-*+]\s+(.*?)\s*$/.exec(l);
      return !!m && m[1].replace(/\s+/g, " ") === want;
    });
}

// fs = { readFileSync, writeFileSync, mkdirSync } (node:fs shape).
// Returns { created, duplicate, line }; nothing is written for an exact duplicate bullet.
function saveNote(file, note, fs) {
  let existing = null;
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (existing != null && hasBullet(existing, note)) return { created: false, duplicate: true, line: bulletLine(note) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, appendBullet(existing, note));
  return { created: existing == null, duplicate: false, line: bulletLine(note) };
}

// Remove the last line equal to `line` (a bullet saveNote appended). Returns { removed } and writes
// nothing if the line is gone or was edited since.
function undoNote(file, line, fs) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { removed: false };
  }
  const lines = text.split('\n');
  const i = lines.lastIndexOf(line);
  if (i < 0) return { removed: false };
  lines.splice(i, 1);
  const out = lines.join('\n').replace(/\s+$/, '');
  fs.writeFileSync(file, out ? out + '\n' : '');
  return { removed: true };
}

const shortPath = (p, home = os.homedir()) => (p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);

module.exports = { CANDIDATES, memoryFile, parseNote, agentDir, projectFile, userFile, appendBullet, bulletLine, hasBullet, saveNote, undoNote, shortPath };
