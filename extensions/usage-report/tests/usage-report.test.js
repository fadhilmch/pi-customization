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
