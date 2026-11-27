'use strict';
// Framed TUI panels for /context and /cost: a usage bar, per-category rows with bars, short tips.
// Pure: (report, width) -> string[] lines. index.ts shows them in an overlay; nothing reaches the model.
const { COLORS, fg, bold, dim, visibleWidth, truncate } = require('./ansi.js');
const { fmt } = require('./context.js');
const { money } = require('./cost.js');
const { formatHistory } = require('./history.js');

const PALETTE = {
  system: COLORS.accent,
  tools: '#c39ac9',
  user: '#6cb6ff',
  assistant: COLORS.success,
  toolResult: '#e5a550',
  other: COLORS.muted,
  main: COLORS.accent,
  sub: '#c39ac9',
  warn: '#e5c07b',
};
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const MAX_WIDTH = 84;
const LABEL = 24;

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - visibleWidth(s)));
const padStart = (s, w) => ' '.repeat(Math.max(0, w - visibleWidth(s))) + s;
const pct = (n, of) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : '');

// Smooth bar: `fraction` of `cells` filled with eighth-blocks, the rest as a dim track.
function bar(fraction, cells, color) {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const eighths = Math.round(f * cells * 8);
  const full = Math.floor(eighths / 8);
  const part = EIGHTHS[eighths % 8];
  const used = full + (part ? 1 : 0);
  return fg(color, '█'.repeat(full) + part) + dim('·'.repeat(Math.max(0, cells - used)));
}

// One bar split into coloured segments of a total. Cell edges come from cumulative rounding, so the bar stays
// proportional; with minCell every non-zero segment still gets one cell (for small splits such as cost).
function stackedBar(segments, total, cells, { minCell = false } = {}) {
  const live = segments.filter((s) => s.value > 0);
  if (!(total > 0) || !live.length) return dim('·'.repeat(cells));
  const sizes = [];
  let cum = 0;
  let prev = 0;
  for (const s of live) {
    cum += s.value;
    const edge = Math.min(cells, Math.round((cum / total) * cells));
    sizes.push(edge - prev);
    prev = edge;
  }
  if (minCell) {
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > 0) continue;
      const j = sizes.indexOf(Math.max(...sizes));
      if (sizes[j] > 1) {
        sizes[j]--;
        sizes[i] = 1;
      }
    }
  } else if (sizes.every((n) => n === 0)) {
    // Something is in use even if it rounds to nothing: show one cell for the largest part.
    const max = Math.max(...live.map((s) => s.value));
    sizes[live.findIndex((s) => s.value === max)] = 1;
  }
  const used = sizes.reduce((a, b) => a + b, 0);
  return live.map((s, i) => fg(s.color, '█'.repeat(sizes[i]))).join('') + dim('·'.repeat(Math.max(0, cells - used)));
}

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && visibleWidth(line) + 1 + visibleWidth(word) > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

// Rounded frame with the title in the top border and a dim hint in the bottom one.
function frame(title, rows, width, hint = 'esc close') {
  const w = Math.max(24, Math.min(width, MAX_WIDTH));
  const inner = w - 4;
  const top = `${dim('╭─ ')}${bold(title)}${dim(` ${'─'.repeat(Math.max(0, w - visibleWidth(title) - 5))}╮`)}`;
  const bottom = dim(`╰${'─'.repeat(Math.max(0, w - visibleWidth(hint) - 5))} ${hint} ─╯`);
  const body = rows.map((r) => `${dim('│')} ${pad(truncate(r, inner), inner)} ${dim('│')}`);
  return [top, ...body, bottom];
}

function innerWidth(width) {
  return Math.max(24, Math.min(width, MAX_WIDTH)) - 4;
}

