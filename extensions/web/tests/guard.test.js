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

test('URL-form tricks for loopback and metadata hosts are rejected', async () => {
  const urls = [
    'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/', 'http://localhost./', 'http://app.localhost/',
    'http://[::ffff:127.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[::7f00:1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/',
    'http://[::ffff:169.254.169.254]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::1]/', 'http://2852039166/',
  ];
  for (const url of urls) await assert.rejects(isAllowedUrl(url, {}, publicLookup), /private|link-local/, url);
  for (const url of ['http://2852039166/', 'http://[::ffff:169.254.169.254]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::1]/']) {
    await assert.rejects(isAllowedUrl(url, { allowPrivate: true }, publicLookup), /link-local/, url);
  }
});

test('allowPrivate still blocks 0.0.0.0/8 and the unspecified IPv6 address', async () => {
  for (const url of ['http://0.0.0.0/', 'http://0/', 'http://0.1.2.3/', 'http://[::]/', 'http://[::0.0.0.0]/']) {
    await assert.rejects(isAllowedUrl(url, { allowPrivate: true }, publicLookup), /unspecified/, url);
  }
  await assert.rejects(isAllowedUrl('http://host.test/', { allowPrivate: true }, async () => [{ address: '0.0.0.0' }]), /unspecified/);
  assert.equal((await isAllowedUrl('http://127.0.0.1/', { allowPrivate: true }, publicLookup)).hostname, '127.0.0.1');
  assert.equal((await isAllowedUrl('http://[::1]/', { allowPrivate: true }, publicLookup)).hostname, '[::1]');
});

test('shared, multicast and broadcast ranges count as private', async () => {
  for (const address of ['100.64.0.1', '100.127.255.254', '192.0.0.8', '224.0.0.1', '239.255.255.250', '255.255.255.255', 'ff02::1', 'fec0::1', '::2']) {
    await assert.rejects(isAllowedUrl('http://host.test/', {}, async () => [{ address }]), /private|unspecified/, address);
    if (address !== '::2') await isAllowedUrl('http://host.test/', { allowPrivate: true }, async () => [{ address }]);
  }
  for (const address of ['100.63.255.255', '100.128.0.1', '192.0.2.1', '2001:db8::1', '2606:4700::1111', '64:ff9b::808:808', '2002:808:808::1']) {
    await isAllowedUrl('http://host.test/', {}, async () => [{ address }]);
  }
});

test('any private address among several DNS answers rejects the host', async () => {
  await assert.rejects(isAllowedUrl('http://host.test/', {}, async () => [{ address: '203.0.113.2' }, { address: '10.0.0.1' }]), /private/);
});
