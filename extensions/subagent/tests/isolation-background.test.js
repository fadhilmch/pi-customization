// Worktree isolation, background runs, turn and spawn limits, live widget.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { stripAnsi } = require('../ansi.js');
const agents = require('../agents.js');
const { parseConfig } = require('../config.js');
const args = require('../args.js');
const run = require('../run.js');
const output = require('../output.js');
const render = require('../render.js');
const dispatch = require('../dispatch.js');
const worktree = require('../worktree.js');
const background = require('../background.js');
const widget = require('../widget.js');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo() {
  const dir = fs.realpathSync(tmp('sa-repo-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- agent and config fields ---------------------------------------------------------------------

test('parseAgent: maxTurns and isolation; config overrides maxTurns; maxSpawns is clamped', () => {
  const a = agents.parseAgent('---\nname: x\ndescription: d\nmaxTurns: 12\nisolation: worktree\n---\n', { filePath: '/a/x.md' });
  assert.equal(a.maxTurns, 12);
  assert.equal(a.isolation, 'worktree');
  const none = agents.parseAgent('---\nname: x\ndescription: d\nmaxTurns: 0\nisolation: none\n---\n', { filePath: '/a/x.md' });
  assert.equal(none.maxTurns, undefined);
  assert.equal(none.isolation, undefined);
  assert.match(agents.parseAgent('---\nname: x\ndescription: d\nisolation: docker\n---\n', { filePath: 'x.md' }).error, /isolation/);

  assert.equal(agents.applyOverrides(a, { maxTurns: { x: 5 } }).maxTurns, 5);
  assert.equal(agents.applyOverrides(a, { maxTurns: { y: 5 } }).maxTurns, 12);
  assert.match(agents.describeAgent(a), /max 12 turns · isolation: worktree/);

  const c = parseConfig({ maxTurns: { scout: 20, bad: 'x', big: 99999 }, maxSpawns: 0 });
  assert.deepEqual(c.maxTurns, { scout: 20, big: 1000 });
  assert.equal(c.maxSpawns, 1);
  assert.equal(parseConfig({}).maxSpawns, 64);
  assert.deepEqual(parseConfig({}).maxTurns, {});
});

test('contract prompt tells the child its turn limit only when one is set', () => {
  assert.ok(!/turns/.test(args.contractPrompt(6000)));
  assert.match(args.contractPrompt(6000, 10), /at most 10 turns.*by turn 8.*After turn 10 you are stopped/);
  const r = args.buildChildArgs({ name: 's', tools: [], skills: [], extensions: [], maxTurns: 6 }, 't', { exists: () => false });
  assert.match(r.args[r.args.indexOf('--append-system-prompt') + 1], /at most 6 turns/);
});

// --- turn limit in runChild ----------------------------------------------------------------------

function fakeChild(script) {
  const dir = tmp('sa-child-');
  const file = path.join(dir, 'child.js');
  fs.writeFileSync(file, script);
  return { command: process.execPath, args: [file] };
}

const TURNS = (n, last) => `
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
for (let i = 1; i <= ${n}; i++) out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'turn ' + i }], usage: { input: 10, output: 1 }, stopReason: ${JSON.stringify(last)} } });
setTimeout(() => {}, 60000);
`;

test('runChild: stops at maxTurns when the child would continue, keeps the partial report, marks it truncated', async () => {
  const t0 = Date.now();
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...fakeChild(TURNS(3, 'toolUse')), maxTurns: 3 });
  assert.ok(Date.now() - t0 < 5000, 'child was killed, not waited out');
  assert.equal(r.status, 'done');
  assert.equal(r.truncated, true);
  assert.equal(r.turns, 3);
  assert.equal(r.output, 'turn 3');
  assert.ok(!output.runReport({ ...r, maxTurns: 3 }).includes('FAILED'));
  assert.match(output.modelText('single', [{ ...r, maxTurns: 3 }], {}), /turn 3\n\n\[truncated: stopped at the turn limit \(3 turns\)/);
  assert.match(stripAnsi(render.runHeader({ ...r, maxTurns: 3 })), /stopped at 3 turns/);

  // a child that finishes on its last allowed turn (stopReason stop) is not truncated
  const fin = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...fakeChild(TURNS(2, 'stop').replace('setTimeout(() => {}, 60000);', '')), maxTurns: 2 });
  assert.equal(fin.status, 'done');
  assert.equal(fin.truncated, undefined);
  // no limit: not stopped early
  const free = await run.runChild(run.createRun({ agent: 'x', task: 't' }), fakeChild(TURNS(4, 'toolUse').replace('setTimeout(() => {}, 60000);', '')));
  assert.equal(free.turns, 4);
  assert.equal(free.truncated, undefined);
});