// "■ Label          1.3k  53.5%  ████▌·····"
function row(color, label, tokens, total, inner, { indent = 0 } = {}) {
  const barCells = Math.max(6, inner - LABEL - 16);
  const glyph = indent ? '  ' : `${fg(color, '■')} `;
  const name = pad(truncate(`${' '.repeat(indent)}${label}`, LABEL - 2), LABEL - 2);
  const text = indent ? dim(name) : name;
  return `${glyph}${text}${padStart(fmt(tokens), 7)} ${dim(padStart(pct(tokens, total), 6))}  ${bar(total ? tokens / total : 0, barCells, indent ? COLORS.dim : color)}`;
}

// report: buildContext() output.
function contextPanel(r, width, { maxTools = 5 } = {}) {
  const inner = innerWidth(width);
  const out = [];
  const used = r.usage?.tokens;
  const win = r.usage?.contextWindow || 0;
  if (used != null && win) {
    out.push(`${bold(fmt(used))} of ${fmt(win)} tokens ${dim(`(${pct(used, win)}, reported by the provider)`)}`);
  } else {
    out.push(`${bold(`~${fmt(r.estimated)}`)} tokens ${dim(`(estimated; exact size after the next response${win ? `, window ${fmt(win)}` : ''})`)}`);
  }

  // Window bar: categories scaled to the real total when we have it, free space dotted.
  const scale = used != null && r.estimated > 0 ? used / r.estimated : 1;
  const t = r.totals;
  const segs = [
    { value: r.systemTokens * scale, color: PALETTE.system },
    { value: r.toolsTotal * scale, color: PALETTE.tools },
    { value: t.user.tokens * scale, color: PALETTE.user },
    { value: t.assistant.tokens * scale, color: PALETTE.assistant },
    { value: t.toolResult.tokens * scale, color: PALETTE.toolResult },
    { value: t.other.tokens * scale, color: PALETTE.other },
  ];
  out.push(stackedBar(segs, win || r.estimated, inner));
  out.push('');
  out.push(dim(`Breakdown (chars/4 estimates, ~${fmt(r.estimated)} total)`));

  const total = r.estimated;
  out.push(row(PALETTE.system, 'System prompt', r.systemTokens, total, inner));
  for (const f of r.files) out.push(row(PALETTE.system, f.path.length > 18 ? `…${f.path.slice(-17)}` : f.path, f.tokens, total, inner, { indent: 2 }));
  if (r.skills.count) out.push(row(PALETTE.system, `${r.skills.count} skill${r.skills.count === 1 ? '' : 's'}`, r.skills.tokens, total, inner, { indent: 2 }));
  out.push(row(PALETTE.tools, `Tools (${r.tools.length})`, r.toolsTotal, total, inner));
  for (const tool of r.tools.slice(0, maxTools)) out.push(row(PALETTE.tools, tool.name, tool.tokens, total, inner, { indent: 2 }));
  if (r.tools.length > maxTools) out.push(dim(`    … ${r.tools.length - maxTools} more`));
  out.push(row(PALETTE.user, `User (${t.user.count})`, t.user.tokens, total, inner));
  out.push(row(PALETTE.assistant, `Assistant (${t.assistant.count})`, t.assistant.tokens, total, inner));
  out.push(row(PALETTE.toolResult, `Tool results (${t.toolResult.count})`, t.toolResult.tokens, total, inner));
  if (t.other.count) out.push(row(PALETTE.other, `Other (${t.other.count})`, t.other.tokens, total, inner));

  if (r.biggest.length) {
    out.push('', bold('Biggest tool results'));
    for (const b of r.biggest) out.push(`  ${padStart(fmt(b.tokens), 6)}  ${b.tool}${b.what ? dim(` ${b.what}`) : ''}`);
  }

  const tips = [];
  if (r.msgTotal > 0 && t.toolResult.tokens / r.msgTotal > 0.5) tips.push('Tool results are over half of the conversation. /compact or /handoff frees them; narrower reads or a scout subagent keep them out.');
  if (win && used != null && used / win > 0.7) tips.push('Context is over 70% full; /compact or /handoff before the model starts losing detail.');
  if (r.toolsTotal > r.systemTokens && r.tools.length > 8) tips.push('Tool definitions outweigh the system prompt. Disable tools you do not use (--tools, defaultTools) or MCP servers.');
  if (tips.length) {
    out.push('');
    for (const tip of tips) for (const [i, l] of wrap(tip, inner - 2).entries()) out.push(i === 0 ? `${fg(PALETTE.warn, '›')} ${l}` : `  ${l}`);
  }
  return frame('Context', out, width);
}

