'use strict';
const { FOLDER_NAMES } = require('./folders.js');

const tokens = (chars) => Math.round(chars / 4);
const n = (v) => v.toLocaleString('en-US');

class Stats {
  constructor() { this.reset(); }
  reset() { this.folds = 0; this.dedupes = 0; this.charsSaved = 0; this.charsBefore = 0; this.byFolder = new Map(); }
  // folder: name of the command folder that did the fold; omitted for the generic head/error/tail fold.
  record(kind, before, after, folder) {
    if (kind === 'dedupe') this.dedupes++;
    else {
      this.folds++;
      const k = folder || 'generic';
      const e = this.byFolder.get(k) || { count: 0, charsSaved: 0 };
      e.count++;
      e.charsSaved += Math.max(0, before - after);
      this.byFolder.set(k, e);
    }
    this.charsBefore += before;
    this.charsSaved += Math.max(0, before - after);
  }
  get tokensSaved() { return tokens(this.charsSaved); }
  snapshot() { return { folds: this.folds, dedupes: this.dedupes, charsSaved: this.charsSaved, tokensSaved: this.tokensSaved, byFolder: Object.fromEntries(this.byFolder) }; }
  // Rebuild from results recorded earlier in the session (details.outputDiet).
  restore(messages) {
    this.reset();
    for (const m of messages || []) {
      const d = m && m.role === 'toolResult' && m.details && m.details.outputDiet;
      if (d && Number.isFinite(d.before) && Number.isFinite(d.after)) this.record(d.kind, d.before, d.after, d.folder);
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
    ...(stats.byFolder.size ? ['  by folder:', ...[...stats.byFolder].sort((a, b) => b[1].charsSaved - a[1].charsSaved).map(([k, e]) => `    ${k}: ${e.count} result${e.count === 1 ? '' : 's'}, ~${n(tokens(e.charsSaved))} tokens`)] : []),
    `  folds bash output over ${cfg.thresholdLines} lines or ${Math.round(cfg.thresholdBytes / 1024)} KB: ${cfg.headLines} head + ${cfg.tailLines} tail + up to ${cfg.maxMatches} error lines`,
    `  command folders (git, tests, tsc, eslint, install, grep, find, ls -R): ${FOLDER_NAMES.filter((f) => !(cfg.disableFolders || []).includes(f)).join(' ') || '(all off)'}${(cfg.disableFolders || []).length ? `; off: ${cfg.disableFolders.join(' ')}` : ''}`,
    `  dedupe repeated reads: ${cfg.dedupeReads ? 'on' : 'off'}`,
    `  never folded (allowlist): ${cfg.allowlist.length ? cfg.allowlist.join('  ') : '(none)'}`,
    '  config: ~/.pi/agent/output-diet.json (a project .pi/output-diet.json can only tighten)',
  ].join('\n');
}

module.exports = { Stats, formatStats, tokens };
