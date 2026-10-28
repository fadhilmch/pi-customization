#!/usr/bin/env node
'use strict';
// Benchmark for output-diet's fold(): how much text it removes and whether the important lines survive.
// Usage: node bench/output-diet/run.js [--json] [--strict]
// No model, no network. The outputs are SYNTHETIC (generated below, deterministic), shaped like common tool
// output, so the savings are illustrative, not a measured rate on real sessions. Tokens are chars / 4, the
// same estimate output-diet itself uses.
const { fold } = require('../../extensions/output-diet/fold.js');
const { DEFAULTS } = require('../../extensions/output-diet/config.js');
const { tokens } = require('../../extensions/output-diet/stats.js');

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const pad = (n, w = 3) => String(n).padStart(w, '0');
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'kappa', 'theta', 'lambda', 'zeta', 'orion', 'vega', 'atlas', 'nova', 'echo', 'pixel', 'cedar', 'maple', 'birch', 'aspen'];

// Each case: name, text, must = lines that must still be visible (substring) to the model after folding.
const cases = [
  {
    name: 'passing test run, 600 tests',
    text: [...range(600, (i) => `  ok ${i + 1} - suite ${pad(i % 40, 2)} case ${pad(i)} (${(i * 7) % 90 + 3}.${pad(i % 100, 2)}ms)`), '# tests 600', '# pass 600', '# fail 0'].join('\n'),
    must: ['# pass 600', '# fail 0'],
  },
  {
    name: 'failing test run, 2 failures in the middle',
    text: [...range(300, (i) => `  ok ${i + 1} - case ${pad(i)}`), '  not ok 301 - auth rejects expired token', '    AssertionError: expected 401 but got 200', '    at src/auth.test.js:88:5', ...range(300, (i) => `  ok ${i + 302} - case ${pad(i + 301)}`), '  not ok 602 - cart total rounds half up', '    AssertionError: expected 10.01 but got 10', '# tests 602', '# pass 600', '# fail 2'].join('\n'),
    must: ['not ok 301 - auth rejects expired token', 'AssertionError: expected 401 but got 200', 'not ok 602 - cart total rounds half up', '# fail 2'],
  },
  {
    name: 'npm install log with a deprecation flood',
    text: [...range(400, (i) => `npm warn deprecated pkg-${pad(i)}@1.${i % 9}.0: use pkg-next instead`), 'added 1204 packages, and audited 1205 packages in 41s', '3 vulnerabilities (1 moderate, 2 high)'].join('\n'),
    must: ['added 1204 packages', '3 vulnerabilities'],
  },
  {
    name: 'build log, one compile error in the middle',
    text: [...range(250, (i) => `[${pad(i)}/500] Compiling module_${pad(i)}.ts`), "src/payment/charge.ts(41,17): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.", ...range(250, (i) => `[${pad(i + 251)}/500] Compiling module_${pad(i + 250)}.ts`), 'Build failed with 1 error'].join('\n'),
    must: ['error TS2345', 'src/payment/charge.ts(41,17)', 'Build failed with 1 error'],
  },
  {
    name: 'repeated error line, 300 times',
    text: [...range(300, (i) => `2026-10-28T10:${pad(i % 60, 2)}:${pad(i % 60, 2)}Z ERROR connect ECONNREFUSED 10.0.0.${i % 250}:5432`), 'service exited with 1'].join('\n'),
    must: ['ECONNREFUSED', 'service exited with 1'],
  },
  {
    name: '80 distinct errors (above the 40 match cap)',
    text: [...range(120, (i) => `info: step ${pad(i)} ok`), ...range(80, (i) => `error: module ${WORDS[i % 20]}${WORDS[(i * 7 + 3) % 20]}${String.fromCharCode(97 + (i % 26))} failed to load`), ...range(120, (i) => `info: step ${pad(i + 120)} ok`)].join('\n'),
    must: range(80, (i) => `module ${WORDS[i % 20]}${WORDS[(i * 7 + 3) % 20]}${String.fromCharCode(97 + (i % 26))} failed to load`),
  },
  {
    name: '80 errors that differ only in a number',
    text: [...range(120, (i) => `info: step ${pad(i)} ok`), ...range(80, (i) => `error: module m${pad(i)} failed to load (code ${100 + i})`), ...range(120, (i) => `info: step ${pad(i + 120)} ok`)].join('\n'),
    must: range(80, (i) => `module m${pad(i)} failed to load`),
  },
  {
    name: 'long output without any keyword, answer in the middle',
    text: [...range(200, (i) => `row ${pad(i)}: value=${i * 3}`), 'row 200: value=THE-ANSWER', ...range(200, (i) => `row ${pad(i + 201)}: value=${i * 5}`)].join('\n'),
    must: ['THE-ANSWER'],
  },
  {
    name: 'short output (under the thresholds)',
    text: range(40, (i) => `line ${i}`).join('\n'),
    must: ['line 20'],
  },
];

