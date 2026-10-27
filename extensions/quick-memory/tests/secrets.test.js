const test = require('node:test');
const assert = require('node:assert/strict');
const { findSecret, entropy } = require('../secrets.js');

test('findSecret flags common credential formats', () => {
  const hits = [
    'aws key AKIAIOSFODNN7EXAMPLE',
    'use ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
    'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789',
    'slack xoxb-123456789012-abcdefghijkl',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----',
    'openai sk-proj-abcdefghijklmnopqrstuvwx1234',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
    'db password=Zx9fQ2mK7vLp4Rt8Yw1B',
    'TOKEN: a8Fk29dLq0Zx7VbN3mPq',
  ];
  for (const t of hits) assert.ok(findSecret(t), t);
});

test('findSecret leaves ordinary notes alone', () => {
  const ok = [
    'always use pnpm, never npm',
    'tests run with make check',
    'set password=changeme in dev', // short
    'the token: refresh-the-session-before-running', // no digit, low entropy
    'password=aaaaaaaaaaaaaaaaaaaa1', // long but low entropy
    'sk-short',
    'see AKIA docs',
    '',
    undefined,
  ];
  for (const t of ok) assert.equal(findSecret(t), null, String(t));
  assert.equal(entropy('aaaa'), 0);
});
