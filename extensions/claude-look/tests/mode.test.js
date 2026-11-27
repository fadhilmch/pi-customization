const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stripAnsi } = require('../ansi.js');
const tools = require('../tools.js');
const { formatElapsed, formatTokens, createWorking } = require('../working.js');
const { createLook } = require('../mode.js');
const { loadMode, saveMode, agentDir } = require('../config.js');

function fakeUi() {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  return {
    calls,
    setWorkingIndicator: rec('indicator'),
    setWorkingMessage: rec('message'),
    setHiddenThinkingLabel: rec('thinking'),
    setHeader: rec('header'),
  };
}

test('claude-light theme mirrors claude-dark keys and is light', () => {
  const read = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', `${n}.json`), 'utf8'));
  const dark = read('claude-dark');
  const light = read('claude-light');
  assert.equal(light.name, 'claude-light');
  assert.equal(light.appearance, 'light');
  assert.deepEqual(Object.keys(light.colors), Object.keys(dark.colors));
  assert.deepEqual(Object.keys(light.vars), Object.keys(dark.vars));
  assert.equal(light.colors.accent, 'claude');
});

test('formatElapsed and formatTokens', () => {
  assert.equal(formatElapsed(12_400), '12s');
  assert.equal(formatElapsed(65_000), '1m 05s');
  assert.equal(formatElapsed(3_720_000), '1h 02m');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1234), '1.2k');
  assert.equal(formatTokens(12345), '12k');
  assert.equal(formatTokens(1_500_000), '1.5m');
});

test('working text: elapsed only until tokens arrive, then sums finished and live messages', () => {
  let t = 1000;
  const w = createWorking(() => t);
  w.start();
  t += 12_000;
  assert.equal(w.text('Pondering…'), 'Pondering… 12s');
  w.update({ role: 'assistant', usage: { output: 300 } });
  w.update({ role: 'assistant', usage: { output: 1200 } });
  assert.equal(w.text('Pondering…'), 'Pondering… 12s · ↓1.2k tokens');
  w.end({ role: 'assistant', usage: { output: 1300 } });
  w.update({ role: 'assistant', usage: { output: 200 } });
  assert.equal(w.tokens(), 1500);
  w.update({ role: 'user' });
  w.end({ role: 'toolResult' });
  assert.equal(w.tokens(), 1500);
  w.start();
  assert.equal(w.tokens(), 0);
  w.stop();
  assert.equal(w.active(), false);
});

test('look: apply styles in on and compact, compact hides the header, off restores Pi defaults', () => {
  const look = createLook({ initial: 'on' });
  const ui = fakeUi();
  look.apply(ui, { cwd: '/w' });
  const header = ui.calls.find((c) => c[0] === 'header')[1];
  assert.match(stripAnsi(header().render(80).join('\n')), /Welcome to Pi/);
  look.setMode('compact', ui, { cwd: '/w' });
  assert.equal(look.mode(), 'compact');
  const h2 = ui.calls.filter((c) => c[0] === 'header').pop()[1];
  assert.deepEqual(h2().render(80), []);
  ui.calls.length = 0;
  look.setMode('off', ui, { cwd: '/w' });
  assert.deepEqual(ui.calls, [['indicator'], ['message'], ['thinking'], ['header', undefined]]);
});

test('look: timer updates the working message during a run and stops at the end; off never starts it', () => {
  let t = 0;
  const ticks = [];
  const look = createLook({
    initial: 'on', now: () => t,
    setInterval: (fn) => { ticks.push(fn); return ticks.length; },
    clearInterval: (id) => { ticks[id - 1] = null; },
  });
  const ui = fakeUi();
  look.runStart(ui);
  t = 5000;
  look.messageUpdate({ role: 'assistant', usage: { output: 2500 } });
  ticks[0]();
  assert.match(ui.calls.pop()[1], /^\w+… 5s · ↓2\.5k tokens$/);
  look.runEnd();
  assert.equal(ticks[0], null);
  assert.equal(look.working.active(), false);

  const off = createLook({ initial: 'off', setInterval: () => assert.fail('no timer in off') });
  const ui2 = fakeUi();
  off.runStart(ui2);
  assert.deepEqual(ui2.calls, []);
});

test('compact folds results and diffs to one line', () => {
  const text = 'a\nb\nc\nd';
  const c = tools.formatResult('bash', { content: [{ type: 'text', text }] }, { width: 80, compact: true }).map(stripAnsi);
  assert.deepEqual(c, ['  ⎿  a', '     … +3 lines (ctrl+o to expand)']);
  const e = tools.formatResult('bash', { content: [{ type: 'text', text }] }, { width: 80, compact: true, expanded: true });
  assert.equal(e.length, 4);
  const diff = ' 1 keep\n-2 old\n+2 new';
  const d = tools.formatResult('edit', { content: [], details: { diff } }, { width: 60, compact: true }).map(stripAnsi);
  assert.equal(d.length, 3);
  assert.match(d[2], /\+1 line|\+2 lines/);
});

test('config: default on, round trip, junk ignored, agent dir override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const env = { PI_CODING_AGENT_DIR: dir };
  assert.equal(loadMode({ env }), 'on');
  const file = saveMode('compact', { env });
  assert.equal(file, path.join(dir, 'claude-look.json'));
  assert.equal(loadMode({ env }), 'compact');
  fs.writeFileSync(file, '{"mode":"loud"}');
  assert.equal(loadMode({ env }), 'on');
  fs.writeFileSync(file, 'not json');
  assert.equal(loadMode({ env }), 'on');
  assert.throws(() => saveMode('loud', { env }));
  assert.equal(agentDir({}, '/h'), path.join('/h', '.pi', 'agent'));
});

// Fake Pi Theme: getFgAnsi from a theme file's colours (vars resolved), truecolor.
function themeFrom(name) {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', `${name}.json`), 'utf8'));
  return {
    getFgAnsi(key) {
      const v = t.colors[key];
      const hex = t.vars[v] || v;
      const n = parseInt(hex.slice(1), 16);
      return `\u001b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
    },
  };
}

test('palette: claude-dark output is identical to the defaults, claude-light gets light diff backgrounds', () => {
  const { paletteFromTheme } = require('../palette.js');
  const dark = paletteFromTheme(themeFrom('claude-dark'));
  const light = paletteFromTheme(themeFrom('claude-light'));
  const diff = ' 1 keep\n-2 old\n+2 new';
  const text = 'hello\nworld';
  const render = (palette) => [
    tools.formatCallLine('bash', { command: 'ls' }, { state: 'success', palette }),
    tools.formatCallLine('bash', { command: 'ls' }, { palette }),
    ...tools.formatResult('edit', { content: [], details: { diff } }, { width: 60, palette }),
    ...tools.formatResult('bash', { content: [{ type: 'text', text }] }, { width: 60, compact: true, palette }),
    ...tools.formatResult('bash', { content: [{ type: 'text', text: 'x' }] }, { isError: true, palette }),
    ...tools.formatResult('bash', {}, { isPartial: true, palette }),
  ];
  assert.deepEqual(render(dark), render(undefined));
  const l = render(light).join('\n');
  assert.match(l, /48;2;199;240;207/); // light add bg
  assert.match(l, /48;2;255;214;220/); // light remove bg
  assert.doesNotMatch(l, /48;2;34;92;43/);
  assert.match(l, /38;2;44;122;57/); // light success bullet
  assert.equal(paletteFromTheme(undefined), undefined);
  assert.deepEqual(paletteFromTheme({ getFgAnsi: () => '\u001b[38;5;12m' }), {});
});
