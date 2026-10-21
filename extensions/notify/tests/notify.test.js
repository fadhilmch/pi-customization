const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../notify.js');

test('config: defaults, merge, invalid values ignored', () => {
  assert.deepEqual(n.normalizeConfig(undefined), n.DEFAULTS);
  const c = n.normalizeConfig({ minSeconds: 3, sound: 'Basso', method: 'osc', enabled: false });
  assert.deepEqual(c, { enabled: false, minSeconds: 3, sound: 'Basso', method: 'osc' });
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
  assert.equal(n.resolveMethod(c('auto'), 'linux'), 'osc');
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
