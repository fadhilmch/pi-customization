const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { contextMessages, summarizeMessages, measureMessage, estimateTokens } = require('../messages.js');
const { buildContext, formatContext } = require('../context.js');
const { aggregate, formatCost } = require('../cost.js');

const msg = (id, message) => ({ id, type: 'message', message });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });

test('estimateTokens is chars/4 rounded up', () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(9), 3);
});

test('measureMessage counts text, thinking and tool calls', () => {
  assert.equal(measureMessage({ role: 'user', content: 'x'.repeat(40) }).tokens, 10);
  const a = measureMessage({ role: 'assistant', content: [{ type: 'text', text: 'abcd' }, { type: 'thinking', thinking: 'abcd' }, call('1', 'ls', {})] });
  assert.equal(a.kind, 'assistant');
  assert.ok(a.chars > 8);
  const img = measureMessage({ role: 'toolResult', content: [{ type: 'image' }] });
  assert.ok(img.tokens >= 1200);
});

test('contextMessages respects the latest compaction', () => {
  const branch = [
    msg('1', { role: 'user', content: 'old' }),
    msg('2', { role: 'user', content: 'kept' }),
    { id: '3', type: 'compaction', summary: 'sum', firstKeptEntryId: '2' },
    msg('4', { role: 'user', content: 'new' }),
    { id: '5', type: 'model_change' },
  ];
  const out = contextMessages(branch);
  assert.deepEqual(out.map((m) => m.role), ['compactionSummary', 'user', 'user']);
  assert.equal(out[1].content, 'kept');
});

test('summarizeMessages ranks the biggest tool results with their call', () => {
  const messages = [
    { role: 'assistant', content: [call('a', 'read', { path: 'big.txt' }), call('b', 'bash', { command: 'ls' })] },
    { role: 'toolResult', toolCallId: 'a', toolName: 'read', content: [{ type: 'text', text: 'x'.repeat(4000) }] },
    { role: 'toolResult', toolCallId: 'b', toolName: 'bash', content: [{ type: 'text', text: 'y'.repeat(40) }] },
  ];
  const { totals, biggest } = summarizeMessages(messages);
  assert.equal(totals.toolResult.count, 2);
  assert.equal(biggest[0].tool, 'read');
  assert.equal(biggest[0].what, 'big.txt');
  assert.equal(biggest[0].tokens, 1000);
});

test('formatContext shows real total, estimates and waste hint', () => {
  const r = buildContext({
    systemPrompt: 's'.repeat(8000),
    contextFiles: [{ path: '/p/AGENTS.md', content: 'c'.repeat(400) }],
    skills: [{ name: 'a', description: 'b' }],
    tools: [{ name: 'read', description: 'd'.repeat(100), parameters: { type: 'object' } }],
    messages: [{ role: 'toolResult', toolCallId: 'x', toolName: 'read', content: [{ type: 'text', text: 'z'.repeat(8000) }] }],
    usage: { tokens: 5000, contextWindow: 200000, percent: 2.5 },
  });
  const text = formatContext(r);
  assert.match(text, /5\.0k used of 200k \(2\.5%\)/);
  assert.match(text, /Estimated/);
  assert.match(text, /System prompt/);
  assert.match(text, /AGENTS\.md/);
  assert.match(text, /Tool definitions \(1\)/);
  assert.match(text, /Biggest tool results/);
  assert.match(text, /over half/);
});

test('formatContext copes with unknown usage and empty input', () => {
  const text = formatContext(buildContext({ systemPrompt: '', messages: [], usage: undefined }));
  assert.match(text, /unknown/);
});

const usage = (input, output, total) => ({ input, output, cacheRead: 10, cacheWrite: 5, cost: { total } });

test('aggregate sums per model and subagent runs', () => {
  const branch = [
    msg('1', { role: 'user', content: 'hi' }),
    msg('2', { role: 'assistant', provider: 'anthropic', model: 'sonnet', usage: usage(100, 50, 0.01), content: [] }),
    msg('3', { role: 'assistant', provider: 'anthropic', model: 'sonnet', usage: usage(200, 20, 0.02), content: [] }),
    msg('4', { role: 'assistant', provider: 'openai', model: 'gpt', usage: usage(1, 1, 0.5), content: [] }),
    msg('5', {
      role: 'toolResult', toolName: 'subagent', content: [],
      details: { mode: 'parallel', runs: [
        { agent: 'scout', model: 'p/haiku', usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.003 } },
        { agent: 'scout', model: 'p/haiku', usage: { input: 500, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.002 } },
      ] },
    }),
    { id: '6', type: 'compaction', summary: 's', firstKeptEntryId: '1', usage: usage(10, 10, 0.1) },
  ];
  const r = aggregate(branch);
  const sonnet = r.models.find((m) => m.name === 'anthropic/sonnet');
  assert.equal(sonnet.turns, 2);
  assert.equal(sonnet.input, 300);
  assert.ok(Math.abs(sonnet.cost - 0.03) < 1e-9);
  assert.equal(r.models[0].name, 'openai/gpt'); // sorted by cost
  assert.ok(r.models.some((m) => m.name === '(compaction)'));
  assert.equal(r.subagents.length, 1);
  assert.equal(r.subagents[0].turns, 2);
  assert.ok(Math.abs(r.sub.cost - 0.005) < 1e-9);
  const text = formatCost(r);
  assert.match(text, /anthropic\/sonnet/);
  assert.match(text, /Subagents/);
  assert.match(text, /Total \$0\.635/);
});

