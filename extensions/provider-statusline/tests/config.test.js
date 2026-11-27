const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULTS, parseBudget, mergeConfig, configFromEnv, envName, loadConfig, parseBool } = require('../config.js');

test('defaults keep every segment on', () => {
  assert.ok(Object.values(DEFAULTS).every((v) => v === true));
  assert.deepEqual(mergeConfig(), { ...DEFAULTS });
});

test('mergeConfig lets later layers win and ignores junk', () => {
  const merged = mergeConfig(
    { cost: false, cwd: false, bogus: false, quota: 'nope' },
    null,
    ['array'],
    { cwd: true, pullRequest: 'off' },
  );
  assert.equal(merged.cost, false);
  assert.equal(merged.cwd, true);
  assert.equal(merged.pullRequest, false);
  assert.equal(merged.quota, true);
  assert.equal('bogus' in merged, false);
});

test('parseBool accepts common spellings', () => {
  assert.equal(parseBool('0'), false);
  assert.equal(parseBool('Off'), false);
  assert.equal(parseBool('yes'), true);
  assert.equal(parseBool(1), true);
  assert.equal(parseBool('maybe'), undefined);
  assert.equal(parseBool(undefined), undefined);
});

test('env var names are PI_STATUSLINE_<SNAKE_KEY>', () => {
  assert.equal(envName('codexQuotaFetch'), 'PI_STATUSLINE_CODEX_QUOTA_FETCH');
  assert.deepEqual(configFromEnv({ PI_STATUSLINE_CODEX_QUOTA_FETCH: '0', PI_STATUSLINE_COST: 'x' }), { codexQuotaFetch: false });
});

test('loadConfig: env overrides file, file overrides defaults, bad file is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-'));
  const file = path.join(dir, 'statusline.json');
  fs.writeFileSync(file, JSON.stringify({ cost: false, gitBranch: false }));
  const cfg = loadConfig({ PI_STATUSLINE_CONFIG: file, PI_STATUSLINE_GIT_BRANCH: '1' });
  assert.equal(cfg.cost, false);
  assert.equal(cfg.gitBranch, true);
  assert.equal(cfg.quota, true);

  fs.writeFileSync(file, '{not json');
  assert.deepEqual(loadConfig({ PI_STATUSLINE_CONFIG: file }), { ...DEFAULTS });
  assert.deepEqual(loadConfig({ PI_STATUSLINE_CONFIG: path.join(dir, 'missing.json') }), { ...DEFAULTS });
});

test('budget is numeric, positive, optional and overridable by env', () => {
  assert.equal('budget' in mergeConfig(), false);
  assert.equal(mergeConfig({ budget: 5 }).budget, 5);
  assert.equal(mergeConfig({ budget: '2.5' }).budget, 2.5);
  for (const bad of [0, -1, 'abc', null, true, NaN]) assert.equal(parseBudget(bad), undefined);
  assert.equal('budget' in mergeConfig({ budget: 0 }), false);
  assert.deepEqual(configFromEnv({ PI_STATUSLINE_BUDGET: '3' }), { budget: 3 });
});
