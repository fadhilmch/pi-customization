const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedUrl } = require('../guard.js');

const publicLookup = async () => [{ address: '203.0.113.2', family: 4 }];

test('URL guard allows only HTTP(S) public hosts', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)']) {
    await assert.rejects(isAllowedUrl(url, {}, publicLookup), /http or https/);
  }
  assert.equal((await isAllowedUrl('https://example.com/docs', {}, publicLookup)).hostname, 'example.com');
});

test('URL guard rejects loopback, private, link-local and unspecified addresses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.3', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1']) {
    await assert.rejects(isAllowedUrl('http://host.test/', {}, async () => [{ address }]), /private|link-local/);
  }
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/']) {
    await assert.rejects(isAllowedUrl(url, {}, publicLookup), /private|link-local/);
  }
});

test('allowPrivate admits private addresses but never link-local metadata', async () => {
  assert.equal((await isAllowedUrl('http://host.test/', { allowPrivate: true }, async () => [{ address: '127.0.0.1' }])).hostname, 'host.test');
  await assert.rejects(isAllowedUrl('http://host.test/', { allowPrivate: true }, async () => [{ address: '169.254.169.254' }]), /link-local/);
});

test('URL guard normalizes IPv4-mapped IPv6 and rejects invalid DNS answers', async () => {
  await assert.rejects(isAllowedUrl('http://host.test/', {}, async () => [{ address: '::ffff:7f00:1' }]), /private/);
  await assert.rejects(isAllowedUrl('http://host.test/', { allowPrivate: true }, async () => [{ address: '::ffff:a9fe:a9fe' }]), /link-local/);
  await assert.rejects(isAllowedUrl('http://host.test/', {}, async () => [{ address: 'not-an-ip' }]), /invalid IP/);
});

test('URL guard applies blocked and allowed domain lists including subdomains', async () => {
  await assert.rejects(isAllowedUrl('https://a.blocked.test', { blockedDomains: ['blocked.test'] }, publicLookup), /blocked domain/);
  await assert.rejects(isAllowedUrl('https://example.com', { allowedDomains: ['docs.test'] }, publicLookup), /not in allowed/);
  assert.equal((await isAllowedUrl('https://a.docs.test', { allowedDomains: ['docs.test'] }, publicLookup)).hostname, 'a.docs.test');
});
