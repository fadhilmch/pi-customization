'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pickSection } = require('./extract.js');

async function saveFullText(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-fetch-'));
  const file = path.join(dir, 'full.md');
  await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
  return file;
}

async function capText(value, maxChars = 12000) {
  const text = String(value);
  if (!Number.isInteger(maxChars) || maxChars < 256) throw new Error('maxChars must be at least 256 characters');
  if (text.length <= maxChars) return { text, truncated: false };
  const file = await saveFullText(text);
  const suffix = `\n\nTruncated. Full text: ${file}`;
  return { text: `${text.slice(0, maxChars - suffix.length)}${suffix}`, truncated: true, file };
}

async function formatResult(page, { section, maxChars = 12000 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 256) throw new Error('maxChars must be at least 256 characters');
  const fullText = page.text;
  let displayText = fullText;
  let sectionMissing = false;
  if (section) {
    const picked = pickSection(fullText, section);
    if (picked.found) displayText = picked.text;
    else {
      sectionMissing = true;
      displayText = `No section matched "${section}". Available headings:\n${picked.text}`;
    }
  }
  const header = `Source: ${page.url} · ${fullText.length} chars`;
  if (page.bodyTruncated) displayText += '\n\nTransport cap reached at 5 MB; no later content was read.';
  let result = `${header}\n\n${displayText}`;
  if (result.length > maxChars) {
    const file = await saveFullText(fullText);
    const suffix = `\n\nTruncated. Full text: ${file}`;
    const leadLength = Math.max(0, maxChars - suffix.length);
    result = `${result.slice(0, leadLength)}${suffix}`;
  }
  return {
    text: result,
    details: { url: page.url, chars: displayText.length, pageChars: fullText.length, elapsedMs: page.elapsedMs, section, sectionMissing, truncated: result.length < header.length + displayText.length + 2 },
  };
}

function formatError(error, maxChars = 12000) {
  const limit = Math.max(1, Math.floor(Number(maxChars) || 12000));
  const text = `Web fetch failed: ${error?.message || String(error)}`;
  return text.length <= limit ? text : text.slice(0, limit);
}

module.exports = { saveFullText, capText, formatResult, formatError };
