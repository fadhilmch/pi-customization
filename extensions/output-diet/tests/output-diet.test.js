const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, mergeConfig, loadConfig } = require('../config.js');
const { fold, isAllowlisted, normalize } = require('../fold.js');
const { ReadTracker, dedupeNote } = require('../dedupe.js');
const { Stats, formatStats } = require('../stats.js');
const { createDiet } = require('../diet.js');

const cfg = mergeConfig();
const mk = (n, f = (i) => `step ${i} ok`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n');

// ---------- fold ----------

test('small output is left alone', () => {
  assert.equal(fold(mk(100), cfg), null);
  assert.equal(fold('x', cfg), null);
});

test('fold keeps head, tail and error lines with context, numbered gaps, note first', () => {
  const text = mk(1000, (i) => (i === 400 ? 'ERROR: disk full' : i === 700 ? 'Traceback (most recent call last):' : `line ${i}`));
  const r = fold(text, cfg, { fullPath: '/tmp/x.log' });
  const out = r.text.split('\n');
  assert.match(out[0], /^\[output-diet: \d+ lines folded, full output saved to \/tmp\/x\.log; use read with offset\/limit to see more\]$/);
  assert.equal(out[1], 'line 1');
  assert.ok(out.includes('line 30'));
  assert.ok(!out.includes('line 31'));
  assert.ok(out.includes('ERROR: disk full') && out.includes('line 399') && out.includes('line 401'));
  assert.ok(out.includes('Traceback (most recent call last):'));
  assert.ok(out.includes('line 1000') && out.includes('line 941') && !out.includes('line 940'));
  assert.ok(out.some((l) => /^\[… \d+ lines skipped \(lines 31-398\) …\]$/.test(l)));
  assert.equal(r.linesFolded, 1000 - 30 - 60 - 6);
  assert.ok(r.text.length < text.length / 5);
});

test('repeated error lines are deduplicated by normalized text and counted', () => {
  const text = mk(500, (i) => (i > 100 && i < 200 ? `2026-01-01 10:00:${String(i % 60).padStart(2, '0')} ERROR retry ${i} failed for pod abc${i}` : `ok ${i}`));
  const r = fold(text, cfg);
  const shown = r.text.split('\n').filter((l) => /ERROR retry/.test(l));
  assert.equal(shown.length, 1);
  assert.equal(r.repeated, 98); // lines 101..199 match: one shown
  assert.match(r.text, /matching lines not shown: 98 repeated/);
});

test('match cap limits distinct error lines', () => {
  const text = mk(1000, (i) => (i > 100 && i < 300 ? `error kind ${'abcdefghij'[i % 10]}${'klmnopqrst'[(i / 10) % 10 | 0]} happened` : `ok ${i}`));
  const r = fold(text, { ...cfg, maxMatches: 5, context: 0 });
  assert.equal(r.matched, 5);
  assert.ok(r.overflow > 0);
  assert.equal(r.text.split('\n').filter((l) => /^error kind/.test(l)).length, 5);
});

test('ignore patterns skip "0 errors" style lines', () => {
  const text = mk(500, (i) => (i === 200 ? 'Found 0 errors.' : `ok ${i}`));
  const r = fold(text, { ...cfg, context: 0 });
  assert.ok(!r.text.includes('Found 0 errors'));
});

test('long lines are clipped', () => {
  const text = `${'x'.repeat(5000)}\n${mk(400)}`;
  const r = fold(text, cfg);
  assert.match(r.text, /x{400}… \[\+4600 chars\]/);
});

test('no gain, no fold: tiny middle or little saved', () => {
  assert.equal(fold(mk(160), { ...cfg, thresholdLines: 100, headLines: 80, tailLines: 75 }), null);
  const allErrors = mk(300, (i) => `error number ${i} ${'y'.repeat(i)}`);
  assert.equal(fold(allErrors, { ...cfg, headLines: 150, tailLines: 140 }), null);
});

test('byte threshold folds few but huge lines? only via line clipping', () => {
  const text = Array.from({ length: 120 }, (_, i) => `row ${i} ${'z'.repeat(300)}`).join('\n');
  assert.ok(Buffer.byteLength(text) > cfg.thresholdBytes);
  const r = fold(text, cfg);
  assert.ok(r && r.text.length < text.length * 0.8);
});

test('numbered=false omits line ranges (Pi truncated file)', () => {
  const r = fold(mk(500), cfg, { numbered: false });
  assert.match(r.text, /\[… \d+ lines skipped …\]/);
});

test('normalize collapses numbers, timestamps and hashes', () => {
  assert.equal(normalize('2026-01-01T10:00:01Z pod abcdef1234 retry 3'), normalize('2027-02-02T11:11:11Z pod 1234567890 retry 99'));
});

// ---------- allowlist ----------

test('allowlist matches explicit full-output commands only', () => {
  for (const c of ['cat foo.log', 'git diff HEAD~1', 'git show abc', 'tail -n 500 x.log', '  cat x']) assert.ok(isAllowlisted(c, cfg), c);
  for (const c of ['npm test', 'kubectl logs pod', 'cd x && cat y', 'pytest -x', 'concat.sh']) assert.ok(!isAllowlisted(c, cfg), c);
  assert.ok(isAllowlisted('make build', { ...cfg, allowlist: ['^make\\b'] }));
});

// ---------- config ----------

test('project config can only tighten', () => {
  const user = { thresholdLines: 300, headLines: 40, patterns: ['boom'], allowlist: ['^foo'] };
  const m = mergeConfig(user, {
    thresholdLines: 100, headLines: 80, tailLines: 10, enabled: true, dedupeReads: false,
    patterns: ['x'], allowlist: ['.*'], ignore: ['.*'], maxLineChars: 1000000, context: 9,
  });
  assert.equal(m.thresholdLines, 100); // lowered
  assert.equal(m.headLines, 40); // cannot raise
  assert.equal(m.tailLines, 10);
  assert.equal(m.dedupeReads, false);
  assert.deepEqual(m.patterns, ['boom']);
  assert.deepEqual(m.allowlist, ['^foo']);
  assert.deepEqual(m.ignore, DEFAULTS.ignore);
  assert.equal(m.maxLineChars, DEFAULTS.maxLineChars);
  assert.equal(m.context, DEFAULTS.context);
  assert.equal(mergeConfig({ enabled: true }, { enabled: false }).enabled, false);
  assert.equal(mergeConfig({ enabled: false }, { enabled: true }).enabled, false);
  assert.equal(mergeConfig({ dedupeReads: false }, { dedupeReads: true }).dedupeReads, false);
});

test('config ignores junk and bad regexes', () => {
  const m = mergeConfig({ thresholdLines: -5, headLines: 'a', patterns: ['(', 'ok'], tailLines: 7.9 }, 'nope');
  assert.equal(m.thresholdLines, DEFAULTS.thresholdLines);
  assert.equal(m.headLines, DEFAULTS.headLines);
  assert.deepEqual(m.patterns, ['ok']);
  assert.equal(m.tailLines, 7);
  assert.deepEqual(mergeConfig(null, null), { ...DEFAULTS });
});

test('loadConfig reads the user file and the project file', () => {
  const files = {
    '/h/.pi/agent/output-diet.json': '{"thresholdLines": 200}',
    '/p/.pi/output-diet.json': '{"thresholdLines": 120, "allowlist": []}',
  };
  const readFile = (f) => { if (f in files) return files[f]; throw new Error('ENOENT'); };
  const c = loadConfig({ cwd: '/p', env: {}, home: '/h', readFile });
  assert.equal(c.thresholdLines, 120);
  assert.deepEqual(c.allowlist, DEFAULTS.allowlist);
  assert.equal(loadConfig({ cwd: '/none', env: { PI_CODING_AGENT_DIR: '/zzz' }, home: '/h', readFile }).thresholdLines, 150);
});

// ---------- read dedupe ----------

const input = { path: 'src/a.js' };
const body = 'const x = 1;\n'.repeat(60);

test('identical read with the earlier result still live is deduped', () => {
  const t = new ReadTracker();
  assert.equal(t.decide(input, body, 'c1', new Set()).dedupe, false);
  const d = t.decide(input, body, 'c2', new Set(['c1']));
  assert.equal(d.dedupe, true);
  assert.equal(dedupeNote(d.earlier), '[output-diet: unchanged since the earlier read of src/a.js (lines 1-60); content omitted]');
});

test('no dedupe when unsure: earlier result not live, liveIds unknown, content or range differs', () => {
  const t = new ReadTracker();
  t.decide(input, body, 'c1', new Set());
  assert.equal(t.decide(input, body, 'c2', new Set(['other'])).dedupe, false); // c1 compacted away
  assert.equal(t.decide(input, body, 'c3', null).dedupe, false);
  assert.equal(t.decide(input, body + 'more', 'c4', new Set(['c3', 'c2'])).dedupe, false);
  assert.equal(t.decide({ path: 'src/a.js', offset: 5, limit: 10 }, body, 'c5', new Set(['c4'])).dedupe, false);
});

test('a re-recorded read becomes the new reference; edits invalidate', () => {
  const t = new ReadTracker();
  t.decide(input, body, 'c1', new Set());
  t.decide(input, body, 'c2', new Set()); // c1 gone: c2 is now the reference
  assert.equal(t.decide(input, body, 'c3', new Set(['c2'])).dedupe, true);
  t.invalidatePath('src/a.js');
  assert.equal(t.decide(input, body, 'c4', new Set(['c2', 'c3'])).dedupe, false);
});

test('dedupe note reports the requested range', () => {
  const t = new ReadTracker();
  const inp = { path: 'f.txt', offset: 100, limit: 50 };
  t.decide(inp, body, 'c1', new Set());
  assert.match(dedupeNote(t.decide(inp, body, 'c2', new Set(['c1'])).earlier), /lines 100-149/);
});

// ---------- stats ----------

test('stats tally, restore and format', () => {
  const s = new Stats();
  s.record('fold', 40000, 4000);
  s.record('dedupe', 8000, 100);
  assert.deepEqual(s.snapshot(), { folds: 1, dedupes: 1, charsSaved: 43900, tokensSaved: 10975, byFolder: { generic: { count: 1, charsSaved: 36000 } } });
  const r = new Stats();
  r.restore([
    { role: 'toolResult', details: { outputDiet: { kind: 'fold', before: 1000, after: 200 } } },
    { role: 'toolResult', details: {} },
    { role: 'assistant' },
  ]);
  assert.equal(r.charsSaved, 800);
  const text = formatStats(s, cfg);
  assert.match(text, /1 folded bash result, 1 deduped read/);
  assert.match(text, /~10,975 tokens/);
});

// ---------- engine (fake ctx) ----------

function engine(over = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'od-'));
  const events = [];
  const diet = createDiet({
    loadConfig: () => mergeConfig(over.user),
    os: { tmpdir: () => tmp },
    emit: (n, d) => events.push([n, d]),
  });
  let live = [];
  const ctx = { cwd: '/p', sessionManager: { getSessionId: () => 'sess1', buildContextEntries: () => live.map((id) => ({ type: 'message', message: { role: 'toolResult', toolCallId: id } })), getBranch: () => [] } };
  return { diet, ctx, tmp, events, setLive: (l) => { live = l; } };
}
const bashEv = (text, extra = {}) => ({ toolName: 'bash', toolCallId: 'tc1', input: { command: 'npm test' }, content: [{ type: 'text', text }], isError: false, details: undefined, ...extra });

