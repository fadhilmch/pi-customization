const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stripAnsi } = require('../ansi.js');
const agents = require('../agents.js');
const { parseConfig, loadConfig, DEFAULTS } = require('../config.js');
const args = require('../args.js');
const run = require('../run.js');
const output = require('../output.js');
const render = require('../render.js');
const dispatch = require('../dispatch.js');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('parseFrontmatter: scalars, inline lists, block lists, quotes', () => {
  const { data, body } = agents.parseFrontmatter('---\nname: a\ndescription: "Hi: there"\ntools: [read, grep]\nskills:\n  - ./x\n  - "./y"\nmcp: true\n---\nBody\n');
  assert.equal(data.name, 'a');
  assert.equal(data.description, 'Hi: there');
  assert.deepEqual(data.tools, ['read', 'grep']);
  assert.deepEqual(data.skills, ['./x', './y']);
  assert.equal(data.mcp, 'true');
  assert.equal(body, 'Body\n');
  assert.deepEqual(agents.parseFrontmatter('no frontmatter').data, {});
  const c = agents.parseFrontmatter('---\nmodel: a/b   # cheap one\nq: "x # y"\nl:\n  - ./s  # skill\n---\n').data;
  assert.equal(c.model, 'a/b');
  assert.equal(c.q, 'x # y');
  assert.deepEqual(c.l, ['./s']);
});

test('parseAgent: defaults, validation, model inherit', () => {
  const a = agents.parseAgent('---\nname: x\ndescription: d\ntools: read, ls\nmodel: inherit\nthinking: LOW\nmaxOutput: 900\n---\nPrompt', { filePath: '/a/x.md' });
  assert.equal(a.name, 'x');
  assert.deepEqual(a.tools, ['read', 'ls']);
  assert.equal(a.model, undefined);
  assert.equal(a.thinking, 'low');
  assert.equal(a.maxOutput, 900);
  assert.equal(a.contextFiles, true);
  assert.equal(a.mcp, false);
  assert.equal(a.systemPrompt, 'Prompt');
  assert.equal(a.dir, '/a');
  assert.match(agents.parseAgent('---\nname: x\n---\n', { filePath: 'x.md' }).error, /description/);
  assert.match(agents.parseAgent('---\nname: "bad name"\ndescription: d\n---\n').error, /invalid agent name/);
  assert.match(agents.parseAgent('---\nname: x\ndescription: d\nthinking: huge\n---\n').error, /thinking/);
  assert.equal(agents.parseAgent('---\ndescription: d\n---\n', { filePath: '/p/fromfile.md' }).name, 'fromfile');
});

test('bundled agents parse cleanly', () => {
  const { agents: list, errors } = agents.loadDir(agents.BUNDLED_DIR, 'bundled');
  assert.deepEqual(errors, []);
  assert.deepEqual(list.map((a) => a.name).sort(), ['reviewer', 'scout', 'worker']);
  const scout = list.find((a) => a.name === 'scout');
  assert.ok(!scout.tools.includes('bash') && !scout.tools.includes('edit'), 'scout stays read-only');
  assert.equal(scout.contextFiles, false);
  assert.ok(!list.find((a) => a.name === 'reviewer').tools.includes('edit'));
});

test('read-only dispatch refuses background shell starts and notebook edits', () => {
  assert.match(dispatch.readOnlyViolation({ tools: ['read', 'bash_bg'] }), /bash_bg/);
  assert.match(dispatch.readOnlyViolation({ tools: ['read', 'notebook_edit'] }), /notebook_edit/);
  assert.equal(dispatch.readOnlyViolation({ tools: ['read', 'grep'] }), null);
});

