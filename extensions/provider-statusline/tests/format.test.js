const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getProviderKind,
  formatModelLabel,
  formatCountdown,
  buildPrimaryItems,
  fitPrimaryItems,
} = require('../format.js');

test('registers F1 as a shortcut for the built-in hotkeys command', async () => {
  const { registerHotkeysShortcut } = require('../shortcuts.js');
  const registrations = [];
  const pi = {
    registerShortcut(key, options) {
      registrations.push({ key, options });
    },
  };

  registerHotkeysShortcut(pi);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].key, 'f1');
  assert.match(registrations[0].options.description, /keyboard shortcuts/i);

  let editorText;
  await registrations[0].options.handler({
    hasUI: true,
    ui: {
      setEditorText(text) {
        editorText = text;
      },
    },
  });

  assert.equal(editorText, '/hotkeys');
});

test('detects provider kind across pi providers', () => {
  assert.equal(getProviderKind({ provider: 'anthropic', id: 'claude-opus-5' }), 'claude');
  assert.equal(getProviderKind({ provider: 'openai-codex', id: 'gpt-5.4' }), 'codex');
  assert.equal(getProviderKind({ provider: 'github-copilot', id: 'gpt-5.4' }), 'copilot');
  assert.equal(getProviderKind({ provider: 'openrouter', id: 'qwen3-coder' }), 'generic');
});

test('formats model labels to compact statusline labels', () => {
  assert.equal(formatModelLabel({ provider: 'anthropic', id: 'claude-opus-5' }), '◉ Claude Opus 5');
  assert.equal(formatModelLabel({ provider: 'openai-codex', id: 'gpt-5.4' }), '✳ Codex GPT-5.4');
  assert.equal(formatModelLabel({ provider: 'github-copilot', id: 'gpt-5.4' }), '✦ Copilot GPT-5.4');
});

test('formats reset countdown like claude statusline', () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);
  const resetAt = new Date(now + ((24 + 14) * 60 * 60 + 12 * 60) * 1000).toISOString();
  assert.equal(formatCountdown(resetAt, now), '1d 14h');
});

test('uses quota windows for claude and codex when available', () => {
  const items = buildPrimaryItems({
    model: { provider: 'anthropic', id: 'claude-opus-5' },
    thinkingLevel: 'high',
    contextPct: 23,
    sessionCostText: '$1.24',
    quota: {
      fiveHourPct: 31,
      sevenDayPct: 72,
      resetText: '1d 14h',
    },
  });

  assert.deepEqual(
    items.map((item) => item.key),
    ['model', 'thinking', 'context', 'fiveHour', 'sevenDay', 'reset'],
  );
  assert.equal(items[1].text, '⚡ high');
  assert.equal(items[2].text, '🧠 Ctx ██░░░░░░ 23%');
  assert.equal(items[3].text, '⏱ 5h ██░░░░░░ 31%');
  assert.equal(items[4].text, '◷ 7d ██████░░ 72%');
});

test('normalizes provider response headers into session and weekly quota percentages', () => {
  const { normalizeHeaderQuota } = require('../quota.js');
  const quota = normalizeHeaderQuota({
    'anthropic-ratelimit-unified-5h-utilization': '0.31',
    'anthropic-ratelimit-unified-7d-utilization': '0.72',
    'anthropic-ratelimit-unified-7d-reset': '2026-09-24T02:00:00Z',
  }, Date.UTC(2026, 8, 22, 12, 0, 0));

  assert.deepEqual(quota, {
    fiveHourPct: 31,
    sevenDayPct: 72,
    resetText: '1d 14h',
    resetAtMs: Date.UTC(2026, 8, 24, 2, 0, 0),
    fiveHourResetAtMs: null,
  });
});

test('normalizes Codex WHAM usage windows into statusline quota percentages', () => {
  const { normalizeCodexUsage } = require('../quota.js');
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);
  const quota = normalizeCodexUsage({
    rate_limit: {
      primary_window: {
        used_percent: 31,
        limit_window_seconds: 18_000,
        reset_at: Math.floor((now + 2 * 60 * 60) / 1000),
      },
      secondary_window: {
        used_percent: 72,
        limit_window_seconds: 604_800,
        reset_at: Math.floor((now + ((24 + 14) * 60 * 60 + 12 * 60) * 1000) / 1000),
      },
    },
  }, now);

  assert.deepEqual(quota, {
    fiveHourPct: 31,
    sevenDayPct: 72,
    resetText: '1d 14h',
    resetAtMs: now + ((24 + 14) * 60 * 60 + 12 * 60) * 1000,
    fiveHourResetAtMs: Math.floor((now + 2 * 60 * 60) / 1000) * 1000, // fixture passes reset_at in seconds
  });
});

