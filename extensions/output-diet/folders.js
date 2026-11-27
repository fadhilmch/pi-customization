'use strict';
const path = require('node:path');
const { parseCommand, unwrap } = require('./commands.js');
const { normalize } = require('./fold.js');

// Command-aware folds, modelled on the ideas in rtk-ai/rtk (summarise what a known command prints instead
// of cutting by position). Each folder is a pure function (lines, cfg) -> lines | null; null means "not
// the format I expected", and the generic head/error/tail fold runs instead. The full output is always
// saved to a file by the caller, and error lines are summarised with counts, never silently dropped.

const FOLDER_NAMES = ['git-log', 'git-status', 'git-diff', 'test-runner', 'tsc', 'eslint', 'install', 'grep', 'find', 'ls'];

const PER_GROUP = 5; // items shown per file or directory
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (s) => s.replace(ANSI, '');
const clip = (line, max) => (line.length > max ? `${line.slice(0, max)}… [+${line.length - max} chars]` : line);
const plural = (n, w) => `${n} ${n === 1 ? w : w.replace(/y$/, 'ie').replace(/(ch|sh)$/, '$1e') + 's'}`;
const bin = (argv) => path.basename(argv[0] || '');
const flagsOf = (argv) => argv.filter((a) => a.startsWith('-'));
const hasShort = (argv, ch) => flagsOf(argv).some((f) => /^-[A-Za-z]+$/.test(f) && f.includes(ch));

// ---------- git ----------

// `git [-C dir] [--no-pager] <sub> ...` -> { sub, args }
function gitParts(argv) {
  if (bin(argv) !== 'git') return null;
  let i = 1;
  while (i < argv.length && argv[i].startsWith('-')) i += /^-[Cc]$/.test(argv[i]) || argv[i] === '--git-dir' || argv[i] === '--work-tree' ? 2 : 1;
  return argv[i] ? { sub: argv[i], args: argv.slice(i + 1) } : null;
}

const gitLog = {
  name: 'git-log',
  match(argv) {
    const g = gitParts(argv);
    return !!g && g.sub === 'log' && !g.args.some((a) => /^--(format|pretty)(=|$)|^--oneline$|^-\d+$/.test(a) || a === '-n');
  },
  // One `hash subject` line per commit; the body, author, date and any patch are dropped.
  fold(lines, cfg) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^commit ([0-9a-f]{7,40})\b/.exec(lines[i]);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && !/^commit [0-9a-f]{7,40}\b/.test(lines[j]) && !/^ {4}\S/.test(lines[j])) j++;
      const subject = j < lines.length && /^ {4}\S/.test(lines[j]) ? lines[j].trim() : '(no message)';
      out.push(`${m[1].slice(0, 8)} ${clip(subject, cfg.maxLineChars)}`);
    }
    if (!out.length) return null;
    const shown = out.slice(0, cfg.maxMatches);
    if (out.length > shown.length) shown.push(`[… ${out.length - shown.length} more commits]`);
    return [`${plural(out.length, 'commit')}:`, ...shown];
  },
};

const STATUS_LABEL = { modified: 'M', 'new file': 'A', deleted: 'D', renamed: 'R', copied: 'C', typechange: 'T', 'both modified': 'U', 'both added': 'U', 'deleted by us': 'U', 'deleted by them': 'U', 'added by us': 'U', 'added by them': 'U', 'both deleted': 'U' };