test('engine folds bash, saves 0600 file with the full text, tallies stats', () => {
  const { diet, ctx, tmp, events } = engine();
  const text = mk(2000, (i) => (i === 900 ? 'FAIL src/a.test.js' : `log ${i}`));
  const r = diet.onToolResult(bashEv(text), ctx);
  const file = path.join(tmp, 'pi-output-diet', 'sess1', 'tc1.log');
  assert.ok(r.content[0].text.includes(`saved to ${file}`));
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(r.details.outputDiet.kind, 'fold');
  assert.equal(diet.state.stats.folds, 1);
  assert.equal(events[0][0], 'output-diet:stats');
});

test('engine reuses the path Pi already saved and writes nothing', () => {
  const { diet, ctx, tmp } = engine();
  const r = diet.onToolResult(bashEv(mk(2000), { details: { fullOutputPath: '/tmp/pi-bash-1.log', truncation: {} } }), ctx);
  assert.match(r.content[0].text, /saved to \/tmp\/pi-bash-1\.log/);
  assert.equal(r.details.truncation !== undefined, true);
  assert.equal(fs.existsSync(path.join(tmp, 'pi-output-diet')), false);
  assert.doesNotMatch(r.content[0].text, /lines \d+-\d+\)/); // no numbered ranges for Pi's file
});

