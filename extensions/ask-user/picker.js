'use strict';
// The question picker as a pure state machine plus a line renderer. index.ts maps terminal keys to
// press()/type() and hands render(width) to Pi's TUI, so all behaviour is testable without a terminal.
//
//   const p = createPicker(questions);   // questions come from validate.js
//   p.press('down'); p.press('enter');   // keys: up down left right tab shift-tab enter space backspace escape
//   p.type('free text');                 // printable text, only used while typing an "Other" answer
//   p.result()  -> null while open, else { cancelled: true } | { cancelled: false, answers: [{header, selected, other}] }
const { COLORS, fg, bold, dim, truncate, wrapAnsi } = require('./ansi.js');

const OTHER_LABEL = 'Other (type your own)';

function createPicker(questions) {
  const n = questions.length;
  const multiTab = n > 1; // several questions: tab bar plus a review/submit tab
  const st = questions.map(() => ({ cursor: 0, picked: new Set(), other: null }));
  let tab = 0;
  let typing = false;
  let buffer = '';
  let done = null;

  const rows = (i) => questions[i].options.length + 1; // options plus "Other"
  const isOtherRow = (i, row) => row === questions[i].options.length;
  const answered = (i) => st[i].picked.size > 0 || Boolean(st[i].other);
  const allAnswered = () => questions.every((_, i) => answered(i));

  function goTo(t) {
    tab = t;
    typing = false;
    buffer = '';
    if (t < n) {
      const first = [...st[t].picked].sort((a, b) => a - b)[0];
      st[t].cursor = first ?? (st[t].other ? questions[t].options.length : st[t].cursor);
    }
  }

  function finish() {
    done = {
      cancelled: false,
      answers: questions.map((q, i) => ({
        header: q.header,
        selected: q.options.filter((_, j) => st[i].picked.has(j)).map((o) => o.label),
        other: st[i].other || null,
      })),
    };
  }

  function advance() {
    if (!multiTab) return finish();
    goTo(tab < n - 1 ? tab + 1 : n);
  }

  function choose(i, row) {
    const s = st[i];
    if (questions[i].multiSelect) {
      if (s.picked.has(row)) s.picked.delete(row);
      else s.picked.add(row);
    } else {
      s.picked = new Set([row]);
      s.other = null; // single-select: one answer, typed or chosen
    }
  }

  function startTyping(i) {
    typing = true;
    buffer = st[i].other || '';
  }

  function press(key) {
    if (done) return;
    if (typing) {
      if (key === 'escape') { typing = false; buffer = ''; }
      else if (key === 'backspace') buffer = [...buffer].slice(0, -1).join('');
      else if (key === 'enter') {
        const text = buffer.trim();
        typing = false;
        buffer = '';
        if (!text) { st[tab].other = null; return; }
        st[tab].other = text;
        if (!questions[tab].multiSelect) st[tab].picked = new Set();
        advance();
      }
      return;
    }
    if (key === 'escape') { done = { cancelled: true }; return; }
    if (multiTab && (key === 'tab' || key === 'right')) return goTo((tab + 1) % (n + 1));
    if (multiTab && (key === 'shift-tab' || key === 'left')) return goTo((tab + n) % (n + 1));

    if (tab === n) { // review tab
      if (key === 'enter') {
        if (allAnswered()) finish();
        else goTo(questions.findIndex((_, i) => !answered(i)));
      }
      return;
    }
    const s = st[tab];
    if (key === 'up') s.cursor = (s.cursor + rows(tab) - 1) % rows(tab);
    else if (key === 'down') s.cursor = (s.cursor + 1) % rows(tab);
    else if (key === 'space' || key === 'enter') {
      if (isOtherRow(tab, s.cursor)) return startTyping(tab);
      const multi = questions[tab].multiSelect;
      if (key === 'space') {
        if (multi) choose(tab, s.cursor);
        else { choose(tab, s.cursor); advance(); }
      } else {
        // enter: multi-select confirms the ticked rows (or ticks the highlighted one if none), single picks and moves on
        if (multi && !answered(tab)) choose(tab, s.cursor);
        else if (!multi) choose(tab, s.cursor);
        advance();
      }
    }
  }

  function type(text) {
    if (done || !typing) return;
    buffer += String(text).replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  }

  function render(width = 80) {
    const w = Math.max(20, width);
    const accent = (s) => fg(COLORS.spinner, s);
    const out = [];
    const rule = dim('─'.repeat(w));
    out.push(rule);

    if (multiTab) {
      const parts = questions.map((q, i) => {
        const box = answered(i) ? '☒' : '☐';
        const label = `${box} ${q.header}`;
        return i === tab ? bold(accent(label)) : answered(i) ? label : dim(label);
      });
      const sub = tab === n ? bold(accent('✓ Submit')) : allAnswered() ? '✓ Submit' : dim('✓ Submit');
      out.push(truncate(` ${dim('←')} ${[...parts, sub].join('  ')} ${dim('→')}`, w));
      out.push('');
    }

    if (tab === n) {
      out.push(` ${bold('Review your answers')}`);
      out.push('');
      questions.forEach((q, i) => {
        const a = answered(i)
          ? [...q.options.filter((_, j) => st[i].picked.has(j)).map((o) => o.label), ...(st[i].other ? [`Other: ${st[i].other}`] : [])].join(', ')
          : null;
        out.push(truncate(`  ${fg(COLORS.muted, `${q.header}:`)} ${a ?? fg(COLORS.error, '(unanswered)')}`, w));
      });
      out.push('');
      out.push(truncate(` ${dim(allAnswered() ? 'Enter submit · ←/Tab back · Esc cancel' : 'Enter go to first unanswered · ←/Tab back · Esc cancel')}`, w));
      out.push(rule);
      return out;
    }

    const q = questions[tab];
    const s = st[tab];
    for (const row of wrapAnsi(bold(q.question), w - 2)) out.push(` ${row}`);
    out.push('');
    const all = [...q.options, { label: OTHER_LABEL, description: '' }];
    all.forEach((o, j) => {
      const cur = j === s.cursor;
      const other = j === q.options.length;
      const on = other ? Boolean(s.other) : s.picked.has(j);
      const mark = q.multiSelect ? (on ? '[x]' : '[ ]') : `${j + 1}.`;
      const pointer = cur ? accent('❯') : ' ';
      let label = `${mark} ${o.label}`;
      if (other && typing && cur) label = `${mark} ${OTHER_LABEL.replace(/ \(.*\)/, '')}: ${buffer}${accent('▏')}`;
      else if (other && s.other) label = `${mark} Other: ${s.other}`;
      const styled = cur ? accent(label) : on ? fg(COLORS.success, label) : label;
      out.push(truncate(` ${pointer} ${styled}${on && !q.multiSelect && !other ? ` ${fg(COLORS.success, '✓')}` : ''}`, w));
      if (o.description) out.push(truncate(`      ${fg(COLORS.muted, o.description)}`, w));
    });
    out.push('');
    const help = typing
      ? 'Enter confirm · Esc back'
      : [
          q.multiSelect ? 'Space toggle · Enter confirm' : 'Enter select',
          '↑↓ move',
          ...(multiTab ? ['←/Tab switch'] : []),
          'Esc cancel',
        ].join(' · ');
    out.push(truncate(` ${dim(help)}`, w));
    out.push(rule);
    return out;
  }

  return {
    press,
    type,
    render,
    result: () => done,
    state: () => ({ tab, typing, buffer, cursors: st.map((s) => s.cursor) }),
  };
}

module.exports = { OTHER_LABEL, createPicker };