const gitStatus = {
  name: 'git-status',
  match(argv) { const g = gitParts(argv); return !!g && g.sub === 'status'; },
  // Branch line, counts per group, then one `X path` line per file (capped).
  fold(lines, cfg) {
    const files = [];
    const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
    const longFormat = lines.some((l) => /^(On branch|HEAD detached|Changes |Untracked files|Unmerged paths|nothing to commit)/.test(l));
    let head = '';
    let group = '';
    for (const line of lines) {
      let m;
      if (!longFormat) {
        if ((m = /^## (.*)$/.exec(line))) { head = `On ${m[1]}`; continue; }
        if (!(m = /^([ MADRCU?!]{2}) (\S.*)$/.exec(line))) continue;
        const [x, y] = m[1];
        if (m[1] === '??') counts.untracked++;
        else if (x === 'U' || y === 'U' || m[1] === 'AA' || m[1] === 'DD') counts.conflicted++;
        else { if (x !== ' ') counts.staged++; if (y !== ' ') counts.unstaged++; }
        files.push(`${m[1]} ${m[2]}`);
        continue;
      }
      if ((m = /^(On branch .*|HEAD detached .*)$/.exec(line))) { head = m[1]; continue; }
      if (/^Changes to be committed/.test(line)) group = 'staged';
      else if (/^Changes not staged/.test(line)) group = 'unstaged';
      else if (/^Untracked files/.test(line)) group = 'untracked';
      else if (/^Unmerged paths/.test(line)) group = 'conflicted';
      else if ((m = /^\t(?:([a-z ]+):\s+)?(.+)$/.exec(line)) && group) {
        counts[group]++;
        files.push(`${group === 'untracked' ? '??' : STATUS_LABEL[m[1]] || '?'} ${m[2]}`);
      }
    }
    if (!files.length) return null;
    const total = counts.staged + counts.unstaged + counts.untracked + counts.conflicted;
    const parts = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
    const shown = files.slice(0, cfg.maxMatches);
    if (files.length > shown.length) shown.push(`[… ${files.length - shown.length} more files]`);
    return [...(head ? [head] : []), `${plural(total, 'change')}: ${parts.join(', ')}`, ...shown];
  },
};

const gitDiff = {
  name: 'git-diff',
  match(argv) {
    const g = gitParts(argv);
    return !!g && (g.sub === 'diff' || g.sub === 'show') && !g.args.some((a) => /^--(stat|numstat|shortstat|name-only|name-status|summary|check)\b|^--raw$|^-[sz]$/.test(a));
  },
  // Per-file `+added -removed` stat for every file (capped), then the first changed lines of the first files.
  fold(lines, cfg) {
    const files = [];
    let cur = null;
    for (const line of lines) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m) { cur = { name: m[2], add: 0, del: 0, body: [], binary: false }; files.push(cur); continue; }
      if (!cur) continue;
      if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity|rename |Binary files)/.test(line)) { if (/^Binary files/.test(line)) cur.binary = true; continue; }
      if (line.startsWith('@@')) { cur.body.push(line); continue; }
      if (line.startsWith('+')) { cur.add++; cur.body.push(line); } else if (line.startsWith('-')) { cur.del++; cur.body.push(line); }
    }
    if (!files.length) return null;
    const out = [`${plural(files.length, 'file')} changed, +${files.reduce((a, f) => a + f.add, 0)} -${files.reduce((a, f) => a + f.del, 0)}`];
    for (const f of files.slice(0, cfg.maxMatches)) out.push(`  ${f.name} | ${f.binary ? 'binary' : `+${f.add} -${f.del}`}`);
    if (files.length > cfg.maxMatches) out.push(`  [… ${files.length - cfg.maxMatches} more files]`);
    const perFile = Math.max(6, Math.floor(cfg.headLines / 2));
    const shownFiles = files.filter((f) => f.body.length).slice(0, 10);
    for (const f of shownFiles) {
      out.push(`--- ${f.name}`);
      for (const l of f.body.slice(0, perFile)) out.push(clip(l, cfg.maxLineChars));
      if (f.body.length > perFile) out.push(`[… ${f.body.length - perFile} more changed lines in ${f.name}]`);
    }
    if (files.filter((f) => f.body.length).length > shownFiles.length) out.push('[… hunks of the remaining files not shown]');
    return out;
  },
};

// ---------- test runners ----------

