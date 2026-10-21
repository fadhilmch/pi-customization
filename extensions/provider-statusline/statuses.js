// Pure helpers for rendering ctx.ui.setStatus() values in the footer.

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

// Like Pi's built-in footer sanitizer, but also drops colors so the whole
// segment can be rendered subtly.
function sanitizeStatusText(text) {
  return String(text ?? '')
    .replace(ANSI_RE, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/ +/g, ' ')
    .trim();
}

// Map<string,string> -> string[] sorted by key (same order as Pi's own footer), empties dropped.
function collectStatuses(statuses) {
  if (!statuses || typeof statuses.entries !== 'function') return [];
  return Array.from(statuses.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([, text]) => sanitizeStatusText(text))
    .filter(Boolean);
}

// Join segments with `sep`, dropping whole trailing segments that do not fit.
// If even the first one is too long it is cut with `cut(text, width)`.
// `measure` and `cut` are injected so this stays free of TUI imports.
function fitSegments(segments, width, { sep = ' │ ', measure = (s) => s.length, cut = (s, w) => s.slice(0, w) } = {}) {
  const parts = segments.filter(Boolean);
  if (parts.length === 0 || width <= 0) return '';
  let line = parts[0];
  if (measure(line) > width) return cut(line, width);
  for (let i = 1; i < parts.length; i++) {
    const next = `${line}${sep}${parts[i]}`;
    if (measure(next) > width) break;
    line = next;
  }
  return line;
}

module.exports = { sanitizeStatusText, collectStatuses, fitSegments };
