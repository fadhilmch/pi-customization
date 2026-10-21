'use strict';
const brave = require('./providers/brave.js');
const tavily = require('./providers/tavily.js');
const { stripHtml } = require('./providers/common.js');

const PROVIDERS = { brave, tavily };

function normalizeResults(input, maxResults = 5) {
  const out = [];
  const seen = new Set();
  for (const item of input || []) {
    let url;
    try { url = new URL(String(item.url || '')); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    url.hash = '';
    const normalized = url.href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const title = stripHtml(item.title).slice(0, 300);
    if (!title) continue;
    out.push({ title, url: normalized.slice(0, 2000), snippet: stripHtml(item.snippet).slice(0, 200) });
    if (out.length >= maxResults) break;
  }
  return out;
}

async function search(query, config, env = process.env, fetch = globalThis.fetch, maxResults, signal) {
  const cfg = config.search || {};
  const apiKey = env[cfg.apiKeyEnv || 'BRAVE_API_KEY'];
  if (!apiKey) throw new Error(`Set ${cfg.apiKeyEnv || 'BRAVE_API_KEY'} to enable web_search`);
  const provider = PROVIDERS[cfg.provider || 'brave'];
  if (!provider) throw new Error(`Unknown web search provider: ${cfg.provider}`);
  const count = Math.min(10, Math.max(1, Math.floor(Number(maxResults) || cfg.maxResults || 5)));
  const timeout = AbortSignal.timeout(Math.max(1, Number(config.timeoutSeconds) || 20) * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const results = await provider({ query: String(query), count, signal: requestSignal, fetch, apiKey });
  return normalizeResults(results, count);
}

module.exports = { PROVIDERS, normalizeResults, search };