test('uses cost for copilot instead of quota windows', () => {
  const items = buildPrimaryItems({
    model: { provider: 'github-copilot', id: 'gpt-5.4' },
    thinkingLevel: 'high',
    contextPct: 23,
    sessionCostText: '$0.48',
    quota: {
      fiveHourPct: 31,
      sevenDayPct: 72,
      resetText: '1d 14h',
    },
  });

  assert.deepEqual(
    items.map((item) => item.key),
    ['model', 'thinking', 'context', 'cost'],
  );
  assert.equal(items[3].text, '💰 Cost $0.48');
});

test('formats an open pull request for the secondary statusline', () => {
  const { formatPullRequestLabel, normalizePullRequest } = require('../git.js');
  const pullRequest = normalizePullRequest({
    number: 42,
    title: 'Show branch metadata',
    url: 'https://github.com/example/repo/pull/42',
    state: 'OPEN',
  });

  assert.deepEqual(pullRequest, {
    number: 42,
    title: 'Show branch metadata',
    url: 'https://github.com/example/repo/pull/42',
  });
  assert.equal(formatPullRequestLabel(pullRequest), '↗ PR #42 Show branch metadata');
  assert.equal(normalizePullRequest({ number: 43, title: 'Closed', state: 'CLOSED' }), null);
});

test('segment toggles hide symbol, context bar, quota and cost', () => {
  const model = { provider: 'anthropic', id: 'claude-opus-4-5' };
  const quota = { fiveHourPct: 10, sevenDayPct: 20, resetText: '1d 1h' };
  const keys = (show) => buildPrimaryItems({ model, thinkingLevel: 'high', contextPct: 5, sessionCostText: '$1.00', quota, show }).map((i) => i.key);

  assert.deepEqual(keys({}), ['model', 'thinking', 'context', 'fiveHour', 'sevenDay', 'reset']);
  assert.deepEqual(keys({ contextBar: false }), ['model', 'thinking', 'fiveHour', 'sevenDay', 'reset']);
  assert.deepEqual(keys({ quota: false }), ['model', 'thinking', 'context', 'cost']);
  assert.deepEqual(keys({ quota: false, cost: false }), ['model', 'thinking', 'context']);
  assert.equal(formatModelLabel(model, { symbol: false }), 'Claude Opus 4.5');
  assert.equal(formatModelLabel(model), '◉ Claude Opus 4.5');
  assert.equal(formatModelLabel({ provider: 'openai-codex', id: 'gpt-5' }, { symbol: false }), 'Codex GPT-5');
});

test('refuses to send the Codex token to a non-https remote URL', () => {
  const { isSafeUsageUrl } = require('../quota.js');
  assert.equal(isSafeUsageUrl('https://chatgpt.com/backend-api/wham/usage'), true);
  assert.equal(isSafeUsageUrl('http://127.0.0.1:8080/usage'), true);
  assert.equal(isSafeUsageUrl('http://remote.example/usage'), false);
  assert.equal(isSafeUsageUrl('not a url'), false);
});

test('async quota snapshot returns null when the JSON file is missing', async () => {
  const { loadQuotaSnapshotAsync } = require('../quota.js');
  const prev = process.env.PI_STATUSLINE_CLAUDE_USAGE_FILE;
  process.env.PI_STATUSLINE_CLAUDE_USAGE_FILE = '/nonexistent/claude.json';
  try {
    assert.equal(await loadQuotaSnapshotAsync('claude'), null);
  } finally {
    if (prev === undefined) delete process.env.PI_STATUSLINE_CLAUDE_USAGE_FILE;
    else process.env.PI_STATUSLINE_CLAUDE_USAGE_FILE = prev;
  }
});

