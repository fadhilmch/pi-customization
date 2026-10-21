'use strict';
// Tiny ANSI helpers (24-bit colour). Pure, no dependencies.
const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const COLORS = {
  orange: '#d77757',
  spinner: '#53e0e0', // teal, so Pi's spinner is distinct from Claude Code's orange
  success: '#4eba65',
  error: '#ff6b80',
  dim: '#808080',
  muted: '#999999',
  text: '#ffffff',
  addBg: '#225c2b',
  remBg: '#7a2936',
};

function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const fg = (hex, s) => `${ESC}38;2;${rgb(hex).join(';')}m${s}${ESC}39m`;
const bg = (hex, s) => `${ESC}48;2;${rgb(hex).join(';')}m${s}${ESC}49m`;
const bold = (s) => `${ESC}1m${s}${ESC}22m`;
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

// Pad with spaces to exactly `width` visible cells (after truncating).
function padTo(s, width) {
  const t = truncate(s, width);
  return t + ' '.repeat(Math.max(0, width - visibleWidth(t)));
}

// Wrap one logical line into rows of at most `width` visible cells. Breaks at the last space when
// there is one (hard break otherwise), counts wide chars as 2 cells, and re-opens active SGR styling
// at the start of each continuation row. Returns at least one row.
function wrapAnsi(s, width) {
  s = String(s).replace(/\t/g, '  ');
  width = Math.max(1, width);
  if (visibleWidth(s) <= width) return [s];
  const items = [];
  let i = 0;
  while (i < s.length) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m && m.index === i) { items.push({ seq: m[0] }); i += m[0].length; continue; }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    items.push({ ch, w: charWidth(cp) });
    i += ch.length;
  }
  const rows = [];
  let cur = [];
  let curW = 0;
  const flush = (list) => rows.push(list);
  for (const it of items) {
    if (it.seq) { cur.push(it); continue; }
    if (curW + it.w > width) {
      let lastSpace = -1;
      for (let k = cur.length - 1; k >= 0; k--) if (cur[k].ch === ' ') { lastSpace = k; break; }
      const hasText = lastSpace > 0 && cur.slice(0, lastSpace).some((x) => x.ch && x.ch !== ' ');
      if (it.ch !== ' ' && hasText) {
        flush(cur.slice(0, lastSpace));
        cur = cur.slice(lastSpace + 1);
        curW = cur.reduce((a, x) => a + (x.w || 0), 0);
      } else {
        flush(cur);
        cur = [];
        curW = 0;
      }
      if (it.ch === ' ' && curW === 0) continue; // swallow the space at a break
    }
    cur.push(it);
    curW += it.w;
  }
  flush(cur);
  // Re-render, carrying styling across rows.
  let active = [];
  return rows.map((row) => {
    let out = active.join('');
    for (const it of row) {
      if (it.seq) {
        if (it.seq === RESET) active = [];
        else active.push(it.seq);
        out += it.seq;
      } else out += it.ch;
    }
    return active.length ? out + RESET : out;
  });
}

module.exports = { COLORS, RESET, fg, bg, bold, dim, stripAnsi, visibleWidth, truncate, padTo, wrapAnsi, charWidth };
