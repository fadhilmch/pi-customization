const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createState, gate, showLog, runTest, nextMode, parseModeArg, statusText, setMode, preview } = require('../gate.js');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-gate-')));
const cwd = path.join(root, 'proj');
const home = path.join(root, 'home');
fs.mkdirSync(cwd);
fs.mkdirSync(home);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fakeCtx(choice, hasUI = true) {
  const calls = [];
  return {
    calls,
    cwd,
    hasUI,
    ui: hasUI ? { select: async (title, options) => { calls.push({ title, options }); return typeof choice === 'function' ? choice() : choice; } } : undefined,
  };
}
const bashEvent = (command) => ({ type: 'tool_call', toolName: 'bash', toolCallId: '1', input: { command } });
const tmpRoots = [path.join(root, 'scratch')];
const state = () => createState({ home, env: {}, tmpRoots });

test('gate: safe call passes without prompting', async () => {
  const ctx = fakeCtx('Deny');
  assert.equal(await gate(bashEvent('ls'), ctx, state()), undefined);
  assert.equal(ctx.calls.length, 0);
});

test('gate: risky call prompts with reason and three options', async () => {
  const ctx = fakeCtx('Allow once');
  assert.equal(await gate(bashEvent('git push --force origin main'), ctx, state()), undefined);
  assert.equal(ctx.calls.length, 1);
  assert.match(ctx.calls[0].title, /git push --force to main/);
  assert.match(ctx.calls[0].title, /^⚠/);
  assert.deepEqual(ctx.calls[0].options, ['Allow once', 'Allow for this session', 'Deny']);
});

test('gate: deny blocks with a reason telling the model the user declined', async () => {
  const r = await gate(bashEvent('git push'), fakeCtx('Deny'), state());
  assert.equal(r.block, true);
  assert.match(r.reason, /user declined/i);
  assert.match(r.reason, /git push/);
});

test('gate: cancelled dialog counts as deny', async () => {
  const r = await gate(bashEvent('git push'), fakeCtx(undefined), state());
  assert.equal(r.block, true);
});

test('gate: select throwing counts as deny', async () => {
  const r = await gate(bashEvent('git push'), fakeCtx(() => { throw new Error('x'); }), state());
  assert.equal(r.block, true);
});

test('gate: "Allow for this session" remembers the rule signature only', async () => {
  const s = state();
  const ctx = fakeCtx('Allow for this session');
  assert.equal(await gate(bashEvent('rm -rf dist'), ctx, s), undefined);
  assert.equal(await gate(bashEvent('rm -rf dist'), ctx, s), undefined);
  assert.equal(ctx.calls.length, 1, 'second identical call is not prompted');
  assert.equal(await gate(bashEvent('rm -rf other'), ctx, s), undefined);
  assert.equal(ctx.calls.length, 2, 'different target prompts again');
  const force = fakeCtx('Deny');
  assert.equal((await gate(bashEvent('git push --force origin main'), force, s)).block, true);
});

test('gate: session allow of a plain push does not cover a force push', async () => {
  const s = state();
  await gate(bashEvent('git push origin feature'), fakeCtx('Allow for this session'), s);
  const ctx = fakeCtx('Deny');
  const r = await gate(bashEvent('git push --force origin feature'), ctx, s);
  assert.equal(ctx.calls.length, 1);
  assert.equal(r.block, true);
});

test('gate: no UI blocks risky calls, allows safe ones', async () => {
  const ctx = fakeCtx(null, false);
  const r = await gate(bashEvent('git push'), ctx, state());
  assert.equal(r.block, true);
  assert.match(r.reason, /no UI/);
  assert.equal(await gate(bashEvent('ls'), ctx, state()), undefined);
});

test('gate: catastrophic is blocked without prompting, in every mode', async () => {
  for (const mode of ['auto', 'ask', 'off']) {
    const ctx = fakeCtx('Allow once');
    const r = await gate(bashEvent('rm -rf /'), ctx, createState({ home, env: {}, tmpRoots, mode, modeFromUser: true }));
    assert.equal(r.block, true, mode);
    assert.equal(ctx.calls.length, 0);
    assert.match(r.reason, /never allowed/);
  }
});

test('gate: write/edit paths', async () => {
  const s = state();
  const ctx = fakeCtx('Deny');
  assert.equal(await gate({ toolName: 'write', input: { path: 'a.txt', content: '' } }, ctx, s), undefined);
  assert.equal((await gate({ toolName: 'write', input: { path: '.env', content: '' } }, ctx, s)).block, true);
  assert.equal((await gate({ toolName: 'edit', input: { path: '../x', edits: [] } }, ctx, s)).block, true);
  assert.equal(ctx.calls.length, 2);
});