test('discoverAgents: user overrides bundled, project only when trusted', () => {
  const home = tmp('sa-home-');
  const proj = tmp('sa-proj-');
  const env = { PI_CODING_AGENT_DIR: path.join(home, 'agent') };
  write(path.join(home, 'agent', 'agents', 'scout.md'), '---\nname: scout\ndescription: user scout\n---\n');
  write(path.join(proj, '.pi', 'agents', 'scout.md'), '---\nname: scout\ndescription: project scout\n---\n');
  write(path.join(proj, '.pi', 'agents', 'broken.md'), '---\nname: broken\n---\n');
  const sub = path.join(proj, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });

  let r = agents.discoverAgents({ cwd: sub, trusted: false, env, home });
  assert.equal(r.agents.find((a) => a.name === 'scout').description, 'user scout');
  assert.equal(r.projectSkipped, true);
  assert.ok(r.agents.find((a) => a.name === 'worker'));

  r = agents.discoverAgents({ cwd: sub, trusted: true, env, home });
  assert.equal(r.agents.find((a) => a.name === 'scout').source, 'project');
  assert.equal(r.errors.length, 1);
});

test('applyOverrides and describeAgent', () => {
  const a = { name: 'scout', description: 'd', tools: ['read'], model: 'x/y', thinking: undefined, source: 'bundled' };
  assert.equal(agents.applyOverrides(a, { models: { scout: 'anthropic/claude-haiku-4-5' } }).model, 'anthropic/claude-haiku-4-5');
  assert.equal(agents.applyOverrides(a, { models: { scout: 'inherit' } }).model, undefined);
  assert.equal(agents.applyOverrides(a, { thinking: { scout: 'nope' } }).thinking, undefined);
  assert.equal(a.model, 'x/y', 'original untouched');
  assert.match(agents.describeAgent(a), /scout \(bundled\) · model: x\/y · tools: read/);
});

test('config: defaults, clamping, invalid JSON warning', () => {
  assert.deepEqual(parseConfig(null), { ...DEFAULTS });
  const c = parseConfig({ maxOutputChars: 10, concurrency: 99, models: { scout: 'm', bad: 3 }, thinking: { scout: 'low', w: 'nope' }, extensions: ['a', 1] });
  assert.equal(c.maxOutputChars, 500);
  assert.equal(c.concurrency, 8);
  assert.deepEqual(c.models, { scout: 'm' });
  assert.deepEqual(c.thinking, { scout: 'low' });
  assert.deepEqual(c.extensions, ['a']);
  const dir = tmp('sa-cfg-');
  fs.writeFileSync(path.join(dir, 'subagent.json'), '{bad');
  const r = loadConfig({ env: { PI_CODING_AGENT_DIR: dir } });
  assert.match(r.warning, /invalid JSON/);
  assert.equal(loadConfig({ env: { PI_CODING_AGENT_DIR: tmp('sa-none-') } }).warning, undefined);
});

test('resolveExtension: sibling, builtin, path, optional', () => {
  const exists = (p) => p.endsWith(path.join('auto-mode', 'index.ts')) || p === '/cfg/prov.ts';
  assert.equal(args.resolveExtension('auto-mode', { exists }).value, path.join(args.EXTENSIONS_ROOT, 'auto-mode', 'index.ts'));
  assert.equal(args.resolveExtension('builtin:mcp', { exists }).value, 'builtin:mcp');
  assert.equal(args.resolveExtension('./prov.ts', { baseDir: '/cfg', exists }).value, '/cfg/prov.ts');
  assert.match(args.resolveExtension('nope', { exists }).error, /unknown extension/);
  assert.deepEqual(args.resolveExtension('nope?', { exists }), { skip: true });
  assert.ok(args.resolveExtension('auto-mode?', { exists }).value);
});

