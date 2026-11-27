'use strict';
const path = require('node:path');

// Parses a bash command line far enough to know WHICH command produced the output. It is a heuristic,
// not a shell: it returns the argv of the one command whose output the result is, or null when that is
// not clear (a pipe, `||`, or a command chain whose earlier parts are not quiet setup like `cd`).

const QUIET = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'source', '.', 'unset', 'true', ':', 'umask']);
const WRAPPERS = new Set(['env', 'time', 'command', 'nice', 'nohup']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);

// Splits into segments of words plus the operators between them. Quotes group words; a backslash escapes.
function tokenize(cmd) {
  const segs = [[]];
  const ops = [];
  let word = '';
  let has = false;
  let quote = '';
  const endWord = () => { if (has) segs[segs.length - 1].push(word); word = ''; has = false; };
  const op = (o) => { endWord(); ops.push(o); segs.push([]); };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) word += cmd[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < cmd.length) { word += cmd[++i]; has = true; continue; }
    if (/\s/.test(c) && c !== '\n') { endWord(); continue; }
    if (c === '\n' || c === ';') { op(';'); continue; }
    if (c === '|') { if (cmd[i + 1] === '|') { i++; op('||'); } else if (cmd[i + 1] === '&') { i++; op('|'); } else op('|'); continue; }
    if (c === '&') {
      if (cmd[i + 1] === '&') { i++; op('&&'); continue; }
      if (/[<>]/.test(cmd[i - 1] ?? '') && has) { word += c; continue; } // 2>&1 is a redirect, not an operator
      op(';');
      continue;
    }
    word += c;
    has = true;
  }
  endWord();
  if (quote) return null; // unterminated quote: do not guess
  return { segs: segs.filter((s) => s.length), ops };
}

// Redirections (2>&1, > file, 2>/dev/null) do not change which command it is.
function dropRedirects(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d*[<>]/.test(w)) { if (/^\d*>>?$|^\d*<$/.test(w)) i++; continue; }
    out.push(w);
  }
  return out;
}

function stripPrefixes(words) {
  let a = words;
  for (;;) {
    if (!a.length) return a;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0])) { a = a.slice(1); continue; }
    if (WRAPPERS.has(path.basename(a[0]))) {
      a = a.slice(1);
      while (a.length && (a[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0]))) a = a.slice(1);
      continue;
    }
    return a;
  }
}

// Returns argv (first word is the program) or null.
function parseCommand(command, depth = 0) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const t = tokenize(command);
  if (!t || !t.segs.length) return null;
  if (t.ops.some((o) => o === '|' || o === '||')) return null;
  const segs = t.segs.map((s) => stripPrefixes(dropRedirects(s)));
  const last = segs[segs.length - 1];
  if (!last.length) return null;
  for (const s of segs.slice(0, -1)) {
    if (!s.length || !QUIET.has(path.basename(s[0]))) return null;
  }
  if (SHELLS.has(path.basename(last[0])) && last[1] === '-c' && typeof last[2] === 'string' && depth < 2) return parseCommand(last[2], depth + 1);
  return last;
}

// Strips runner wrappers so matchers see the real tool: `npx jest`, `pnpm exec eslint`, `uv run pytest`,
// `python -m pytest`. Package scripts (`npm test`) are left alone.
function unwrap(argv) {
  let a = argv.slice();
  for (let n = 0; n < 4 && a.length; n++) {
    const b = path.basename(a[0]);
    const skipFlags = (from) => { let i = from; while (i < a.length && a[i].startsWith('-')) i++; return a.slice(i); };
    if (b === 'npx' || b === 'bunx' || b === 'pnpx') { a = skipFlags(1); continue; }
    if ((b === 'pnpm' || b === 'yarn' || b === 'npm' || b === 'bun') && ['exec', 'dlx', 'x'].includes(a[1])) { a = skipFlags(2); continue; }
    if ((b === 'poetry' || b === 'uv' || b === 'pipenv' || b === 'pdm') && a[1] === 'run') { a = skipFlags(2); continue; }
    if (/^python[\d.]*$/.test(b) && a[1] === '-m' && a[2]) { a = a.slice(2); continue; }
    break;
  }
  return a;
}

module.exports = { parseCommand, unwrap, tokenize };
