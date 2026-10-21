'use strict';
const { parseResponse } = require('./common.js');
const { stripHtml } = require('./common.js');

async function tavily({ query, count, signal, fetch = globalThis.fetch, apiKey }) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: count }),
  });
  const data = await parseResponse(response, 'Tavily');
  return (data.results || []).map((result) => ({ title: stripHtml(result.title), url: result.url, snippet: stripHtml(result.content) }));
}

module.exports = tavily;