test('buildChildArgs: lean child, inherit model and thinking, budget, task last', () => {
  const agent = { name: 'scout', tools: ['read', 'grep'], skills: [], extensions: ['missing?'], mcp: false, contextFiles: false, systemPrompt: 'Be a scout', dir: '/a' };
  const r = args.buildChildArgs(agent, '  find x  ', { dispatch: { model: 'p/m', thinking: 'high' }, config: { maxOutputChars: 6000 }, exists: () => false });
  const a = r.args;
  for (const f of ['--mode', 'json', '-p', '--no-session', '-ne', '-ns', '--no-mcp', '-nc']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--model') + 1], 'p/m');
  assert.equal(a[a.indexOf('--thinking') + 1], 'high');
  assert.equal(a[a.indexOf('--tools') + 1], 'read,grep');
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /under about 1000 words/);
  assert.ok(a.includes('Be a scout'));
  assert.equal(a.at(-1), 'Task: find x');
  assert.deepEqual(r.warnings, []);

  // Own model: parent's thinking is not inherited; own thinking is.
  const own = args.buildChildArgs({ ...agent, model: 'a/b', thinking: undefined }, 't', { dispatch: { model: 'p/m', thinking: 'high' }, exists: () => false });
  assert.equal(own.args[own.args.indexOf('--model') + 1], 'a/b');
  assert.ok(!own.args.includes('--thinking'));
  assert.equal(own.model, 'a/b');

  const mcp = args.buildChildArgs({ ...agent, mcp: true, contextFiles: true, extensions: ['x'] }, 't', { exists: () => false, maxChars: 1200 });
  assert.ok(!mcp.args.includes('--no-mcp') && !mcp.args.includes('-nc'));
  assert.match(mcp.warnings[0], /unknown extension "x"/);
  assert.match(mcp.args[mcp.args.indexOf('--append-system-prompt') + 1], /under about 200 words/);
  assert.equal(args.outputBudget({ maxOutput: 900 }, { maxOutputChars: 12000 }, 5000), 900);
});

test('piInvocation: script, compiled binary, PATH fallback', () => {
  assert.deepEqual(args.piInvocation(['-p'], { argv: ['node', '/x/cli.js'], execPath: '/usr/bin/node', exists: () => true }), { command: '/usr/bin/node', args: ['/x/cli.js', '-p'] });
  assert.deepEqual(args.piInvocation(['-p'], { argv: ['pi', '/$bunfs/root/pi'], execPath: '/opt/pi', exists: () => true }), { command: '/opt/pi', args: ['-p'] });
  assert.deepEqual(args.piInvocation(['-p'], { argv: ['node'], execPath: '/usr/bin/node', exists: () => false }), { command: 'pi', args: ['-p'] });
});

test('applyEvent folds usage, tool calls and the last text', () => {
  const r = run.createRun({ agent: 'scout', task: 't' });
  run.applyEvent(r, { type: 'tool_execution_start', toolName: 'read', args: { path: 'src/a.js' } });
  run.applyEvent(r, { type: 'tool_execution_start', toolName: 'write', args: { path: 'b.js', content: 'x'.repeat(5000) } });
  run.applyEvent(r, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }], usage: { input: 100, output: 10, cost: { total: 0.01 }, totalTokens: 110 }, provider: 'p', model: 'm' } });
  run.applyEvent(r, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall' }], usage: { input: 50, output: 5 } } });
  run.applyEvent(r, { type: 'message_end', message: { role: 'user', content: 'ignored' } });
  assert.equal(r.toolCount, 2);
  assert.deepEqual(r.toolCalls[1], { name: 'write', arg: 'b.js' });
  assert.equal(r.output, 'first');
  assert.equal(r.turns, 2);
  assert.equal(r.usage.input, 150);
  assert.equal(r.model, 'p/m');
  assert.equal(run.argSummary('bash', { command: 'a\n  b' }), 'a b');
});

// A fake child: a node script printing Pi-style JSON events.
function fakeChild(script) {
  const dir = tmp('sa-child-');
  const file = path.join(dir, 'child.js');
  fs.writeFileSync(file, script);
  return { command: process.execPath, args: [file] };
}

const EVENTS = `
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
out({ type: 'tool_execution_start', toolName: 'grep', args: { pattern: 'slugify' } });
out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Found in src/a.js:3 (depth ' + process.env.PI_SUBAGENT_DEPTH + ')' }], usage: { input: 2000, output: 50 }, stopReason: 'stop' } });
`;

