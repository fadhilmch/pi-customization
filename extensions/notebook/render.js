'use strict';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const sourceText = (source) => Array.isArray(source) ? source.join('') : String(source ?? '');
const plain = (value) => Array.isArray(value) ? value.join(value.some((line) => String(line).includes('\n')) ? '' : '\n') : String(value ?? '');

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

function outputText(output) {
  if (output.output_type === 'stream') {
    const label = output.name === 'stderr' ? 'stderr' : 'stdout';
    return `→ ${label}:\n${cappedLines(plain(output.text).replace(/\n+$/, '')).join('\n').replace(/^/gm, '   ')}`;
  }
  if (output.output_type === 'error') {
    const trace = (output.traceback || []).flatMap((line) => String(line).replace(ANSI, '').split(/\r?\n/)).slice(-5);
    return [`→ error: ${output.ename || 'Error'}: ${output.evalue || ''}`, ...trace.map((line) => `   ${line}`)].join('\n');
  }
  const data = output.data || {};
  const parts = [];
  if (data['text/plain'] !== undefined) parts.push(`→ out: text/plain\n${cappedLines(plain(data['text/plain']).replace(/\n+$/, '')).join('\n').replace(/^/gm, '   ')}`);
  else if (data['text/html'] !== undefined) parts.push(`→ out: text/html (as text)\n${cappedLines(stripHtml(data['text/html']), 20).join('\n').replace(/^/gm, '   ')}`);
  for (const [mime, value] of Object.entries(data)) {
    if (mime === 'text/plain' || mime === 'text/html') continue;
    const dataText = Array.isArray(value) ? value.join('') : String(value);
    const bytes = mime.startsWith('image/') ? Math.floor(Buffer.byteLength(dataText) * 3 / 4) : Buffer.byteLength(dataText);
    const label = mime.startsWith('image/') ? 'image' : 'binary';
    parts.push(`→ out: [${label}/${mime.split('/')[1] || 'data'} ${bytes} bytes omitted]`);
  }
  return parts.join('\n');
}

function renderCell(cell, index, { language = 'python' } = {}) {
  const id = cell.id ? ` · id=${cell.id}` : '';
  if (cell.cell_type === 'markdown') return [`[${index}] markdown`, sourceText(cell.source)].join('\n');
  if (cell.cell_type === 'raw') return [`[${index}] raw`, sourceText(cell.source)].join('\n');
  const exec = cell.execution_count == null ? '' : ` · exec ${cell.execution_count}`;
  const source = sourceText(cell.source);
  const codeBlock = `\`\`\`${language}\n${source.endsWith('\n') ? source : `${source}\n`}\`\`\``;
  const body = `[${index}] code${id}${exec}\n${codeBlock}`;
  const outputs = (cell.outputs || []).map(outputText).filter(Boolean);
  return [body, ...outputs].join('\n');
}

function renderNotebook(nb, { fileName = 'notebook.ipynb', from = 1, limit, maxChars = 12000 } = {}) {
  const cells = Array.isArray(nb?.cells) ? nb.cells : [];
  const kernel = nb?.metadata?.kernelspec?.name || nb?.metadata?.kernelspec?.language || 'unknown';
  const language = nb?.metadata?.kernelspec?.language || 'unknown';
  const start = Math.max(1, Math.min(cells.length || 1, Math.floor(Number(from) || 1)));
  const end = limit === undefined ? cells.length : Math.min(cells.length, start + Math.max(1, Math.floor(Number(limit) || 1)) - 1);
  const sections = cells.slice(start - 1, end).map((cell, i) => renderCell(cell, start + i, { language }));
  const heading = (last) => `Notebook: ${fileName} · ${kernel} · ${cells.length} cells (showing ${last >= start ? `${start}–${last}` : '0'} of ${cells.length})`;
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

module.exports = { sourceText, stripHtml, cappedLines, outputText, renderCell, renderNotebook };
