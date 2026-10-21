const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchPage, clearCache, rewriteKnownUrl } = require('../fetch.js');

async function server(handler) {
  const srv = http.createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { srv, url: `http://127.0.0.1:${srv.address().port}` };
}

test('rewrites GitHub blob URLs to the raw file host', () => {
  assert.equal(rewriteKnownUrl('https://github.com/org/repo/blob/main/docs/a.md'), 'https://raw.githubusercontent.com/org/repo/main/docs/a.md');
});

test('fetch follows validated redirects and caches by requested URL', async (t) => {
  let requests = 0;
  const { srv, url } = await server((req, res) => {
    requests++;
    if (req.url === '/one') { res.writeHead(302, { location: '/two' }).end(); return; }
    res.writeHead(200, { 'content-type': 'text/markdown' }).end('# Ready');
  });
  t.after(() => srv.close());
  clearCache();
  const opts = { config: { allowPrivate: true }, timeoutMs: 1000 };
  const first = await fetchPage(`${url}/one`, opts);
  const second = await fetchPage(`${url}/one`, opts);
  assert.equal(first.url, `${url}/two`);
  assert.equal(first.text, '# Ready');
  assert.equal(second.cached, true);
  assert.equal(requests, 2);
  assert.equal((await fetchPage(`${url}/two`, opts)).cached, true, 'final URL uses the same cached entry');
});

test('cache entries are revalidated against the current URL and domain policy', async (t) => {
  const { srv, url } = await server((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('public'));
  t.after(() => srv.close());
  clearCache();
  await fetchPage(url, { config: { allowPrivate: true } });
  await assert.rejects(fetchPage(url, { config: { allowPrivate: false } }), /private/);
  await assert.rejects(fetchPage(url, { config: { allowPrivate: true, blockedDomains: ['127.0.0.1'] } }), /blocked domain/);
});

test('fetch rejects blocked redirect targets and stops redirect loops', async (t) => {
  const { srv, url } = await server((req, res) => {
    if (req.url === '/to-local') { res.writeHead(302, { location: `http://localhost:${srv.address().port}/` }).end(); return; }
    res.writeHead(302, { location: '/loop' }).end();
  });
  t.after(() => srv.close());
  const opts = { config: { allowPrivate: true, blockedDomains: ['localhost'] }, timeoutMs: 1000 };
  await assert.rejects(fetchPage(`${url}/to-local`, opts), /blocked domain/);
  await assert.rejects(fetchPage(`${url}/loop`, { ...opts, config: { allowPrivate: true } }), /more than 5 redirects/);
});

test('fetch caps bodies at 5 MB and rejects non-text types', async (t) => {
  const { srv, url } = await server((req, res) => {
    if (req.url === '/binary') { res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([1, 2])); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(6 * 1024 * 1024));
  });
  t.after(() => srv.close());
  const opts = { config: { allowPrivate: true }, timeoutMs: 2000 };
  const body = await fetchPage(`${url}/large`, opts);
  assert.equal(Buffer.byteLength(body.text), 5 * 1024 * 1024);
  assert.equal(body.bodyTruncated, true);
  await assert.rejects(fetchPage(`${url}/binary`, opts), /Unsupported content type: image\/png/);
});

test('fetch honors timeout and caller abort signals', async (t) => {
  const { srv, url } = await server((_req, res) => setTimeout(() => res.end('late'), 250));
  t.after(() => srv.close());
  await assert.rejects(fetchPage(url, { config: { allowPrivate: true }, timeoutMs: 20 }), /timed out/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchPage(url, { config: { allowPrivate: true }, timeoutMs: 1000, signal: controller.signal }), /aborted/);
});

const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { CACHE_MAX_ENTRIES } = require('../fetch.js');

const priv = { config: { allowPrivate: true }, timeoutMs: 2000 };
const publicIp = async () => [{ address: '203.0.113.2', family: 4 }];