test('gate: ask mode confirms plain commands; off mode never prompts', async () => {
  const askCtx = fakeCtx('Allow once');
  const s = createState({ home, env: {}, tmpRoots, mode: 'ask', modeFromUser: true });
  assert.equal(await gate(bashEvent('ls'), askCtx, s), undefined);
  assert.equal(askCtx.calls.length, 1);
  const offCtx = fakeCtx('Deny');
  const o = createState({ home, env: {}, tmpRoots, mode: 'off', modeFromUser: true });
  assert.equal(await gate(bashEvent('git push --force origin main'), offCtx, o), undefined);
  assert.equal(offCtx.calls.length, 0);
});

test('gate: project config cannot disable the guard; user config mode is used', async () => {
  fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pi', 'auto-mode.json'), JSON.stringify({ mode: 'off', allow: ['.*'] }));
  const ctx = fakeCtx('Deny');
  const r = await gate(bashEvent('git push'), ctx, state());
  assert.equal(r.block, true);
  fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(home, '.pi', 'agent', 'auto-mode.json'), JSON.stringify({ mode: 'ask' }));
  const s = state();
  await gate(bashEvent('ls'), fakeCtx('Allow once'), s);
  assert.equal(s.mode, 'ask');
  fs.rmSync(path.join(cwd, '.pi'), { recursive: true, force: true });
  fs.rmSync(path.join(home, '.pi'), { recursive: true, force: true });
});

test('mode helpers', () => {
  assert.equal(nextMode('auto'), 'ask');
  assert.equal(nextMode('ask'), 'off');
  assert.equal(nextMode('off'), 'auto');
  assert.deepEqual(parseModeArg(''), { cycle: true });
  assert.deepEqual(parseModeArg(' ASK '), { mode: 'ask' });
  assert.ok(parseModeArg('nope').error);
  assert.match(statusText('auto'), /auto/);
  const seen = [];
  const s = state();
  setMode(s, 'ask', { ui: { setStatus: (k, v) => seen.push([k, v]), notify: (m) => seen.push(m) } });
  assert.equal(s.mode, 'ask');
  assert.equal(seen[0][0], 'auto-mode');
  assert.match(preview('bash', { command: 'x'.repeat(1000) }), /\.\.\.$/);
});

test('index.ts loads under node --experimental-strip-types and wires Pi correctly', () => {
  const fakeHome = path.join(root, 'idxhome');
  fs.mkdirSync(fakeHome, { recursive: true });
  const harness = path.join(__dirname, 'index-harness.mjs');
  const res = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', harness, cwd], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: fakeHome, USERPROFILE: fakeHome, VIRTUAL_ENV: '' }),
  });
  assert.equal(res.status, 0, res.stderr);
  const r = JSON.parse(res.stdout.trim().split('\n').pop());

  assert.deepEqual(r.registered.events.sort(), ['session_start', 'tool_call']);
  assert.deepEqual(r.registered.commands, ['auto']);
  assert.deepEqual(r.registered.shortcuts, ['ctrl+alt+a']);
  assert.deepEqual(r.afterStart.statuses[0][0], 'auto-mode');

  assert.equal(r.safe, null);
  assert.equal(r.safeSelects, 0);
  assert.equal(r.once, null);
  assert.match(r.onceTitle, /git push/);
  assert.deepEqual(r.onceOptions, ['Allow once', 'Allow for this session', 'Deny']);
  assert.match(r.highTitle, /^⚠/);
  assert.equal(r.denied.block, true);
  assert.match(r.denied.reason, /declined/);
  assert.equal(r.session1, null);
  assert.equal(r.session2, null);
  assert.equal(r.sessionPrompts, 1);
  assert.equal(r.sessionOtherPrompts, 2);
  assert.equal(r.cancelled.block, true);
  assert.equal(r.noUi.block, true);
  assert.equal(r.noUiSafe, null);
  assert.equal(r.catastrophic.block, true);
  assert.equal(r.writeInside, null);
  assert.equal(r.writeEnvPrompted, 1);
  assert.equal(r.askPrompted, 1);
  assert.match(r.askStatus[1], /ask/);
  assert.equal(r.offPrompted, 0);
  assert.equal(r.offCatastrophic.block, true);
  assert.match(r.cycleStatus[1], /auto/);
  assert.equal(r.bogus[1], 'error');
  assert.match(r.shortcutStatus[1], /ask/);
  assert.deepEqual(r.completions, [{ value: 'auto', label: 'auto' }, { value: 'ask', label: 'ask' }]);
});

