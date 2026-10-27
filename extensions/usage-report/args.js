'use strict';
// Argument parsing for /cost and /context. Pure; returns { error } instead of throwing.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// "daily --since 2026-01-01 --project --json" -> { mode, since, project, json }
function parseCostArgs(text) {
  const out = { mode: 'session', json: false, project: false, since: undefined };
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--json') out.json = true;
    else if (t === '--project') out.project = true;
    else if (t === '--since' || t.startsWith('--since=')) {
      const value = t === '--since' ? tokens[++i] : t.slice('--since='.length);
      if (!value || !validDate(value)) return { error: '--since needs a date like 2026-01-31' };
      out.since = value;
    } else if (['session', 'daily', 'monthly'].includes(t) && i === 0) out.mode = t;
    else return { error: `Unknown argument "${t}". Usage: /cost [session|daily|monthly] [--since YYYY-MM-DD] [--project] [--json]` };
  }
  if (out.mode === 'session' && (out.since || out.project)) return { error: '--since and --project apply to /cost daily and /cost monthly' };
  return out;
}

// "--json", "system", "tool bash", "files AGENTS.md" -> { json, query }
function parseContextArgs(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  const json = tokens.includes('--json');
  return { json, query: tokens.filter((t) => t !== '--json').join(' ') };
}

module.exports = { parseCostArgs, parseContextArgs, validDate };