test('missing Content-Type is sniffed and any text type is accepted', async (t) => {
  const { srv, url } = await server((req, res) => {
    const bodies = {
      '/html': ['', '<html><body><h1>Sniffed</h1></body></html>'],
      '/fragment': ['', '<p>frag</p>'],
      '/plain': ['', 'just words'],
      '/binary': ['', Buffer.from([0, 1, 2, 3])],
      '/csv': ['text/csv', 'a,b\n1,2'],
      '/xml': ['application/xml', '<a>1</a>'],
      '/js': ['application/javascript', 'let a = 1 < 2;'],
      '/yaml': ['application/x-yaml', 'k: v'],
      '/rss': ['application/rss+xml', '<rss/>'],
    };
    const [type, body] = bodies[req.url];
    res.writeHead(200, type ? { 'content-type': type } : {}).end(body);
  });
  t.after(() => srv.close());
  clearCache();
  assert.equal((await fetchPage(`${url}/html`, priv)).text, '# Sniffed');
  assert.equal((await fetchPage(`${url}/fragment`, priv)).text, 'frag');
  assert.equal((await fetchPage(`${url}/plain`, priv)).text, 'just words');
  await assert.rejects(fetchPage(`${url}/binary`, priv), /Unsupported content type: \(missing\)/);
  assert.equal((await fetchPage(`${url}/csv`, priv)).text, 'a,b\n1,2');
  assert.equal((await fetchPage(`${url}/xml`, priv)).text, '<a>1</a>');
  assert.equal((await fetchPage(`${url}/js`, priv)).text, 'let a = 1 < 2;');
  assert.equal((await fetchPage(`${url}/yaml`, priv)).text, 'k: v');
  assert.equal((await fetchPage(`${url}/rss`, priv)).text, '<rss/>');
});

test('JSON is pretty-printed, and invalid or truncated JSON falls back to raw text', async (t) => {
  const { srv, url } = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(req.url === '/ok' ? '{"a":1}' : '{"items":[' + '1,'.repeat(100));
  });
  t.after(() => srv.close());
  clearCache();
  assert.equal((await fetchPage(`${url}/ok`, priv)).text, '{\n  "a": 1\n}');
  const cut = await fetchPage(`${url}/cut`, { ...priv, maxBytes: 20 });
  assert.equal(cut.bodyTruncated, true);
  assert.equal(cut.text, '{"items":[1,1,1,1,1,');
});

test('charset from Content-Type is honoured with a utf-8 fallback', async (t) => {
  const { srv, url } = await server((req, res) => {
    if (req.url === '/latin') res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' }).end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    else res.writeHead(200, { 'content-type': 'text/plain; charset=made-up' }).end('café');
  });
  t.after(() => srv.close());
  clearCache();
  assert.equal((await fetchPage(`${url}/latin`, priv)).text, 'café');
  assert.equal((await fetchPage(`${url}/bogus`, priv)).text, 'café');
});

test('compressed responses are decoded and no cookies or auth are sent', async (t) => {
  const seen = [];
  const { srv, url } = await server((req, res) => {
    seen.push(req.headers);
    const body = Buffer.from('# compressed '.repeat(50));
    const encodings = { '/gzip': ['gzip', zlib.gzipSync], '/deflate': ['deflate', zlib.deflateSync], '/br': ['br', zlib.brotliCompressSync] };
    const [encoding, compress] = encodings[req.url];
    res.writeHead(200, { 'content-type': 'text/markdown', 'content-encoding': encoding }).end(compress(body));
  });
  t.after(() => srv.close());
  clearCache();
  for (const name of ['gzip', 'deflate', 'br']) assert.equal((await fetchPage(`${url}/${name}`, priv)).text, '# compressed '.repeat(50), name);
  assert.match(seen[0]['accept-encoding'], /gzip.*br/);
  assert.match(seen[0]['user-agent'], /web-fetch/);
  assert.equal(seen[0].cookie, undefined);
  assert.equal(seen[0].authorization, undefined);
});

test('the 5 MB cap applies to decompressed bytes', async (t) => {
  const { srv, url } = await server((_req, res) => res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }).end(zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 'a'))));
  t.after(() => srv.close());
  clearCache();
  const page = await fetchPage(url, priv);
  assert.equal(page.bodyTruncated, true);
  assert.equal(page.text.length, 5 * 1024 * 1024);
});

test('redirects to private targets are refused when allowPrivate is false', async (t) => {
  const original = http.request;
  const locations = ['http://10.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://inner.test/'];
  let hops = 0;
  http.request = (_options, onResponse) => {
    const req = new EventEmitter();
    req.end = () => setImmediate(() => onResponse({ statusCode: 302, headers: { location: locations[hops++] }, destroy() {} }));
    return req;
  };
  t.after(() => { http.request = original; });
  const lookup = async (host) => [{ address: host === 'inner.test' ? '10.1.2.3' : '203.0.113.2', family: 4 }];
  for (const target of locations) {
    clearCache();
    hops = locations.indexOf(target);
    await assert.rejects(fetchPage('http://start.test/', { config: {}, lookup, timeoutMs: 1000 }), /private or loopback/, target);
  }
});