const PASS_LINES = [
  /^\s*[✓✔√]\s/,                                  // jest, vitest, node spec reporter
  /^\s*PASS\s/,                                     // jest per-file
  /^\s*ok \d+ - /,                                  // TAP
  /^\s*# Subtest:/,                                 // node TAP
  /^\s*--- PASS/, /^\s*=== (RUN|PAUSE|CONT|NAME)\b/, // go test -v
  /^\s*test \S+ \.\.\. ok$/,                        // cargo
  /^\S+::\S+ PASSED\b/, /^\S+\.py::\S+.*\bPASSED\b/, // pytest -v
  /^[\w./\\-]+\.py\s+[.sxXFE]+\s*(\[\s*\d+%\])?$/,    // pytest progress by file
  /^[.sxXFE]+\s*(\[\s*\d+%\])?$/,                   // pytest progress dots
];

const TEST_SUMMARY = /^\s*(Tests?:|Test Suites?:|Test Files|Duration|Time:|Ran \d+ tests?|test result:|running \d+ tests?|collected \d+|(# |ℹ )(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b|ok\s+\S+\s+[\d.]+s|FAIL\b|PASS$|=+ .*(passed|failed|error|no tests ran|skipped).* =+$|\d+ (passed|failed))/;

const testRunner = {
  name: 'test-runner',
  match(argv) {
    const a = unwrap(argv);
    const b = bin(a);
    if (['pytest', 'py.test', 'jest', 'vitest', 'nextest'].includes(b)) return true;
    if (b === 'go') return a[1] === 'test';
    if (b === 'cargo') return a[1] === 'test' || a[1] === 'nextest';
    if (b === 'node' || b === 'bun' || b === 'deno') return a.includes('--test') || (b !== 'node' && a[1] === 'test');
    if (['npm', 'pnpm', 'yarn'].includes(b)) return a[1] === 'test' || a[1] === 't' || (a[1] === 'run' && /^test(:|$)/.test(a[2] || ''));
    return false;
  },
  // Drops lines of passing tests and progress; failure blocks, errors and the counts stay. If much is still
  // left (many failures) the generic fold takes over from the original text.
  fold(lines, cfg) {
    const out = [];
    let yaml = false;
    let dropped = 0;
    for (const line of lines) {
      if (yaml) { dropped++; if (/^\s*\.\.\.\s*$/.test(line)) yaml = false; continue; }
      if (PASS_LINES.some((re) => re.test(line)) && !/\bfail/i.test(line)) {
        dropped++;
        if (/^\s*ok \d+ - /.test(line)) yaml = true; // the TAP diagnostics block of a passing test
        continue;
      }
      out.push(clip(line, cfg.maxLineChars));
    }
    if (!dropped) return null;
    const hasSummary = out.some((l) => TEST_SUMMARY.test(l));
    if (!hasSummary) return null; // cannot see the result line: do not claim a summary
    if (out.length > cfg.thresholdLines) return null;
    // Blank lines carry nothing here; collapse runs.
    const tidy = out.filter((l, i) => l.trim() || (i > 0 && out[i - 1].trim()));
    return [`${plural(dropped, 'passing/progress line')} dropped`, ...tidy];
  },
};

// ---------- tsc / eslint ----------

function groupReport(groups, summaryLines, cfg, label) {
  const files = [...groups.entries()];
  if (!files.length) return null;
  const total = files.reduce((a, [, g]) => a + g.items.length, 0);
  const out = [`${plural(total, label)} in ${plural(files.length, 'file')}`];
  for (const [file, g] of files.slice(0, cfg.maxMatches)) {
    out.push(`${file} (${g.items.length})`);
    for (const it of g.items.slice(0, PER_GROUP)) out.push(`  ${clip(it, cfg.maxLineChars)}`);
    if (g.items.length > PER_GROUP) out.push(`  [… ${g.items.length - PER_GROUP} more in this file]`);
  }
  if (files.length > cfg.maxMatches) {
    const rest = files.slice(cfg.maxMatches);
    out.push(`[… ${plural(rest.length, 'more file')}: ${plural(rest.reduce((a, [, g]) => a + g.items.length, 0), label)}]`);
  }
  return [...out, ...summaryLines];
}

const tsc = {
  name: 'tsc',
  match(argv) { const a = unwrap(argv); return bin(a) === 'tsc' || bin(a) === 'vue-tsc'; },
  fold(lines, cfg) {
    const groups = new Map();
    const rest = [];
    let cur = null;
    for (const line of lines) {
      let m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);
      let item;
      if (m) item = `${m[2]}:${m[3]} ${m[5]} ${m[6]}`;
      else if ((m = /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+): (.*)$/.exec(line))) item = `${m[2]}:${m[3]} ${m[5]} ${m[6]}`;
      if (m) {
        if (!groups.has(m[1])) groups.set(m[1], { items: [] });
        cur = { text: item };
        groups.get(m[1]).items.push(item);
        continue;
      }
      if (/^\s+\S/.test(line) && cur && /^ {2,}/.test(line) && !/^\s*\d+\s*[│|]/.test(line) && !/^\s*~+/.test(line)) continue; // continuation of a type error: first line is enough
      if (/^\s*\d+\s*[│|]|^\s*~+\s*$|^\s*$/.test(line)) continue; // pretty-mode source frames
      rest.push(line);
    }
    return groupReport(groups, rest.filter((l) => /\berror\b|Found \d+|Watching|TS\d+/i.test(l)), cfg, 'error');
  },
};

