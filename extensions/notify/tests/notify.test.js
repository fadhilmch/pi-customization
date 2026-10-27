const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../notify.js');

test('config: defaults, merge, invalid values ignored', () => {
  assert.deepEqual(n.normalizeConfig(undefined), n.DEFAULTS);
  const c = n.normalizeConfig({ minSeconds: 3, sound: 'Basso', method: 'osc', enabled: false });
  assert.deepEqual(c, { ...n.DEFAULTS, enabled: false, minSeconds: 3, sound: 'Basso', method: 'osc' });
  const bad = n.normalizeConfig({ minSeconds: -1, method: 'carrier-pigeon', enabled: 'yes' });
  assert.deepEqual(bad, n.DEFAULTS);
  assert.deepEqual(n.loadConfig('/h', () => { throw new Error('ENOENT'); }), n.DEFAULTS);
  assert.deepEqual(n.loadConfig('/h', () => '{oops'), n.DEFAULTS);
  let seen;
  n.loadConfig('/home/x', (p) => { seen = p; return '{}'; });
  assert.equal(seen, '/home/x/.pi/agent/notify.json');
});

test('escaping: AppleScript quotes/backslashes/control chars, no injection', () => {
  const evil = 'a" & do shell script "rm -rf ~" & "\\\n\x1b[31m';
  const [flag, script] = n.osascriptArgs('T"itle', evil, 'Tink');
  assert.equal(flag, '-e');
  // every quote inside user text is escaped: removing escaped quotes leaves only our 6 delimiters
  const stripped = script.replace(/\\\\/g, '').replace(/\\"/g, '');
  assert.equal((stripped.match(/"/g) || []).length, 6);
  assert.ok(!/[\n\x1b]/.test(script));
  assert.match(script, /sound name "Tink"$/);
});

test('sound: unsafe names dropped, empty disables', () => {
  assert.equal(n.safeSound('Tink'), 'Tink');
  assert.equal(n.safeSound('x" & evil'), '');
  assert.ok(!n.osascriptArgs('t', 'b', '')[1].includes('sound name'));
  assert.ok(!n.osascriptArgs('t', 'b', 'bad"name')[1].includes('sound name'));
});

test('OSC sequences per terminal; semicolons and control chars removed', () => {
  assert.equal(n.oscSequence('Pi', 'done', {}), '\x1b]777;notify;Pi;done\x07');
  assert.match(n.oscSequence('Pi', 'done', { KITTY_WINDOW_ID: '1' }), /^\x1b\]99;i=1:d=0;Pi\x1b\\\x1b\]99;i=1:p=body;done\x1b\\$/);
  assert.equal(n.oscSequence('Pi', 'done', { TERM_PROGRAM: 'iTerm.app' }), '\x1b]9;Pi: done\x07');
  const s = n.oscSequence('a;b\x07', 'c\x1b]0;x\x07', {});
  assert.equal(s, '\x1b]777;notify;a,b;c ]0,x\x07');
});

test('method resolution', () => {
  const c = (m, enabled = true) => ({ ...n.DEFAULTS, method: m, enabled });
  assert.equal(n.resolveMethod(c('auto'), 'darwin'), 'osascript');
  assert.equal(n.resolveMethod(c('auto'), 'linux'), 'notify-send');
  assert.equal(n.resolveMethod(c('auto'), 'win32'), 'osc');
  assert.equal(n.resolveMethod(c('notify-send'), 'darwin'), 'none');
  assert.equal(n.resolveMethod(c('osascript'), 'linux'), 'none');
  assert.equal(n.resolveMethod(c('osc'), 'darwin'), 'osc');
  assert.equal(n.resolveMethod(c('none'), 'darwin'), 'none');
  assert.equal(n.resolveMethod(c('auto', false), 'darwin'), 'none');
});

test('threshold: only long runs, never aborted', () => {
  const config = { ...n.DEFAULTS, minSeconds: 10 };
  assert.equal(n.shouldNotify({ config, elapsedMs: 9999, aborted: false }), false);
  assert.equal(n.shouldNotify({ config, elapsedMs: 10000, aborted: false }), true);
  assert.equal(n.shouldNotify({ config, elapsedMs: 60000, aborted: true }), false);
  assert.equal(n.shouldNotify({ config: { ...config, enabled: false }, elapsedMs: 60000, aborted: false }), false);
});

test('message building', () => {
  assert.deepEqual(n.buildSettled({ cwd: '/a/proj', elapsedMs: 83000 }), { title: 'Pi - proj', body: 'Ready for input (took 1m 23s)' });
  assert.equal(n.buildSettled({ elapsedMs: 12000 }).title, 'Pi');
  assert.equal(n.buildPrompt({ cwd: '/a/proj', title: 'Allow?' }).body, 'Waiting for you: Allow?');
  assert.equal(n.buildPrompt({}).body, 'Waiting for your confirmation');
});

test('deliver: execFile with args (no shell), ENOENT falls back to OSC, never throws', () => {
  const calls = [];
  const writes = [];
  const base = { platform: 'darwin', env: {}, write: (s) => writes.push(s) };
  n.deliver(n.DEFAULTS, 'T', 'B', { ...base, execFile: (bin, args, opts, cb) => { calls.push([bin, args, opts]); cb(null); return { on() {} }; } });
  assert.equal(calls[0][0], 'osascript');
  assert.ok(Array.isArray(calls[0][1]));
  assert.equal(writes.length, 0);

  n.deliver(n.DEFAULTS, 'T', 'B', { ...base, execFile: (b, a, o, cb) => { cb(Object.assign(new Error('x'), { code: 'ENOENT' })); return { on() {} }; } });
  assert.equal(writes.length, 1);

  n.deliver(n.DEFAULTS, 'T', 'B', { ...base, execFile: () => { throw new Error('boom'); } });
  assert.equal(writes.length, 2);

  n.deliver({ ...n.DEFAULTS, method: 'none' }, 'T', 'B', { ...base, execFile: () => assert.fail('no') });
  assert.equal(writes.length, 2);
});

test('config: suppressWhenFocused, quietHours, command validation', () => {
  assert.equal(n.DEFAULTS.suppressWhenFocused, true);
  const c = n.normalizeConfig({ suppressWhenFocused: false, quietHours: { start: '22:00', end: '7:00' }, command: ['curl', '-d', 'x'] });
  assert.equal(c.suppressWhenFocused, false);
  assert.deepEqual(c.quietHours, { start: '22:00', end: '7:00' });
  assert.deepEqual(c.command, ['curl', '-d', 'x']);
  for (const q of [{ start: '25:00', end: '07:00' }, { start: '22:00' }, { start: '08:00', end: '08:00' }, 'night']) assert.equal(n.normalizeConfig({ quietHours: q }).quietHours, null);
  for (const cmd of ['curl -d x', [], ['ok', 3], [''], {}]) assert.equal(n.normalizeConfig({ command: cmd }).command, null);
});

test('quiet hours: wraps midnight, plain window, half-open end', () => {
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  const wrap = { start: '22:00', end: '07:00' };
  assert.equal(n.inQuietHours(wrap, at(23, 0)), true);
  assert.equal(n.inQuietHours(wrap, at(3, 0)), true);
  assert.equal(n.inQuietHours(wrap, at(7, 0)), false);
  assert.equal(n.inQuietHours(wrap, at(12, 0)), false);
  assert.equal(n.inQuietHours(wrap, at(22, 0)), true);
  const day = { start: '09:00', end: '17:00' };
  assert.equal(n.inQuietHours(day, at(10, 0)), true);
  assert.equal(n.inQuietHours(day, at(17, 0)), false);
  assert.equal(n.inQuietHours(null, at(3, 0)), false);
});

test('error message building', () => {
  const e = n.buildError({ cwd: '/a/proj', message: 'rate\x1b[31m limit', elapsedMs: 5000 });
  assert.equal(e.title, 'Pi - proj - error');
  assert.equal(e.body, 'Run ended with an error (after 5s): rate [31m limit');
  assert.equal(n.buildError({}).body, 'Run ended with an error');
});

test('deliver: linux uses notify-send with "--", falls back to OSC on failure or no session bus', () => {
  const calls = [];
  const writes = [];
  const base = { platform: 'linux', env: { DISPLAY: ':0' }, write: (s) => writes.push(s) };
  n.deliver(n.DEFAULTS, '-T', 'B', { ...base, execFile: (bin, args, o, cb) => { calls.push([bin, args]); cb(null); return { on() {} }; } });
  assert.deepEqual(calls[0], ['notify-send', ['--app-name=Pi', '--', '-T', 'B']]);
  assert.equal(writes.length, 0);
  n.deliver(n.DEFAULTS, 'T', 'B', { ...base, execFile: (b, a, o, cb) => { cb(new Error('no bus')); return { on() {} }; } });
  assert.equal(writes.length, 1);
  n.deliver(n.DEFAULTS, 'T', 'B', { ...base, env: {}, execFile: () => assert.fail('no session bus') });
  assert.equal(writes.length, 2);
});

test('runCommand: argv, detached, env vars, never throws', () => {
  const seen = [];
  const child = { on() {}, unref() { seen.push('unref'); } };
  n.runCommand(['curl', '-d', 'x'], { title: 'T\x07', body: 'B', event: 'error', quiet: true }, {
    env: { KEEP: '1' },
    spawn: (bin, args, opts) => { seen.push([bin, args, opts]); return child; },
  });
  const [bin, args, opts] = seen[0];
  assert.equal(bin, 'curl');
  assert.deepEqual(args, ['-d', 'x']);
  assert.equal(opts.detached, true);
  assert.equal(opts.stdio, 'ignore');
  assert.ok(opts.timeout > 0);
  assert.deepEqual([opts.env.KEEP, opts.env.PI_NOTIFY_TITLE, opts.env.PI_NOTIFY_MESSAGE, opts.env.PI_NOTIFY_EVENT, opts.env.PI_NOTIFY_QUIET], ['1', 'T', 'B', 'error', '1']);
  assert.equal(seen[1], 'unref');
  n.runCommand(null, {}, { spawn: () => assert.fail('no command') });
  n.runCommand(['x'], { title: '', body: '', event: 'settled' }, { env: {}, spawn: () => { throw new Error('boom'); } });
});

test('notifyAll: focus suppresses everything; quiet hours keep only the command', async () => {
  const mk = (over = {}) => {
    const log = { osc: 0, cmd: [] };
    const deps = {
      platform: 'win32', env: {}, execFile: () => assert.fail('unused'),
      write: () => log.osc++, spawn: (b, a, o) => { log.cmd.push(o.env.PI_NOTIFY_QUIET); return { on() {}, unref() {} }; },
      now: () => new Date(2026, 0, 1, 23, 0), isFocused: async () => false, ...over,
    };
    return { log, deps };
  };
  const ev = { title: 'T', body: 'B', event: 'settled' };
  const cfg = { ...n.DEFAULTS, command: ['x'] };

  let { log, deps } = mk({ isFocused: async () => true });
  await n.notifyAll(cfg, ev, deps);
  assert.deepEqual([log.osc, log.cmd.length], [0, 0]);

  ({ log, deps } = mk({ isFocused: async () => true }));
  await n.notifyAll({ ...cfg, suppressWhenFocused: false }, ev, deps);
  assert.deepEqual([log.osc, log.cmd.length], [1, 1]);

  ({ log, deps } = mk());
  await n.notifyAll({ ...cfg, quietHours: { start: '22:00', end: '07:00' } }, ev, deps);
  assert.deepEqual([log.osc, log.cmd], [0, ['1']]);

  ({ log, deps } = mk({ isFocused: async () => { throw new Error('x'); } }));
  await n.notifyAll(cfg, ev, deps); // a throwing focus probe must not escape
  assert.equal(log.osc + log.cmd.length, 0);
});
