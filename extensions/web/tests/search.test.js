const test = require('node:test');
const assert = require('node:assert/strict');
const { search, normalizeResults } = require('../search.js');
const brave = require('../providers/brave.js');
const tavily = require('../providers/tavily.js');

test('Brave provider sends documented endpoint, count and token header then normalizes results', async () => {
  let request;
  const fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ web: { results: [
      { title: '<strong>Docs</strong>', url: 'https://docs.test/a', description: 'A <b>useful</b> result' },
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const results = await brave({ query: 'agent framework', count: 3, apiKey: 'secret', fetch });
  assert.match(request.url, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.equal(new URL(request.url).searchParams.get('count'), '3');
  assert.equal(request.init.headers['X-Subscription-Token'], 'secret');
  assert.equal(request.init.redirect, 'error');
  assert.deepEqual(results, [{ title: 'Docs', url: 'https://docs.test/a', snippet: 'A useful result' }]);
});

test('Tavily provider posts documented query fields with bearer auth', async () => {
  let request;
  const fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ results: [{ title: 'Docs', url: 'https://docs.test/a', content: 'Snippet' }] }), { status: 200 });
  };
  const results = await tavily({ query: 'question', count: 2, apiKey: 'secret', fetch });
  assert.equal(request.url, 'https://api.tavily.com/search');
  assert.deepEqual(JSON.parse(request.init.body), { query: 'question', max_results: 2 });
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
  assert.equal(request.init.redirect, 'error');
  assert.equal(results[0].snippet, 'Snippet');
});

test('search strips markup, drops duplicate and invalid URLs, caps results and reports provider errors', async () => {
  const raw = [
    { title: '<b>A</b>', url: 'https://docs.test/a', snippet: '<i>first</i>' },
    { title: 'A again', url: 'https://docs.test/a#fragment', snippet: 'duplicate' },
    { title: 'Bad', url: 'javascript:alert(1)', snippet: 'bad' },
    { title: 'B', url: 'https://docs.test/b', snippet: 'b'.repeat(220) },
  ];
  assert.deepEqual(normalizeResults(raw, 1), [{ title: 'A', url: 'https://docs.test/a', snippet: 'first' }]);
  assert.match(normalizeResults(raw, 5)[1].snippet, /^b{200}$/);
  await assert.rejects(brave({ query: 'x', count: 1, apiKey: 'hidden-key', fetch: async () => new Response('', { status: 401 }) }), /Brave API key rejected/);
  await assert.rejects(tavily({ query: 'x', count: 1, apiKey: 'hidden-key', fetch: async () => new Response('', { status: 429 }) }), /rate limited, try again later/);
});

test('search reads only the configured user environment key and never returns it', async () => {
  let receivedSignal;
  const fetch = async (_url, init) => {
    receivedSignal = init.signal;
    assert.equal(init.headers['X-Subscription-Token'], 'secret-value');
    return new Response(JSON.stringify({ web: { results: [{ title: 'T', url: 'https://docs.test', description: 'S' }] } }), { status: 200 });
  };
  const result = await search('query', { timeoutSeconds: 2, search: { provider: 'brave', apiKeyEnv: 'MY_SEARCH_KEY', maxResults: 5 } }, { MY_SEARCH_KEY: 'secret-value' }, fetch, 5);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.doesNotMatch(JSON.stringify(result), /secret-value/);
  assert.doesNotMatch(JSON.stringify({ result, details: {} }), /secret-value/);
});
