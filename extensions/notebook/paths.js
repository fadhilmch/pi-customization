'use strict';

const os = require('node:os');
const path = require('node:path');

const UNICODE_SPACES = /[  -   　]/g;

// Mirrors the path handling of Pi's read/edit tools (Pi does not export its resolver):
// normalize unicode spaces, strip a leading "@", expand "~" and "~/", then resolve against cwd.
function expandPath(input, home = os.homedir()) {
  let value = String(input ?? '').replace(UNICODE_SPACES, ' ');
  if (value.startsWith('@')) value = value.slice(1);
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

function resolvePath(input, cwd = process.cwd(), home = os.homedir()) {
  const value = expandPath(input, home);
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(expandPath(cwd, home), value);
}

module.exports = { expandPath, resolvePath };
