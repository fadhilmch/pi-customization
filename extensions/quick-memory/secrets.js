'use strict';
// Refuse to write obvious secrets into an instructions file (which is sent to the model on every
// prompt and is often committed). Pattern list, not a guarantee: findSecret returns a label or null.

const PATTERNS = [
  ['AWS access key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['Slack token', /\bxox[abeprs]-[A-Za-z0-9-]{10,}\b/],
  ['private key', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
];

// "password=...", "token: ..." followed by a long value; checked for entropy so prose is not refused.
const ASSIGNED = /\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)\s*[=:]\s*["']?([^\s"']{16,})/gi;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

const looksRandom = (v) => /[A-Za-z]/.test(v) && /\d/.test(v) && entropy(v) >= 3.5;

function findSecret(text) {
  const t = String(text ?? '');
  for (const [label, re] of PATTERNS) if (re.test(t)) return label;
  for (const m of t.matchAll(ASSIGNED)) if (looksRandom(m[1])) return 'high-entropy value after a password/token assignment';
  return null;
}

module.exports = { PATTERNS, entropy, findSecret };
