'use strict';
const { isAllowedUrl } = require('./guard.js');
const { htmlToMarkdown } = require('./html.js');

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();
const ACCEPT = 'text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5';

function rewriteKnownUrl(value) {
  const url = new URL(value);
  if (url.hostname === 'github.com') {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}${url.search}`;
  }
  return url.href;
}

async function readLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes: bytes.slice(0, maxBytes), truncated: bytes.byteLength > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, Math.max(0, remaining)));
        total = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, truncated };
}

function contentToText(bytes, contentType, baseUrl) {
  const type = contentType.split(';')[0].trim().toLowerCase();
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (type === 'text/markdown' || type === 'text/plain') return raw;
  if (type === 'application/json' || type.endsWith('+json')) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); }
    catch { throw new Error('Invalid JSON response'); }
  }
  if (type === 'text/html' || type === 'application/xhtml+xml') return htmlToMarkdown(raw, baseUrl);
  throw new Error(`Unsupported content type: ${type || '(missing)'}`);
}

async function fetchPage(value, options = {}) {
  const config = options.config || {};
  const request = options.fetch || globalThis.fetch;
  const lookup = options.lookup;
  const timeoutMs = options.timeoutMs ?? Math.max(1, Number(config.timeoutSeconds) || 20) * 1000;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const started = Date.now();
  const initial = rewriteKnownUrl(value);
  const cached = cache.get(initial);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    await isAllowedUrl(initial, config, lookup);
    await isAllowedUrl(cached.result.url, config, lookup);
    return { ...cached.result, cached: true, elapsedMs: Date.now() - started };
  }
  if (cached) cache.delete(initial);

  let current = initial;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [timeoutSignal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let redirects = 0;
  try {
    while (true) {
      const url = await isAllowedUrl(current, config, lookup);
      const response = await request(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { Accept: ACCEPT, 'User-Agent': 'pi-customization-web-fetch/1.0' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error(`Redirect ${response.status} without a Location header`);
        if (redirects >= 5) throw new Error('Stopped after more than 5 redirects');
        current = new URL(location, url).href;
        redirects++;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
      }
      const contentType = response.headers.get('content-type') || '';
      const result = await readLimited(response, maxBytes);
      const text = contentToText(result.bytes, contentType, url.href);
      const body = {
        url: url.href,
        text,
        contentType: contentType.split(';')[0].trim().toLowerCase(),
        bodyTruncated: result.truncated,
        elapsedMs: Date.now() - started,
        cached: false,
      };
      const entry = { at: Date.now(), result: body };
      cache.set(initial, entry);
      cache.set(body.url, entry);
      return body;
    }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Fetch aborted by caller', { cause: error });
    if (timeoutSignal.aborted) throw new Error(`Fetch timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  }
}

function clearCache() { cache.clear(); }

module.exports = { MAX_BODY_BYTES, CACHE_TTL_MS, ACCEPT, rewriteKnownUrl, readLimited, fetchPage, clearCache };