test('runChild: real process, success, failure, abort, timeout', async () => {
  const ok = await run.runChild(run.createRun({ agent: 'scout', task: 't' }), { ...fakeChild(EVENTS), env: { ...process.env, PI_SUBAGENT_DEPTH: '1' } });
  assert.equal(ok.status, 'done');
  assert.equal(ok.output, 'Found in src/a.js:3 (depth 1)');
  assert.equal(ok.toolCount, 1);

  const bad = await run.runChild(run.createRun({ agent: 'x', task: 't' }), fakeChild('process.stderr.write("boom\\n"); process.exit(3);'));
  assert.equal(bad.status, 'failed');
  assert.equal(bad.exitCode, 3);
  assert.match(output.failureReason(bad), /boom/);

  const errStop = await run.runChild(run.createRun({ agent: 'x', task: 't' }), fakeChild(`process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' } }) + '\\n');`));
  assert.equal(errStop.status, 'failed');
  assert.equal(output.failureReason(errStop), 'rate limited');

  const ac = new AbortController();
  const slow = fakeChild('setTimeout(() => {}, 60000);');
  const p = run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...slow, signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  assert.equal((await p).status, 'aborted');

  const timed = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...slow, timeoutMs: 150 });
  assert.equal(timed.status, 'failed');
  assert.match(timed.errorMessage, /timed out/);

  const missing = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { command: '/nonexistent/pi', args: [] });
  assert.equal(missing.status, 'failed');
  assert.match(missing.errorMessage, /could not start pi/);
});

