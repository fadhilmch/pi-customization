const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseCostArgs, parseContextArgs } = require('../args.js');
const { drillDown, MAX_CHARS } = require('../drill.js');
const { sessionsDir, projectDirName, entrySpend, scanHistory, formatHistory } = require('../history.js');

const asst = (id, ts, model, cost, extra = {}) => JSON.stringify({ type: 'message', id, timestamp: ts, message: { role: 'assistant', provider: 'anthropic', model, usage: { input: 100, output: 10, cacheRead: 50, cacheWrite: 5, cost: { total: cost } }, ...extra } });
const sub = (id, ts) => JSON.stringify({ type: 'message', id, timestamp: ts, message: { role: 'toolResult', toolName: 'subagent', details: { runs: [{ agent: 'scout', model: 'haiku', usage: { input: 10, output: 1, cost: 0.01 } }] } } });
const noon = (d) => `${d}T12:00:00`; // local time, so the local day is stable in any timezone

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-hist-'));
  const a = path.join(dir, '--tmp-a--');
  const b = path.join(dir, '--tmp-b--');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, '1.jsonl'), [
    JSON.stringify({ type: 'session', cwd: '/tmp/a' }),
    asst('e1', noon('2026-03-01'), 'sonnet', 0.5),
    asst('e2', noon('2026-03-01'), 'opus', 1),
    'not json {{{ "usage"',
    asst('e3', noon('2026-03-15'), 'sonnet', 0.25),
    sub('e4', noon('2026-03-15')),
  ].join('\n'));
  // A forked file repeats e1; it must not be counted twice.
  fs.writeFileSync(path.join(b, '2.jsonl'), [asst('e1', noon('2026-03-01'), 'sonnet', 0.5), asst('x1', noon('2026-04-02'), 'sonnet', 2)].join('\n'));
  return dir;
}

test('parseCostArgs: modes, flags and errors', () => {
  assert.deepEqual(parseCostArgs(''), { mode: 'session', json: false, project: false, since: undefined });
  assert.deepEqual(parseCostArgs('daily --since 2026-01-02 --project --json'), { mode: 'daily', json: true, project: true, since: '2026-01-02' });
  assert.equal(parseCostArgs('monthly --since=2026-02-30').error.includes('--since'), true);
  assert.ok(parseCostArgs('weekly').error);
  assert.ok(parseCostArgs('--since').error);
  assert.ok(parseCostArgs('--project').error);
  assert.equal(parseCostArgs('--json').json, true);
});

test('parseContextArgs separates --json from the category query', () => {
  assert.deepEqual(parseContextArgs('tool bash --json'), { json: true, query: 'tool bash' });
  assert.deepEqual(parseContextArgs(''), { json: false, query: '' });
});

test('sessionsDir follows env, then the sessionDir setting, then the agent dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-home-'));
  assert.equal(sessionsDir({ env: {}, home, cwd: '/x' }), path.join(home, '.pi', 'agent', 'sessions'));
  const agent = path.join(home, 'agent');
  fs.mkdirSync(agent);
  assert.equal(sessionsDir({ env: { PI_CODING_AGENT_DIR: agent }, home }), path.join(agent, 'sessions'));
  fs.writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({ sessionDir: '~/elsewhere' }));
  assert.equal(sessionsDir({ env: { PI_CODING_AGENT_DIR: agent }, home }), path.join(home, 'elsewhere'));
  assert.equal(sessionsDir({ env: { PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: '/s' }, home }), '/s');
});

test('projectDirName mirrors Pi directory naming', () => {
  assert.equal(projectDirName('/Users/me/code/app'), '--Users-me-code-app--');
});

test('entrySpend reads messages, usage entries, compaction and subagent runs', () => {
  assert.equal(entrySpend({ type: 'message', message: { role: 'user' } }).length, 0);
  const s = entrySpend({ type: 'message', message: { role: 'toolResult', toolName: 'subagent', details: { runs: [{ agent: 'a', usage: { cost: 1 } }, {}] } } });
  assert.deepEqual(s.map((x) => [x.model, x.sub, x.cost]), [['a', true, 1]]);
  assert.equal(entrySpend({ type: 'compaction', usage: { cost: { total: 2 } } })[0].model, '(compaction)');
});

test('scanHistory aggregates per day, skips bad lines and dedupes forked entries', async () => {
  const dir = fixture();
  const r = await scanHistory({ dir, period: 'daily' });
  assert.deepEqual(r.rows.map((x) => x.period), ['2026-03-01', '2026-03-15', '2026-04-02']);
  const d1 = r.rows[0];
  assert.ok(Math.abs(d1.cost - 1.5) < 1e-9);
  assert.deepEqual(d1.models.map((m) => m.name), ['anthropic/opus', 'anthropic/sonnet']);
  assert.equal(d1.input, 200);
  const d15 = r.rows[1];
  assert.ok(Math.abs(d15.subagentCost - 0.01) < 1e-9);
  assert.ok(Math.abs(r.total.cost - 3.76) < 1e-9);
  assert.equal(r.files, 2);
});

