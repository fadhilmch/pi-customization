const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createState, gate, nextMode, parseModeArg, statusText, setMode, preview } = require('../gate.js');

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