test('mapLimit keeps order and respects the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const res = await run.mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    return i;
  });
  assert.deepEqual(res, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test('output: cap, usage, model text per mode', () => {
  assert.equal(output.capText('abc', 10), 'abc');
  assert.match(output.capText('x'.repeat(50), 10), /^x{10}\n\n\[… 40 more characters truncated/);
  assert.equal(output.formatUsage({ input: 18200, output: 640, cacheRead: 12000, cost: 0.0123 }), '↑18k ↓640 R12k $0.012');
  assert.equal(output.formatDuration(75000), '1m 15s');
  const okRun = { agent: 'scout', status: 'done', output: 'report', usage: {}, stderr: '' };
  const badRun = { agent: 'worker', status: 'failed', output: '', errorMessage: 'nope', usage: {}, stderr: '' };
  assert.equal(output.modelText('single', [okRun]), 'report');
  assert.equal(output.modelText('single', [badRun]), 'Subagent worker failed: nope');
  assert.match(output.modelText('parallel', [okRun, badRun]), /^1\/2 subagents succeeded\.\n\n## 1\. scout\n\nreport\n\n## 2\. worker \(failed\)\n\nFAILED: nope$/);
  assert.equal(output.modelText('chain', [okRun, { ...okRun, output: 'last' }]), 'last');
  assert.match(output.modelText('chain', [okRun, badRun]), /Chain stopped at step 2 \(worker\): nope/);
});

test('render: call line per mode, collapsed and expanded results', () => {
  assert.equal(stripAnsi(render.formatCallLine({ agent: 'scout', task: 'find\nall callers' })), '⏺ Subagent(scout: find all callers)');
  assert.equal(stripAnsi(render.formatCallLine({ tasks: [{ agent: 'scout' }, { agent: 'scout' }, { agent: 'reviewer' }] })), '⏺ Subagent(parallel: scout ×2, reviewer)');
  assert.equal(stripAnsi(render.formatCallLine({ chain: [{ agent: 'scout' }, { agent: 'worker' }] })), '⏺ Subagent(chain: scout → worker)');

  const base = { task: 'find x', usage: { input: 18000, output: 600 }, stderr: '', startedAt: 0, endedAt: 14000, toolCount: 2, toolCalls: [{ name: 'grep', arg: 'x' }, { name: 'read', arg: 'a.js' }] };
  const done = { ...base, agent: 'scout', status: 'done', output: 'l1\nl2\nl3\nl4\nl5' };
  let rows = render.formatResult({ mode: 'single', runs: [done] }, { width: 100 }).map(stripAnsi);
  assert.equal(rows[0], '  ⎿  ✓ scout · 2 tools · ↑18k ↓600 · 14s');
  assert.equal(rows[1], '     l1');
  assert.equal(rows.at(-1), '     … +2 lines (ctrl+o to expand)');

  rows = render.formatResult({ mode: 'single', runs: [done] }, { width: 100, expanded: true }).map(stripAnsi);
  assert.ok(rows.includes('       Task: find x'));
  assert.ok(rows.includes('       → Read(a.js)'));
  assert.ok(rows.includes('       l5'));

  const running = { ...base, agent: 'worker', status: 'running', endedAt: undefined, startedAt: Date.now() };
  rows = render.formatResult({ mode: 'parallel', runs: [done, running] }, { width: 100 }).map(stripAnsi);
  assert.equal(rows[0], '  ⎿  ✓ scout find x · 2 tools · ↑18k ↓600 · 14s');
  assert.equal(rows[1], '     ◌ worker find x · 2 tools · ↑18k ↓600');
  assert.equal(rows[2], '       → Read(a.js)');
  assert.ok(!rows.some((r) => r.includes('Total')), 'no total while running');

  rows = render.formatResult({ mode: 'chain', runs: [{ ...done, step: 1 }, { ...done, step: 2 }] }, { width: 100 }).map(stripAnsi);
  assert.match(rows[0], /✓ 1\. scout/);
  assert.match(rows.at(-2), /Total ↑36k ↓1.2k/);

  assert.deepEqual(render.formatResult(undefined, { fallbackText: 'Unknown agent "x".' }).map(stripAnsi), ['  ⎿  Unknown agent "x".']);
  assert.ok(render.formatResult({ mode: 'single', runs: [done] }, { width: 20 }).every((r) => stripAnsi(r).length <= 20));
});

test('chainTask substitutes or appends the previous report', () => {
  assert.equal(dispatch.chainTask('a {previous}', 'X', 0), 'a ');
  assert.equal(dispatch.chainTask('use {previous} then {previous}', 'X', 1), 'use X then X');
  assert.equal(dispatch.chainTask('plan it', 'X', 1), 'plan it\n\nOutput of the previous step:\nX');
  assert.equal(dispatch.modeOf({ agent: 'a', task: 't' }), 'single');
  assert.equal(dispatch.modeOf({ agent: 'a', tasks: [{}] }), null);
  assert.equal(dispatch.modeOf({}), null);
});

const AGENTS = [
  { name: 'scout', description: 'd', tools: ['read'], skills: [], extensions: [], mcp: false, contextFiles: false, systemPrompt: 's', source: 'bundled', dir: '/a' },
  { name: 'worker', description: 'd', tools: [], skills: [], extensions: [], mcp: false, contextFiles: true, systemPrompt: '', source: 'bundled', dir: '/a', maxOutput: 3000 },
];
const CONFIG = parseConfig({});

// Fake runChild: records the call and "finishes" with a scripted outcome.
function fakeRun(outcomes, calls) {
  return async (r, opts) => {
    calls.push({ task: r.task, agent: r.agent, args: opts.args, env: opts.env, cwd: opts.cwd });
    const o = outcomes[r.agent] || {};
    r.output = typeof o.output === 'function' ? o.output(r) : o.output ?? `${r.agent} report`;
    r.usage.input = 1000;
    return run.finish(r, { exitCode: o.exitCode ?? 0 });
  };
}

test('executeSubagent: validation errors', async () => {
  const opts = { agents: AGENTS, config: CONFIG, cwd: '/w', run: fakeRun({}, []), invocation: (a) => ({ command: 'pi', args: a }) };
  let r = await dispatch.executeSubagent({}, opts);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /exactly one of.*Agents: scout, worker/);
  r = await dispatch.executeSubagent({ agent: 'nope', task: 't' }, opts);
  assert.match(r.content[0].text, /Unknown agent "nope"/);
  r = await dispatch.executeSubagent({ agent: 'scout' }, opts);
  assert.match(r.content[0].text, /needs both/);
  r = await dispatch.executeSubagent({ tasks: Array.from({ length: 7 }, () => ({ agent: 'scout', task: 't' })) }, opts);
  assert.match(r.content[0].text, /limit is 6/);
});

test('executeSubagent: single passes depth, cwd, model and caps output', async () => {
  const calls = [];
  const updates = [];
  const r = await dispatch.executeSubagent({ agent: 'scout', task: 'look', cwd: 'sub' }, {
    agents: AGENTS, config: { ...CONFIG, maxOutputChars: 600 }, cwd: '/w', env: { PI_SUBAGENT_DEPTH: '0' },
    dispatch: { model: 'p/m' }, onUpdate: (u) => updates.push(u),
    run: fakeRun({ scout: { output: 'y'.repeat(2000) } }, calls), invocation: (a) => ({ command: 'pi', args: a }),
  });
  assert.equal(calls[0].env.PI_SUBAGENT_DEPTH, '1');
  assert.equal(calls[0].cwd, path.resolve('/w', 'sub'));
  assert.ok(calls[0].args.includes('p/m'));
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /truncated/);
  assert.ok(r.content[0].text.length < 800);
  assert.equal(r.details.mode, 'single');
  assert.equal(r.details.runs[0].status, 'done');
  assert.ok(updates.length >= 1);
});

test('executeSubagent: parallel shares the budget and reports partial failure', async () => {
  const calls = [];
  const r = await dispatch.executeSubagent({ tasks: [{ agent: 'scout', task: 'a' }, { agent: 'worker', task: 'b' }, { agent: 'scout', task: 'c' }] }, {
    agents: AGENTS, config: CONFIG, cwd: '/w', env: {},
    run: fakeRun({ worker: { exitCode: 1, output: '' } }, calls), invocation: (a) => ({ command: 'pi', args: a }),
  });
  assert.equal(calls.length, 3);
  // 2 * 12000 / 3 = 8000 chars each; worker's own 3000 is smaller.
  assert.match(calls[0].args.join(' '), /under about 1330 words/);
  assert.match(calls.find((c) => c.agent === 'worker').args.join(' '), /under about 500 words/);
  assert.equal(r.isError, undefined, 'partial failure is not a tool error');
  assert.match(r.content[0].text, /^2\/3 subagents succeeded/);
  assert.match(r.content[0].text, /## 2\. worker \(failed\)/);
});

test('executeSubagent: chain feeds reports forward and stops on failure', async () => {
  const calls = [];
  const opts = { agents: AGENTS, config: CONFIG, cwd: '/w', env: {}, invocation: (a) => ({ command: 'pi', args: a }) };
  let r = await dispatch.executeSubagent({ chain: [{ agent: 'scout', task: 'map it' }, { agent: 'worker', task: 'fix using {previous}' }] }, { ...opts, run: fakeRun({}, calls) });
  assert.equal(calls[1].task, 'fix using scout report');
  assert.equal(r.content[0].text, 'worker report');
  assert.deepEqual(r.details.runs.map((x) => x.step), [1, 2]);

  calls.length = 0;
  r = await dispatch.executeSubagent({ chain: [{ agent: 'worker', task: 'a' }, { agent: 'scout', task: 'b' }] }, { ...opts, run: fakeRun({ worker: { exitCode: 2 } }, calls) });
  assert.equal(calls.length, 1);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Chain stopped at step 1 \(worker\)/);
});

test('agents panel: effective model, sources, notes, fixed width', () => {
  const { agentsPanel } = require('../panel.js');
  const { visibleWidth } = require('../ansi.js');
  const list = agents.loadDir(agents.BUNDLED_DIR, 'bundled').agents.map((a) => agents.applyOverrides(a, { models: { scout: 'p/cheap' } }));
  const data = { agents: list, errors: ['x.md: missing description'], projectSkipped: true, projectDir: '/r/.pi/agents', configFile: path.join(os.homedir(), '.pi/agent/subagent.json') };
  const lines = agentsPanel(data, 90);
  assert.ok(lines.every((l) => visibleWidth(l) === 84));
  const text = lines.map(stripAnsi).join('\n');
  assert.match(text, /■ scout\s+bundled\s+p\/cheap · thinking low/);
  assert.match(text, /■ worker\s+bundled\s+inherits session model/);
  assert.match(text, /loads auto-mode, quality-on-write/);
  assert.doesNotMatch(text, /auto-mode\?/);
  assert.match(text, /not loaded: the project is not trusted/);
  assert.match(text, /! x\.md: missing description/);
  assert.match(text, /~\/\.pi\/agent\/subagent\.json/);
  assert.match(agentsPanel({ agents: [] }, 40).map(stripAnsi).join('\n'), /No subagents found/);
});

// ---- review fixes ----

test('readOnly session: only agents without write/edit/bash may run, nothing is spawned otherwise', async () => {
  const calls = [];
  const agentsList = [...AGENTS, { ...AGENTS[0], name: 'reviewer', tools: ['read', 'bash'] }, { ...AGENTS[0], name: 'editor', tools: ['read', 'edit'] }];
  const opts = { agents: agentsList, config: CONFIG, cwd: '/w', env: {}, readOnly: true, run: fakeRun({}, calls), invocation: (a) => ({ command: 'pi', args: a }) };
  // worker has an empty tool list = Pi's default tools (write, edit, bash)
  let r = await dispatch.executeSubagent({ agent: 'worker', task: 'edit files' }, opts);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /read-only.*"worker".*default tool set/);
  for (const name of ['reviewer', 'editor']) {
    r = await dispatch.executeSubagent({ agent: name, task: 't' }, opts);
    assert.equal(r.isError, true, name);
  }
  // one risky item in a parallel or chain call refuses the whole call before anything starts
  r = await dispatch.executeSubagent({ tasks: [{ agent: 'scout', task: 'a' }, { agent: 'worker', task: 'b' }] }, opts);
  assert.equal(r.isError, true);
  r = await dispatch.executeSubagent({ chain: [{ agent: 'scout', task: 'a' }, { agent: 'worker', task: 'b' }] }, opts);
  assert.equal(r.isError, true);
  assert.equal(calls.length, 0);
  r = await dispatch.executeSubagent({ agent: 'scout', task: 'look' }, opts);
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1);
  // not read-only: the worker runs
  r = await dispatch.executeSubagent({ agent: 'worker', task: 'x' }, { ...opts, readOnly: false });
  assert.equal(r.isError, undefined);
});

