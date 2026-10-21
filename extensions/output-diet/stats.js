'use strict';

const tokens = (chars) => Math.round(chars / 4);
const n = (v) => v.toLocaleString('en-US');

class Stats {
  constructor() { this.reset(); }
  reset() { this.folds = 0; this.dedupes = 0; this.charsSaved = 0; this.charsBefore = 0; }
  record(kind, before, after) {
    if (kind === 'dedupe') this.dedupes++; else this.folds++;
    this.charsBefore += before;
    this.charsSaved += Math.max(0, before - after);
  }
  get tokensSaved() { return tokens(this.charsSaved); }
  snapshot() { return { folds: this.folds, dedupes: this.dedupes, charsSaved: this.charsSaved, tokensSaved: this.tokensSaved }; }
  // Rebuild from results recorded earlier in the session (details.outputDiet).
  restore(messages) {
    this.reset();
    for (const m of messages || []) {
      const d = m && m.role === 'toolResult' && m.details && m.details.outputDiet;
      if (d && Number.isFinite(d.before) && Number.isFinite(d.after)) this.record(d.kind, d.before, d.after);
    }
  }
}

function formatStats(stats, cfg) {
  const s = stats.snapshot();
  const pct = stats.charsBefore ? Math.round((stats.charsSaved / stats.charsBefore) * 100) : 0;
  return [
    `output-diet (${cfg.enabled ? 'on' : 'off'})`,
    `  this session: ${s.folds} folded bash result${s.folds === 1 ? '' : 's'}, ${s.dedupes} deduped read${s.dedupes === 1 ? '' : 's'}`,
    `  saved: ~${n(s.tokensSaved)} tokens (${n(s.charsSaved)} chars, ${pct}% of the affected output); counted once, every later turn also resends less`,
    `  folds bash output over ${cfg.thresholdLines} lines or ${Math.round(cfg.thresholdBytes / 1024)} KB: ${cfg.headLines} head + ${cfg.tailLines} tail + up to ${cfg.maxMatches} error lines`,
    `  dedupe repeated reads: ${cfg.dedupeReads ? 'on' : 'off'}`,
    `  never folded (allowlist): ${cfg.allowlist.length ? cfg.allowlist.join('  ') : '(none)'}`,
    '  config: ~/.pi/agent/output-diet.json (a project .pi/output-diet.json can only tighten)',
  ].join('\n');
}

module.exports = { Stats, formatStats, tokens };