function tokensLine(u, unit) {
  return dim(`↑${fmt(u.input)} ↓${fmt(u.output)} R${fmt(u.cacheRead)} W${fmt(u.cacheWrite)} · ${u.turns} ${unit}${u.turns === 1 ? '' : 's'}`);
}

// One spend row: "■ name   $0.015  28.0%  ███▌····" and a dim token line under it.
function spendRows(color, item, total, inner, unit) {
  const barCells = Math.max(6, inner - LABEL - 18);
  const name = pad(truncate(item.name, LABEL - 2), LABEL - 2);
  return [
    `${fg(color, '■')} ${name}${padStart(money(item.cost), 9)} ${dim(padStart(pct(item.cost, total), 6))}  ${bar(total ? item.cost / total : 0, barCells, color)}`,
    `  ${tokensLine(item, unit)}`,
  ];
}

// agg: aggregate() output.
function costPanel(agg, width) {
  const inner = innerWidth(width);
  if (!agg.models.length && !agg.subagents.length) return frame('Cost', [dim('No usage recorded on this branch yet.')], width);
  const total = agg.main.cost + agg.sub.cost;
  const out = [];
  out.push(`${bold(money(total))} this branch ${dim(agg.subagents.length ? `(main ${money(agg.main.cost)} · subagents ${money(agg.sub.cost)})` : '')}`);
  if (agg.subagents.length) out.push(stackedBar([{ value: agg.main.cost, color: PALETTE.main }, { value: agg.sub.cost, color: PALETTE.sub }], total, inner, { minCell: true }));
  out.push('');
  out.push(bold('Main agent'));
  for (const m of agg.models) out.push(...spendRows(PALETTE.main, m, total, inner, 'turn'));
  if (agg.subagents.length) {
    out.push('', `${bold('Subagents')} ${dim('(separate pi processes)')}`);
    for (const s of agg.subagents) out.push(...spendRows(PALETTE.sub, s, total, inner, 'run'));
  }

  // Cache reads are the cheap part of input; a low share on a long session means prompts are not being reused.
  const all = ['input', 'cacheRead', 'cacheWrite'].reduce((n, k) => n + agg.main[k] + agg.sub[k], 0);
  const reads = agg.main.cacheRead + agg.sub.cacheRead;
  out.push('');
  const barCells = Math.max(6, inner - LABEL - 18);
  out.push(`${fg(COLORS.success, '■')} ${pad('Cache reads', LABEL - 2)}${padStart(all ? pct(reads, all) : '-', 9)} ${' '.repeat(6)}  ${bar(all ? reads / all : 0, barCells, COLORS.success)}`);
  for (const l of wrap('Share of input tokens served from cache, billed at a fraction of the input price.', inner - 2)) out.push(`  ${dim(l)}`);
  if (total === 0) out.push(dim('All costs are $0: the model may have no pricing configured (local or free models).'));
  return frame('Cost', out, width);
}

// r: scanHistory() output. The overlay does not scroll, so the panel keeps only the newest rows (--json has all).
function historyPanel(r, width, { maxRows = 10 } = {}) {
  const title = r.period === 'monthly' ? 'Cost per month' : 'Cost per day';
  const lines = formatHistory(r, { maxRows }).split('\n');
  return frame(title, lines.slice(r.rows.length ? 2 : 0).map((l) => (/^\d{4}-\d{2}/.test(l) ? bold(l) : l)), width);
}

module.exports = { PALETTE, MAX_WIDTH, bar, stackedBar, wrap, frame, contextPanel, costPanel, historyPanel };
