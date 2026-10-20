'use strict';
const { COLORS, fg, bold, dim, visibleWidth, truncate } = require('./ansi.js');

// Rounded welcome box, Claude-Code style. Returns an array of lines (<= width cells each).
function renderHeader(width, { cwd = '', home = '' } = {}) {
  const boxW = Math.max(12, Math.min(width, 80));
  const inner = boxW - 2;
  const border = (s) => fg(COLORS.orange, s);
  const shownCwd = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const row = (content) => {
    const t = truncate(content, inner - 2);
    return `${border('│')} ${t}${' '.repeat(Math.max(0, inner - 2 - visibleWidth(t)))} ${border('│')}`;
  };
  return [
    border(`╭${'─'.repeat(inner)}╮`),
    row(`${fg(COLORS.orange, '✻')} ${bold('Welcome to Pi')}`),
    row(''),
    row(dim(`cwd: ${shownCwd}`)),
    border(`╰${'─'.repeat(inner)}╯`),
    '',
  ];
}

module.exports = { renderHeader };
