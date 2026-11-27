const path = require('node:path');
const os = require('node:os');

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function roundPercent(value) {
  return Math.round(clampPercent(Number(value) || 0));
}

function makeBar(value, width = 8) {
  const pct = roundPercent(value);
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function getProviderKind(model) {
  const provider = String(model?.provider || '').toLowerCase();
  if (provider === 'anthropic' || provider === 'ant-ling') return 'claude';
  if (provider === 'openai-codex') return 'codex';
  if (provider === 'github-copilot') return 'copilot';
  return 'generic';
}

function prettifyModelId(modelId) {
  const value = String(modelId || '').replace(/^models\//, '');
  if (!value) return 'Model';
  if (/^gpt-/i.test(value)) return value.replace(/^gpt-/i, 'GPT-');
  if (/^o[1-9]/i.test(value)) return value.toUpperCase();
  return value
    .split(/[-_]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function formatClaudeLabel(raw) {
  const value = String(raw || '').replace(/^models\//, '');
  const match = value.match(/claude-(opus|sonnet|haiku)-(.+)$/i);
  if (!match) return prettifyModelId(value.replace(/^claude-/i, ''));
  const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  const version = match[2].replace(/-/g, '.');
  return `${family} ${version}`;
}

function formatModelLabel(model, { symbol = true } = {}) {
  const kind = getProviderKind(model);
  const source = model?.name || model?.id || '';
  const glyph = { claude: '◉', codex: '✳', copilot: '✦', generic: '◆' }[kind];
  const mark = symbol ? `${glyph} ` : '';
  if (kind === 'claude') return `${mark}Claude ${formatClaudeLabel(source)}`;
  const pretty = prettifyModelId(source);
  if (kind === 'codex') return `${mark}Codex ${pretty}`;
  if (kind === 'copilot') return `${mark}Copilot ${pretty}`;
  return `${mark}${pretty}`;
}

function formatCountdown(resetAt, nowMs = Date.now()) {
  if (!resetAt) return '';
  const resetMs = new Date(resetAt).getTime();
  if (!Number.isFinite(resetMs)) return '';
  const totalSeconds = Math.max(0, Math.floor((resetMs - nowMs) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

// Countdown recomputed at render time from the reset timestamp (the cached text goes stale between refreshes).
function liveCountdown(resetAtMs, fallback, nowMs) {
  if (Number.isFinite(resetAtMs)) return formatCountdown(resetAtMs, nowMs);
  return fallback || '';
}

function buildPrimaryItems({ model, thinkingLevel, contextPct, sessionCostText, sessionCostLevel = null, cacheHitPct = null, quota, show = {}, level = 0, nowMs = Date.now() }) {
  // level 0: 8-cell bars; 1: 4-cell bars; 2: no bars ("Ctx 42%")
  const kind = getProviderKind(model);
  const { providerSymbol = true, contextBar = true, quota: showQuota = true, cost: showCost = true, cacheHit: showCacheHit = true } = show;
  const bar = (pct) => (level >= 2 ? '' : `${makeBar(pct, level === 1 ? 4 : 8)} `);
  const items = [
    { key: 'model', text: formatModelLabel(model, { symbol: providerSymbol }) },
    { key: 'thinking', text: `⚡ ${thinkingLevel || 'off'}` },
  ];
  if (contextBar) {
    items.push({ key: 'context', text: `🧠 Ctx ${bar(contextPct)}${roundPercent(contextPct)}%`, pct: roundPercent(contextPct) });
  }

  if (showCacheHit && Number.isFinite(cacheHitPct)) {
    items.push({ key: 'cacheHit', text: `⚡ Cache ${roundPercent(cacheHitPct)}%` });
  }

  // The budget makes cost worth showing next to the quota bars too.
  const costItem = () => ({ key: 'cost', text: `💰 Cost ${sessionCostText}`, level: sessionCostLevel });
  const showBudgetCost = showCost && sessionCostText && sessionCostLevel;

  const hasQuota = showQuota && quota && (Number.isFinite(quota.fiveHourPct) || Number.isFinite(quota.sevenDayPct) || quota.resetText);
  if ((kind === 'claude' || kind === 'codex') && hasQuota) {
    if (Number.isFinite(quota.fiveHourPct)) {
      items.push({
        key: 'fiveHour',
        text: `⏱ 5h ${bar(quota.fiveHourPct)}${roundPercent(quota.fiveHourPct)}%`,
        pct: roundPercent(quota.fiveHourPct),
      });
    }
    if (Number.isFinite(quota.sevenDayPct)) {
      items.push({
        key: 'sevenDay',
        text: `◷ 7d ${bar(quota.sevenDayPct)}${roundPercent(quota.sevenDayPct)}%`,
        pct: roundPercent(quota.sevenDayPct),
      });
    }
    const fiveReset = liveCountdown(quota.fiveHourResetAtMs, '', nowMs);
    if (Number.isFinite(quota.fiveHourPct) && fiveReset) {
      items.push({ key: 'fiveHourReset', text: level >= 2 ? `↻5h ${fiveReset}` : `5h ↻ ${fiveReset}` });
    }
    const reset = liveCountdown(quota.resetAtMs, quota.resetText, nowMs);
    if (reset) {
      items.push({ key: 'reset', text: level >= 2 ? `↻${reset}` : `↻ ${reset}` });
    }
    if (showBudgetCost) items.push(costItem());
    return items;
  }

  if (showCost && sessionCostText) {
    items.push(costItem());
  }

  return items;
}

// Drop order when even the compact form does not fit: first in the list goes first.
const DROP_ORDER = ['cost', 'cacheHit', 'sevenDay', 'fiveHourReset', 'thinking', 'reset', 'fiveHour', 'context', 'model'];

// Fit the primary line into `width` by degrading gracefully: shrink bars (8 -> 4 -> none), then drop the
// lowest-priority items (cost, 7d, thinking level, ...) so the model, context, 5h and reset survive longest.
// Returns the items to render; the caller joins them with a separator of `sepWidth` cells.
function fitPrimaryItems(args, width, { sepWidth = 3, measure = (t) => [...t].length } = {}) {
  const total = (items) => items.reduce((n, it) => n + measure(it.text), 0) + sepWidth * Math.max(0, items.length - 1);
  let items = [];
  for (const level of [0, 1, 2]) {
    items = buildPrimaryItems({ ...args, level });
    if (total(items) <= width) return items;
  }
  for (const key of DROP_ORDER) {
    if (items.length <= 1) break;
    items = items.filter((it) => it.key !== key);
    if (total(items) <= width) return items;
  }
  return items;
}

function formatWorkspacePath(cwd) {
  if (!cwd) return '';
  const home = os.homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(`${home}${path.sep}`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

module.exports = {
  clampPercent,
  roundPercent,
  makeBar,
  getProviderKind,
  formatModelLabel,
  formatCountdown,
  buildPrimaryItems,
  fitPrimaryItems,
  formatWorkspacePath,
};