const args = process.argv.slice(2);
const rows = cases.map((c) => {
  const r = fold(c.text, DEFAULTS, { fullPath: '/tmp/full.log' });
  const after = r ? r.text : c.text;
  const lost = c.must.filter((m) => !after.includes(m));
  return {
    name: c.name, folded: Boolean(r), before_chars: c.text.length, after_chars: after.length,
    tokens_before: tokens(c.text.length), tokens_after: tokens(after.length),
    saved_pct: Math.round((1 - after.length / c.text.length) * 100), must: c.must.length, lost,
  };
});
const totBefore = rows.reduce((a, r) => a + r.tokens_before, 0);
const totAfter = rows.reduce((a, r) => a + r.tokens_after, 0);
const lostTotal = rows.reduce((a, r) => a + r.lost.length, 0);
const mustTotal = rows.reduce((a, r) => a + r.must, 0);

if (args.includes('--json')) {
  console.log(JSON.stringify({ rows, total: { tokens_before: totBefore, tokens_after: totAfter, saved_pct: Math.round((1 - totAfter / totBefore) * 100), must_lines: mustTotal, lost_lines: lostTotal } }, null, 2));
} else {
  console.log('output-diet fold benchmark (synthetic outputs, default config, tokens = chars / 4)\n');
  console.log('Case'.padEnd(52) + 'tokens before -> after   saved   important lines lost');
  for (const r of rows) {
    console.log(`${r.name.padEnd(52)}${String(r.tokens_before).padStart(6)} -> ${String(r.tokens_after).padEnd(6)}  ${String(r.saved_pct).padStart(4)}%   ${r.lost.length}/${r.must}${r.folded ? '' : '  (not folded)'}`);
  }
  console.log(`\nTotal: ${totBefore} -> ${totAfter} tokens (${Math.round((1 - totAfter / totBefore) * 100)}% less). Important lines lost: ${lostTotal}/${mustTotal}.`);
  for (const r of rows) if (r.lost.length) console.log(`  LOST in "${r.name}": ${r.lost.length} line(s), e.g. ${r.lost[0]}`);
}
// --strict fails on a loss that is not listed here, or when a listed loss stops happening, so neither a new loss
// nor a fixed one goes unnoticed. These losses are findings, not passes: read the table, not the exit code.
const EXPECTED_LOSS = {
  '80 distinct errors (above the 40 match cap)': 'only maxMatches (40) distinct error lines are shown, the rest are counted in a note',
  '80 errors that differ only in a number': 'lines equal after digits and hashes are normalised count as repeats, so only the first is shown',
  'long output without any keyword, answer in the middle': 'by design: a middle with no error keyword is folded; the full output is saved to a file',
};
const unexpected = rows.filter((r) => r.lost.length && !(r.name in EXPECTED_LOSS));
const stale = Object.keys(EXPECTED_LOSS).filter((n) => !rows.find((r) => r.name === n && r.lost.length));
if (args.includes('--strict') && (unexpected.length || stale.length)) process.exit(1);