test('formatCost handles empty branch', () => {
  assert.match(formatCost(aggregate([])), /No usage/);
});

const canStrip = process.features?.typescript || process.execArgv.includes('--experimental-strip-types');
test('index.ts registers /context and /cost and reports via notify', { skip: !canStrip && 'needs --experimental-strip-types' }, async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'index.ts')).href);
  const commands = {};
  mod.default({
    registerCommand: (n, o) => (commands[n] = o),
    getActiveTools: () => ['read'],
    getAllTools: () => [{ name: 'read', description: 'd', parameters: {} }, { name: 'other', description: 'x', parameters: {} }],
  });
  assert.ok(commands.context && commands.cost);
  const notes = [];
  const ctx = {
    ui: { notify: (m, t) => notes.push([m, t]) },
    sessionManager: { getBranch: () => [msg('1', { role: 'user', content: 'hello there' })] },
    getSystemPrompt: () => 'sys',
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
  };
  await commands.context.handler('', ctx);
  assert.match(notes.at(-1)[0], /Tool definitions \(1\)/);
  await commands.cost.handler('', ctx);
  assert.match(notes.at(-1)[0], /No usage/);
});

test('panels: framed, fixed width, proportional bars', () => {
  const { contextPanel, costPanel, stackedBar, bar, frame } = require('../panel.js');
  const { stripAnsi, visibleWidth } = require('../ansi.js');
  const strip = (ls) => ls.map(stripAnsi);

  // Bars: proportional window bar, minCell for small cost splits, eighth-block precision.
  assert.equal(stripAnsi(stackedBar([{ value: 1, color: '#ffffff' }, { value: 1, color: '#ffffff' }], 100, 10)), '··········'.replace(/^./, '█'));
  assert.equal(stripAnsi(stackedBar([{ value: 50, color: '#ffffff' }, { value: 25, color: '#ffffff' }], 100, 8)), '██████··');
  assert.equal(stripAnsi(stackedBar([{ value: 99, color: '#ffffff' }, { value: 1, color: '#ffffff' }], 100, 10, { minCell: true })), '██████████');
  assert.equal(stripAnsi(bar(0.5, 4, '#ffffff')), '██··');
  assert.equal(stripAnsi(bar(0.0625, 2, '#ffffff')), '▏·');
  assert.deepEqual(strip(frame('T', ['x'], 26)), ['╭─ T ────────────────────╮', '│ x                      │', '╰──────────── esc close ─╯']);

  const report = buildContext({
    systemPrompt: 'x'.repeat(4000),
    tools: [{ name: 'subagent', description: 'd'.repeat(2400) }, { name: 'read', description: 'r'.repeat(400) }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [call('1', 'subagent', { tasks: [{ agent: 'scout', task: 'a' }, { agent: 'scout', task: 'b' }] })] },
      { role: 'toolResult', toolCallId: '1', toolName: 'subagent', content: [{ type: 'text', text: 'z'.repeat(8000) }] },
    ],
    usage: { tokens: 4000, contextWindow: 200000, percent: 2 },
  });
  for (const w of [60, 84, 140]) {
    const lines = contextPanel(report, w);
    assert.ok(lines.every((l) => visibleWidth(l) === Math.min(w, 84)), `context width ${w}`);
  }
  const text = strip(contextPanel(report, 100)).join('\n');
  assert.match(text, /4\.0k of 200k tokens \(2\.0%, reported by the provider\)/);
  assert.match(text, /subagent parallel: scout ×2/);
  assert.match(text, /Tool results are over half/);
  // 2% of an 80-cell bar is 2 cells, not one per category.
  const windowBar = strip(contextPanel(report, 84))[2];
  assert.equal((windowBar.match(/█/g) || []).length, 2);

  const branch = [
    msg('1', { role: 'assistant', provider: 'p', model: 'big', usage: { input: 1000, output: 100, cacheRead: 3000, cacheWrite: 0, cost: { total: 0.03 } } }),
    msg('2', { role: 'toolResult', toolName: 'subagent', details: { runs: [{ agent: 'scout', model: 'p/small', usage: { input: 4000, output: 50, cost: 0.01 } }] } }),
  ];
  const cost = strip(costPanel(aggregate(branch), 84)).join('\n');
  assert.match(cost, /\$0\.040 this branch \(main \$0\.030 · subagents \$0\.010\)/);
  assert.match(cost, /p\/big\s+\$0\.030\s+75\.0%/);
  assert.match(cost, /scout \(p\/small\)\s+\$0\.010\s+25\.0%/);
  assert.match(cost, /Cache reads\s+37\.5%/); // 3000 / (1000 + 4000 + 3000)
  assert.ok(costPanel(aggregate(branch), 70).every((l) => visibleWidth(l) === 70));
  assert.match(strip(costPanel(aggregate([]), 84)).join('\n'), /No usage recorded/);
});

