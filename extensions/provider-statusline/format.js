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

function formatModelLabel(model) {
  const kind = getProviderKind(model);
  const source = model?.name || model?.id || '';
  const mark = { claude: '◉', codex: '✳', copilot: '✦', generic: '◆' }[kind];
  if (kind === 'claude') return `${mark} Claude ${formatClaudeLabel(source)}`;
  const pretty = prettifyModelId(source);
  if (kind === 'codex') return `${mark} Codex ${pretty}`;
  if (kind === 'copilot') return `${mark} Copilot ${pretty}`;
  return `${mark} ${pretty}`;
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

function buildPrimaryItems({ model, thinkingLevel, contextPct, sessionCostText, quota }) {
  const kind = getProviderKind(model);
  const items = [
    { key: 'model', text: formatModelLabel(model) },
    { key: 'thinking', text: `⚡ ${thinkingLevel || 'off'}` },
    { key: 'context', text: `🧠 Ctx ${makeBar(contextPct, 8)} ${roundPercent(contextPct)}%`, pct: roundPercent(contextPct) },
  ];

  const hasQuota = quota && (Number.isFinite(quota.fiveHourPct) || Number.isFinite(quota.sevenDayPct) || quota.resetText);
  if ((kind === 'claude' || kind === 'codex') && hasQuota) {
    if (Number.isFinite(quota.fiveHourPct)) {
      items.push({
        key: 'fiveHour',
        text: `⏱ 5h ${makeBar(quota.fiveHourPct, 8)} ${roundPercent(quota.fiveHourPct)}%`,
        pct: roundPercent(quota.fiveHourPct),
      });
    }
    if (Number.isFinite(quota.sevenDayPct)) {
      items.push({
        key: 'sevenDay',
        text: `◷ 7d ${makeBar(quota.sevenDayPct, 8)} ${roundPercent(quota.sevenDayPct)}%`,
        pct: roundPercent(quota.sevenDayPct),
      });
    }
    if (quota.resetText) {
      items.push({ key: 'reset', text: `↻ ${quota.resetText}` });
    }
    return items;
  }

  if (sessionCostText) {
    items.push({ key: 'cost', text: `💰 Cost ${sessionCostText}` });
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
  formatWorkspacePath,
};