test('output is capped by each agent\'s own maxOutput (single, chain last step, parallel)', async () => {
  const long = 'z'.repeat(9000);
  const opts = { agents: AGENTS, config: CONFIG, cwd: '/w', env: {}, invocation: (a) => ({ command: 'pi', args: a }) };
  const runs = () => fakeRun({ scout: { output: long }, worker: { output: long } }, []);
  let r = await dispatch.executeSubagent({ agent: 'worker', task: 't' }, { ...opts, run: runs() });
  assert.ok(r.content[0].text.length < 3300, `single ${r.content[0].text.length}`);
  assert.match(r.content[0].text, /truncated/);
  r = await dispatch.executeSubagent({ chain: [{ agent: 'scout', task: 'a' }, { agent: 'worker', task: 'b' }] }, { ...opts, run: runs() });
  assert.ok(r.content[0].text.length < 3300, `chain ${r.content[0].text.length}`);
  r = await dispatch.executeSubagent({ tasks: [{ agent: 'scout', task: 'a' }, { agent: 'worker', task: 'b' }] }, { ...opts, run: runs() });
  const worker = r.content[0].text.split('## 2. worker')[1];
  assert.ok(worker.length < 3300, `parallel ${worker.length}`);
  assert.match(worker, /truncated/);
  const one = { ...run.createRun({ agent: 'a' }), status: 'done', output: 'q'.repeat(100), budget: 20 };
  assert.equal(output.modelText('single', [one], { maxChars: 50 }).split('\n')[0].length, 20);
});