// --- worktrees -----------------------------------------------------------------------------------

test('worktree: refuses outside a git repository and without a commit', () => {
  const plain = tmp('sa-plain-');
  assert.match(worktree.createWorktree({ cwd: plain, agent: 'worker' }).error, /needs a git repository/);
  const empty = fs.realpathSync(tmp('sa-empty-'));
  git(empty, 'init', '-q', '-b', 'main');
  assert.match(worktree.createWorktree({ cwd: empty, agent: 'worker' }).error, /at least one commit/);
  assert.equal(worktree.repoRoot(plain), null);
});

test('worktree: unchanged worktree and branch are removed; changes and commits keep both', () => {
  const repo = makeRepo();
  const tmpRoot = tmp('sa-wt-');
  const make = (cwd = repo) => {
    const r = worktree.createWorktree({ cwd, agent: 'wor ker', tmpRoot });
    assert.equal(r.error, undefined);
    return r.worktree;
  };

  // untouched: gone
  let wt = make();
  assert.match(wt.branch, /^pi-subagent\/wor-ker-[0-9a-f]{6}$/);
  assert.ok(fs.existsSync(path.join(wt.dir, 'sub', 'a.txt')));
  assert.deepEqual(worktree.finalizeWorktree(wt), { kept: false, dirty: false, commits: 0 });
  assert.ok(!fs.existsSync(wt.dir));
  assert.equal(git(repo, 'branch', '--list', wt.branch), '');

  // uncommitted change: kept
  wt = make();
  fs.writeFileSync(path.join(wt.dir, 'new.txt'), 'x');
  let fin = worktree.finalizeWorktree(wt);
  assert.deepEqual(fin, { kept: true, dirty: true, commits: 0 });
  assert.ok(fs.existsSync(wt.dir));
  assert.notEqual(git(repo, 'branch', '--list', wt.branch), '');
  assert.match(worktree.worktreeNote({ worktree: { ...fin, branch: wt.branch, dir: wt.dir } }), new RegExp(`Changes in branch ${wt.branch.replace('/', '\\/')} at path .*\\(uncommitted changes\\)`));

  // a new commit and a clean tree: kept
  wt = make();
  git(wt.dir, 'config', 'user.email', 't@example.com');
  git(wt.dir, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(wt.dir, 'c.txt'), 'x');
  git(wt.dir, 'add', '.');
  git(wt.dir, 'commit', '-q', '-m', 'c');
  fin = worktree.finalizeWorktree(wt);
  assert.deepEqual(fin, { kept: true, dirty: false, commits: 1 });
  assert.match(worktree.worktreeNote({ worktree: { ...fin, branch: wt.branch, dir: wt.dir } }), /\(1 commit\)/);
  assert.equal(worktree.worktreeNote({ worktree: { kept: false } }), '');
  assert.equal(worktree.worktreeNote({}), '');

  // a subfolder cwd maps into the worktree
  wt = make(path.join(repo, 'sub'));
  assert.equal(wt.cwd, path.join(wt.dir, 'sub'));
  assert.ok(fs.existsSync(path.join(wt.cwd, 'a.txt')));
  worktree.finalizeWorktree(wt);
  assert.match(worktree.createWorktree({ cwd: path.join(repo, 'nope'), agent: 'w', tmpRoot }).error, /does not exist/);
});

// --- dispatch ------------------------------------------------------------------------------------

const AGENTS = [
  { name: 'scout', description: 'd', tools: ['read'], skills: [], extensions: [], mcp: false, contextFiles: false, systemPrompt: 's', source: 'bundled', dir: '/a' },
  { name: 'worker', description: 'd', tools: ['read', 'write'], skills: [], extensions: [], mcp: false, contextFiles: true, systemPrompt: '', source: 'bundled', dir: '/a', isolation: 'worktree', maxTurns: 9 },
];
const CONFIG = parseConfig({});

function fakeRun(calls, outcome = {}) {
  return async (r, opts) => {
    calls.push({ agent: r.agent, cwd: opts.cwd, maxTurns: opts.maxTurns, args: opts.args });
    r.output = `${r.agent} report`;
    return run.finish(r, { exitCode: 0, ...outcome });
  };
}

