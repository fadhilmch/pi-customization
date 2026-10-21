'use strict';
// /agents panel: one block per agent (effective model, thinking, tools, description) in a rounded frame.
// Pure: (data, width) -> string[]. The frame and wrap helpers are copied from usage-report/panel.js.
const os = require('node:os');
const { COLORS, fg, bold, dim, visibleWidth, truncate } = require('./ansi.js');

const MAX_WIDTH = 84;
const SOURCE_COLORS = { bundled: COLORS.muted, user: COLORS.accent, project: '#e5a550' };

const tilde = (p, home = os.homedir()) => (p && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - visibleWidth(s)));

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

function frame(title, rows, width, hint = 'esc close') {
  const w = Math.max(24, Math.min(width, MAX_WIDTH));
  const inner = w - 4;
  const top = `${dim('╭─ ')}${bold(title)}${dim(` ${'─'.repeat(Math.max(0, w - visibleWidth(title) - 5))}╮`)}`;
  const bottom = dim(`╰${'─'.repeat(Math.max(0, w - visibleWidth(hint) - 5))} ${hint} ─╯`);
  const body = rows.map((r) => `${dim('│')} ${pad(truncate(r, inner), inner)} ${dim('│')}`);
  return [top, ...body, bottom];
}

// data: { agents (after config overrides), errors, projectSkipped, projectDir, configFile, userDir }
function agentsPanel(data, width) {
  const inner = Math.max(24, Math.min(width, MAX_WIDTH)) - 4;
  const out = [];
  const agents = data.agents || [];
  if (!agents.length) out.push(dim('No subagents found.'));
  agents.forEach((a, i) => {
    if (i) out.push('');
    const color = SOURCE_COLORS[a.source] || COLORS.muted;
    const model = `${a.model || dim('inherits session model')}${a.thinking ? ` ${dim('·')} thinking ${a.thinking}` : ''}`;
    out.push(`${fg(color, '■')} ${pad(bold(a.name), 12)} ${pad(fg(color, a.source), 8)} ${model}`);
    const exts = (a.extensions || []).map((e) => e.replace(/\?$/, ''));
    out.push(`  ${dim('tools')} ${a.tools.length ? a.tools.join(', ') : 'default'}`);
    if (exts.length) out.push(`  ${dim('loads')} ${exts.join(', ')}`);
    for (const l of wrap(a.description, inner - 2)) out.push(`  ${dim(l)}`);
  });
  const notes = [];
  if (data.projectSkipped) notes.push(`Project agents in ${data.projectDir} are not loaded: the project is not trusted.`);
  for (const e of data.errors || []) notes.push(`! ${e}`);
  if (notes.length) {
    out.push('');
    for (const n of notes) for (const [i, l] of wrap(n, inner - 2).entries()) out.push(i === 0 ? `${fg('#e5c07b', '›')} ${l}` : `  ${l}`);
  }
  out.push('');
  const footer = `Add agents in ${tilde(data.userDir) || '~/.pi/agent/agents'} or .pi/agents. Pin models in ${tilde(data.configFile) || '~/.pi/agent/subagent.json'}.`;
  for (const l of wrap(footer, inner)) out.push(dim(l));
  return frame('Subagents', out, width);
}

module.exports = { MAX_WIDTH, wrap, frame, agentsPanel };
