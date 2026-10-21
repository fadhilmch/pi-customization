'use strict';
// /cost report: spend on the current branch, per model, plus subagent children. No Pi imports.
const { fmt } = require('./context.js');

const emptyU = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 });
const add = (t, u, cost, countTurn = true) => {
  t.input += u.input || 0;
  t.output += u.output || 0;
  t.cacheRead += u.cacheRead || 0;
  t.cacheWrite += u.cacheWrite || 0;
  t.cost += cost || 0;
  if (countTurn) t.turns++;
};

// Walks the whole branch (compaction does not erase spend already made).
function aggregate(branch) {
  const models = new Map();
  const subagents = new Map();
  for (const e of branch) {
    if ((e.type === 'compaction' || e.type === 'branch_summary') && e.usage) {
      const key = e.type === 'compaction' ? '(compaction)' : '(branch summary)';
      const t = models.get(key) || emptyU();
      add(t, e.usage, e.usage.cost?.total);
      models.set(key, t);
      continue;
    }
    if (e.type === 'usage' && e.usage) {
      // Out-of-band spend such as a cache warm-up: billed to its model, but not a conversation turn.
      const key = e.provider && e.model ? `${e.provider}/${e.model}` : e.model || `(${e.kind || 'usage'})`;
      const t = models.get(key) || emptyU();
      add(t, e.usage, e.usage.cost?.total, false);
      models.set(key, t);
      continue;
    }
    if (e.type !== 'message') continue;
    const m = e.message;
    if (m.role === 'assistant' && m.usage) {
      const key = m.provider && m.model ? `${m.provider}/${m.model}` : m.model || 'unknown';
      const t = models.get(key) || emptyU();
      add(t, m.usage, m.usage.cost?.total);
      models.set(key, t);
    } else if (m.role === 'toolResult' && m.toolName === 'subagent') {
      for (const r of m.details?.runs || []) {
        if (!r.usage) continue;
        const key = `${r.agent || 'agent'}${r.model ? ` (${r.model})` : ''}`;
        const t = subagents.get(key) || emptyU();
        add(t, r.usage, r.usage.cost);
        subagents.set(key, t);
      }
    }
  }
  const sum = (map) => [...map.values()].reduce((a, t) => ({ input: a.input + t.input, output: a.output + t.output, cacheRead: a.cacheRead + t.cacheRead, cacheWrite: a.cacheWrite + t.cacheWrite, cost: a.cost + t.cost, turns: a.turns + t.turns }), emptyU());
  return {
    models: [...models].map(([name, u]) => ({ name, ...u })).sort((a, b) => b.cost - a.cost),
    subagents: [...subagents].map(([name, u]) => ({ name, ...u })).sort((a, b) => b.cost - a.cost),
    main: sum(models),
    sub: sum(subagents),
  };
}

const money = (n) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(n < 1 ? 3 : 2)}`;

function formatCost(r) {
  if (!r.models.length && !r.subagents.length) return 'No usage recorded on this branch yet.';
  const out = [];
  const line = (name, t, label) => out.push(`${name.padEnd(34)} ${money(t.cost).padStart(8)}  ↑${fmt(t.input)} ↓${fmt(t.output)} R${fmt(t.cacheRead)} W${fmt(t.cacheWrite)}${label ? `  ${t.turns} ${label}${t.turns === 1 ? '' : 's'}` : ''}`);
  out.push('Session cost (current branch)', '');
  for (const m of r.models) line(m.name.length > 34 ? `…${m.name.slice(-33)}` : m.name, m, 'turn');
  if (r.models.length > 1) line('Main agent total', r.main);
  if (r.subagents.length) {
    out.push('', 'Subagents (children are separate pi processes)');
    for (const s of r.subagents) line(s.name.length > 34 ? `…${s.name.slice(-33)}` : s.name, s, 'run');
    line('Subagent total', r.sub);
  }
  const total = r.main.cost + r.sub.cost;
  out.push('', `Total ${money(total)}   ↑ input  ↓ output  R cache read  W cache write`);
  if (total === 0) out.push('Costs are $0: the model may have no pricing configured (local/free models).');
  return out.join('\n');
}

module.exports = { aggregate, formatCost, money };
