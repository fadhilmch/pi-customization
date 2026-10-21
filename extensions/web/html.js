'use strict';

// Never rendered. Page chrome (nav/header/footer/aside) is dropped separately so it can be kept as a last resort.
const DROP = new Set(['script', 'style', 'noscript', 'svg', 'iframe']);
const CHROME = new Set(['nav', 'header', 'footer', 'aside']);
// Content up to the literal closing tag is text, so a "<" in it cannot start a tag.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'noscript']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠', sect: '§', para: '¶',
};
// Opening one of these closes a still-open sibling, scanning down the stack until a stop tag.
const BLOCK_STOP = ['div', 'li', 'td', 'th', 'table', 'section', 'article', 'main', 'blockquote', 'body', 'button'];
const BLOCKS = ['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'];
const AUTO_CLOSE = {
  li: { close: ['li'], stop: ['ul', 'ol'] },
  dt: { close: ['dt', 'dd'], stop: ['dl'] },
  dd: { close: ['dt', 'dd'], stop: ['dl'] },
  tr: { close: ['tr'], stop: ['table'] },
  td: { close: ['td', 'th'], stop: ['tr', 'table'] },
  th: { close: ['td', 'th'], stop: ['tr', 'table'] },
  thead: { close: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
  tbody: { close: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
  tfoot: { close: ['thead', 'tbody', 'tfoot'], stop: ['table'] },
  option: { close: ['option'], stop: ['select', 'datalist'] },
};
for (const tag of BLOCKS) AUTO_CLOSE[tag] = { close: ['p'], stop: BLOCK_STOP };
const TAG_START = /<(\/?)([a-zA-Z][\w:-]*)/y;

function decodeEntities(value) {
  // A terminating ";" is required so "&copy=2" in a URL stays literal.
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(point) ? String.fromCodePoint(point) : whole; } catch { return whole; }
    }
    return NAMED[entity] ?? NAMED[entity.toLowerCase()] ?? whole;
  });
}

function attributes(text) {
  const out = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(text))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function parse(html) {
  const src = String(html).replace(/\0/g, '');
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const text = (value) => { if (value) stack.at(-1).children.push({ tag: '#text', text: decodeEntities(value) }); };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    text(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    TAG_START.lastIndex = i;
    const start = TAG_START.exec(src);
    if (!start) {
      if (src[i + 1] === '!' || src[i + 1] === '?') { const end = src.indexOf('>', i); i = end < 0 ? src.length : end + 1; } else { text('<'); i++; }
      continue;
    }
    // Find the closing ">" outside quoted attribute values (a quote only opens right after "=").
    let j = TAG_START.lastIndex;
    let quote = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = ''; } else if ((c === '"' || c === "'") && /=\s*$/.test(src.slice(Math.max(0, j - 8), j))) quote = c;
      else if (c === '>') break;
    }
    if (j >= src.length) break;
    const tag = start[2].toLowerCase();
    const rest = src.slice(TAG_START.lastIndex, j);
    i = j + 1;
    if (start[1]) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    const rule = AUTO_CLOSE[tag];
    if (rule) {
      for (let k = stack.length - 1; k > 0 && !rule.stop.includes(stack[k].tag); k--) {
        if (rule.close.includes(stack[k].tag)) { stack.length = k; break; }
      }
    }
    const selfClosed = /\/\s*$/.test(rest);
    const node = { tag, attrs: attributes(rest), children: [] };
    stack.at(-1).children.push(node);
    if (RAW_TEXT.has(tag)) {
      const closer = new RegExp(`</${tag}[\\s/>]`, 'gi');
      closer.lastIndex = i;
      const found = closer.exec(src);
      const raw = src.slice(i, found ? found.index : src.length);
      if (tag !== 'script' && tag !== 'style' && raw) node.children.push({ tag: '#text', text: tag === 'textarea' ? decodeEntities(raw) : raw });
      const end = found ? src.indexOf('>', found.index) : -1;
      i = end < 0 ? src.length : end + 1;
    } else if (!VOID.has(tag) && !selfClosed) stack.push(node);
  }
  return root;
}

function find(node, tag) {
  if (node.tag === tag) return node;
  for (const child of node.children || []) { const result = find(child, tag); if (result) return result; }
  return null;
}

function plain(node) {
  if (node.tag === '#text') return node.text;
  if (node.tag === 'br') return '\n';
  return (node.children || []).map(plain).join('');
}

