function hasTokenUsage(usage) {
  return !!usage && ((usage.input || 0) > 0 || (usage.output || 0) > 0 || (usage.cacheRead || 0) > 0 || (usage.cacheWrite || 0) > 0);
}

function modelHasPricing(model) {
  const cost = model?.cost;
  return !!cost && [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].some((value) => Number(value) > 0);
}

function normalizeId(id) {
  return String(id || '').replace(/^models\//, '');
}

function matchesCurrentModel(message, model) {
  if (!message?.model || !model?.id) return false;
  if (normalizeId(message.model) !== normalizeId(model.id)) return false;
  if (message.provider && model.provider) return String(message.provider).toLowerCase() === String(model.provider).toLowerCase();
  return true;
}

function calculateCost(usage, model) {
  if (!usage || !modelHasPricing(model)) return 0;
  const cost = model.cost;
  return ((Number(cost.input) || 0) * (Number(usage.input) || 0) +
    (Number(cost.output) || 0) * (Number(usage.output) || 0) +
    (Number(cost.cacheRead) || 0) * (Number(usage.cacheRead) || 0) +
    (Number(cost.cacheWrite) || 0) * (Number(usage.cacheWrite) || 0)) / 1_000_000;
}

function formatUsd(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

// { text, total }: the footer text and the numeric spend it is based on (for budget colouring).
function getSessionCostInfo(ctx) {
  let total = 0;
  let sawUsage = false;
  let sawUnknown = false;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role !== 'assistant' || !message.usage) continue;

    sawUsage = true;
    const reported = Number(message.usage.cost?.total || 0);
    if (reported > 0) {
      total += reported;
      continue;
    }

    if (matchesCurrentModel(message, ctx.model) && modelHasPricing(ctx.model)) {
      total += calculateCost(message.usage, ctx.model);
      continue;
    }

    if (hasTokenUsage(message.usage)) sawUnknown = true;
  }

  if (total > 0 || sawUsage) return { text: formatUsd(total), total };
  if (sawUnknown) return { text: '?', total };
  if (modelHasPricing(ctx.model)) return { text: '$0.00', total };
  return { text: '', total };
}

function getSessionCostText(ctx) {
  return getSessionCostInfo(ctx).text;
}

// Share of input tokens served from the prompt cache over the session: cacheRead / (input + cacheRead + cacheWrite).
// null when nothing was cached or sent yet, or when the provider never reports cache usage.
function getCacheHitPct(ctx) {
  let reads = 0;
  let all = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role !== 'assistant' || !message.usage) continue;
    const u = message.usage;
    reads += Number(u.cacheRead) || 0;
    all += (Number(u.input) || 0) + (Number(u.cacheRead) || 0) + (Number(u.cacheWrite) || 0);
  }
  if (all <= 0 || reads <= 0) return null;
  return (reads / all) * 100;
}

// Cost segment colour level against a budget: 'ok' under 80%, 'warn' from 80%, 'error' from 100%.
function budgetLevel(total, budget) {
  if (!(budget > 0) || !Number.isFinite(total)) return null;
  const ratio = total / budget;
  return ratio >= 1 ? 'error' : ratio >= 0.8 ? 'warn' : 'ok';
}

module.exports = {
  getSessionCostText,
  getSessionCostInfo,
  getCacheHitPct,
  budgetLevel,
};
