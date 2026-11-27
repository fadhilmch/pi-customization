'use strict';
// /cost daily and /cost monthly: scan Pi's session files and aggregate spend per day/month and model. No Pi imports.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { fmt } = require('./context.js');
const { money } = require('./cost.js');

// Same precedence as Pi: env var, then the sessionDir setting, then <agent dir>/sessions.
function sessionsDir({ env = process.env, cwd = process.cwd(), home = os.homedir() } = {}) {
  const expand = (p) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : path.resolve(cwd, p));
  if (env.PI_CODING_AGENT_SESSION_DIR) return expand(env.PI_CODING_AGENT_SESSION_DIR);
  const agentDir = env.PI_CODING_AGENT_DIR ? expand(env.PI_CODING_AGENT_DIR) : path.join(home, '.pi', 'agent');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
    if (typeof settings.sessionDir === 'string' && settings.sessionDir) return expand(settings.sessionDir);
  } catch {}
  return path.join(agentDir, 'sessions');
}

// Pi groups sessions as --<cwd without leading separator, with / \ : replaced by ->--
const projectDirName = (cwd) => `--${String(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;

const pad2 = (n) => String(n).padStart(2, '0');
function localDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Spend recorded by one session entry: [{ model, usage:{input,output,cacheRead,cacheWrite}, cost, sub }]
function entrySpend(e) {
  const out = [];
  const modelKey = (p, m, fallback) => (p && m ? `${p}/${m}` : m || fallback);
  if ((e.type === 'compaction' || e.type === 'branch_summary') && e.usage) {
    out.push({ model: e.type === 'compaction' ? '(compaction)' : '(branch summary)', usage: e.usage, cost: e.usage.cost?.total });
  } else if (e.type === 'usage' && e.usage) {
    out.push({ model: modelKey(e.provider, e.model, `(${e.kind || 'usage'})`), usage: e.usage, cost: e.usage.cost?.total });
  } else if (e.type === 'message' && e.message) {
    const m = e.message;
    if (m.role === 'assistant' && m.usage) out.push({ model: modelKey(m.provider, m.model, 'unknown'), usage: m.usage, cost: m.usage.cost?.total });
    else if (m.role === 'toolResult' && m.toolName === 'subagent') {
      for (const r of m.details?.runs || []) if (r.usage) out.push({ model: `${r.agent || 'agent'}${r.model ? ` (${r.model})` : ''}`, usage: r.usage, cost: r.usage.cost, sub: true });
    }
  }
  return out;
}

const emptyU = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
function addTo(t, u, cost) {
  t.input += Number(u.input) || 0;
  t.output += Number(u.output) || 0;
  t.cacheRead += Number(u.cacheRead) || 0;
  t.cacheWrite += Number(u.cacheWrite) || 0;
  t.cost += Number(cost) || 0;
}

// Cheap guard: only lines that can carry usage are parsed. Malformed lines are skipped.
const MAY_HAVE_USAGE = /"usage"|"runs"/;

async function scanFile(file, add) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  rl.on('error', () => {});
  try {
    for await (const line of rl) {
      if (!MAY_HAVE_USAGE.test(line)) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e && typeof e === 'object') add(e);
    }
  } catch {
    // unreadable or vanished file: skip it
  }
}

function listFiles(dir, onlyDirName) {
  const files = [];
  let dirs;
  try {
    dirs = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const d of dirs) {
    if (d.isFile() && d.name.endsWith('.jsonl') && !onlyDirName) files.push(path.join(dir, d.name));
    if (!d.isDirectory() || (onlyDirName && d.name !== onlyDirName)) continue;
    try {
      for (const f of fs.readdirSync(path.join(dir, d.name))) if (f.endsWith('.jsonl')) files.push(path.join(dir, d.name, f));
    } catch {}
  }
  return files;
}

// opts: { dir, period:'daily'|'monthly', since?:'YYYY-MM-DD', project?:cwd string, concurrency? }
async function scanHistory({ dir, period = 'daily', since, project, concurrency = 8 }) {
  const files = listFiles(dir, project ? projectDirName(project) : undefined);
  const sinceMs = since ? new Date(`${since}T00:00:00`).getTime() : 0;
  const seen = new Set();
  const periods = new Map();
  let scanned = 0;
  const add = (e) => {
    const day = localDay(e.timestamp ?? e.message?.timestamp);
    if (!day || (since && day < since)) return;
    const spend = entrySpend(e);
    if (!spend.length) return;
    // A forked session repeats the entries it copied; count each only once.
    const key = `${e.id}|${e.timestamp}|${e.message?.toolCallId || ''}`;
    if (e.id && seen.has(key)) return;
    if (e.id) seen.add(key);
    const label = period === 'monthly' ? day.slice(0, 7) : day;
    let p = periods.get(label);
    if (!p) periods.set(label, (p = { period: label, models: new Map(), main: emptyU(), sub: emptyU() }));
    for (const s of spend) {
      let t = p.models.get(s.model);
      if (!t) p.models.set(s.model, (t = { ...emptyU(), sub: !!s.sub }));
      addTo(t, s.usage, s.cost);
      addTo(s.sub ? p.sub : p.main, s.usage, s.cost);
    }
  };
  // A file last written before `since` cannot hold anything newer: skip it without reading.
  const todo = files.filter((f) => {
    if (!sinceMs) return true;
    try {
      return fs.statSync(f).mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const f = todo[next++];
      await scanFile(f, add);
      scanned++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return buildReport(periods, { period, since, project, files: files.length, scanned });
}

function buildReport(periods, meta) {
  const rows = [...periods.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((p) => {
      const total = emptyU();
      addTo(total, p.main, p.main.cost);
      addTo(total, p.sub, p.sub.cost);
      return {
        period: p.period,
        ...total,
        subagentCost: p.sub.cost,
        models: [...p.models].map(([name, u]) => ({ name, ...u })).sort((a, b) => b.cost - a.cost),
      };
    });
  const total = emptyU();
  let subagentCost = 0;
  for (const r of rows) {
    addTo(total, r, r.cost);
    subagentCost += r.subagentCost;
  }
  return { ...meta, rows, total: { ...total, subagentCost } };
}

const MAX_ROWS = 30;

// Plain-text table (also the TUI body): one line per period, models indented under it. Newest rows kept when capped.
function formatHistory(r, { maxRows = MAX_ROWS } = {}) {
  const what = r.period === 'monthly' ? 'month' : 'day';
  if (!r.rows.length) return `No usage found in ${r.files} session file${r.files === 1 ? '' : 's'}${r.since ? ` since ${r.since}` : ''}${r.project ? ' for this project' : ''}.`;
  const out = [`Cost per ${what}${r.since ? ` since ${r.since}` : ''}${r.project ? ' (this project)' : ''}`, ''];
  const line = (label, t) => `${label.padEnd(34)} ${money(t.cost).padStart(8)}  ↑${fmt(t.input)} ↓${fmt(t.output)} R${fmt(t.cacheRead)} W${fmt(t.cacheWrite)}`;
  const shown = maxRows > 0 ? r.rows.slice(-maxRows) : r.rows;
  if (shown.length < r.rows.length) out.push(`… ${r.rows.length - shown.length} older ${what}s hidden (use --since, or --json for all)`);
  for (const row of shown) {
    out.push(line(row.period, row));
    for (const m of row.models) out.push(line(`  ${m.sub ? '↳ ' : ''}${m.name.length > 30 ? `…${m.name.slice(-29)}` : m.name}`, m));
  }
  out.push('', line('Total', r.total));
  if (r.total.subagentCost > 0) out.push(`of which subagents ${money(r.total.subagentCost)}`);
  out.push(`${r.scanned} session file${r.scanned === 1 ? '' : 's'} read   ↑ input  ↓ output  R cache read  W cache write`);
  return out.join('\n');
}

module.exports = { sessionsDir, projectDirName, localDay, entrySpend, scanHistory, formatHistory, MAX_ROWS };
