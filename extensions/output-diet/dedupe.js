'use strict';
const crypto = require('node:crypto');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const SEP = '\u0000';
const keyOf = (input) => `${input.path}${SEP}${input.offset ?? ''}${SEP}${input.limit ?? ''}`;

function countLines(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  while (lines.length && /^\s*\[.*\]\s*$/.test(lines[lines.length - 1])) lines.pop(); // trailing Pi notices
  return lines.length;
}

// Remembers reads whose content is in the model's context and decides whether a new identical read
// can be replaced by a short note. Conservative: it dedupes only when the earlier result is provably
// still in the live context (liveIds) and the content hash is identical.
class ReadTracker {
  constructor() { this.byKey = new Map(); }
  reset() { this.byKey.clear(); }

  // An edit or write to a path makes older reads of it untrustworthy.
  invalidatePath(p) {
    for (const k of [...this.byKey.keys()]) if (k.startsWith(`${p}${SEP}`)) this.byKey.delete(k);
  }

  // liveIds: Set of toolCallIds whose results are in the live context; null/unknown disables deduping.
  // Returns { dedupe: true, earlier } or { dedupe: false }.
  decide(input, text, toolCallId, liveIds) {
    if (!input || typeof input.path !== 'string' || typeof text !== 'string') return { dedupe: false };
    const key = keyOf(input);
    const h = hash(text);
    const prev = this.byKey.get(key);
    if (prev && prev.hash === h && liveIds instanceof Set && liveIds.has(prev.toolCallId)) {
      return { dedupe: true, earlier: prev };
    }
    this.byKey.set(key, { hash: h, toolCallId, path: input.path, offset: input.offset, limit: input.limit, lines: countLines(text) });
    return { dedupe: false };
  }
}

function dedupeNote(earlier) {
  const a = Number.isFinite(earlier.offset) ? earlier.offset : 1;
  const b = Number.isFinite(earlier.limit) ? a + earlier.limit - 1 : a + earlier.lines - 1;
  return `[output-diet: unchanged since the earlier read of ${earlier.path} (lines ${a}-${b}); content omitted]`;
}

module.exports = { ReadTracker, dedupeNote, hash, countLines };