test("engine folds Pi's saved full file, so the head and errors Pi's own truncation dropped come back", () => {
  const { diet, ctx, tmp } = engine();
  const full = mk(3000, (i) => (i === 500 ? 'ERROR: early failure' : `log ${i}`));
  const piFile = path.join(tmp, 'pi-bash-full.log');
  fs.writeFileSync(piFile, full);
  const tail = full.split('\n').slice(-2000).join('\n'); // what Pi hands to the model
  const r = diet.onToolResult(bashEv(tail, { details: { fullOutputPath: piFile } }), ctx);
  const out = r.content[0].text;
  assert.ok(out.includes('ERROR: early failure') && out.includes('\nlog 1\n'));
  assert.match(out, /lines skipped \(lines 31-498\)/);
  assert.ok(out.includes(`saved to ${piFile}`));
  assert.equal(r.details.outputDiet.before, tail.length);
});

test('engine leaves allowlisted commands, other tools, small output, disabled and images alone', () => {
  const { diet, ctx } = engine();
  const big = mk(2000);
  assert.equal(diet.onToolResult(bashEv(big, { input: { command: 'cat build.log' } }), ctx), undefined);
  assert.equal(diet.onToolResult({ ...bashEv(big), toolName: 'grep' }, ctx), undefined);
  assert.equal(diet.onToolResult({ ...bashEv(big), toolName: 'custom' }, ctx), undefined);
  assert.equal(diet.onToolResult(bashEv(mk(20)), ctx), undefined);
  assert.equal(diet.onToolResult(bashEv(big, { content: [{ type: 'text', text: big }, { type: 'image', data: '', mimeType: 'image/png' }] }), ctx), undefined);
  const off = engine({ user: { enabled: false } });
  assert.equal(off.diet.onToolResult(bashEv(big), off.ctx), undefined);
});

