'use strict';
// Tiny ANSI helpers (24-bit colour). Pure, no dependencies. Same palette as claude-look/ansi.js (copied from subagent: extensions stay self-contained).
const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const COLORS = {
  accent: '#53e0e0',
  success: '#4eba65',
  error: '#ff6b80',
  dim: '#808080',
  muted: '#999999',
};

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const fg = (hex, s) => `${ESC}38;2;${rgb(hex).join(';')}m${s}${ESC}39m`;
const bold = (s) => `${ESC}1m${s}${ESC}22m`;
const strike = (s) => `${ESC}9m${s}${ESC}29m`;
const dim = (s) => fg(COLORS.dim, s);

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => String(s).replace(ANSI_RE, '');

function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff)
  ) return 2;
  return 1;
}

function visibleWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

// Truncate to at most `width` visible cells, keeping escape sequences intact.
function truncate(s, width, ellipsis = '…') {
  s = String(s).replace(/\t/g, '  ');
  if (visibleWidth(s) <= width) return s;
  const limit = Math.max(0, width - visibleWidth(ellipsis));
  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m && m.index === i) { out += m[0]; i += m[0].length; continue; }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (w + cw > limit) break;
    out += ch; w += cw; i += ch.length;
  }
  return `${out}${RESET}${ellipsis}`;
}

module.exports = { COLORS, RESET, fg, bold, strike, dim, stripAnsi, charWidth, visibleWidth, truncate };
