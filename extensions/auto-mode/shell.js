'use strict';
// Quote-aware shell splitter. Not a full parser: it splits a command line into
// simple-command "segments" (tokens + redirects), extracts $(...), `...` and
// <(...) bodies as extra segments, skips heredoc bodies, and reports anything
// it could not analyse with confidence in `uncertain`.

const MAX_LEN = 8000;
const SUB = '\u0001'; // marker appended to a token containing a command substitution
const PSUB = '\u0002'; // marker for process substitution <(...) / >(...)

function newSeg() {
  return { tokens: [], redirects: [], raw: '', heredocs: [], pipedFromPrev: false, prevSeg: null, fromSub: false };
}

function parseShell(command) {
  const out = { segments: [], uncertain: [] };
  const s = String(command == null ? '' : command);
  if (s.length > MAX_LEN) out.uncertain.push('very long command');
  scan(s, 0, null, out, 0);
  return out;
}

// Returns the index just after the closer (or end of input); -1 if closer missing.
function scan(s, start, closer, out, depth) {
  let i = start;
  let seg = newSeg();
  let tok = null;
  let inS = false;
  let inD = false;
  let pending = null; // {kind:'write'|'read'|'heredoc'|'herestring'}
  const heredocs = []; // pending heredocs awaiting a newline
  let parenDepth = 0;
  let sepBefore = '';
  let lastSeg = null;
  seg.fromSub = depth > 0;

  const flushTok = () => {
    if (tok === null) return;
    const t = tok;
    tok = null;
    if (pending) {
      const p = pending;
      pending = null;
      if (p.kind === 'heredoc') {
        const h = { delim: t.replace(/[\u0001\u0002]/g, ''), strip: p.strip, seg };
        heredocs.push(h);
        seg.heredocs.push(h.delim);
      } else if (p.kind === 'write' || p.kind === 'read') {
        seg.redirects.push({ kind: p.kind, target: t });
      }
      return;
    }
    seg.tokens.push(t);
  };
  const endSeg = (sep) => {
    flushTok();
    pending = null;
    if (seg.tokens.length || seg.redirects.length) {
      seg.pipedFromPrev = sepBefore === '|';
      seg.prevSeg = lastSeg;
      out.segments.push(seg);
      lastSeg = seg;
    }
    seg = newSeg();
    seg.fromSub = depth > 0;
    sepBefore = sep;
  };
  const tadd = (ch) => { tok = (tok === null ? '' : tok) + ch; };
  const radd = (ch) => { seg.raw += ch; };

  while (i < s.length) {
    const c = s[i];
    if (inS) {
      radd(c);
      if (c === "'") inS = false; else tadd(c);
      i++;
      continue;
    }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) { i++; continue; }
      if (n === '\n') { radd(' '); i += 2; continue; }
      if (inD && !'$`"\\'.includes(n)) { radd(c); tadd(c); i++; continue; }
      radd(c + n); tadd(n); i += 2;
      continue;
    }
    if (inD) {
      if (c === '"') { inD = false; radd(c); i++; continue; }
      if (c === '$' && s[i + 1] === '(') {
        const r = scan(s, i + 2, ')', out, depth + 1);
        if (r < 0) return s.length;
        radd('$(…)'); tadd(SUB); i = r; continue;
      }
      if (c === '`') {
        const r = scan(s, i + 1, '`', out, depth + 1);
        if (r < 0) return s.length;
        radd('`…`'); tadd(SUB); i = r; continue;
      }
      radd(c); tadd(c); i++;
      continue;
    }
    // Unquoted context
    if (c === "'") { inS = true; if (tok === null) tok = ''; radd(c); i++; continue; }
    if (c === '"') { inD = true; if (tok === null) tok = ''; radd(c); i++; continue; }
    if (c === '$' && s[i + 1] === "'") { out.uncertain.push("ANSI-C quoting $'...'"); radd(c); tadd(c); i++; continue; }
    if (c === '$' && s[i + 1] === '(') {
      const r = scan(s, i + 2, ')', out, depth + 1);
      if (r < 0) return s.length;
      radd('$(…)'); tadd(SUB); i = r; continue;
    }
    if (c === '`') {
      if (closer === '`') { endSeg(''); return i + 1; }
      const r = scan(s, i + 1, '`', out, depth + 1);
      if (r < 0) return s.length;
      radd('`…`'); tadd(SUB); i = r; continue;
    }
    if ((c === '<' || c === '>') && s[i + 1] === '(') {
      const r = scan(s, i + 2, ')', out, depth + 1);
      if (r < 0) return s.length;
      radd(c + '(…)'); tadd(PSUB); i = r; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { flushTok(); radd(' '); i++; continue; }
    if (c === '\n') {
      flushTok();
      if (heredocs.length) {
        let pos = i + 1;
        for (const h of heredocs) {
          let found = false;
          while (pos <= s.length) {
            let nl = s.indexOf('\n', pos);
            if (nl < 0) nl = s.length;
            let line = s.slice(pos, nl);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (h.strip) line = line.replace(/^\t+/, '');
            pos = nl + 1;
            if (line === h.delim) { found = true; break; }
            if (nl >= s.length) break;
          }
          if (!found) out.uncertain.push('unterminated heredoc');
        }
        heredocs.length = 0;
        i = Math.min(pos, s.length);
        endSeg('\n');
        continue;
      }
      endSeg('\n'); radd(' '); i++;
      continue;
    }
    if (c === '#' && tok === null) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === ';') { endSeg(';'); i++; continue; }
    if (c === '|') {
      if (s[i + 1] === '|') { endSeg('||'); i += 2; }
      else if (s[i + 1] === '&') { endSeg('|'); i += 2; }
      else { endSeg('|'); i++; }
      continue;
    }
    if (c === '&') {
      if (s[i + 1] === '&') { endSeg('&&'); i += 2; continue; }
      if (s[i + 1] === '>') {
        flushTok();
        i += 2; if (s[i] === '>') i++;
        pending = { kind: 'write' };
        radd('&>');
        continue;
      }
      endSeg('&'); i++;
      continue;
    }
    if (c === '(') { parenDepth++; endSeg('('); i++; continue; }
    if (c === ')') {
      if (closer === ')' && parenDepth === 0) { endSeg(''); return i + 1; }
      if (parenDepth > 0) parenDepth--;
      endSeg(')'); i++;
      continue;
    }
    if (c === '>' || c === '<') {
      // fd prefix such as 2> : drop a purely numeric pending token
      if (tok !== null && /^\d+$/.test(tok)) tok = null; else flushTok();
      let op = c;
      if (c === '>' && (s[i + 1] === '>' || s[i + 1] === '|')) { op += s[i + 1]; i++; }
      else if (c === '<' && s[i + 1] === '<') {
        op = '<<'; i++;
        if (s[i + 1] === '<') { op = '<<<'; i++; }
        else if (s[i + 1] === '-') { op = '<<-'; i++; }
      }
      i++;
      radd(op);
      if (s[i] === '&' && (op === '>' || op === '<')) {
        // fd duplication such as >&2, 2>&1, >&-
        i++;
        let w = '';
        while (i < s.length && /[0-9-]/.test(s[i])) { w += s[i]; i++; }
        if (w === '') pending = { kind: op === '>' ? 'write' : 'read' };
        continue;
      }
      if (op === '<<' || op === '<<-') pending = { kind: 'heredoc', strip: op === '<<-' };
      else if (op === '<<<') pending = { kind: 'herestring' };
      else if (op === '<') pending = { kind: 'read' };
      else pending = { kind: 'write' };
      continue;
    }
    radd(c); tadd(c); i++;
  }
  if (closer) { out.uncertain.push('unterminated substitution'); endSeg(''); return -1; }
  if (inS || inD) out.uncertain.push('unbalanced quotes');
  if (heredocs.length) out.uncertain.push('unterminated heredoc');
  endSeg('');
  return s.length;
}

module.exports = { parseShell, SUB, PSUB };
