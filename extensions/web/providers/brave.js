'use strict';
const { parseResponse } = require('./common.js');
const { stripHtml } = require('./common.js');

async function brave({ query, count, signal, fetch = globalThis.fetch, apiKey }) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  const response = await fetch(url.href, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  const data = await parseResponse(response, 'Brave');
  return (data.web?.results || []).map((result) => ({ title: stripHtml(result.title), url: result.url, snippet: stripHtml(result.description) }));
}

module.exports = brave;