test('runChild: UTF-8 characters split across stdout chunks survive', async () => {
  const script = `
    const line = JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'caf\\u00e9 \\u4e16\\u754c \\u{1F600}' }], stopReason: 'stop' } }) + '\\n';
    const buf = Buffer.from(line);
    let at = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] >= 0xC0) { at = i + 1; break; } // right after a lead byte
    process.stdout.write(buf.subarray(0, at));
    setTimeout(() => process.stdout.write(buf.subarray(at)), 60);
  `;
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), fakeChild(script));
  assert.equal(r.status, 'done');
  assert.equal(r.output, 'café 世界 \u{1F600}');
});

test('runChild: an already aborted signal never spawns', async () => {
  const ac = new AbortController();
  ac.abort();
  let spawned = 0;
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { command: 'pi', args: [], signal: ac.signal, spawn: () => { spawned++; throw new Error('should not spawn'); } });
  assert.equal(spawned, 0);
  assert.equal(r.status, 'aborted');
});

test('executeSubagent: queued parallel tasks are not started after an abort', async () => {
  const ac = new AbortController();
  const calls = [];
  const r = await dispatch.executeSubagent({ tasks: Array.from({ length: 6 }, (_, i) => ({ agent: 'scout', task: `t${i}` })) }, {
    agents: AGENTS, config: { ...CONFIG, concurrency: 1 }, cwd: '/w', env: {}, signal: ac.signal, invocation: (a) => ({ command: 'pi', args: a }),
    run: async (rr) => { calls.push(rr.task); ac.abort(); return run.finish(rr, { exitCode: 1, aborted: true }); },
  });
  assert.deepEqual(calls, ['t0'], 'only the first task started');
  assert.equal(r.details.runs.length, 6);
  assert.ok(r.details.runs.every((x) => x.status === 'aborted'));
});

