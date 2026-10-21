const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfigs, parseConfig, loadConfig, agentDir } = require('../config.js');
const { isAllowedUrl } = require('../guard.js');

test('config clamps user values, defaults private access off and search to Exa', () => {
  const cfg = parseConfig({ maxChars: 999999, timeoutSeconds: 0, allowPrivate: true, search: { provider: 'brave' } });
  assert.equal(cfg.maxChars, 50000);
  assert.equal(cfg.timeoutSeconds, 1);
  assert.equal(cfg.allowPrivate, true);
  assert.equal(parseConfig(null).allowPrivate, false);
  assert.equal(parseConfig(null).search.provider, 'exa');
  assert.equal(parseConfig(null).search.apiKeyEnv, 'EXA_API_KEY');
  // Choosing a provider without apiKeyEnv uses that provider's usual variable.
  assert.equal(parseConfig({ search: { provider: 'tavily' } }).search.apiKeyEnv, 'TAVILY_API_KEY');
  assert.equal(cfg.search.apiKeyEnv, 'BRAVE_API_KEY');
  assert.equal(parseConfig({ search: { provider: 'exa', apiKeyEnv: 'MY_EXA' } }).search.apiKeyEnv, 'MY_EXA');
  assert.equal(parseConfig({ search: { provider: 'bing' } }).search.provider, 'exa');
  assert.equal(parseConfig(null).exposure, 'direct');
  assert.equal(parseConfig({ exposure: 'bogus' }).exposure, 'direct');
  assert.equal(parseConfig({ exposure: 'deferred' }).exposure, 'deferred');
});

test('project config can only tighten limits and domains', () => {
  const cfg = mergeConfigs({ allowPrivate: true, maxChars: 12000, timeoutSeconds: 20, blockedDomains: ['bad.test'], allowedDomains: [] }, { allowPrivate: true, maxChars: 20000, timeoutSeconds: 60, blockedDomains: [], allowedDomains: ['docs.test'], search: { provider: 'tavily' } });
  assert.equal(cfg.allowPrivate, true);
  assert.equal(cfg.maxChars, 12000);
  assert.equal(cfg.timeoutSeconds, 20);
  assert.deepEqual(cfg.blockedDomains, ['bad.test']);
  assert.deepEqual(cfg.allowedDomains, ['docs.test']);
  assert.equal(cfg.search.provider, 'exa');
});

test('config loads user and project files from their supported locations', () => {
  const files = new Map([
    ['/agent/web.json', JSON.stringify({ maxChars: 8000, allowPrivate: true })],
    ['/project/.pi/web.json', JSON.stringify({ maxChars: 3000, blockedDomains: ['internal.test'] })],
  ]);
  const loaded = loadConfig({ cwd: '/project', env: { PI_CODING_AGENT_DIR: '/agent' }, readFile: (file) => {
    if (!files.has(file)) throw new Error('missing');
    return files.get(file);
  } });
  assert.equal(loaded.config.maxChars, 3000);
  assert.equal(loaded.config.allowPrivate, true);
  assert.deepEqual(loaded.config.blockedDomains, ['internal.test']);
});

test('project config cannot choose tool exposure', () => {
  const cfg = mergeConfigs({ exposure: 'deferred' }, { exposure: 'direct' });
  assert.equal(cfg.exposure, 'deferred');
});

test('disjoint project and user allowed domains create a deny-all policy', async () => {
  const cfg = mergeConfigs({ allowedDomains: ['a.test'] }, { allowedDomains: ['b.test'] });
  assert.equal(cfg.denyAllDomains, true);
  assert.deepEqual(cfg.allowedDomains, []);
  await assert.rejects(isAllowedUrl('https://a.test', cfg, async () => [{ address: '203.0.113.3' }]), /No domains are allowed/);
});

test('agentDir expands ~ in PI_CODING_AGENT_DIR like the other extensions', () => {
  assert.equal(agentDir({}, '/home/u'), '/home/u/.pi/agent');
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: '~' }, '/home/u'), '/home/u');
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: '~/pi-agent' }, '/home/u'), '/home/u/pi-agent');
  assert.equal(agentDir({ PI_CODING_AGENT_DIR: '/abs/agent' }, '/home/u'), '/abs/agent');
  const files = [];
  loadConfig({ env: { PI_CODING_AGENT_DIR: '~/pi-agent' }, home: '/home/u', readFile: (file) => { files.push(file); throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
  assert.deepEqual(files, ['/home/u/pi-agent/web.json']);
});