function renderTable(node) {
  const rows = [];
  const visit = (n) => {
    if (n.tag === 'tr') rows.push(n.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => plain(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
    else for (const c of n.children || []) visit(c);
  };
  visit(node);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const format = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`;
  return [format(rows[0]), format(Array(width).fill('---')), ...rows.slice(1).map(format)].join('\n');
}

const SYMBOLS_ONLY = /^[\p{P}\p{S}\s]*$/u;
const fenceMarker = (index) => `\0${index}\0`;

function htmlToMarkdown(html, baseUrl = 'https://example.invalid/') {
  const tree = parse(html);
  // Code blocks are parked here and spliced back after whitespace cleanup so their layout survives.
  const fences = [];
  const render = (node, depth = 0, context = {}) => {
    if (node.tag === '#text') return node.text.replace(/[\t\r\n ]+/g, ' ');
    const tag = node.tag;
    if (DROP.has(tag)) return '';
    if (CHROME.has(tag) && !context.keepChrome && !(tag === 'header' && context.article)) return '';
    if (tag === 'main' || tag === 'article') context = { ...context, article: true };
    const children = () => (node.children || []).map((c) => render(c, depth, context)).join('');
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') return node.attrs.alt ? `[image: ${node.attrs.alt}]` : '';
    if (tag === 'a') {
      const text = children().trim();
      if (!node.attrs.href || !text) return text;
      // Permalink anchors in headings ("¶", "#") would otherwise render as "Title[¶](...)".
      if (context.heading && SYMBOLS_ONLY.test(text)) return '';
      if (context.heading && node.attrs.href.startsWith('#')) return text;
      try { return `[${text}](${new URL(node.attrs.href, baseUrl).href})`; } catch { return text; }
    }
    if (/^h[1-6]$/.test(tag)) {
      const inner = { ...context, heading: true };
      const title = (node.children || []).map((c) => render(c, depth, inner)).join('').replace(/\s+/g, ' ').trim();
      return title ? `\n\n${'#'.repeat(Number(tag[1]))} ${title}\n\n` : '';
    }
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'blockquote') return `\n\n${children().trim()}\n\n`;
    if (tag === 'pre') {
      const code = find(node, 'code');
      const cls = `${node.attrs.class || ''} ${code?.attrs.class || ''}`;
      const lang = cls.match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '';
      const body = plain(node).replace(/^\n+|\n+$/g, '');
      const fence = '`'.repeat(Math.max(3, ...(body.match(/`+/g) || []).map((run) => run.length + 1)));
      fences.push(`${fence}${lang}\n${body}\n${fence}`);
      return `\n\n${fenceMarker(fences.length - 1)}\n\n`;
    }
    if (tag === 'code') return `\`${children().replace(/`/g, '\\`').trim()}\``;
    if (tag === 'ul' || tag === 'ol') {
      const start = Number.parseInt(node.attrs.start, 10);
      let number = Number.isFinite(start) ? start : 1;
      const listContext = { ...context, ordered: tag === 'ol' };
      return `\n${node.children.map((c) => render(c, depth, c.tag === 'li' ? { ...listContext, number: number++ } : listContext)).join('')}\n`;
    }
    if (tag === 'li') {
      let body = '';
      const nested = [];
      for (const child of node.children) {
        if (child.tag === 'ul' || child.tag === 'ol') nested.push(render(child, depth + 1, context).replace(/^\n+|\n+$/g, ''));
        else body += render(child, depth, context);
      }
      const marker = context.ordered ? `${context.number ?? 1}. ` : '- ';
      const pad = '  '.repeat(depth) + ' '.repeat(marker.length);
      // Re-indent code blocks under the item so they stay part of it.
      const text = body.replace(/\s+/g, ' ').trim().replace(/\0(\d+)\0/g, (_, index) => {
        fences.push(fences[Number(index)].split('\n').map((line) => (line ? pad + line : line)).join('\n'));
        return `\n${fenceMarker(fences.length - 1)}\n`;
      });
      return `${'  '.repeat(depth)}${marker}${text}\n${nested.join('\n')}${nested.length ? '\n' : ''}`;
    }
    if (tag === 'table') return `\n\n${renderTable(node)}\n\n`;
    if (tag === 'td' || tag === 'th' || tag === 'tr') return children();
    if (['strong', 'b'].includes(tag)) return `**${children().trim()}**`;
    if (['em', 'i'].includes(tag)) return `*${children().trim()}*`;
    return children();
  };
  const finish = (node, context) => {
    const text = render(node, 0, context).replace(/[ \t]+\n/g, '\n').replace(/ *\n{3,} */g, '\n\n').trim();
    return text.replace(/\0(\d+)\0/g, (_, index) => fences[Number(index)]);
  };
  // Prefer the main container, but fall back when it holds no text; never return less than the page has.
  for (const node of [find(tree, 'main'), find(tree, 'article'), tree]) {
    const text = node && finish(node, {});
    if (text) return text;
  }
  return finish(tree, { keepChrome: true });
}

module.exports = { decodeEntities, htmlToMarkdown };
