'use strict';
const { parseResponse } = require('./common.js');
const { stripHtml } = require('./common.js');

// https://exa.ai/docs/reference/search: highlights are short query-relevant excerpts, used as the snippet.
async function exa({ query, count, signal, fetch = globalThis.fetch, apiKey }) {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, numResults: count, type: 'auto', contents: { highlights: true } }),
  });
  const data = await parseResponse(response, 'Exa');
  return (data.results || []).map((result) => ({
    title: stripHtml(result.title),
    url: result.url,
    snippet: stripHtml((Array.isArray(result.highlights) && result.highlights.join(' … ')) || result.summary || ''),
  }));
}

module.exports = exa;
