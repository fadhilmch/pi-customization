'use strict';

function listHeadings(markdown) {
  const headings = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    headings.push(m[2].replace(/`([^`]*)`/g, '$1').replace(/[*_~]/g, '').trim());
  }
  return headings;
}

function pickSection(markdown, heading) {
  const text = String(markdown).replace(/\r/g, '');
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) headings.push({ line: i, level: m[1].length, title: m[2].replace(/`([^`]*)`/g, '$1').replace(/[*_~]/g, '').trim() });
  }
  const target = String(heading || '').trim().toLowerCase();
  const index = headings.findIndex((h) => h.title.toLowerCase() === target);
  if (index < 0) return { found: false, text: headings.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n') || '(no headings found)', headings: headings.map((h) => h.title) };
  const current = headings[index];
  const next = headings.slice(index + 1).find((h) => h.level <= current.level);
  return { found: true, text: lines.slice(current.line, next ? next.line : lines.length).join('\n').trim(), headings: headings.map((h) => h.title) };
}

module.exports = { listHeadings, pickSection };
