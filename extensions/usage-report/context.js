'use strict';
// /context report: where the context window goes. Sizes are chars/4 estimates; only `real` comes from the provider.
const { estimateTokens, summarizeMessages } = require('./messages.js');

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pct = (n, of) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : '-');

function toolTokens(t) {
  let params = '';
  try {
    params = JSON.stringify(t.parameters ?? {});
  } catch {}
  return estimateTokens((t.name || '').length + (t.description || '').length + params.length);
}

// input: { systemPrompt, contextFiles:[{path,content}], skills:[{name,description}], tools:[ToolInfo] (active only),
//          messages, usage: {tokens,contextWindow,percent}|undefined, model? }
function buildContext(input) {
  const systemTokens = estimateTokens((input.systemPrompt || '').length);
  const files = (input.contextFiles || []).map((f) => ({ path: f.path, tokens: estimateTokens((f.content || '').length) }));
  const skills = input.skills || [];
  const skillTokens = estimateTokens(skills.reduce((n, s) => n + (s.name || '').length + (s.description || '').length + 40, 0));
  const tools = (input.tools || []).map((t) => ({ name: t.name, tokens: toolTokens(t) })).sort((a, b) => b.tokens - a.tokens);
  const toolsTotal = tools.reduce((n, t) => n + t.tokens, 0);
  const { totals, biggest } = summarizeMessages(input.messages || []);
  const msgTotal = Object.values(totals).reduce((n, t) => n + t.tokens, 0);
  const estimated = systemTokens + toolsTotal + msgTotal;
  return { systemTokens, files, skills: { count: skills.length, tokens: skillTokens }, tools, toolsTotal, totals, msgTotal, biggest, estimated, usage: input.usage };
}

function formatContext(r, { maxTools = 6 } = {}) {
  const win = r.usage?.contextWindow || 0;
  const out = [];
  if (r.usage?.tokens != null) out.push(`Context: ${fmt(r.usage.tokens)} used of ${fmt(win)} (${r.usage.percent != null ? r.usage.percent.toFixed(1) + '%' : pct(r.usage.tokens, win)}), as reported by the provider`);
  else out.push(`Context: size unknown until the next response${win ? ` (window ${fmt(win)})` : ''}`);
  out.push(`Estimated below (chars/4, rough): ~${fmt(r.estimated)} tokens`);
  out.push('');
  const row = (label, n, indent = '') => out.push(`${indent}${label.padEnd(28 - indent.length)} ~${fmt(n).padStart(6)}  ${pct(n, r.estimated).padStart(6)}`);
  row('System prompt', r.systemTokens);
  for (const f of r.files) row(f.path.length > 24 ? `…${f.path.slice(-23)}` : f.path, f.tokens, '  ');
  if (r.skills.count) row(`${r.skills.count} skill listing${r.skills.count === 1 ? '' : 's'}`, r.skills.tokens, '  ');
  row(`Tool definitions (${r.tools.length})`, r.toolsTotal);
  for (const t of r.tools.slice(0, maxTools)) row(t.name, t.tokens, '  ');
  if (r.tools.length > maxTools) out.push(`  … ${r.tools.length - maxTools} more`);
  row('Messages', r.msgTotal);
  const t = r.totals;
  row(`user (${t.user.count})`, t.user.tokens, '  ');
  row(`assistant (${t.assistant.count})`, t.assistant.tokens, '  ');
  row(`tool results (${t.toolResult.count})`, t.toolResult.tokens, '  ');
  if (t.other.count) row(`other (${t.other.count})`, t.other.tokens, '  ');
  if (r.biggest.length) {
    out.push('', 'Biggest tool results:');
    for (const b of r.biggest) out.push(`  ~${fmt(b.tokens).padStart(6)}  ${b.tool}${b.what ? ` ${b.what}` : ''}`);
  }
  out.push('');
  out.push('System prompt rows are part of the system prompt total, not extra. Skills and context files are listed only when Pi exposes them.');
  if (r.msgTotal > 0 && r.totals.toolResult.tokens / r.msgTotal > 0.5) out.push('Tool results are over half of the messages: consider /compact, /handoff, or narrower reads (the scout subagent keeps big reads out of this context).');
  return out.join('\n');
}

module.exports = { buildContext, formatContext, fmt };
