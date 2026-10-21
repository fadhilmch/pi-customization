'use strict';
// Turning picker answers into the compact text the model reads.
//   answer = { header, selected: [label, ...], other: string | null }

const UNAVAILABLE =
  'The user cannot be asked: there is no interactive UI (print, JSON or RPC mode). Do not wait or retry. ' +
  'For each question, proceed with the recommended option (the first one) or the most sensible default, and state the assumption you made in your reply.';

const DECLINED =
  'The user declined to answer (dismissed the questions). Continue without it: use the most sensible default, or ask in plain text only if you are truly blocked, and state your assumption.';

function answerText(a) {
  const parts = [...(a.selected || [])];
  if (a.other) parts.push(`Other: ${a.other}`);
  return parts.join(', ');
}

// "Scope: Full rewrite" per line; multi-select joined with ", "; free text as "Other: <text>".
function formatAnswers(answers) {
  return ['User answers:', ...answers.map((a) => `${a.header}: ${answerText(a)}`)].join('\n');
}

module.exports = { UNAVAILABLE, DECLINED, answerText, formatAnswers };