function fakeWorktree({ repo = true, finalized = { kept: true, dirty: true, commits: 0 }, log = [] } = {}) {
  return {
    repoRoot: () => (repo ? '/repo' : null),
    create: ({ cwd, agent }) => {
      log.push(['create', cwd, agent]);
      return { worktree: { root: '/repo', dir: '/wt/1', branch: `pi-subagent/${agent}-abc`, base: 'x', cwd: '/wt/1/sub' } };
    },
    finalize: (wt) => {
      log.push(['finalize', wt.dir]);
      return finalized;
    },
  };
}

const base = { agents: AGENTS, config: CONFIG, cwd: '/repo', env: {}, invocation: (a) => ({ command: 'pi', args: a }) };

test('executeSubagent: isolation worktree runs in the worktree, reports kept changes, passes maxTurns', async () => {
  const calls = [];
  const log = [];
  let r = await dispatch.executeSubagent({ agent: 'scout', task: 't', isolation: 'worktree' }, { ...base, run: fakeRun(calls), worktree: fakeWorktree({ log }) });
  assert.equal(calls[0].cwd, '/wt/1/sub');
  assert.deepEqual(log.map((l) => l[0]), ['create', 'finalize']);
  assert.match(r.content[0].text, /scout report\n\nChanges in branch pi-subagent\/scout-abc at path \/wt\/1 \(uncommitted changes\)\./);
  assert.equal(r.details.runs[0].worktree.branch, 'pi-subagent/scout-abc');
  assert.match(stripAnsi(render.runHeader(r.details.runs[0])), /⎇ pi-subagent\/scout-abc/);

  // agent default (worker has isolation: worktree), maxTurns from the agent, "none" overrides
  calls.length = 0;
  r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...base, run: fakeRun(calls), worktree: fakeWorktree({ log }) });
  assert.equal(calls[0].cwd, '/wt/1/sub');
  assert.equal(calls[0].maxTurns, 9);
  assert.match(calls[0].args.join(' '), /at most 9 turns/);
  calls.length = 0;
  r = await dispatch.executeSubagent({ agent: 'worker', task: 't', isolation: 'none' }, { ...base, run: fakeRun(calls), worktree: fakeWorktree({ log }) });
  assert.equal(calls[0].cwd, '/repo');
  assert.ok(!/Changes in branch/.test(r.content[0].text));

  // a removed (unchanged) worktree is not mentioned
  r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...base, run: fakeRun([]), worktree: fakeWorktree({ finalized: { kept: false, dirty: false, commits: 0 } }) });
  assert.equal(r.content[0].text, 'worker report');

  // config override beats the agent file
  calls.length = 0;
  await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...base, config: parseConfig({ maxTurns: { worker: 4 } }), run: fakeRun(calls), worktree: fakeWorktree() });
  assert.equal(calls[0].maxTurns, 4);
});

test('executeSubagent: parallel and chain isolate each item; chain mentions earlier worktrees', async () => {
  const log = [];
  const wtApi = fakeWorktree({ log });
  const calls = [];
  let r = await dispatch.executeSubagent({ tasks: [{ agent: 'worker', task: 'a' }, { agent: 'scout', task: 'b' }] }, { ...base, run: fakeRun(calls), worktree: wtApi });
  assert.equal(log.filter((l) => l[0] === 'create').length, 1, 'only the worker is isolated');
  assert.match(r.content[0].text, /## 1\. worker[\s\S]*Changes in branch/);

  r = await dispatch.executeSubagent({ chain: [{ agent: 'worker', task: 'a' }, { agent: 'scout', task: 'b {previous}' }] }, { ...base, run: fakeRun([]), worktree: wtApi });
  assert.match(r.content[0].text, /^scout report\n.*Changes in branch pi-subagent\/worker-abc/);
});

test('executeSubagent: isolation refusals leave nothing started', async () => {
  const calls = [];
  const common = { ...base, run: fakeRun(calls) };
  let r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...common, worktree: fakeWorktree({ repo: false }) });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /needs a git repository/);
  r = await dispatch.executeSubagent({ agent: 'scout', task: 't', isolation: 'worktree' }, { ...common, readOnly: true, worktree: fakeWorktree() });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /read-only.*isolation "worktree"/);
  r = await dispatch.executeSubagent({ agent: 'scout', task: 't', isolation: 'docker' }, { ...common, worktree: fakeWorktree() });
  assert.match(r.content[0].text, /isolation must be one of/);
  assert.equal(calls.length, 0);

  // creation failing at start time fails that run with the reason
  const failing = { repoRoot: () => '/repo', create: () => ({ error: 'git worktree add failed: boom' }), finalize: () => assert.fail('no finalize') };
  r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...common, worktree: failing });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /boom/);
  assert.equal(calls.length, 0);
});

