const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../focus.js');

const exec = (out, calls = []) => (bin, args, opts, cb) => { calls.push([bin, args]); if (out instanceof Error) cb(out); else cb(null, out + '\n'); return { on() {} }; };

test('parseTmux: needs active pane+window, attached session and focused client flag', () => {
  assert.equal(f.parseTmux('1|1|1|attached,focused,UTF-8'), true);
  assert.equal(f.parseTmux('1|1|1|attached,UTF-8'), false); // focus unknown (no focus-events)
  assert.equal(f.parseTmux('0|1|1|focused'), false);
  assert.equal(f.parseTmux('1|0|1|focused'), false);
  assert.equal(f.parseTmux('1|1|0|focused'), false);
  assert.equal(f.parseTmux(''), false);
});

test('macOS: frontmost app compared with TERM_PROGRAM', async () => {
  const calls = [];
  const env = { TERM_PROGRAM: 'iTerm.app' };
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env, execFile: exec('iTerm2', calls) }), true);
  assert.equal(calls[0][0], 'osascript');
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env, execFile: exec('Safari') }), false);
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env, execFile: exec(new Error('not authorized')) }), false);
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env: { TERM_PROGRAM: 'mystery' }, execFile: () => assert.fail('unknown terminal') }), false);
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env: { KITTY_WINDOW_ID: '1' }, execFile: exec('kitty') }), true);
});

test('tmux uses display-message on the pane; other platforms never suppress; throws are swallowed', async () => {
  const calls = [];
  const env = { TMUX: '/tmp/s,1,0', TMUX_PANE: '%3' };
  assert.equal(await f.isTerminalFocused({ platform: 'linux', env, execFile: exec('1|1|1|focused', calls) }), true);
  assert.deepEqual(calls[0].slice(0, 1).concat(calls[0][1].slice(0, 4)), ['tmux', 'display-message', '-p', '-t', '%3']);
  assert.equal(await f.isTerminalFocused({ platform: 'linux', env: {}, execFile: () => assert.fail('no') }), false);
  assert.equal(await f.isTerminalFocused({ platform: 'darwin', env: { TERM_PROGRAM: 'ghostty' }, execFile: () => { throw new Error('boom'); } }), false);
});
