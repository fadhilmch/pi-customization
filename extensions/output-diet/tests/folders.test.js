const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { parseCommand, unwrap } = require('../commands.js');
const { FOLDERS, FOLDER_NAMES, pickFolder, foldByCommand } = require('../folders.js');
const { mergeConfig } = require('../config.js');
const { Stats, formatStats } = require('../stats.js');
const { createDiet } = require('../diet.js');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.txt`), 'utf8');
// Fixtures are small; lower the thresholds so they count as "large".
const cfg = mergeConfig({ thresholdLines: 20, thresholdBytes: 500 });
const run = (command, name) => foldByCommand(command, fx(name), cfg, { fullPath: '/tmp/full.log' });
const lines = (r) => r.text.split('\n');

// ---------- command parsing ----------

test('parseCommand sees through env prefixes, cd chains, redirects and wrappers', () => {
  assert.deepEqual(parseCommand('git log'), ['git', 'log']);
  assert.deepEqual(parseCommand('FOO=1 BAR="a b" git status 2>&1'), ['git', 'status']);
  assert.deepEqual(parseCommand('cd sub && npm test'), ['npm', 'test']);
  assert.deepEqual(parseCommand('cd "my dir"; export X=1; pytest -q 2>/dev/null'), ['pytest', '-q']);
  assert.deepEqual(parseCommand('env -i A=b time go test ./...'), ['go', 'test', './...']);
  assert.deepEqual(parseCommand('bash -c "cd a && pytest -q"'), ['pytest', '-q']);
  assert.deepEqual(parseCommand('git commit -m "a && b | c"'), ['git', 'commit', '-m', 'a && b | c']);
});

test('parseCommand gives up on pipes, ||, unclear chains and junk', () => {
  for (const c of ['git log | head -5', 'npm test 2>&1 | tail -20', 'pytest | grep FAIL', 'a || b', 'npm ci && npm test', 'git log && git status', '', '   ', 'echo "unterminated']) {
    assert.equal(parseCommand(c), null, c);
  }
  assert.equal(parseCommand(undefined), null);
});

test('unwrap strips runner wrappers', () => {
  assert.deepEqual(unwrap(['npx', '-y', 'jest', '--ci']), ['jest', '--ci']);
  assert.deepEqual(unwrap(['pnpm', 'exec', 'eslint', '.']), ['eslint', '.']);
  assert.deepEqual(unwrap(['uv', 'run', 'pytest']), ['pytest']);
  assert.deepEqual(unwrap(['python3', '-m', 'pytest', '-x']), ['pytest', '-x']);
  assert.deepEqual(unwrap(['npm', 'test']), ['npm', 'test']);
});

// ---------- picking ----------

test('pickFolder selects by command, honours disableFolders, ignores pipes', () => {
  const name = (c, k = cfg) => pickFolder(c, k)?.name;
  assert.equal(name('git log'), 'git-log');
  assert.equal(name('git log --format=%H'), undefined);
  assert.equal(name('git log --oneline'), undefined);
  assert.equal(name('git -C repo status -sb'), 'git-status');
  assert.equal(name('git diff HEAD~1'), 'git-diff');
  assert.equal(name('git diff --stat'), undefined);
  assert.equal(name('cd app && FORCE_COLOR=0 npx vitest run'), 'test-runner');
  assert.equal(name('npm run test:unit'), 'test-runner');
  assert.equal(name('node --test tests/'), 'test-runner');
  assert.equal(name('go test ./...'), 'test-runner');
  assert.equal(name('cargo test --release'), 'test-runner');
  assert.equal(name('python -m pytest -q'), 'test-runner');
  assert.equal(name('npx tsc --noEmit'), 'tsc');
  assert.equal(name('pnpm exec eslint src'), 'eslint');
  assert.equal(name('npm install'), 'install');
  assert.equal(name('python -m pip install -r r.txt'), 'install');
  assert.equal(name('grep -rn foo src'), 'grep');
  assert.equal(name('grep -rl foo src'), undefined);
  assert.equal(name('grep foo file.txt'), undefined);
  assert.equal(name('rg TODO'), 'grep');
  assert.equal(name('find . -name "*.js"'), 'find');
  assert.equal(name('find . -name x -exec rm {} +'), undefined);
  assert.equal(name('ls -laR'), 'ls');
  assert.equal(name('ls -la'), undefined);
  assert.equal(name('git log | head'), undefined);
  assert.equal(name('pytest | tail -5'), undefined);
  assert.equal(name('git log', { ...cfg, disableFolders: ['git-log'] }), undefined);
  assert.equal(name('git status', { ...cfg, disableFolders: ['git-log'] }), 'git-status');
  assert.deepEqual(FOLDERS.map((f) => f.name), FOLDER_NAMES);
});

// ---------- fixtures: one per folder ----------

test('git log: one `hash subject` line per commit', () => {
  const r = run('git log', 'git-log');
  const out = lines(r);
  assert.equal(r.folder, 'git-log');
  assert.match(out[0], /^\[output-diet: git-log summary of 320 lines, full output saved to \/tmp\/full\.log;/);
  assert.equal(out[1], '40 commits:');
  assert.equal(out.filter((l) => /^[0-9a-f]{8} (feat|fix): change number \d+$/.test(l)).length, 40);
  assert.ok(!r.text.includes('Author:') && !r.text.includes('Longer body'));
});

test('git log: commit cap leaves a count', () => {
  const r = foldByCommand('git log', fx('git-log'), { ...cfg, maxMatches: 5 });
  assert.equal(lines(r).filter((l) => /^[0-9a-f]{8} /.test(l)).length, 5);
  assert.match(r.text, /\[… 35 more commits\]/);
});

test('git status: grouped counts, capped file list', () => {
  const r = run('git status', 'git-status');
  const out = lines(r);
  assert.equal(out[1], 'On branch feat/x');
  assert.equal(out[2], '75 changes: 4 staged, 31 unstaged, 40 untracked');
  assert.ok(out.includes('A src/added.ts') && out.includes('D old.js') && out.includes('M src/staged1.ts'));
  assert.match(r.text, /\[… 35 more files\]/);
  assert.equal(lines(r).filter((l) => /^(M|A|D|\?\?) /.test(l)).length, 40);
});

test('git status --short is parsed too', () => {
  const short = ['## main...origin/main', ...Array.from({ length: 60 }, (_, i) => (i % 2 ? ` M src/a${i}.js` : `?? new${i}.js`))].join('\n');
  const r = foldByCommand('git status -sb', short, { ...cfg, maxMatches: 10 });
  assert.match(r.text, /On main\.\.\.origin\/main\n60 changes: 30 unstaged, 30 untracked/);
});

test('git diff: per-file stat, then capped hunks', () => {
  const r = run('git diff', 'git-diff');
  const out = lines(r);
  assert.equal(out[1], '7 files changed, +108 -108');
  assert.ok(out.includes('  src/f1.ts | +18 -18') && out.includes('  logo.png | binary'));
  assert.ok(out.includes('--- src/f1.ts') && out.includes('@@ -1,12 +1,14 @@ function f1() {'));
  assert.match(r.text, /\[… \d+ more changed lines in src\/f1\.ts\]/);
  assert.ok(r.text.length < fx('git-diff').length / 2);
});

for (const [command, name, summary] of [
  ['pytest -q', 'pytest', /1 failed, 119 passed in 3\.21s/],
  ['npx jest', 'jest', /Tests: {7}1 failed, 71 passed, 72 total/],
  ['go test -v ./...', 'go-test', /FAIL\texample\.com\/pkg/],
  ['cargo test', 'cargo-test', /test result: FAILED\. 39 passed; 1 failed/],
  ['node --test', 'node-test', /ℹ pass 30/],
]) {
  test(`test-runner (${name}): failure blocks and the summary stay, passing lines go`, () => {
    const r = run(command, name);
    assert.equal(r.folder, 'test-runner');
    assert.match(r.text, summary);
    assert.match(r.text, /fail/i);
    assert.ok(!/case \d+\.[13-6]\b|✔ passes|TestCase[0-68-9]\d* \(|case_[1-8] \.\.\. ok|tests\/test_mod[1-9]\.py \.+/.test(r.text.split('\n').slice(2).join('\n')), 'passing lines dropped');
    assert.ok(r.text.length < fx(name).length * 0.6);
  });
}

test('test-runner details: failure content is kept verbatim', () => {
  assert.match(run('pytest', 'pytest').text, />       assert parse\(""\) == \[\]\nE {7}AssertionError: assert None == \[\]/);
  assert.match(run('npx jest', 'jest').text, /Expected: 2\n {4}Received: 3/);
  assert.match(run('cargo test', 'cargo-test').text, /panicked at src\/lib\.rs:44:9/);
  assert.match(run('go test', 'go-test').text, /case_test\.go:31: got 3 want 4/);
});

test('test-runner falls back (null) without a visible summary or with huge leftovers', () => {
  const noSummary = Array.from({ length: 60 }, (_, i) => `✔ case ${i}`).join('\n');
  assert.equal(foldByCommand('npx jest', noSummary, cfg), null);
  const manyFailures = [...Array.from({ length: 40 }, (_, i) => `✕ case ${i}\n  detail a\n  detail b`), 'Tests: 40 failed, 40 total'].join('\n');
  assert.equal(foldByCommand('npx jest', manyFailures, cfg), null);
});

test('tsc: grouped by file, capped per file, totals kept', () => {
  const r = run('npx tsc --noEmit', 'tsc');
  const out = lines(r);
  assert.equal(out[1], '21 errors in 5 files');
  assert.ok(out.includes('src/mod1.ts (9)') && out.includes('src/mod2.ts (3)'));
  assert.ok(out.includes("  3:5 TS2322 Type 'string' is not assignable to type 'number'."));
  assert.ok(out.includes('  [… 4 more in this file]'));
  assert.ok(out.includes('Found 21 errors in 5 files.'));
  assert.ok(!r.text.includes("Type 'A' is not assignable"), 'continuation lines trimmed');
});

test('eslint: grouped by file, errors before warnings, summary kept', () => {
  const r = run('npx eslint .', 'eslint');
  const out = lines(r);
  assert.equal(out[1], '61 problems in 8 files');
  assert.ok(out.includes('/repo/src/file2.js (40)'));
  assert.ok(out.includes('  [… 35 more in this file]'));
  assert.ok(!out.slice(out.indexOf('/repo/src/file2.js (40)'), out.indexOf('  [… 35 more in this file]')).some((l) => / warning /.test(l)), 'errors are shown before warnings');
  assert.ok(out.includes('✖ 61 problems (51 errors, 10 warnings)'));
});

test('install: summary lines, warnings (deduplicated) and errors only', () => {
  const n = run('npm install', 'npm-install');
  const out = lines(n).slice(1);
  assert.equal(out.filter((l) => /deprecated inflight/.test(l)).length, 1);
  assert.ok(out.includes('added 412 packages, and audited 413 packages in 14s'));
  assert.ok(out.includes('3 vulnerabilities (1 moderate, 2 high)'));
  assert.ok(!n.text.includes('npm http fetch'));
  const p = run('pip install -r requirements.txt', 'pip-install');
  assert.match(p.text, /WARNING: The script foo/);
  assert.match(p.text, /ERROR: pip's dependency resolver/);
  assert.match(p.text, /Successfully installed newpkg1-2\.0/);
  assert.match(p.text, /\[25 requirements already satisfied\]/);
  assert.ok(!p.text.includes('Downloading'));
});

test('install: every error line is kept even past the warning cap', () => {
  const noisy = [...Array.from({ length: 80 }, (_, i) => `npm warn deprecated pkg${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0))}@1.0.0: old`), ...Array.from({ length: 5 }, (_, i) => `npm ERR! code E${i}`), 'npm ERR! A complete log is in /x'].join('\n');
  const r = foldByCommand('npm ci', noisy, { ...cfg, maxMatches: 3 });
  assert.equal((r.text.match(/npm ERR!/g) || []).length, 6);
  assert.match(r.text, /more distinct warnings? not shown/);
});

test('grep -r / rg: matches grouped by file with counts', () => {
  const r = run('grep -rn TODO src', 'grep');
  const out = lines(r);
  assert.equal(out[1], '26 matches in 8 files');
  assert.ok(out.includes('src/lib/mod1.js (12)') && out.includes('  [… 9 more]'));
  assert.equal(run('rg TODO', 'grep').folder, 'grep');
  const ctx = ['a.js-1-x', 'a.js:2:y', '--', ...Array.from({ length: 30 }, (_, i) => `b.js-${i}-z`)].join('\n');
  assert.equal(foldByCommand('grep -rn y .', ctx, cfg), null, 'context output is left to the generic fold');
});

test('find: paths grouped by directory with counts', () => {
  const r = run('find . -name "*.test.js"', 'find');
  const out = lines(r);
  assert.equal(out[1], '40 paths in 6 directories');
  assert.match(out[2], /^\.\/src\/dir1\/ \(20\): file1\.test\.js .* … \+15$/);
  const withErr = `${fx('find')}find: './secret': Permission denied\n`;
  assert.match(foldByCommand('find .', withErr, cfg).text, /find: '\.\/secret': Permission denied/);
});

test('ls -R and ls -lR: one line per directory with a count', () => {
  const r = run('ls -R', 'ls-R');
  assert.equal(lines(r)[1], '59 entries in 3 directories');
  assert.ok(lines(r).includes('./ (3): README.md package.json src'));
  const l = run('ls -lR', 'ls-lR');
  assert.ok(lines(l).includes('./ (2): README.md src'));
  assert.match(l.text, /\.\/src\/ \(30\): f1\.js f2\.js/);
});

// ---------- guards ----------

test('small output, unknown format and no-gain are left alone', () => {
  assert.equal(foldByCommand('git log', 'commit abc1234\n', cfg), null);
  assert.equal(foldByCommand('git log', 'x\n'.repeat(100), cfg), null);
  assert.equal(foldByCommand('git log', fx('git-log').split('\n').slice(0, 80).join('\n'), mergeConfig()), null, 'under the default thresholds');
});

test('ANSI colour codes do not stop a folder', () => {
  const coloured = fx('git-log').replace(/^commit /gm, '\u001b[33mcommit ').replace(/^(commit [0-9a-f]+.*)$/gm, '$1\u001b[m');
  assert.equal(lines(foldByCommand('git log', coloured, cfg))[1], '40 commits:');
});

// ---------- config ----------

test('disableFolders: user may switch off; project cannot, but may switch on', () => {
  const user = { disableFolders: ['tsc', 'git-log', 'nope'] };
  assert.deepEqual(mergeConfig(user).disableFolders, ['tsc', 'git-log']);
  assert.deepEqual(mergeConfig(undefined, { disableFolders: ['install'] }).disableFolders, []);
  assert.deepEqual(mergeConfig(user, { disableFolders: ['install'] }).disableFolders, ['tsc', 'git-log']);
  assert.deepEqual(mergeConfig(user, { enableFolders: ['tsc', 'x'] }).disableFolders, ['git-log']);
  assert.deepEqual(mergeConfig().disableFolders, []);
  assert.equal(mergeConfig(user, { enableFolders: ['tsc'] }).enableFolders, undefined);
});

// ---------- engine ----------

function engine(over = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odf-'));
  const diet = createDiet({ loadConfig: () => mergeConfig({ thresholdLines: 20, thresholdBytes: 500, ...over }), os: { tmpdir: () => tmp }, emit: () => {} });
  const ctx = { cwd: '/p', sessionManager: { getSessionId: () => 's', buildContextEntries: () => [], getBranch: () => [] } };
  return { diet, ctx };
}
const ev = (command, name, extra = {}) => ({ toolName: 'bash', toolCallId: 'tc1', input: { command }, content: [{ type: 'text', text: fx(name) }], isError: false, details: undefined, ...extra });

test('engine: a folder replaces the result, saves the full output and tallies per folder', () => {
  const { diet, ctx } = engine();
  const r = diet.onToolResult(ev('cd app && git log 2>&1', 'git-log'), ctx);
  assert.match(r.content[0].text, /git-log summary of 320 lines/);
  assert.equal(r.details.outputDiet.folder, 'git-log');
  assert.equal(fs.readFileSync(r.details.outputDiet.path, 'utf8'), fx('git-log'));
  assert.equal(diet.state.stats.byFolder.get('git-log').count, 1);
  assert.equal(diet.onToolResult(ev('npx tsc', 'tsc'), ctx).details.outputDiet.folder, 'tsc');
});

test('engine: default allowlist keeps git log whole only when no folder applies; custom allowlist wins', () => {
  const dflt = engine().diet;
  const ctx = engine().ctx;
  assert.equal(dflt.onToolResult(ev('git log --format=%H%n%s', 'git-log'), ctx), undefined, 'custom --format stays allowlisted');
  assert.ok(dflt.onToolResult(ev('git log', 'git-log'), ctx), 'plain git log is summarised');
  const custom = engine({ allowlist: ['^npm test'] }).diet;
  assert.ok(custom.onToolResult(ev('git log', 'git-log'), ctx), 'folder runs; the custom allowlist does not list git');
  assert.equal(custom.onToolResult(ev('npm test', 'jest'), ctx), undefined, 'custom allowlist wins over test-runner');
});

test('engine: disabled folder and piped command fall back to the generic fold', () => {
  const { ctx } = engine();
  const off = engine({ disableFolders: ['tsc'] }).diet.onToolResult(ev('npx tsc', 'tsc'), ctx);
  assert.ok(!off || !off.details.outputDiet.folder);
  const piped = engine().diet.onToolResult(ev('npx tsc 2>&1 | head -100', 'tsc'), ctx);
  assert.ok(!piped || !piped.details.outputDiet.folder);
});

test('stats: per-folder tally, restore from details and /diet text', () => {
  const s = new Stats();
  s.record('fold', 8000, 1000, 'git-log');
  s.record('fold', 4000, 1000, 'git-log');
  s.record('fold', 4000, 2000);
  assert.deepEqual(s.snapshot().byFolder, { 'git-log': { count: 2, charsSaved: 10000 }, generic: { count: 1, charsSaved: 2000 } });
  const r = new Stats();
  r.restore([{ role: 'toolResult', details: { outputDiet: { kind: 'fold', before: 4000, after: 400, folder: 'tsc' } } }]);
  assert.equal(r.byFolder.get('tsc').count, 1);
  const text = formatStats(s, mergeConfig({ disableFolders: ['find'] }));
  assert.match(text, /by folder:\n {4}git-log: 2 results, ~2,500 tokens\n {4}generic: 1 result, ~500 tokens/);
  assert.match(text, /command folders .*; off: find/);
});