test('executeSubagent: real git repo end to end (changed worktree kept, untouched removed)', async () => {
  const repo = makeRepo();
  let created;
  const wtApi = {
    repoRoot: worktree.repoRoot,
    create: (o) => {
      const r = worktree.createWorktree({ ...o, tmpRoot: tmp('sa-e2e-') });
      created = r.worktree;
      return r;
    },
    finalize: worktree.finalizeWorktree,
  };
  const opts = (edit) => ({ ...base, cwd: repo, worktree: wtApi, run: async (r, o) => {
    if (edit) fs.writeFileSync(path.join(o.cwd, 'changed.txt'), 'x');
    r.output = 'done';
    return run.finish(r, { exitCode: 0 });
  } });
  let r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, opts(true));
  assert.match(r.content[0].text, /Changes in branch pi-subagent\/worker-/);
  assert.ok(fs.existsSync(path.join(created.dir, 'changed.txt')));
  assert.ok(!fs.existsSync(path.join(repo, 'changed.txt')), 'main checkout untouched');
  r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, opts(false));
  assert.equal(r.content[0].text, 'done');
  assert.ok(!fs.existsSync(created.dir));
});

test('executeSubagent: session spawn cap counts started children and refuses over the cap', async () => {
  const calls = [];
  const spawns = { count: 0, max: 3 };
  const opts = { ...base, run: fakeRun(calls), spawns };
  let r = await dispatch.executeSubagent({ tasks: [{ agent: 'scout', task: 'a' }, { agent: 'scout', task: 'b' }] }, opts);
  assert.equal(r.isError, undefined);
  assert.equal(spawns.count, 2);
  r = await dispatch.executeSubagent({ tasks: [{ agent: 'scout', task: 'a' }, { agent: 'scout', task: 'b' }] }, opts);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Spawn cap reached: 2 of 3/);
  assert.equal(calls.length, 2);
  await dispatch.executeSubagent({ agent: 'scout', task: 'c' }, opts);
  assert.equal(spawns.count, 3);
  r = await dispatch.executeSubagent({ agent: 'scout', task: 'd' }, opts);
  assert.equal(r.isError, true);

  // a chain that stops early gives its unused slots back
  const s2 = { count: 0, max: 10 };
  await dispatch.executeSubagent({ chain: [{ agent: 'scout', task: 'a' }, { agent: 'scout', task: 'b' }, { agent: 'scout', task: 'c' }] }, { ...base, spawns: s2, run: fakeRun([], { exitCode: 1 }) });
  assert.equal(s2.count, 1);
});

test('checkCall validates without starting or reserving anything', () => {
  const spawns = { count: 0, max: 5 };
  assert.match(dispatch.checkCall({}, { ...base, spawns }).error.content[0].text, /exactly one of/);
  const ok = dispatch.checkCall({ agent: 'scout', task: 't' }, { ...base, spawns });
  assert.equal(ok.mode, 'single');
  assert.equal(spawns.count, 0);
});

// --- background registry -------------------------------------------------------------------------