const eslint = {
  name: 'eslint',
  match(argv) { return bin(unwrap(argv)) === 'eslint' || bin(unwrap(argv)) === 'eslint_d'; },
  fold(lines, cfg) {
    const groups = new Map();
    const tail = [];
    let file = null;
    let errors = 0;
    for (const line of lines) {
      const m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s{2,}(\S+)\s*$/.exec(line) || /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*)$/.exec(line);
      if (m && file) {
        if (m[3] === 'error') errors++;
        groups.get(file).items.push(`${m[1]}:${m[2]} ${m[3]} ${m[4]}${m[5] ? `  ${m[5]}` : ''}`);
        continue;
      }
      if (/^(\/|[A-Za-z]:\\|\.{0,2}\/)?[^\s].*\.[A-Za-z0-9]+$/.test(line) && !/^\s/.test(line) && !/^✖/.test(line)) { file = line.trim(); groups.set(file, { items: [] }); continue; }
      if (/^✖|^\d+ problems?|problems? \(/.test(line.trim())) tail.push(line.trim());
    }
    for (const [f, g] of groups) if (!g.items.length) groups.delete(f);
    for (const g of groups.values()) g.items.sort((a, b) => Number(/ warning /.test(a)) - Number(/ warning /.test(b))); // errors first
    return groupReport(groups, tail, cfg, 'problem');
  },
};

// ---------- install ----------

const INSTALL_KEEP = /\b(warn(ing)?s?|error|err!?|fail(ed|ure)?|deprecated|vulnerabilit(y|ies)|conflict|unmet|missing|cannot|could not|not found)\b|^added \d|^removed \d|^changed \d|^up to date|^audited|^packages?:|^done\b|^successfully (installed|uninstalled)|^\d+ packages? are looking for funding|^lockfile|^dependencies:|^devDependencies:|^\s*[+-] \S+@?\S*\s*\S*$|^progress: .* done|^\+\s|^resolved \d+/i;
const INSTALL_ERROR = /\b(error|err!?|fail(ed|ure)?|cannot|could not|not found|conflict|unmet)\b/i;
const INSTALL_DROP = /^(requirement already satisfied|collecting |downloading |using cached |installing collected|obtaining |preparing metadata|building wheel|created wheel|stored in directory|running setup|getting requirements|installing build dependencies|progress: resolved(?!.*done)|\s*\d+%|\s*[#=▉█]+)/i;

const install = {
  name: 'install',
  match(argv) {
    const a = unwrap(argv);
    const b = bin(a);
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(b)) return ['install', 'i', 'add', 'ci', 'update', 'upgrade', 'remove'].includes(a[1]) || (b === 'yarn' && a.length === 1);
    if (b === 'pip' || b === 'pip3') return a[1] === 'install' || a[1] === 'uninstall';
    if (b === 'uv') return (a[1] === 'pip' && a[2] === 'install') || a[1] === 'sync' || a[1] === 'add';
    if (b === 'poetry') return a[1] === 'install' || a[1] === 'add' || a[1] === 'update';
    return false;
  },
  // Summary lines, warnings (deduplicated, capped) and errors (all kept).
  fold(lines, cfg) {
    const out = [];
    const seenWarn = new Set();
    let warns = 0;
    let warnOver = 0;
    let satisfied = 0;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (/^requirement already satisfied/i.test(line)) { satisfied++; continue; }
      if (INSTALL_ERROR.test(line) && !/^\s*(warn|npm warn)/i.test(line)) { out.push(clip(line, cfg.maxLineChars)); continue; } // errors: all kept
      if (INSTALL_DROP.test(line)) continue;
      if (!INSTALL_KEEP.test(line)) continue;
      if (/\bwarn(ing)?\b|deprecated/i.test(line)) {
        const key = normalize(line);
        if (seenWarn.has(key)) continue;
        seenWarn.add(key);
        if (++warns > cfg.maxMatches) { warnOver++; continue; }
      }
      out.push(clip(line, cfg.maxLineChars));
    }
    if (satisfied) out.push(`[${plural(satisfied, 'requirement')} already satisfied]`);
    if (warnOver) out.push(`[… ${plural(warnOver, 'more distinct warning')} not shown]`);
    return out.length ? out : null;
  },
};

