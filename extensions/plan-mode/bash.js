'use strict';
// Read-only bash classifier for plan mode. Conservative: anything unrecognised is blocked.
// Approach: mask quoted strings, reject shell features that can write or run code (redirects, $(), backticks),
// split into simple commands on ; && || | newline, and require every command to be allowlisted.

const SIMPLE = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'ls', 'pwd', 'echo', 'printf', 'wc', 'uniq',
  'diff', 'cmp', 'file', 'stat', 'du', 'df', 'tree', 'which', 'whereis', 'type', 'printenv', 'uname', 'whoami',
  'id', 'date', 'cal', 'uptime', 'ps', 'free', 'jq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink',
  'nl', 'column', 'rev', 'tac', 'od', 'xxd', 'hexdump', 'strings', 'md5sum', 'shasum', 'sha256sum', 'true', 'false',
  'test', '[', 'sleep', 'hostname', 'locale', 'lsof', 'rg', 'bat', 'eza', 'fd', 'comm', 'paste', 'expand',
  'fold', 'seq', 'nproc', 'sw_vers',
]);

const GIT_READ = new Set([
  'status', 'log', 'diff', 'show', 'remote', 'ls-files', 'ls-tree', 'ls-remote', 'rev-parse', 'rev-list', 'blame',
  'describe', 'shortlog', 'cat-file', 'grep', 'show-ref', 'name-rev', 'whatchanged', 'reflog', 'merge-base',
  'diff-tree', 'for-each-ref', 'count-objects', 'check-ignore', 'help', 'version',
]);
const NPM_READ = new Set(['list', 'ls', 'view', 'info', 'search', 'outdated', 'audit', 'explain', 'why', 'root', 'prefix', 'bin', 'config']);
const YARN_READ = new Set(['list', 'info', 'why', 'audit']);

const hasFlag = (args, ...flags) => args.some((a) => flags.some((f) => a === f || (f.length > 2 && a.startsWith(`${f}=`))));
const hasShortFlag = (args, ch) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(ch));

// Replace quoted contents with 'x' so operators inside strings are ignored. Returns null on unbalanced quotes.
function maskQuotes(cmd) {
  let out = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) { q = null; out += c; continue; }
      if (c === '\\' && q === '"') { out += 'xx'; i++; continue; }
      // keep $( and backtick visible inside double quotes: they still execute
      if (q === '"' && c === '`') { out += c; continue; }
      if (q === '"' && c === '$' && (cmd[i + 1] === '(' || cmd[i + 1] === '{')) { out += c + cmd[i + 1]; i++; continue; }
      out += 'x';
    } else {
      if (c === '\\') { out += 'x'; i++; if (i < cmd.length) out += 'x'; continue; }
      if (c === "'" || c === '"') { q = c; out += c; continue; }
      out += c;
    }
  }
  return q ? null : out;
}

// Split the original command on unquoted separators, using the mask to locate them.
function splitCommands(cmd, masked) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    let len = 0;
    if (c === ';' || c === '\n') len = 1;
    else if ((c === '&' || c === '|') && masked[i + 1] === c) len = 2;
    else if (c === '|') len = 1;
    else if (c === '&' && masked[i - 1] !== '>' && masked[i + 1] !== '>') len = 1;
    if (len) {
      parts.push(cmd.slice(start, i));
      i += len - 1;
      start = i + 1;
    }
  }
  parts.push(cmd.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function tokenize(segment) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

function isSafeSimple(tokens) {
  // drop leading VAR=value assignments only if followed by a command; assignments to env are harmless
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
  if (!tokens.length) return true;
  const [cmd, ...args] = tokens;
  const sub = args.find((a) => !a.startsWith('-'));

  if (SIMPLE.has(cmd)) {
    if (cmd === 'rg') return !hasFlag(args, '--pre', '--pre-glob');
    if (cmd === 'fd') return !hasFlag(args, '-x', '--exec', '-X', '--exec-batch');
    if (cmd === 'tree') return !hasFlag(args, '-o');
    if (cmd === 'less' || cmd === 'more') return true;
    return true;
  }
  switch (cmd) {
    case 'sort': return !hasFlag(args, '-o', '--output');
    case 'env': return args.length === 0;
    case 'find': return !hasFlag(args, '-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls');
    case 'sed': return hasShortFlag(args, 'n') && !hasShortFlag(args, 'i') && !hasFlag(args, '--in-place', '-i') && !args.some((a) => /(^|[;{}\s\d$/])[wWe]\s/.test(a));
    case 'awk': case 'gawk': case 'mawk': return !args.some((a) => /system\s*\(|getline|\|\s*"|print[^;]*>/.test(a));
    case 'curl': return !hasFlag(args, '-o', '-O', '--output', '-d', '--data', '--data-raw', '--data-binary', '-F', '--form', '-T', '--upload-file', '-X', '--request', '-K', '--config') && !hasShortFlag(args, 'o') && !hasShortFlag(args, 'O');
    case 'wget': return hasFlag(args, '-O') && args[args.indexOf('-O') + 1] === '-' && !hasFlag(args, '--post-data', '--post-file');
    case 'git': {
      const flagsBefore = args.slice(0, args.indexOf(sub));
      if (hasFlag(flagsBefore, '-c', '--exec-path') || !sub) return false;
      const rest = args.slice(args.indexOf(sub) + 1);
      // listing only: every arg must be a flag (a bare name would create a branch) and none may mutate
      if (sub === 'branch') return rest.every((a) => a.startsWith('-')) && !hasFlag(rest, '-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--copy', '--set-upstream-to', '-u', '--unset-upstream', '--edit-description');
      if (sub === 'config') return hasFlag(rest, '--get', '--get-all', '--list', '-l', '--get-regexp');
      if (sub === 'remote') return !rest.length || ['-v', '--verbose', 'show', 'get-url'].includes(rest[0]);
      if (sub === 'reflog') return !rest.length || rest[0] === 'show';
      if (sub === 'diff' || sub === 'log' || sub === 'show' || sub === 'blame' || sub === 'grep') return !hasFlag(rest, '--output', '--ext-diff', '-O', '--open-files-in-pager');
      return GIT_READ.has(sub);
    }
    case 'npm': case 'pnpm': return NPM_READ.has(sub) && !(sub === 'config' && args.some((a) => ['set', 'delete', 'edit'].includes(a)));
    case 'yarn': return YARN_READ.has(sub);
    case 'node': case 'python': case 'python3': case 'ruby': case 'go': case 'cargo': case 'rustc': case 'java':
      return args.length === 1 && ['-v', '--version', 'version', '-version'].includes(args[0]);
    default: return false;
  }
}

function isSafeCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  // harmless redirections
  const cleaned = command.replace(/\d?>\s*\/dev\/null/g, ' ').replace(/\d?>&\d/g, ' ').replace(/&>\s*\/dev\/null/g, ' ');
  const masked = maskQuotes(cleaned);
  if (masked === null) return false;
  if (/[<>]/.test(masked)) return false; // redirects, here-docs, process substitution
  if (/`|\$\(|\$\{|<\(/.test(masked)) return false; // command/process substitution
  const segments = splitCommands(cleaned, masked);
  if (!segments.length) return false;
  return segments.every((seg) => isSafeSimple(tokenize(seg)));
}

module.exports = { isSafeCommand };
