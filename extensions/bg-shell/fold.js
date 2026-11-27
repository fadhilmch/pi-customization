// Copied from extensions/output-diet/fold.js after the output-diet prerequisite landed (PR #11).
'use strict';

const compile = (list) => list.map((s) => new RegExp(s, 'i'));

// True when the command looks like it explicitly asks for full output (cat, git diff, ...).
function isAllowlisted(command, cfg) {
  const cmd = String(command ?? '');
  return compile(cfg.allowlist).some((re) => re.test(cmd));
}

// Make "same message, different number/time/hash" lines compare equal.
function normalize(line) {
  return line
    .replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?Z?/g, '#T')
    .replace(/\b[0-9a-f]{7,}\b/gi, '#H')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

const clip = (line, max) => (line.length > max ? `${line.slice(0, max)}… [+${line.length - max} chars]` : line);

// Decide whether text is big enough to fold and, if so, build the folded text.
// opts.fullPath: where the full output lives; opts.numbered: line numbers in the gap markers match that file.
// Returns null when nothing should change.
function fold(text, cfg, { fullPath = '<unsaved>', numbered = true } = {}) {
  if (typeof text !== 'string') return null;
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length <= cfg.thresholdLines && bytes <= cfg.thresholdBytes) return null;

  const head = Math.min(cfg.headLines, lines.length);
  const tailStart = Math.max(head, lines.length - cfg.tailLines);
  const middleStart = head;
  const middleEnd = tailStart; // exclusive
  if (middleEnd - middleStart < 10) return null; // too little to be worth a note

  const important = compile(cfg.patterns);
  const ignored = compile(cfg.ignore);
  const seen = new Set();
  const keep = new Set();
  let matched = 0;
  let repeated = 0;
  let overflow = 0;
  const isMatch = (line) => important.some((re) => re.test(line)) && !ignored.some((re) => re.test(line));
  for (let i = middleStart; i < middleEnd; i++) {
    const line = lines[i];
    if (!isMatch(line)) continue;
    const key = normalize(line);
    if (seen.has(key)) { repeated++; continue; }
    if (matched >= cfg.maxMatches) { overflow++; continue; }
    seen.add(key);
    matched++;
    for (let j = Math.max(middleStart, i - cfg.context); j <= Math.min(middleEnd - 1, i + cfg.context); j++) {
      // Neighbouring matches are judged on their own (shown, repeated or over the cap), not smuggled in as context.
      if (j === i || !isMatch(lines[j])) keep.add(j);
    }
  }

  let skipped = 0;
  const out = [];
  const gap = (a, b) => {
    if (b <= a) return;
    skipped += b - a;
    out.push(`[… ${b - a} lines skipped${numbered ? ` (lines ${a + 1}-${b})` : ''} …]`);
  };
  for (let i = 0; i < head; i++) out.push(clip(lines[i], cfg.maxLineChars));
  let cursor = middleStart;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > cursor) gap(cursor, i);
    out.push(clip(lines[i], cfg.maxLineChars));
    cursor = i + 1;
  }
  gap(cursor, middleEnd);
  if (repeated + overflow > 0) {
    const parts = [];
    if (repeated) parts.push(`${repeated} repeated`);
    if (overflow) parts.push(`${overflow} over the cap`);
    out.push(`[output-diet: matching lines not shown: ${parts.join(', ')}]`);
  }
  for (let i = tailStart; i < lines.length; i++) out.push(clip(lines[i], cfg.maxLineChars));

  const note = `[output-diet: ${skipped} lines folded, full output saved to ${fullPath}; use read with offset/limit to see more]`;
  // The note goes first: claude-look shows only the first 3 lines of a collapsed result.
  const result = `${note}\n${out.join('\n')}`;
  if (result.length >= text.length * 0.8) return null; // not worth it
  return { text: result, linesFolded: skipped, totalLines: lines.length, matched, repeated, overflow };
}

module.exports = { fold, isAllowlisted, normalize };