test('DNS rebinding cannot reach a private address through the socket lookup', async (t) => {
  let requests = 0;
  const { srv } = await server((_req, res) => { requests++; res.writeHead(200, { 'content-type': 'text/plain' }).end('secret'); });
  t.after(() => srv.close());
  const port = srv.address().port;
  for (const [config, second, message] of [[{}, '127.0.0.1', /private or loopback/], [{ allowPrivate: true }, '169.254.169.254', /link-local/]]) {
    clearCache();
    let calls = 0;
    const lookup = async () => [{ address: calls++ === 0 ? '203.0.113.2' : second, family: 4 }];
    await assert.rejects(fetchPage(`http://rebind.test:${port}/`, { config, lookup, timeoutMs: 1000 }), message);
    assert.ok(calls >= 2, 'the socket asked for its own, validated resolution');
  }
  assert.equal(requests, 0);
});

test('the socket connects to the address that was validated', async (t) => {
  const { srv } = await server((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('hello'));
  t.after(() => srv.close());
  clearCache();
  const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  const page = await fetchPage(`http://pinned.test:${srv.address().port}/`, { config: { allowPrivate: true }, lookup, timeoutMs: 1000 });
  assert.equal(page.text, 'hello');
});

test('a DNS lookup that never answers is cut off by the timeout and by abort', async () => {
  clearCache();
  const hang = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(fetchPage('http://slow-dns.test/', { config: {}, lookup: hang, timeoutMs: 50 }), /timed out/);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(fetchPage('http://slow-dns.test/', { config: {}, lookup: hang, timeoutMs: 5000, signal: controller.signal }), /aborted/);
  assert.ok(Date.now() - started < 2000);
});

test('the timeout and caller abort also cover a body that stalls mid-stream', async (t) => {
  const closed = [];
  const { srv, url } = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('partial');
    res.on('close', () => closed.push(true));
  });
  t.after(() => srv.close());
  clearCache();
  await assert.rejects(fetchPage(url, { ...priv, timeoutMs: 100 }), /timed out/);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(fetchPage(url, { ...priv, timeoutMs: 5000, signal: controller.signal }), /aborted/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed.length, 2, 'server-side connections were torn down');
});

test('a slowly streamed body stops at the cap and the connection is destroyed', async (t) => {
  let closed;
  const done = new Promise((resolve) => { closed = resolve; });
  const chunk = Buffer.alloc(1024 * 1024, 'x');
  const { srv, url } = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    let sent = 0;
    const timer = setInterval(() => { sent++; res.write(chunk); if (sent >= 200) clearInterval(timer); }, 5);
    res.on('close', () => { clearInterval(timer); closed(sent); });
  });
  t.after(() => srv.close());
  clearCache();
  const page = await fetchPage(url, { ...priv, timeoutMs: 10000 });
  assert.equal(page.bodyTruncated, true);
  assert.equal(page.text.length, 5 * 1024 * 1024);
  const sent = await done;
  assert.ok(sent < 100, `server stopped early (sent ${sent} MB)`);
});

test('the cache evicts the least recently used entries beyond the entry cap', async (t) => {
  const { srv, url } = await server((req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(`page ${req.url}`));
  t.after(() => srv.close());
  clearCache();
  const total = CACHE_MAX_ENTRIES + 5;
  for (let i = 0; i < total; i++) {
    await fetchPage(`${url}/${i}`, priv);
    if (i > 0) await fetchPage(`${url}/0`, priv);
  }
  assert.equal((await fetchPage(`${url}/0`, priv)).cached, true, 'recently used entry survives');
  assert.equal((await fetchPage(`${url}/1`, priv)).cached, false, 'oldest untouched entry was evicted');
  assert.equal((await fetchPage(`${url}/${total - 1}`, priv)).cached, true);
});

test('the cache also caps total cached text', async (t) => {
  const { srv, url } = await server((_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('y'.repeat(5 * 1024 * 1024)));
  t.after(() => srv.close());
  clearCache();
  for (let i = 0; i < 5; i++) await fetchPage(`${url}/${i}`, priv);
  assert.equal((await fetchPage(`${url}/4`, priv)).cached, true);
  assert.equal((await fetchPage(`${url}/0`, priv)).cached, false, '5 x 5 MB exceeds the 20 MB budget, so the first was dropped');
});
