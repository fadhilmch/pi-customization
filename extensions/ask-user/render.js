'use strict';
// Claude-Code-style rows: "⏺ AskUser(Scope)" then "  ⎿  Scope: Only slugify".
const { COLORS, fg, bold, dim, truncate, wrapAnsi } = require('./ansi.js');
const { answerText } = require('./answers.js');

const RESULT_PREFIX = '  ⎿  ';
const CONT_PREFIX = '     ';

function bulletFor(state) {
  if (state === 'error') return fg(COLORS.error, '⏺');
  if (state === 'success') return fg(COLORS.success, '⏺');
  return dim('⏺');
}

// "AskUser(Scope)"; more questions add " +N". state: pending | success | error
function formatCallLine(args, { state = 'pending', width = 80, pad = 0 } = {}) {
  const qs = Array.isArray(args?.questions) ? args.questions : [];
  const first = String(qs[0]?.header ?? '').replace(/\s+/g, ' ').trim();
  const more = qs.length > 1 ? dim(` +${qs.length - 1}`) : '';
  const arg = first ? `${dim('(')}${first}${more}${dim(')')}` : '';
  return truncate(`${' '.repeat(pad)}${bulletFor(state)} ${bold('AskUser')}${arg}`, width);
}

// details: { status: 'answered' | 'declined' | 'unavailable' | 'invalid', answers?, error? }
function formatResult(details, { isError = false, isPartial = false, width = 80, pad = 0, fallbackText = '' } = {}) {
  const p = ' '.repeat(pad);
  const one = (s) => [truncate(`${p}${RESULT_PREFIX}${s}`, width)];
  if (isPartial) return one(dim('Waiting for answer…'));
  const status = details?.status;
  if (status === 'answered' && Array.isArray(details.answers) && details.answers.length) {
    const room = Math.max(10, width - pad - CONT_PREFIX.length);
    const out = [];
    for (const a of details.answers) {
      const row = `${fg(COLORS.muted, `${a.header}:`)} ${answerText(a)}`;
      for (const piece of wrapAnsi(row, room)) out.push(`${p}${out.length === 0 ? RESULT_PREFIX : CONT_PREFIX}${piece}`);
    }
    return out;
  }
  if (status === 'declined') return one(fg(COLORS.muted, 'User declined to answer'));
  if (status === 'unavailable') return one(fg(COLORS.muted, 'Not asked (no interactive UI); proceeding with defaults'));
  if (status === 'invalid' || isError) return one(fg(COLORS.error, details?.error || fallbackText || 'Invalid questions'));
  return one(fg(COLORS.muted, fallbackText || '(No content)'));
}

module.exports = { formatCallLine, formatResult };