test('describeCall names subagent calls', () => {
  const { describeCall } = require('../messages.js');
  assert.equal(describeCall(call('1', 'subagent', { chain: [{ agent: 'scout' }, { agent: 'worker' }] })), 'chain: scout → worker');
  assert.equal(describeCall(call('1', 'subagent', { agent: 'scout', task: 'find x' })), 'scout: find x');
  assert.equal(describeCall(call('1', 'bash', { command: 'ls  -la' })), 'ls -la');
});

test('projectedMessages prefers Pi\'s projection, falls back to context entries, then to the branch walk', () => {
  const { projectedMessages } = require('../messages.js');
  const projected = [{ role: 'compactionSummary', summary: 'new' }, { role: 'user', content: 'edited' }];
  let branchCalls = 0;
  // Pi's projection already dropped old summaries and applied context_edit: use it as is.
  assert.equal(projectedMessages({ buildSessionProjection: () => ({ messages: projected }), getBranch: () => { branchCalls++; return []; } }), projected);
  assert.equal(branchCalls, 0);
  const entries = [{ id: '1', type: 'compaction', summary: 's' }, { id: '2', type: 'message', message: { role: 'user', content: 'x' } }, { id: '3', type: 'context_edit', targetId: '2' }];
  assert.deepEqual(projectedMessages({ buildContextEntries: () => entries }).map((m) => m.role), ['compactionSummary', 'user']);
  const branch = [msg('1', { role: 'user', content: 'a' }), msg('2', { role: 'user', content: 'b' })];
  assert.equal(projectedMessages({ getBranch: () => branch }).length, 2);
});

test('/context ignores superseded compaction summaries and honours context_edit via the projection', () => {
  // Branch with two compactions and an edited tool result; Pi's projection keeps only the newest summary.
  const big = 'x'.repeat(40000);
  const projection = { messages: [
    { role: 'compactionSummary', summary: 'newest' },
    { role: 'toolResult', toolName: 'read', toolCallId: 't', content: [{ type: 'text', text: '[trimmed]' }] },
  ] };
  const sm = {
    buildSessionProjection: () => projection,
    getBranch: () => [
      { id: '1', type: 'compaction', summary: big, firstKeptEntryId: '1' },
      msg('2', { role: 'toolResult', toolName: 'read', toolCallId: 't', content: [{ type: 'text', text: big }] }),
      { id: '3', type: 'compaction', summary: 'newest', firstKeptEntryId: '2' },
    ],
  };
  const { projectedMessages } = require('../messages.js');
  const tokens = summarizeMessages(projectedMessages(sm)).totals;
  assert.ok(tokens.toolResult.tokens < 50, 'edited result counted at its replacement size');
  assert.ok(tokens.other.tokens < 50, 'only the newest summary counted');
});

test('aggregate counts usage entries (cache_warm) and branch summary usage', () => {
  const u = (cost) => ({ input: 100, output: 10, cacheRead: 0, cacheWrite: 500, cost: { total: cost } });
  const branch = [
    msg('1', { role: 'assistant', provider: 'p', model: 'm', usage: u(0.01), content: [] }),
    { id: '2', type: 'usage', kind: 'cache_warm', provider: 'p', model: 'm', usage: u(0.02) },
    { id: '3', type: 'usage', kind: 'cache_warm', provider: '', model: '', usage: u(0.04) },
    { id: '4', type: 'branch_summary', fromId: '1', summary: 's', usage: u(0.08) },
  ];
  const r = aggregate(branch);
  const m = r.models.find((x) => x.name === 'p/m');
  assert.equal(m.turns, 1, 'a cache warm-up is not a conversation turn');
  assert.ok(Math.abs(m.cost - 0.03) < 1e-9);
  assert.equal(m.cacheWrite, 1000);
  assert.ok(r.models.some((x) => x.name === '(cache_warm)'));
  assert.ok(r.models.some((x) => x.name === '(branch summary)'));
  assert.ok(Math.abs(r.main.cost - 0.15) < 1e-9);
  assert.match(formatCost(r), /Total \$0\.150/);
});
