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
