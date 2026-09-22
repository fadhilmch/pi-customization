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

function getSessionCostText(ctx) {
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

  if (total > 0 || sawUsage) return formatUsd(total);
  if (sawUnknown) return '?';
  if (modelHasPricing(ctx.model)) return '$0.00';
  return '';
}

module.exports = {
  getSessionCostText,
};
