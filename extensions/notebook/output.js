'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { renderNotebook } = require('./render.js');

async function saveFullText(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-notebook-'));
  const file = path.join(dir, 'rendered.md');
  await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
  return { file, dir };
}

async function capText(value, maxChars = 12000) {
  const text = String(value ?? '');
  if (text.length <= maxChars) return { text, truncated: false };
  const saved = await saveFullText(text);
  const note = `\n\nTruncated. Full text: ${saved.file}`;
  return { text: `${text.slice(0, maxChars - note.length)}${note}`, truncated: true, ...saved };
}

async function renderNotebookResult(nb, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) ? Math.max(512, options.maxChars) : 12000;
  const fullText = renderNotebook(nb, { ...options, maxChars: Number.MAX_SAFE_INTEGER });
  const text = renderNotebook(nb, { ...options, maxChars: Math.max(256, maxChars - 220) });
  if (fullText.length <= text.length && text.length <= maxChars) return { text, truncated: false };
  const saved = await saveFullText(fullText);
  const note = `\n\nFull rendered notebook: ${saved.file}`;
  return { text: `${text.slice(0, maxChars - note.length)}${note}`, truncated: true, ...saved };
}

module.exports = { saveFullText, capText, renderNotebookResult };