// ---------- grep / find / ls ----------

const grep = {
  name: 'grep',
  match(argv) {
    const a = unwrap(argv);
    const b = bin(a);
    if (b === 'rg' || b === 'ag' || b === 'ack') return !a.some((x) => /^(-c|--count|-l|--files-with-matches|--files|--json|-A\d*|-B\d*|-C\d*|--context.*)$/.test(x)) && !flagsOf(a).some((f) => /^-\d/.test(f));
    if (b === 'grep' || b === 'egrep' || b === 'fgrep') {
      const f = flagsOf(a);
      const recursive = f.some((x) => x === '--recursive' || x === '--dereference-recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(x));
      const other = f.some((x) => /^(--count|--files-with-matches|--files-without-match|--only-matching|--context|-[ABC]\d*)$/.test(x) || /^-[A-Za-z]*[clLqoABC]/.test(x) && !/^--/.test(x));
      return recursive && !other;
    }
    return false;
  },
  // Matches grouped by file with a count; the first few matches of each file are shown.
  fold(lines, cfg) {
    const byFile = new Map();
    const other = [];
    let n = 0;
    for (const line of lines) {
      const m = /^(.+?):(\d+)(?::\d+)?:(.*)$/.exec(line) || /^([^\s:][^:]*):(.*)$/.exec(line);
      if (!m || line.startsWith('--')) { if (line.trim() && !line.startsWith('--')) other.push(line); continue; }
      const text = m.length === 4 ? `${m[2]}: ${m[3].trim()}` : m[2].trim();
      if (!byFile.has(m[1])) byFile.set(m[1], []);
      byFile.get(m[1]).push(text);
      n++;
    }
    if (!n || n < lines.length * 0.8) return null; // context lines or unknown format
    const out = [`${plural(n, 'match')} in ${plural(byFile.size, 'file')}`];
    for (const [f, ms] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, cfg.maxMatches)) {
      out.push(`${f} (${ms.length})`);
      for (const t of ms.slice(0, 3)) out.push(`  ${clip(t, cfg.maxLineChars)}`);
      if (ms.length > 3) out.push(`  [… ${ms.length - 3} more]`);
    }
    if (byFile.size > cfg.maxMatches) out.push(`[… ${plural(byFile.size - cfg.maxMatches, 'more file')} with fewer matches]`);
    return [...out, ...other.slice(0, 10)];
  },
};