test('background: start returns an id, wait collects, the finish event is emitted once, caps apply', async () => {
  const events = [];
  const reg = background.createRegistry({ emit: (n, d) => events.push([n, d]) });
  const runsOf = (agent, cost) => [{ agent, toolCount: 2, usage: { cost }, status: 'done', worktree: { kept: true, branch: 'pi-subagent/w-1', dir: '/wt' } }];
  const a = reg.start({ label: 'scout: x', task: async ({ onUpdate }) => {
    onUpdate({ details: { runs: runsOf('scout', 0.01) } });
    await delay(30);
    return { content: [{ type: 'text', text: 'A'.repeat(100) }], details: { runs: runsOf('scout', 0.02) } };
  } });
  const b = reg.start({ label: 'worker: y', task: async () => {
    await delay(60);
    return { content: [{ type: 'text', text: 'boom' }], details: { runs: [] }, isError: true };
  } });
  assert.deepEqual([a.id, b.id], ['bg-1', 'bg-2']);
  assert.equal(a.status, 'running');

  const sel = reg.select();
  assert.equal(sel.entries.length, 2);
  let text = background.formatWait(sel.entries, []);
  assert.match(text, /## bg-1 scout: x\nstill running/);

  await reg.wait(sel.entries, 5000);
  assert.equal(a.status, 'done');
  assert.equal(b.status, 'failed');
  text = background.formatWait(sel.entries, ['bg-9'], { maxChars: 1000 });
  assert.match(text, /## bg-1 scout: x\ndone\n\nA{100}/);
  assert.match(text, /## bg-2 worker: y\nfailed\n\nboom/);
  assert.match(text, /Unknown run id: bg-9/);
  assert.equal(reg.select().entries.length, 0, 'collected runs drop out of "all"');
  assert.equal(reg.select(['bg-1']).entries.length, 1, 'but can still be fetched by id');

  assert.deepEqual(events.map((e) => e[0]), ['subagent:finished', 'subagent:finished']);
  assert.deepEqual(events[0][1], { id: 'bg-1', label: 'scout: x', status: 'done', agents: ['scout'], durationMs: events[0][1].durationMs, cost: 0.02, summary: 'A'.repeat(100), worktrees: [{ branch: 'pi-subagent/w-1', path: '/wt' }] });
  assert.equal(events[1][1].status, 'failed');
  assert.equal(background.FINISHED_EVENT, 'subagent:finished');

  // reports share the budget when several come back
  const big = ['x', 'y', 'z'].map((n) => reg.start({ label: n, task: async () => ({ content: [{ type: 'text', text: 'B'.repeat(9000) }], details: { runs: [] } }) }));
  await reg.wait(big, 5000);
  const shared = background.formatWait(big, [], { maxChars: 6000 });
  assert.ok(shared.length < 3 * 4100 + 300, `shared budget, got ${shared.length}`);
  assert.match(shared, /truncated/);
});

test('background: cancel and killAll abort the signal; a wait timeout leaves runs running; a throwing task fails', async () => {
  const events = [];
  const reg = background.createRegistry({ emit: (n, d) => events.push(d), now: Date.now });
  const hang = ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ content: [{ type: 'text', text: 'partial' }], details: { runs: [] }, isError: true })));
  const a = reg.start({ label: 'a', task: hang });
  const b = reg.start({ label: 'b', task: hang });
  const t0 = Date.now();
  await reg.wait([a], 80);
  assert.ok(Date.now() - t0 >= 70);
  assert.equal(a.status, 'running');

  reg.cancel(reg.select(['bg-1']).entries);
  await reg.wait([a], 1000);
  assert.equal(a.status, 'cancelled');
  assert.equal(b.status, 'running');
  reg.killAll();
  await reg.wait([b], 1000);
  assert.equal(b.status, 'cancelled');
  assert.deepEqual(events.map((e) => e.status), ['cancelled', 'cancelled']);

  const c = reg.start({ label: 'c', task: async () => { throw new Error('nope'); } });
  await reg.wait([c], 1000);
  assert.equal(c.status, 'failed');
  assert.match(c.text, /nope/);
  // an abort signal ends a wait early
  const d = reg.start({ label: 'd', task: hang });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const t1 = Date.now();
  await reg.wait([d], 10000, ac.signal);
  assert.ok(Date.now() - t1 < 2000);
  reg.killAll();
  assert.equal(background.formatWait([], []), 'No background subagent runs.');
});

// --- widget --------------------------------------------------------------------------------------

test('widget: running children only, name, tools and cost, fixed width, cleared when idle', () => {
  let changes = 0;
  const live = widget.createLiveRuns(() => changes++);
  assert.deepEqual(live.running(), []);
  live.set('call-1', [{ agent: 'scout', status: 'running', toolCount: 1, usage: { cost: 0.0123 } }, { agent: 'done', status: 'done', toolCount: 3, usage: {} }]);
  live.set('bg-1', [{ agent: 'worker', status: 'running', toolCount: 0, usage: { cost: 0 } }]);
  const running = live.running();
  assert.deepEqual(running.map((r) => r.agent), ['scout', 'worker']);
  const rows = widget.widgetLines(running, { width: 60 }).map(stripAnsi);
  assert.deepEqual(rows, ['subagents running (2)', '◌ scout · 1 tool · $0.012', '◌ worker · 0 tools']);
  assert.ok(widget.widgetLines(running, { width: 12 }).every((r) => stripAnsi(r).length <= 12));
  live.delete('call-1');
  live.delete('call-1');
  live.delete('bg-1');
  assert.equal(changes, 4);
  assert.deepEqual(widget.widgetLines(live.running()), []);
  const many = Array.from({ length: 9 }, (_, i) => ({ agent: `a${i}`, status: 'running', toolCount: 0, usage: {} }));
  const out = widget.widgetLines(many).map(stripAnsi);
  assert.equal(out.length, 1 + widget.MAX_ROWS + 1);
  assert.equal(out.at(-1), '+3 more');
});
