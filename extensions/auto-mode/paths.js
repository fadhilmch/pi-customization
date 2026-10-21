'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  const m = /^(\$HOME|\$\{HOME\})(\/.*)?$/.exec(p);
  if (m) return path.join(home, m[2] || '');
  return p;
}

// Variables / substitutions we cannot resolve statically.
function hasUnresolved(p) {
  const stripped = p.replace(/^(\$HOME|\$\{HOME\})(?=\/|$)/, '');
  return /[$`\u0001\u0002]/.test(stripped);
}

// Resolve symlinks of the deepest existing ancestor and re-append the rest.
function realish(abs) {
  let cur = abs;
  const rest = [];
  for (;;) {
    try {
      const r = fs.realpathSync(cur);
      return rest.length ? path.join(r, ...rest.reverse()) : r;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function resolvePath(p, cwd, home) {
  return realish(path.resolve(cwd, expandHome(String(p), home)));
}

function isInside(abs, root) {
  const rel = path.relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function tmpRoots() {
  const roots = new Set();
  for (const r of [os.tmpdir(), '/tmp', '/var/tmp']) {
    roots.add(r);
    roots.add(realish(r));
  }
  return [...roots];
}

function isScratch(abs, roots) {
  return (roots || tmpRoots()).some((r) => isInside(abs, r));
}

// ---- sensitive path detection ------------------------------------------------

const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|defaults?)$/i;

function norm(abs) {
  return abs.split(path.sep).join('/');
}

// Files holding secrets: reading OR writing them needs confirmation.
function secretKind(abs, opts) {
  const p = norm(abs);
  const base = path.posix.basename(p);
  const strict = !opts || opts.strict !== false; // strict: also match bare "secrets"/"credentials"
  if (/^\.env(\..+)?$/i.test(base) && !TEMPLATE_SUFFIX.test(base)) return '.env file';
  if (/\.(pem|key|p12|pfx|keystore|jks|ppk)$/i.test(base)) return 'key/certificate file';
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base) && !/\.pub$/.test(base)) return 'SSH private key';
  if (/^(credentials|secrets?)(\..+)?$/i.test(base) && (strict || base.includes('.')) && !TEMPLATE_SUFFIX.test(base)) return 'credentials/secrets file';
  if (['.netrc', '.npmrc', '.pypirc', '.git-credentials', '.pgpass', '.htpasswd'].includes(base)) return 'credentials file';
  if (/\/\.(ssh|aws|gnupg|azure)(\/|$)/.test(p)) return 'credentials directory';
  if (/\/\.kube\/config$/.test(p)) return 'kubeconfig';
  if (/\/\.docker\/config\.json$/.test(p)) return 'docker credentials';
  if (/\/\.config\/(gcloud|gh)(\/|$)/.test(p)) return 'cloud/CLI credentials';
  return null;
}

// Files that are risky to modify (but fine to read).
function writeKind(abs) {
  const p = norm(abs);
  const base = path.posix.basename(p);
  if (/\/\.git(\/|$)/.test(p)) return '.git internals';
  if (/\/\.github\/workflows(\/|$)/.test(p)) return 'CI workflow';
  if (/\/\.circleci(\/|$)/.test(p) || ['.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml'].includes(base)) return 'CI config';
  if (/\/\.pi\/auto-mode\.json$/.test(p) || /\/\.pi\/agent\/auto-mode\.json$/.test(p)) return 'auto-mode config';
  if (/\/\.pi\/extensions(\/|$)/.test(p)) return 'Pi extension code';
  return null;
}

// ---- globs -------------------------------------------------------------------

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

// Pattern forms: "/abs/**", "~/dir/*", "rel/dir/**" (matches at any depth), "*.pem" (any depth).
function matchesGlob(abs, glob, home) {
  let g = glob;
  if (g.startsWith('~/')) g = path.join(home, g.slice(2));
  const target = norm(abs);
  if (!g.startsWith('/')) g = '**/' + g;
  const re = globToRegExp(norm(g));
  if (re.test(target)) return true;
  // Directory-style pattern ("secrets/") or a pattern matching a parent directory
  if (!/[*?]$/.test(g)) {
    const dir = globToRegExp(norm(g).replace(/\/$/, '') + '/**');
    if (dir.test(target)) return true;
  }
  return false;
}

module.exports = {
  expandHome, hasUnresolved, realish, resolvePath, isInside, isScratch, tmpRoots,
  secretKind, writeKind, globToRegExp, matchesGlob,
};