const { redact, formatLog } = require('../decision-log.js');
const logState = (extra) => createState(Object.assign({ home, env: {}, tmpRoots, logRoot: path.join(root, 'logs') }, extra));
const readLines = (st) => fs.readFileSync(st.logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('decision log: one JSONL line per decision with ask outcomes, file mode 0600', async () => {
  const st = logState({ branch: 'feature/x' });
  const ctx = Object.assign(fakeCtx('Allow once'), { sessionManager: { getSessionId: () => 'sess/1' } });
  await gate(bashEvent('ls'), ctx, st);
  await gate(bashEvent('git push origin feature/x'), ctx, st);
  const denyCtx = Object.assign(fakeCtx('Deny'), { sessionManager: ctx.sessionManager });
  await gate(bashEvent('rm -rf dist'), denyCtx, st);
  const sessCtx = Object.assign(fakeCtx('Allow for this session'), { sessionManager: ctx.sessionManager });
  await gate(bashEvent('rm -rf out'), sessCtx, st);
  await gate(bashEvent('rm -rf out'), sessCtx, st);
  await gate(bashEvent('rm -rf /'), ctx, st);
  await gate(bashEvent('git push'), Object.assign(fakeCtx(null, false), { sessionManager: ctx.sessionManager }), st);
  const e = readLines(st);
  assert.deepEqual(e.map((x) => [x.verdict, x.outcome]), [
    ['allow', null], ['ask', 'allowed once'], ['ask', 'denied'], ['ask', 'allowed for session'],
    ['ask', 'allowed (session rule)'], ['deny', null], ['ask', 'blocked (no UI)'],
  ]);
  assert.equal(e[1].tool, 'bash');
  assert.equal(e[1].target, 'git push origin feature/x');
  assert.equal(e[1].rule, 'git-push');
  assert.ok(e[0].ts);
  assert.match(st.logFile, /sess_1/);
  assert.equal(fs.statSync(st.logFile).mode & 0o777, 0o600);
});

test('decision log: redacts secrets and truncates', () => {
  assert.doesNotMatch(redact('curl -H "Authorization: Bearer abc123def456" x'), /abc123/);
  assert.doesNotMatch(redact('curl -H "X-Id: Bearer abc123def456" x'), /abc123/);
  assert.match(redact('API_KEY=sk-live-1234 node x'), /API_KEY=\*\*\* node x/);
  assert.match(redact('git clone https://u:pw@host/r'), /u:\*\*\*@host/);
  assert.match(redact('tool --token abcdef'), /--token \*\*\*/);
  assert.ok(redact('x'.repeat(1000)).length <= 200);
});

test('/auto log and /auto test parse and run', async () => {
  assert.deepEqual(parseModeArg('log'), { log: 20 });
  assert.deepEqual(parseModeArg('log 5'), { log: 5 });
  assert.ok(parseModeArg('log 0').error);
  assert.ok(parseModeArg('log abc').error);
  assert.deepEqual(parseModeArg('test "git push -f"'), { test: { tool: 'bash', text: 'git push -f' } });
  assert.deepEqual(parseModeArg('test ls -la'), { test: { tool: 'bash', text: 'ls -la' } });
  assert.deepEqual(parseModeArg('test write ./a.txt'), { test: { tool: 'write', text: './a.txt' } });
  assert.ok(parseModeArg('test').error);

  const st = logState({ branch: 'main' });
  const out = [];
  const ctx = { cwd, hasUI: true, ui: { notify: (m) => out.push(m) } };
  runTest(st, ctx, { tool: 'bash', text: 'git commit -m x' });
  assert.match(out[0], /verdict: ask/);
  assert.match(out[0], /branch-guard/);
  assert.match(out[0], /protected branch main/);
  runTest(st, ctx, { tool: 'bash', text: 'rm -rf /' });
  assert.match(out[1], /verdict: deny/);
  runTest(st, ctx, { tool: 'write', text: '.env' });
  assert.match(out[2], /verdict: ask/);
  runTest(st, ctx, { tool: 'bash', text: 'ls' });
  assert.match(out[3], /verdict: allow/);
  assert.match(out[3], /none matched/);
  assert.equal(st.logFile, null, 'dry run logs nothing');

  const ctx2 = Object.assign(fakeCtx('Allow once'), { sessionManager: { getSessionId: () => 'log-test' } });
  for (const c of ['ls', 'pwd', 'git push']) await gate(bashEvent(c), ctx2, st);
  showLog(st, Object.assign({}, ctx, { sessionManager: ctx2.sessionManager }), 2);
  assert.equal(out[4].split('\n').length, 2);
  assert.match(out[4], /pwd/);
  assert.match(out[4], /git push/);
  assert.doesNotMatch(out[4], / ls /);
  assert.match(formatLog([]), /no decisions/);
});

test('gate: branch guard reads the branch of the git -C target, not the session directory', async () => {
  const git = (dir, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  const onMain = path.join(root, 'repo-main');
  const onFeature = path.join(root, 'repo-feature');
  for (const d of [onMain, onFeature]) { fs.mkdirSync(d); git(d, 'init', '-q', '-b', 'main'); }
  git(onFeature, 'checkout', '-q', '-b', 'feature/x');
  // Session runs in the feature repo; -C points at the repo on main.
  const st = createState({ home, env: {}, tmpRoots });
  const askedFor = async (command) => { const c = Object.assign(fakeCtx('Deny'), { cwd: onFeature }); await gate(bashEvent(command), c, st); return c.calls.length; };
  assert.equal(await askedFor(`git -C ${onMain} commit -m x`), 1, 'target repo is on main: asks');
  assert.equal(await askedFor(`git -C ${onFeature} commit -m x`), 0, 'target repo is on a feature branch');
  assert.equal(await askedFor('git commit -m x'), 0, 'session directory is on a feature branch');
});
