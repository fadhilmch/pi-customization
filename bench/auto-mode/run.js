#!/usr/bin/env node
'use strict';
// Benchmark for the auto-mode rule classifier. No model, no network.
// Usage: node bench/auto-mode/run.js [--show] [--json] [--strict] [--extra file.jsonl]
//   --show    list every fixture whose verdict differs from its label
//   --json    print the results as JSON instead of a table
//   --strict  exit 1 when a fixture not marked known_gap disagrees, or a known_gap now passes
//   --extra   add fixtures from another JSONL file (same fields), e.g. your own decision log
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyToolCall } = require('../../extensions/auto-mode/classify.js');
const { emptyConfig } = require('../../extensions/auto-mode/config.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const extraAt = args.indexOf('--extra');

function loadFixtures(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`${file}:${i + 1}: ${e.message}`); }
  });
}

// Labels: safe = should run silently; risky = should ask or be blocked; block = should be hard-blocked.
const OK = {
  safe: (a) => a === 'allow',
  risky: (a) => a === 'ask' || a === 'deny',
  block: (a) => a === 'deny',
};
const UNCERTAIN_RULES = new Set(['uncertain', 'path-unknown']);

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-bench-')));
  const cwd = path.join(root, 'proj');
  const home = path.join(root, 'home');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(cwd, 'src', 'a.js'), '');
  fs.writeFileSync(path.join(cwd, 'README.md'), '');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{}');
  fs.symlinkSync(outside, path.join(cwd, 'link-out'));
  return { root, cwd, home, outside };
}

function expand(s, env) {
  return String(s).replace(/\{\{(cwd|home|outside)\}\}/g, (_, k) => env[k]);
}

function pct(n, d) { return d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a'; }
function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; }

function main() {
  const fixtures = loadFixtures(path.join(__dirname, 'fixtures.jsonl'));
  if (extraAt >= 0) fixtures.push(...loadFixtures(args[extraAt + 1]));
  const env = setup();
  const results = [];
  const times = [];
  try {
    for (const f of fixtures) {
      const input = f.command !== undefined ? { command: expand(f.command, env) } : { path: expand(f.path, env) };
      const opts = { cwd: env.cwd, home: env.home, env: {}, mode: 'auto', tmpRoots: [], config: emptyConfig() };
      const t0 = process.hrtime.bigint();
      const d = classifyToolCall(f.tool, input, opts);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const ids = (d.findings || []).map((x) => x.id);
      results.push({
        id: f.id, group: f.group, label: f.label, tool: f.tool, command: f.command, path: f.path, note: f.note,
        known_gap: Boolean(f.known_gap), verdict: d.action, reason: d.reason, rules: ids,
        ok: OK[f.label](d.action), uncertain: ids.some((i) => UNCERTAIN_RULES.has(i)),
      });
    }
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }

  const by = (fn) => results.filter(fn);
  const safe = by((r) => r.label === 'safe');
  const risky = by((r) => r.label === 'risky');
  const block = by((r) => r.label === 'block');
  const summary = {
    fixtures: results.length,
    safe: { n: safe.length, asked_or_blocked: safe.filter((r) => r.verdict !== 'allow').length },
    risky: { n: risky.length, allowed: risky.filter((r) => r.verdict === 'allow').length },
    block: { n: block.length, not_denied: block.filter((r) => r.verdict !== 'deny').length, allowed: block.filter((r) => r.verdict === 'allow').length },
    uncertain: results.filter((r) => r.uncertain).length,
    decision_ms: { p50: quantile([...times].sort((a, b) => a - b), 0.5), p95: quantile([...times].sort((a, b) => a - b), 0.95), max: Math.max(...times) },
  };
  const groups = {};
  for (const r of results) {
    const g = (groups[r.group] ||= { n: 0, ok: 0 });
    g.n++; if (r.ok) g.ok++;
  }
  const mismatches = results.filter((r) => !r.ok);
  const regress = mismatches.filter((r) => !r.known_gap);
  const fixedGaps = results.filter((r) => r.known_gap && r.ok);

  if (flag('--json')) {
    console.log(JSON.stringify({ summary, groups, mismatches }, null, 2));
  } else {
    console.log('auto-mode rule benchmark (no model, mode=auto)\n');
    console.log(`Fixtures: ${summary.fixtures}   (labels are hand-written; see README)\n`);
    console.log('Measure                                         Count        Rate');
    console.log(`Safe commands that asked or blocked (friction)  ${String(summary.safe.asked_or_blocked).padStart(3)}/${String(summary.safe.n).padEnd(4)}      ${pct(summary.safe.asked_or_blocked, summary.safe.n)}`);
    console.log(`Risky commands allowed silently (missed)        ${String(summary.risky.allowed).padStart(3)}/${String(summary.risky.n).padEnd(4)}      ${pct(summary.risky.allowed, summary.risky.n)}`);
    console.log(`Catastrophic not hard-blocked                   ${String(summary.block.not_denied).padStart(3)}/${String(summary.block.n).padEnd(4)}      ${pct(summary.block.not_denied, summary.block.n)}`);
    console.log(`Calls flagged "uncertain" (rules could not tell)${String(summary.uncertain).padStart(3)}/${String(summary.fixtures).padEnd(4)}      ${pct(summary.uncertain, summary.fixtures)}`);
    console.log(`Decision time per call (ms)                     p50 ${summary.decision_ms.p50.toFixed(3)}  p95 ${summary.decision_ms.p95.toFixed(3)}  max ${summary.decision_ms.max.toFixed(3)}\n`);
    console.log('By group (fixtures matching their label):');
    for (const [g, v] of Object.entries(groups)) console.log(`  ${g.padEnd(14)} ${v.ok}/${v.n}`);
    console.log(`\nDisagreements: ${mismatches.length} (${mismatches.length - regress.length} marked known_gap)`);
    if (flag('--show') || regress.length) {
      for (const r of mismatches) {
        const what = r.command !== undefined ? r.command.replace(/\n/g, '\\n') : `${r.tool} ${r.path}`;
        console.log(`  ${r.id} [${r.group}] want ${r.label}, got ${r.verdict}${r.known_gap ? ' (known gap)' : ''}: ${what}${r.note ? `  # ${r.note}` : ''}`);
      }
    }
    if (fixedGaps.length) console.log(`\nKnown gaps that now pass (remove known_gap): ${fixedGaps.map((r) => r.id).join(', ')}`);
  }
  if (flag('--strict') && (regress.length || fixedGaps.length)) process.exit(1);
}

main();
