'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

function ipv4Flags(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return { private: false, linkLocal: false };
  const [a, b] = parts;
  return {
    private: a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168),
    linkLocal: a === 169 && b === 254,
  };
}

function addressFlags(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4Flags(address);
  if (family !== 6) return { private: false, linkLocal: false, invalid: true };
  let ip = address.toLowerCase().split('%')[0];
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    ip = ip.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return { private: false, linkLocal: false, invalid: true };
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return { private: false, linkLocal: false, invalid: true };
  const words = [...left, ...Array(missing).fill('0'), ...right].map((x) => Number.parseInt(x || '0', 16));
  if (words.length !== 8 || words.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff)) return { private: false, linkLocal: false, invalid: true };
  if (words.slice(0, 5).every((x) => x === 0) && words[5] === 0xffff) {
    const v4 = [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
    return ipv4Flags(v4);
  }
  const isLoopbackOrUnspecified = words.slice(0, 7).every((x) => x === 0) && (words[7] === 0 || words[7] === 1);
  const linkLocal = words[0] >= 0xfe80 && words[0] <= 0xfebf;
  const isPrivate = isLoopbackOrUnspecified || (words[0] >= 0xfc00 && words[0] <= 0xfdff) || linkLocal;
  return { private: isPrivate, linkLocal };
}

function domainMatch(host, domain) {
  const d = String(domain).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return Boolean(d) && (host === d || host.endsWith(`.${d}`));
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

  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname, family: net.isIP(hostname) }];
  else if (hostname === 'localhost' || hostname.endsWith('.localhost')) addresses = [{ address: '127.0.0.1', family: 4 }];
  else addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error(`Could not resolve host: ${hostname}`);
  for (const entry of addresses) {
    const flags = addressFlags(entry.address);
    if (flags.invalid) throw new Error(`DNS returned an invalid IP address: ${entry.address}`);
    if (flags.linkLocal) throw new Error(`link-local address is not allowed: ${entry.address}`);
    if (flags.private && !config.allowPrivate) throw new Error(`private or loopback address is not allowed: ${entry.address}`);
  }
  return url;
}

module.exports = { addressFlags, domainMatch, isAllowedUrl };
