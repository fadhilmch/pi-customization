'use strict';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const sourceText = (source) => Array.isArray(source) ? source.join('') : String(source ?? '');
// nbformat multiline strings are lists of already newline-terminated lines.
const plain = (value) => (Array.isArray(value) ? value.join('') : String(value ?? '')).replace(ANSI, '');
const TEXT_ALTERNATIVES = ['text/plain', 'text/markdown', 'text/latex', 'text/html'];

function stripHtml(value) {
  return plain(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
}

function cappedLines(text, max = 20) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  if (lines.length <= max) return lines;
  const edge = Math.floor(max / 2);
  return [...lines.slice(0, edge), `[${lines.length - max} lines omitted]`, ...lines.slice(-edge)];
}

const indented = (lines) => lines.join('\n').replace(/^/gm, '   ');
const byteLength = (value) => Buffer.byteLength(Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : JSON.stringify(value) ?? '');

function outputText(output) {
  if (output.output_type === 'stream') {
    const label = output.name === 'stderr' ? 'stderr' : 'stdout';
    return `→ ${label}:\n${indented(cappedLines(plain(output.text).replace(/\n+$/, '')))}`;
  }
  if (output.output_type === 'error') {
    const trace = (output.traceback || []).flatMap((line) => plain(String(line)).split(/\r?\n/)).slice(-5);
    return [`→ error: ${plain(output.ename || 'Error')}: ${plain(output.evalue || '')}`, ...trace.map((line) => `   ${line}`)].join('\n');
  }
  const data = output.data || {};
  const parts = [];
  const textMime = TEXT_ALTERNATIVES.find((mime) => data[mime] !== undefined);
  if (textMime === 'text/html') parts.push(`→ out: text/html (as text)\n${indented(cappedLines(stripHtml(data[textMime]), 20))}`);
  else if (textMime) parts.push(`→ out: ${textMime}\n${indented(cappedLines(plain(data[textMime]).replace(/\n+$/, '')))}`);
  for (const [mime, value] of Object.entries(data)) {
    if (TEXT_ALTERNATIVES.includes(mime)) continue;
    if (mime === 'application/json') {
      const json = JSON.stringify(value) ?? '';
      parts.push(`→ out: application/json ${json.length > 200 ? `${json.slice(0, 200)}… (${json.length} chars)` : json}`);
      continue;
    }
    const isImage = mime.startsWith('image/');
    const bytes = isImage && mime !== 'image/svg+xml' ? Math.floor(byteLength(value) * 3 / 4) : byteLength(value);
    parts.push(`→ out: [${isImage ? 'image' : 'binary'}/${mime.split('/')[1] || 'data'} ${bytes} bytes omitted]`);
  }
  return parts.join('\n');
}

function notebookLanguage(nb) { return nb?.metadata?.kernelspec?.language || nb?.metadata?.language_info?.name || ''; }

function renderCell(cell, index, { language = '' } = {}) {
  const id = cell.id ? ` · id=${cell.id}` : '';
  const source = sourceText(cell.source);
  if (cell.cell_type === 'markdown') return [`[${index}] markdown${id}`, source].join('\n');
  if (cell.cell_type === 'raw') return [`[${index}] raw${id}`, source].join('\n');
  const exec = cell.execution_count == null ? '' : ` · exec ${cell.execution_count}`;
  const fence = '`'.repeat(Math.max(3, ...(source.match(/`+/g) || []).map((run) => run.length + 1)));
  const codeBlock = `${fence}${language}\n${source.endsWith('\n') ? source : `${source}\n`}${fence}`;
  const body = `[${index}] code${id}${exec}\n${codeBlock}`;
  const outputs = (cell.outputs || []).map(outputText).filter(Boolean);
  return [body, ...outputs].join('\n');
}

function renderNotebook(nb, { fileName = 'notebook.ipynb', from = 1, limit, maxChars = 12000 } = {}) {
  const cells = Array.isArray(nb?.cells) ? nb.cells : [];
  const kernel = nb?.metadata?.kernelspec?.name || nb?.metadata?.kernelspec?.language || nb?.metadata?.language_info?.name || 'unknown';
  const language = notebookLanguage(nb);
  const requested = Math.floor(Number(from));
  const start = Number.isFinite(requested) ? Math.max(1, requested) : 1;
  const top = `Notebook: ${fileName} · ${kernel} · ${cells.length} cells`;
  if (cells.length && start > cells.length) return `${top}\n\nOffset ${start} is beyond the last cell (${cells.length} cells).`.slice(0, maxChars);
  const count = limit === undefined || limit === null || !Number.isFinite(Number(limit)) ? Infinity : Math.floor(Number(limit));
  if (count < 1) return `${top}\n\nLimit must be at least 1 cell.`.slice(0, maxChars);
  const end = Math.min(cells.length, start + count - 1);
  const sections = cells.slice(start - 1, end).map((cell, i) => renderCell(cell, start + i, { language }));
  const heading = (last) => `${top} (showing ${last >= start ? `${start}–${last}` : '0'} of ${cells.length})`;
  const footer = (last) => last < cells.length ? `\n\nShowing cells ${start}–${last} of ${cells.length}. Read with offset ${last + 1} for more.` : '';
  let included = [];
  let last = start - 1;
  for (let i = 0; i < sections.length; i++) {
    const candidate = [...included, sections[i]];
    const candidateLast = start + i;
    let text = `${heading(candidateLast)}\n\n${candidate.join('\n\n')}${footer(candidateLast)}`;
    if (text.length <= maxChars) { included = candidate; last = candidateLast; continue; }
    if (included.length === 0) {
      const note = `\n\nCell ${candidateLast} exceeds the ${maxChars} character display cap.`;
      const room = Math.max(0, maxChars - heading(candidateLast).length - 2 - note.length);
      included = [sections[i].slice(0, room) + note];
      last = candidateLast;
    }
    break;
  }
  const text = `${heading(last)}${included.length ? `\n\n${included.join('\n\n')}` : ''}${footer(last)}`;
  return text.slice(0, maxChars);
}

module.exports = { sourceText, notebookLanguage, stripHtml, cappedLines, outputText, renderCell, renderNotebook };