const find = {
  name: 'find',
  match(argv) {
    return bin(argv) === 'find' && !argv.some((a) => /^-(exec|execdir|ok|delete|print0|printf|ls|fprint|fls)$/.test(a));
  },
  // Paths grouped by directory with counts; the first few names of each directory are shown.
  fold(lines, cfg) {
    const byDir = new Map();
    const other = [];
    let n = 0;
    for (const line of lines) {
      if (!line.trim() || /^find: /.test(line)) { if (line.trim()) other.push(line); continue; }
      const dir = path.posix.dirname(line);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(path.posix.basename(line));
      n++;
    }
    if (!n) return null;
    const out = [`${plural(n, 'path')} in ${plural(byDir.size, 'directory')}`];
    for (const [d, names] of [...byDir.entries()].slice(0, cfg.maxMatches)) {
      out.push(`${d}/ (${names.length}): ${names.slice(0, PER_GROUP).join(' ')}${names.length > PER_GROUP ? ` … +${names.length - PER_GROUP}` : ''}`);
    }
    if (byDir.size > cfg.maxMatches) out.push(`[… ${byDir.size - cfg.maxMatches} more directories]`);
    return [...out, ...other];
  },
};

const LS_LONG = /^[-dlcbps][-rwxsStT]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/;

const ls = {
  name: 'ls',
  match(argv) {
    if (bin(argv) !== 'ls') return false;
    return flagsOf(argv).some((f) => f === '--recursive' || /^-[A-Za-z]*R[A-Za-z]*$/.test(f));
  },
  // One line per directory: entry count and the first few names.
  fold(lines, cfg) {
    const dirs = [];
    let cur = null;
    let sawHeader = false;
    for (const line of lines) {
      if (!line.trim()) { cur = null; continue; }
      const h = /^(.+):$/.exec(line);
      if (h && (!cur || !cur.entries.length || sawHeader)) { cur = { name: h[1], entries: [] }; dirs.push(cur); sawHeader = true; continue; }
      if (/^total \d+$/.test(line)) continue;
      if (!cur) { cur = { name: '.', entries: [] }; dirs.push(cur); }
      const m = LS_LONG.exec(line);
      cur.entries.push(m ? m[1].replace(/ -> .*$/, '') : line.trim());
    }
    if (!sawHeader) return null;
    const total = dirs.reduce((a, d) => a + d.entries.length, 0);
    const out = [`${plural(total, 'entry')} in ${plural(dirs.length, 'directory')}`];
    for (const d of dirs.slice(0, cfg.maxMatches)) {
      out.push(`${d.name.replace(/\/$/, '')}/ (${d.entries.length}): ${d.entries.slice(0, PER_GROUP + 3).join(' ')}${d.entries.length > PER_GROUP + 3 ? ` … +${d.entries.length - PER_GROUP - 3}` : ''}`);
    }
    if (dirs.length > cfg.maxMatches) out.push(`[… ${dirs.length - cfg.maxMatches} more directories]`);
    return out;
  },
};

const FOLDERS = [gitLog, gitStatus, gitDiff, testRunner, tsc, eslint, install, grep, find, ls];

// The enabled folder that handles this command line, or null (also for pipes and unclear chains).
function pickFolder(command, cfg) {
  const argv = parseCommand(command);
  if (!argv) return null;
  const off = cfg.disableFolders || [];
  return FOLDERS.find((f) => !off.includes(f.name) && f.match(argv)) || null;
}

// Same size thresholds as the generic fold. Returns { text, folder, linesFolded, totalLines } or null.
function foldByCommand(command, text, cfg, { fullPath = '<unsaved>' } = {}) {
  if (typeof text !== 'string') return null;
  const folder = pickFolder(command, cfg);
  if (!folder) return null;
  const lines = stripAnsi(text).replace(/\n$/, '').split('\n');
  if (lines.length <= cfg.thresholdLines && Buffer.byteLength(text, 'utf8') <= cfg.thresholdBytes) return null;
  let out;
  try { out = folder.fold(lines, cfg); } catch { return null; }
  if (!out || !out.length) return null;
  const note = `[output-diet: ${folder.name} summary of ${lines.length} lines, full output saved to ${fullPath}; use read with offset/limit to see more]`;
  const result = `${note}\n${out.join('\n')}`;
  if (result.length >= text.length * 0.8) return null; // not worth it
  return { text: result, folder: folder.name, linesFolded: Math.max(0, lines.length - out.length), totalLines: lines.length };
}

module.exports = { FOLDERS, FOLDER_NAMES, pickFolder, foldByCommand };
