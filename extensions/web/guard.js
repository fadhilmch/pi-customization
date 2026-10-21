'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

// private: loopback/RFC1918/CGNAT/etc., refused unless allowPrivate. linkLocal and blocked are never allowed:
// link-local covers cloud metadata, and 0.0.0.0/8 and :: reach localhost on Linux.
const NONE = { private: false, linkLocal: false, blocked: false };

function ipv4Flags(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return { ...NONE, invalid: true };
  const [a, b, c] = parts;
  return {
    private: a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0) || a >= 224,
    linkLocal: a === 169 && b === 254,
    blocked: a === 0,
  };
}

const embedded = (hi, lo) => ipv4Flags([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));

function addressFlags(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4Flags(address);
  if (family !== 6) return { ...NONE, invalid: true };
  let ip = address.toLowerCase().split('%')[0];
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    ip = ip.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return { ...NONE, invalid: true };
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return { ...NONE, invalid: true };
  const words = [...left, ...Array(missing).fill('0'), ...right].map((x) => Number.parseInt(x || '0', 16));
  if (words.length !== 8 || words.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff)) return { ...NONE, invalid: true };
  const zeros = (n) => words.slice(0, n).every((x) => x === 0);
  if (zeros(7) && words[7] === 0) return { ...NONE, blocked: true };
  if (zeros(7) && words[7] === 1) return { ...NONE, private: true };
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if ((zeros(5) && words[5] === 0xffff) || zeros(6)) return embedded(words[6], words[7]);
  // NAT64 64:ff9b::/96
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((x) => x === 0)) return embedded(words[6], words[7]);
  // 6to4 2002::/16 carries the IPv4 address in words 1-2
  if (words[0] === 0x2002) return embedded(words[1], words[2]);
  const linkLocal = words[0] >= 0xfe80 && words[0] <= 0xfebf;
  const isPrivate = (words[0] >= 0xfc00 && words[0] <= 0xfdff) || (words[0] >= 0xfec0 && words[0] <= 0xfeff) || words[0] >> 8 === 0xff || linkLocal;
  return { private: isPrivate, linkLocal, blocked: false };
}

function domainMatch(host, domain) {
  const d = String(domain).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return Boolean(d) && (host === d || host.endsWith(`.${d}`));
}

async function resolveHost(hostname, lookup = dns.lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
  if (host === 'localhost' || host.endsWith('.localhost')) return [{ address: '127.0.0.1', family: 4 }];
  return lookup(host, { all: true, verbatim: true });
}

// Checks every resolved address; shared by the URL pre-check and the socket-level lookup in fetch.js.
function assertAddressesAllowed(addresses, config, hostname = '') {
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error(`Could not resolve host: ${hostname}`);
  for (const entry of addresses) {
    const flags = addressFlags(entry.address);
    if (flags.invalid) throw new Error(`DNS returned an invalid IP address: ${entry.address}`);
    if (flags.linkLocal || flags.blocked) throw new Error(`link-local or unspecified address is not allowed: ${entry.address}`);
    if (flags.private && !config.allowPrivate) throw new Error(`private or loopback address is not allowed: ${entry.address}`);
  }
}

async function isAllowedUrl(value, config = {}, lookup = dns.lookup) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http or https URLs are allowed');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (config.denyAllDomains) throw new Error(`No domains are allowed by the combined policy: ${hostname}`);
  const blocked = (config.blockedDomains || []).some((d) => domainMatch(hostname, d));
  if (blocked) throw new Error(`blocked domain: ${hostname}`);
  if (Array.isArray(config.allowedDomains) && config.allowedDomains.length && !config.allowedDomains.some((d) => domainMatch(hostname, d))) {
    throw new Error(`Domain is not in allowedDomains: ${hostname}`);
  }
  assertAddressesAllowed(await resolveHost(hostname, lookup), config, hostname);
  return url;
}

module.exports = { addressFlags, domainMatch, isAllowedUrl, resolveHost, assertAddressesAllowed };
