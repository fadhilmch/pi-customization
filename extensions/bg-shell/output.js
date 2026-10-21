'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fold } = require('./fold.js');

const FOLD_CONFIG = {
  thresholdLines: 50, thresholdBytes: 4000, headLines: 10, tailLines: 15, context: 1,
  maxMatches: 40, maxLineChars: 400,
  patterns: ['\\berror\\b', '\\bfail(ed|s|ure|ures|ing)?\\b', 'traceback', 'exception', '\\bpanic\\b', '\\bfatal\\b', 'assertionerror'],
  ignore: [],
};

async function saveFullText(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-bg-shell-output-'));
  const file = path.join(dir, 'output.log');
  await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
  return file;
}

async function capOutput(text, { maxChars = 8000, logPath } = {}) {
  text = String(text ?? '');
  if (text.length <= maxChars) return { text, truncated: false };
  let folded = fold(text, FOLD_CONFIG, { fullPath: logPath || '<log>', numbered: false })?.text;
  if (folded && folded.length <= maxChars) return { text: folded, truncated: true, folded: true, logPath };
  const fullPath = logPath || await saveFullText(text);
  const note = `[… output capped; full log: ${fullPath}]`;
  return { text: `${text.slice(0, Math.max(0, maxChars - note.length))}${note}`.slice(0, maxChars), truncated: true, logPath: fullPath };
}

module.exports = { FOLD_CONFIG, saveFullText, capOutput };
