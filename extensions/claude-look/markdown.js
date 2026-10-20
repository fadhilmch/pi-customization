'use strict';
// Adds Claude-Code style prefixes to the first line of a message.
// Only touches plain paragraph openings, so headings, lists, tables,
// quotes and code fences are never corrupted.

const BLOCK_START = /^(\s{4,}|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||<|---|===|\[[^\]]*\]:)/;

function prefixFirstLine(markdown, prefix) {
  if (typeof markdown !== 'string' || markdown.trim() === '') return markdown;
  const lines = markdown.split('\n');
  const idx = lines.findIndex((l) => l.trim() !== '');
  if (idx < 0 || BLOCK_START.test(lines[idx])) return markdown;
  lines[idx] = prefix + lines[idx];
  return lines.join('\n');
}

const ASSISTANT_PREFIX = '⏺ ';
// '\>' is a Markdown escape, so the user line shows a literal "> " and is not parsed as a quote.
const USER_PREFIX = '\\> ';

function transformMarkdown(markdown, context = {}) {
  switch (context.messageType) {
    case 'assistant': return prefixFirstLine(markdown, ASSISTANT_PREFIX);
    case 'user': return prefixFirstLine(markdown, USER_PREFIX);
    default: return markdown;
  }
}

module.exports = { prefixFirstLine, transformMarkdown, ASSISTANT_PREFIX, USER_PREFIX };