test('scanHistory monthly, --since and --project', async () => {
  const dir = fixture();
  const m = await scanHistory({ dir, period: 'monthly' });
  assert.deepEqual(m.rows.map((x) => x.period), ['2026-03', '2026-04']);
  const since = await scanHistory({ dir, period: 'daily', since: '2026-03-10' });
  assert.deepEqual(since.rows.map((x) => x.period), ['2026-03-15', '2026-04-02']);
  const proj = await scanHistory({ dir, period: 'daily', project: '/tmp/b' });
  assert.deepEqual(proj.rows.map((x) => x.period), ['2026-03-01', '2026-04-02']);
  assert.ok(Math.abs(proj.total.cost - 2.5) < 1e-9);
  assert.equal((await scanHistory({ dir: path.join(dir, 'nope') })).rows.length, 0);
});

test('formatHistory prints periods, models, total and caps rows', async () => {
  const r = await scanHistory({ dir: fixture(), period: 'daily' });
  const text = formatHistory(r);
  assert.match(text, /2026-03-01/);
  assert.match(text, /↳ scout \(haiku\)/);
  assert.match(text, /Total/);
  assert.match(text, /of which subagents/);
  const capped = formatHistory(r, { maxRows: 1 });
  assert.match(capped, /2 older days hidden/);
  assert.doesNotMatch(capped, /2026-03-01/);
  assert.match(formatHistory({ rows: [], files: 0 }), /No usage found/);
});

test('drillDown previews system prompt, tools, files and skills, capped', () => {
  const input = {
    systemPrompt: 'x'.repeat(MAX_CHARS + 50),
    contextFiles: [{ path: '/p/AGENTS.md', content: 'be nice' }],
    skills: [{ name: 'pdf', description: 'make pdfs' }],
    tools: [{ name: 'read', description: 'reads', parameters: { type: 'object' } }],
  };
  const sys = drillDown('system', input);
  assert.match(sys.text, /50 more characters/);
  assert.match(drillDown('tool read', input).text, /"description": "reads"/);
  assert.match(drillDown('read', input).title, /Tool: read/);
  assert.equal(drillDown('file agents', input).text, 'be nice');
  assert.match(drillDown('AGENTS.md', input).title, /Context file/);
  assert.match(drillDown('files', input).text, /AGENTS\.md/);
  assert.match(drillDown('skills', input).text, /pdf: make pdfs/);
  assert.ok(drillDown('tool nope', input).error);
  assert.ok(drillDown('wat', input).error);
  assert.ok(drillDown('tool', input).error);
});

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');
test('index.ts: /cost daily, --json variants and /context drill-down', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const dir = fixture();
  const prev = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
    const commands = {};
    mod.default({
      registerCommand: (n, o) => (commands[n] = o),
      getActiveTools: () => ['read'],
      getAllTools: () => [{ name: 'read', description: 'd', parameters: {} }],
    });
    const notes = [];
    const ctx = {
      cwd: '/tmp/a',
      ui: { notify: (m, t) => notes.push([m, t]) },
      sessionManager: { getBranch: () => [] },
      getSystemPrompt: () => 'sys prompt',
      getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    };
    await commands.cost.handler('daily', ctx);
    assert.match(notes.at(-1)[0], /2026-03-01/);
    await commands.cost.handler('monthly --project --json', ctx);
    const json = JSON.parse(notes.at(-1)[0]);
    assert.equal(json.period, 'monthly');
    assert.deepEqual(json.rows.map((r) => r.period), ['2026-03']);
    await commands.cost.handler('--json', ctx);
    assert.ok(JSON.parse(notes.at(-1)[0]).models);
    await commands.cost.handler('bogus', ctx);
    assert.equal(notes.at(-1)[1], 'warning');
    await commands.context.handler('--json', ctx);
    assert.ok(JSON.parse(notes.at(-1)[0]).systemTokens >= 0);
    await commands.context.handler('system', ctx);
    assert.match(notes.at(-1)[0], /sys prompt/);
    await commands.context.handler('tool read', ctx);
    assert.match(notes.at(-1)[0], /Tool: read/);
    await commands.context.handler('nonsense', ctx);
    assert.equal(notes.at(-1)[1], 'warning');
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = prev;
  }
});

test('historyPanel is framed at a fixed width', async () => {
  const { historyPanel } = require('../panel.js');
  const { stripAnsi, visibleWidth } = require('../ansi.js');
  const lines = historyPanel(await scanHistory({ dir: fixture(), period: 'daily' }), 70).map(stripAnsi);
  assert.match(lines[0], /Cost per day/);
  assert.ok(lines.every((l) => visibleWidth(l) === visibleWidth(lines[0])));
  assert.ok(lines.some((l) => l.includes('2026-04-02')));
});
