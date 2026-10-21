'use strict';

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// "#" lines inside ``` or ~~~ fences are code, not headings.
function scanHeadings(lines) {
  const found = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !lines[i].slice(open[0].length).trim()) fence = null;
      continue;
    }
    if (open) { fence = open[1]; continue; }
    const m = lines[i].match(HEADING);
    if (m) found.push({ line: i, level: m[1].length, title: m[2].replace(/`([^`]*)`/g, '$1').replace(/[*_~]/g, '').trim() });
  }
  return found;
}

function listHeadings(markdown) {
  return scanHeadings(String(markdown).split(/\r?\n/)).map((h) => h.title);
}

function pickSection(markdown, heading) {
  const text = String(markdown).replace(/\r/g, '');
  const lines = text.split('\n');
  const headings = scanHeadings(lines);
  const target = String(heading || '').trim().toLowerCase();
  const index = headings.findIndex((h) => h.title.toLowerCase() === target);
  if (index < 0) return { found: false, text: headings.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n') || '(no headings found)', headings: headings.map((h) => h.title) };
  const current = headings[index];
  const next = headings.slice(index + 1).find((h) => h.level <= current.level);
  return { found: true, text: lines.slice(current.line, next ? next.line : lines.length).join('\n').trim(), headings: headings.map((h) => h.title) };
}

module.exports = { listHeadings, pickSection };
