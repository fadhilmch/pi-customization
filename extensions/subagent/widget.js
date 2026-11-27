'use strict';
// Live widget: one row per running child (name, tool count, cost so far). No Pi imports.
const { COLORS, fg, bold, dim, truncate } = require('./ansi.js');
const { formatCost } = require('./output.js');

const MAX_ROWS = 6;

// Latest runs per source (a foreground call's tool call id or a background run id).
function createLiveRuns(onChange = () => {}) {
  const sources = new Map();
  return {
    set(key, runs) {
      sources.set(key, runs || []);
      onChange();
    },
    delete(key) {
      if (sources.delete(key)) onChange();
    },
    clear() {
      sources.clear();
    },
    running: () => [...sources.values()].flat().filter((r) => r && r.status === 'running'),
  };
}

function widgetLines(runs, { width = 80, max = MAX_ROWS } = {}) {
  if (!runs.length) return [];
  const rows = runs.slice(0, max).map((r) => {
    const parts = [`${fg(COLORS.accent, '◌')} ${bold(r.agent)}`, `${r.toolCount || 0} tool${r.toolCount === 1 ? '' : 's'}`];
    const cost = formatCost(r.usage?.cost);
    if (cost) parts.push(cost);
    return truncate(parts.join(dim(' · ')), width);
  });
  if (runs.length > max) rows.push(dim(`+${runs.length - max} more`));
  return [truncate(dim(`subagents running (${runs.length})`), width), ...rows];
}

module.exports = { MAX_ROWS, createLiveRuns, widgetLines };
