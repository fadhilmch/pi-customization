const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitStatus, formatGitStatus } = require('../git.js');
const { getSessionCostInfo, getCacheHitPct, budgetLevel } = require('../cost.js');

test('parseGitStatus counts entries and reads ahead/behind', () => {
  const out = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.js',
    '1 M. N... 100644 100644 100644 a b src/b.js',
    '? new.txt',
  ].join('\n');
  assert.deepEqual(parseGitStatus(out), { dirty: 3, ahead: 2, behind: 1 });
  assert.deepEqual(parseGitStatus('# branch.head main\n'), { dirty: 0, ahead: 0, behind: 0 });
  assert.deepEqual(parseGitStatus(''), { dirty: 0, ahead: 0, behind: 0 });
});

test('formatGitStatus hides zero parts', () => {
  assert.equal(formatGitStatus({ dirty: 3, ahead: 2, behind: 1 }), '*3 ↑2 ↓1');
  assert.equal(formatGitStatus({ dirty: 0, ahead: 2, behind: 0 }), '↑2');
  assert.equal(formatGitStatus({ dirty: 0, ahead: 0, behind: 0 }), '');
  assert.equal(formatGitStatus(null), '');
});

const branch = (...usages) => ({ sessionManager: { getBranch: () => usages.map((usage) => ({ type: 'message', message: { role: 'assistant', usage } })) } });

test('getCacheHitPct is cache reads over all input tokens', () => {
  const ctx = branch({ input: 100, cacheRead: 800, cacheWrite: 100 }, { input: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(getCacheHitPct(ctx), 80);
  assert.equal(getCacheHitPct(branch({ input: 100 })), null);
  assert.equal(getCacheHitPct(branch()), null);
});

test('getSessionCostInfo returns text and numeric total; budgetLevel thresholds', () => {
  const info = getSessionCostInfo(branch({ input: 1, cost: { total: 0.5 } }, { input: 1, cost: { total: 0.25 } }));
  assert.equal(info.text, '$0.750');
  assert.equal(info.total, 0.75);
  assert.equal(budgetLevel(0.79, 1), 'ok');
  assert.equal(budgetLevel(0.8, 1), 'warn');
  assert.equal(budgetLevel(0.99, 1), 'warn');
  assert.equal(budgetLevel(1, 1), 'error');
  assert.equal(budgetLevel(5, undefined), null);
});