test('fitPrimaryItems degrades by priority and never exceeds the width', () => {
  const measure = (t) => [...t].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x1f300 ? 2 : 1), 0);
  const args = {
    model: { provider: 'openai-codex', id: 'demo', name: 'Demo Model' },
    thinkingLevel: 'medium',
    contextPct: 42,
    quota: { fiveHourPct: 31, sevenDayPct: 72, resetText: '1d 14h' },
  };
  const total = (items) => items.reduce((n, i) => n + measure(i.text), 0) + 3 * (items.length - 1);
  const keys = (w) => fitPrimaryItems(args, w, { measure }).map((i) => i.key);
  const bars = (items, k) => items.find((i) => i.key === k).text.match(/[█░]/g)?.length ?? 0;
  assert.equal(bars(fitPrimaryItems(args, 500, { measure }), 'context'), 8);
  const w1 = total(buildPrimaryItems({ ...args, level: 1 }));
  const mid = fitPrimaryItems(args, w1, { measure });
  assert.equal(bars(mid, 'fiveHour'), 4);
  assert.deepEqual(mid.map((i) => i.key), ['model', 'thinking', 'context', 'fiveHour', 'sevenDay', 'reset']);
  const w2 = total(buildPrimaryItems({ ...args, level: 2 }));
  assert.deepEqual(keys(w2), ['model', 'thinking', 'context', 'fiveHour', 'sevenDay', 'reset']);
  assert.equal(bars(fitPrimaryItems(args, w2, { measure }), 'context'), 0);
  // below that: 7d is dropped first, the reset countdown outlives thinking
  assert.ok(!keys(w2 - 1).includes('sevenDay') && keys(w2 - 1).includes('reset'));
  for (const w of [100, 80, 60, 40]) {
    const items = fitPrimaryItems(args, w, { measure });
    assert.ok(total(items) <= w || items.length === 1, `w=${w}`);
    assert.equal(items[0].key, 'model');
  }
  assert.ok(keys(100).includes('reset'));
});

test('reset countdowns are recomputed at render time and the 5h window gets its own', () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);
  const quota = { fiveHourPct: 31, sevenDayPct: 72, resetText: 'stale', resetAtMs: now + 26 * 3600 * 1000, fiveHourResetAtMs: now + 135 * 60 * 1000 };
  const model = { provider: 'anthropic', id: 'claude-opus-4-5' };
  const items = buildPrimaryItems({ model, thinkingLevel: 'high', contextPct: 5, quota, nowMs: now });
  assert.equal(items.find((i) => i.key === 'reset').text, '↻ 1d 2h');
  assert.equal(items.find((i) => i.key === 'fiveHourReset').text, '5h ↻ 2h 15m');
  // No timestamp: fall back to the cached text, and no 5h countdown.
  const old = buildPrimaryItems({ model, thinkingLevel: 'high', contextPct: 5, quota: { fiveHourPct: 1, resetText: '3h 00m' }, nowMs: now });
  assert.equal(old.find((i) => i.key === 'reset').text, '↻ 3h 00m');
  assert.equal(old.find((i) => i.key === 'fiveHourReset'), undefined);
});

test('cache hit segment appears when known and obeys its toggle', () => {
  const args = { model: { provider: 'github-copilot', id: 'gpt-5.4' }, thinkingLevel: 'high', contextPct: 5, cacheHitPct: 86.6 };
  assert.equal(buildPrimaryItems(args).find((i) => i.key === 'cacheHit').text, '⚡ Cache 87%');
  assert.equal(buildPrimaryItems({ ...args, show: { cacheHit: false } }).find((i) => i.key === 'cacheHit'), undefined);
  assert.equal(buildPrimaryItems({ ...args, cacheHitPct: null }).find((i) => i.key === 'cacheHit'), undefined);
});

test('a budget keeps the cost segment next to quota bars and carries its level', () => {
  const model = { provider: 'anthropic', id: 'claude-opus-4-5' };
  const quota = { fiveHourPct: 10, sevenDayPct: 20, resetText: '1d 1h' };
  const base = { model, thinkingLevel: 'high', contextPct: 5, sessionCostText: '$0.90', quota };
  assert.equal(buildPrimaryItems(base).some((i) => i.key === 'cost'), false);
  const cost = buildPrimaryItems({ ...base, sessionCostLevel: 'warn' }).find((i) => i.key === 'cost');
  assert.equal(cost.level, 'warn');
  assert.equal(buildPrimaryItems({ ...base, sessionCostLevel: 'warn', show: { cost: false } }).some((i) => i.key === 'cost'), false);
});