test('runChild: nonexistent cwd gives a clear error', async () => {
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...fakeChild(EVENTS), cwd: path.join(os.tmpdir(), 'sa-does-not-exist-xyz') });
  assert.equal(r.status, 'failed');
  assert.match(r.errorMessage, /working directory does not exist/);
});

test('runChild: timeout message uses seconds under a minute', async () => {
  const slow = fakeChild('setTimeout(() => {}, 60000);');
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...slow, timeoutMs: 1200 });
  assert.equal(r.errorMessage, 'timed out after 1s');
});

test('runChild: abort kills the whole process group, not just the child', { skip: process.platform === 'win32' }, async () => {
  const dir = tmp('sa-pg-');
  const pidFile = path.join(dir, 'grandchild.pid');
  const script = `
    const { spawn } = require('node:child_process');
    const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
    setTimeout(() => {}, 60000);
  `;
  const ac = new AbortController();
  const p = run.runChild(run.createRun({ agent: 'x', task: 't' }), { ...fakeChild(script), signal: ac.signal });
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 30));
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  ac.abort();
  assert.equal((await p).status, 'aborted');
  await new Promise((r) => setTimeout(r, 300));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false, 'grandchild is gone');
});

test('runChild: settles after exit even if a grandchild keeps stdout open', { skip: process.platform === 'win32' }, async () => {
  const script = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref();
    process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } }) + '\\n');
  `;
  const t0 = Date.now();
  const r = await run.runChild(run.createRun({ agent: 'x', task: 't' }), fakeChild(script));
  assert.equal(r.status, 'done');
  assert.equal(r.output, 'ok');
  assert.ok(Date.now() - t0 < 2500, `settled in ${Date.now() - t0}ms`);
});

test('parseFrontmatter: prose descriptions keep " #", block scalars fold, empty frontmatter parses', () => {
  const fm = agents.parseFrontmatter;
  assert.equal(fm('---\nname: a\ndescription: Fixes issue #12 and PR #3\n---\n').data.description, 'Fixes issue #12 and PR #3');
  assert.equal(fm('---\nmodel: a/b # note\n---\n').data.model, 'a/b');
  const folded = fm('---\nname: a\ndescription: >\n  Looks up things\n  across many files.\n\n  Second para.\ntools: read\n---\nBody').data;
  assert.equal(folded.description, 'Looks up things across many files. Second para.');
  assert.equal(folded.tools, 'read');
  const lit = fm('---\ndescription: |\n  line one\n  line two\n---\n').data;
  assert.equal(lit.description, 'line one\nline two');
  const empty = fm('---\n---\nBody here');
  assert.deepEqual(empty.data, {});
  assert.equal(empty.body, 'Body here');
  assert.match(agents.parseAgent('---\n---\nBody', { filePath: 'x.md' }).error, /description/);
  assert.equal(agents.parseAgent('---\nname: x\ndescription: See issue #7 first\n---\n').description, 'See issue #7 first');
});

test('expandHome handles the path separator; piInvocation uses pi.cmd on win32', () => {
  assert.equal(agents.expandHome('~'), os.homedir());
  assert.equal(agents.expandHome(`~${path.sep}x`, '/h'), path.join('/h', 'x'));
  assert.equal(agents.expandHome('~/x', '/h'), path.join('/h', 'x'));
  assert.equal(agents.expandHome('~x', '/h'), '~x');
  assert.equal(args.piInvocation(['-p'], { argv: ['node'], execPath: 'node.exe', exists: () => false, platform: 'win32' }).command, 'pi.cmd');
});
