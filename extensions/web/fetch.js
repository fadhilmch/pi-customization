'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');
const { isAllowedUrl, resolveHost, assertAddressesAllowed } = require('./guard.js');
const { htmlToMarkdown } = require('./html.js');

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const CACHE_MAX_CHARS = 20 * 1024 * 1024;
const cache = new Map();
const ACCEPT = 'text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5';
const ACCEPT_ENCODING = 'gzip, deflate, br';
const DECODERS = { gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };
const TEXT_APPLICATION = /^application\/(?:xml|javascript|x-javascript|ecmascript|x-yaml|yaml|toml|x-toml|x-sh|x-httpd-php)$|^application\/[\w.+-]+\+xml$/;

function rewriteKnownUrl(value) {
  const url = new URL(value);
  if (url.hostname === 'github.com') {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}${url.search}`;
  }
  return url.href;
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('Fetch aborted');
}

// Rejects as soon as the signal aborts, so a DNS lookup that never answers cannot outlive the timeout.
function untilAborted(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// Socket-level DNS hook: resolves, validates EVERY answer with the guard's rules, and only then hands the
// addresses to the socket, so the IP we connect to is always one that was checked (no DNS rebinding window).
function guardedLookup(config, lookup, signal) {
  return (hostname, opts, callback) => {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    let settled = false;
    const settle = (error, addresses) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) callback(error);
      else if (opts?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family || net.isIP(addresses[0].address));
    };
    const onAbort = () => settle(abortError(signal));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => resolveHost(hostname, lookup))
      .then((addresses) => {
        assertAddressesAllowed(addresses, config, hostname);
        settle(null, addresses.map((entry) => ({ address: entry.address, family: entry.family || net.isIP(entry.address) })));
      })
      .catch((error) => settle(error));
  };
}

function requestOnce(url, { config, lookup, signal }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: false,
      lookup: guardedLookup(config, lookup, signal),
      headers: { Accept: ACCEPT, 'Accept-Encoding': ACCEPT_ENCODING, 'User-Agent': 'pi-customization-web-fetch/1.0' },
      signal,
    }, resolve);
    req.once('error', reject);
    req.end();
  });
}

// Reads at most maxBytes of the (decompressed) body; once the cap is hit the connection is destroyed.
function readLimited(response, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const encoding = String(response.headers['content-encoding'] || 'identity').trim().toLowerCase();
    const create = DECODERS[encoding];
    if (!create && encoding !== 'identity') { response.destroy(); reject(new Error(`Unsupported content encoding: ${encoding}`)); return; }
    const stream = create ? response.pipe(create()) : response;
    const chunks = [];
    let total = 0;
    let truncated = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (truncated || error) { response.destroy(); stream.destroy(); }
      if (error) { reject(error); return; }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      resolve({ bytes, truncated });
    };
    const onAbort = () => finish(abortError(signal));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      const remaining = maxBytes - total;
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, Math.max(0, remaining)));
        total = maxBytes;
        truncated = true;
        finish();
        return;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    });
    stream.once('end', () => finish());
    stream.once('error', (error) => finish(error));
    response.once('error', (error) => finish(error));
    response.once('close', () => { if (!response.complete) finish(new Error('Connection closed before the response finished')); });
  });
}

function decodeBytes(bytes, contentType) {
  const charset = contentType.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  if (charset) {
    try { return new TextDecoder(charset, { fatal: false }).decode(bytes); } catch { /* unknown charset: use utf-8 */ }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// Returns { text, type } where type is the media type used (sniffed when the server sent none).
function contentToText(bytes, contentType, baseUrl, truncated = false) {
  let type = contentType.split(';')[0].trim().toLowerCase();
  const raw = decodeBytes(bytes, contentType);
  if (!type) {
    if (bytes.subarray(0, 1024).includes(0)) throw new Error('Unsupported content type: (missing)');
    type = /^\s*</.test(raw) || /<html[\s>]/i.test(raw.slice(0, 4096)) ? 'text/html' : 'text/plain';
  }
  if (type === 'text/html' || type === 'application/xhtml+xml') return { text: htmlToMarkdown(raw, baseUrl), type };
  if (type === 'application/json' || type.endsWith('+json')) {
    // A body cut at the cap is not valid JSON; hand back the raw text rather than failing.
    try { return { text: JSON.stringify(JSON.parse(raw), null, 2), type }; } catch { return { text: raw, type }; }
  }
  if (type.startsWith('text/') || TEXT_APPLICATION.test(type)) return { text: raw, type };
  throw new Error(`Unsupported content type: ${type}`);
}

function cacheDrop(entry) { for (const key of entry.keys) if (cache.get(key) === entry) cache.delete(key); }

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= CACHE_TTL_MS) { cacheDrop(entry); return null; }
  for (const k of entry.keys) { cache.delete(k); cache.set(k, entry); }
  return entry;
}

function cacheSet(keys, result) {
  const entry = { at: Date.now(), result, keys: [...new Set(keys)], size: result.text.length };
  if (entry.size > CACHE_MAX_CHARS) return;
  for (const key of entry.keys) { const old = cache.get(key); if (old) cacheDrop(old); cache.set(key, entry); }
  // Maps iterate oldest-touched first, so evict from the front until entry count and total size fit.
  while (true) {
    const unique = new Set(cache.values());
    let chars = 0;
    for (const e of unique) chars += e.size;
    if (unique.size <= CACHE_MAX_ENTRIES && chars <= CACHE_MAX_CHARS) return;
    cacheDrop(cache.values().next().value);
  }
}

async function fetchPage(value, options = {}) {
  const config = options.config || {};
  const lookup = options.lookup;
  const timeoutMs = options.timeoutMs ?? Math.max(1, Number(config.timeoutSeconds) || 20) * 1000;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const started = Date.now();
  const initial = rewriteKnownUrl(value);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [timeoutSignal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let current = initial;
  const allowed = (target) => untilAborted(isAllowedUrl(target, config, lookup), signal);
  let redirects = 0;
  try {
    const cached = cacheGet(initial);
    if (cached) {
      await allowed(initial);
      await allowed(cached.result.url);
      return { ...cached.result, cached: true, elapsedMs: Date.now() - started };
    }
    while (true) {
      const url = await allowed(current);
      const response = await requestOnce(url, { config, lookup, signal });
      const status = response.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        const location = response.headers.location;
        if (!location) throw new Error(`Redirect ${status} without a Location header`);
        if (redirects >= 5) throw new Error('Stopped after more than 5 redirects');
        current = new URL(location, url).href;
        redirects++;
        continue;
      }
      if (status < 200 || status > 299) {
        response.destroy();
        throw new Error(`HTTP ${status} ${response.statusMessage || ''}`.trim());
      }
      const contentType = String(response.headers['content-type'] || '');
      const result = await readLimited(response, maxBytes, signal);
      const page = contentToText(result.bytes, contentType, url.href, result.truncated);
      const body = {
        url: url.href,
        text: page.text,
        contentType: page.type,
        bodyTruncated: result.truncated,
        elapsedMs: Date.now() - started,
        cached: false,
      };
      cacheSet([initial, body.url], body);
      return body;
    }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Fetch aborted by caller', { cause: error });
    if (timeoutSignal.aborted) throw new Error(`Fetch timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  }
}

function clearCache() { cache.clear(); }

module.exports = { MAX_BODY_BYTES, CACHE_TTL_MS, CACHE_MAX_ENTRIES, CACHE_MAX_CHARS, ACCEPT, rewriteKnownUrl, readLimited, fetchPage, clearCache };
