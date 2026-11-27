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

// options.cache (a Map) keeps one saved file per notebook path; it is reused while options.signature (mtime and size) is unchanged.
async function savedNotebook(options, fullText) {
  const { cache, cacheKey, signature } = options;
  if (!cache || !cacheKey) return saveFullText(fullText);
  const hit = cache.get(cacheKey);
  if (hit && hit.signature === signature) {
    try { await fs.access(hit.file); return { file: hit.file, dir: hit.dir }; } catch { /* removed meanwhile: save again */ }
  }
  if (hit) await fs.rm(hit.dir, { recursive: true, force: true });
  const saved = await saveFullText(fullText);
  cache.set(cacheKey, { ...saved, signature });
  return saved;
}

async function renderNotebookResult(nb, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) ? Math.max(512, options.maxChars) : 12000;
  const fullPage = renderNotebook(nb, { ...options, maxChars: Number.MAX_SAFE_INTEGER });
  const text = renderNotebook(nb, { ...options, maxChars: Math.max(256, maxChars - 220) });
  if (fullPage.length <= text.length && text.length <= maxChars) return { text, truncated: false };
  const saved = await savedNotebook(options, renderNotebook(nb, { fileName: options.fileName, maxChars: Number.MAX_SAFE_INTEGER }));
  const note = `\n\nFull rendered notebook: ${saved.file}`;
  return { text: `${text.slice(0, maxChars - note.length)}${note}`, truncated: true, ...saved };
}

module.exports = { saveFullText, capText, renderNotebookResult };
