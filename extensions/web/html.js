'use strict';

const DROP = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'header', 'footer', 'aside', 'form']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);?/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(point) ? String.fromCodePoint(point) : whole; } catch { return whole; }
    }
    return NAMED[entity.toLowerCase()] ?? whole;
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
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const tokens = String(html).replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]*>|[^<]+/g) || [];
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      stack.at(-1).children.push({ tag: '#text', text: decodeEntities(token) });
      continue;
    }
    const close = token.match(/^<\s*\/\s*([\w:-]+)/);
    if (close) {
      const tag = close[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const open = token.match(/^<\s*([\w:-]+)([\s\S]*?)\/?\s*>$/);
    if (!open || token.startsWith('<!') || token.startsWith('<?')) continue;
    const tag = open[1].toLowerCase();
    const node = { tag, attrs: attributes(open[2]), children: [] };
    stack.at(-1).children.push(node);
    if (!VOID.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
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

function htmlToMarkdown(html, baseUrl = 'https://example.invalid/') {
  const tree = parse(html);
  const content = find(tree, 'main') || find(tree, 'article') || tree;
  const render = (node, depth = 0, context = {}) => {
    if (node.tag === '#text') return node.text.replace(/[\t\r\n ]+/g, ' ');
    const tag = node.tag;
    if (DROP.has(tag)) return '';
    const children = () => (node.children || []).map((c) => render(c, depth, context)).join('');
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') return node.attrs.alt ? `[image: ${node.attrs.alt}]` : '';
    if (tag === 'a') {
      const text = children().trim();
      if (!node.attrs.href || !text) return text;
      try { return `[${text}](${new URL(node.attrs.href, baseUrl).href})`; } catch { return text; }
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'blockquote') return `\n\n${children().trim()}\n\n`;
    if (tag === 'pre') {
      const code = find(node, 'code');
      const cls = `${node.attrs.class || ''} ${code?.attrs.class || ''}`;
      const lang = cls.match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '';
      return `\n\n\`\`\`${lang}\n${plain(node).replace(/^\n+|\n+$/g, '')}\n\`\`\`\n\n`;
    }
    if (tag === 'code') return `\`${children().replace(/`/g, '\\`').trim()}\``;
    if (tag === 'ul' || tag === 'ol') {
      const listContext = { ordered: tag === 'ol', start: Number(node.attrs.start) || 1 };
      return `\n${node.children.map((c) => render(c, depth, listContext)).join('')}\n`;
    }
    if (tag === 'li') {
      let body = '';
      let nested = '';
      for (const child of node.children) {
        if (child.tag === 'ul' || child.tag === 'ol') nested += render(child, depth + 1, context).replace(/^\n+|\n+$/g, '');
        else body += render(child, depth, context);
      }
      const marker = context.ordered ? `${context.start || 1}. ` : '- ';
      return `${'  '.repeat(depth)}${marker}${body.replace(/\s+/g, ' ').trim()}\n${nested}${nested ? '\n' : ''}`;
    }
    if (tag === 'table') return `\n\n${renderTable(node)}\n\n`;
    if (tag === 'td' || tag === 'th' || tag === 'tr') return children();
    if (['strong', 'b'].includes(tag)) return `**${children().trim()}**`;
    if (['em', 'i'].includes(tag)) return `*${children().trim()}*`;
    return children();
  };
  return render(content).replace(/[ \t]+\n/g, '\n').replace(/ *\n{3,} */g, '\n\n').trim();
}

module.exports = { decodeEntities, htmlToMarkdown };