test('engine does not fold when it cannot save the file', () => {
  const { diet, ctx } = engine();
  diet.state.cfg = mergeConfig();
  const bad = createDiet({ loadConfig: () => mergeConfig(), fs: { mkdirSync() { throw new Error('EACCES'); }, writeFileSync() {} } });
  assert.equal(bad.onToolResult(bashEv(mk(2000)), ctx), undefined);
});

const readEv = (id, text = body, input = { path: 'src/a.js' }) => ({ toolName: 'read', toolCallId: id, input, content: [{ type: 'text', text }], isError: false });

test('engine dedupes the second identical read and respects dedupeReads=false', () => {
  const e = engine();
  assert.equal(e.diet.onToolResult(readEv('r1'), e.ctx), undefined);
  e.setLive(['r1']);
  const r = e.diet.onToolResult(readEv('r2'), e.ctx);
  assert.match(r.content[0].text, /unchanged since the earlier read of src\/a\.js \(lines 1-60\)/);
  assert.equal(e.diet.state.stats.dedupes, 1);
  const off = engine({ user: { dedupeReads: false } });
  off.diet.onToolResult(readEv('r1'), off.ctx);
  off.setLive(['r1']);
  assert.equal(off.diet.onToolResult(readEv('r2'), off.ctx), undefined);
});

test('engine: edit between reads, tiny reads and failing context lookup do not dedupe', () => {
  const e = engine();
  e.diet.onToolResult(readEv('r1'), e.ctx);
  e.setLive(['r1']);
  e.diet.onToolResult({ toolName: 'edit', toolCallId: 'e1', input: { path: 'src/a.js' }, content: [], isError: false }, e.ctx);
  assert.equal(e.diet.onToolResult(readEv('r2'), e.ctx), undefined);
  const small = engine();
  small.diet.onToolResult(readEv('s1', 'tiny'), small.ctx);
  small.setLive(['s1']);
  assert.equal(small.diet.onToolResult(readEv('s2', 'tiny'), small.ctx), undefined);
  const broken = engine();
  broken.ctx.sessionManager.buildContextEntries = () => { throw new Error('nope'); };
  broken.diet.onToolResult(readEv('b1'), broken.ctx);
  assert.equal(broken.diet.onToolResult(readEv('b2'), broken.ctx), undefined);
});

test('engine.start restores stats from the session branch', () => {
  const e = engine();
  e.ctx.sessionManager.getBranch = () => [{ type: 'message', message: { role: 'toolResult', details: { outputDiet: { kind: 'dedupe', before: 4000, after: 100 } } } }];
  e.diet.start(e.ctx);
  assert.equal(e.diet.state.stats.dedupes, 1);
});

// ---------- index.ts ----------

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');
test('index.ts registers tool_result, session_start and /diet', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const on = {};
  const cmds = {};
  mod.default({ on: (e, h) => { on[e] = h; }, registerCommand: (n, o) => { cmds[n] = o; }, events: { emit() {} } });
  assert.ok(on.tool_result && on.session_start && cmds.diet);
  const notes = [];
  await cmds.diet.handler('', { cwd: process.cwd(), ui: { notify: (m) => notes.push(m) } });
  assert.match(notes[0], /output-diet \(on\)/);
});
