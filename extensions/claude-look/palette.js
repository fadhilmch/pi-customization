'use strict';

// Pi's Theme exposes foreground colours only (no diff backgrounds), so tool output takes its text colours
// from the active theme and picks the diff backgrounds by whether the theme's text colour is dark (light theme).
// Only truecolor ANSI (38;2;r;g;b) is read; anything else gives no override, i.e. the dark defaults.
const LIGHT = { addBg: '#c7f0cf', remBg: '#ffd6dc' };

function hexOf(ansi) {
  const m = /\u001b\[38;2;(\d+);(\d+);(\d+)m/.exec(String(ansi));
  if (!m) return undefined;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

// theme: Pi Theme (getFgAnsi). Returns a palette for tools.js.
function paletteFromTheme(theme) {
  if (!theme || typeof theme.getFgAnsi !== 'function') return undefined;
  const get = (key) => { try { return hexOf(theme.getFgAnsi(key)); } catch { return undefined; } };
  const pal = { success: get('success'), error: get('error'), muted: get('toolOutput'), dim: get('dim'), text: get('text') };
  if (pal.text && luma(pal.text) < 128) Object.assign(pal, LIGHT);
  for (const k of Object.keys(pal)) if (pal[k] === undefined) delete pal[k];
  return pal;
}

module.exports = { paletteFromTheme, hexOf };
