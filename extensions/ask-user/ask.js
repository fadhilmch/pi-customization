'use strict';
// The tool's execute logic without Pi: validate, ask (through an injected picker), format.
//   pick(questions) -> Promise<picker result | undefined>   (undefined = no UI answered)
const { validateQuestions } = require('./validate.js');
const { UNAVAILABLE, DECLINED, formatAnswers } = require('./answers.js');

const text = (t, details) => ({ content: [{ type: 'text', text: t }], details });

async function runAsk(params, { interactive, pick, signal } = {}) {
  const v = validateQuestions(params?.questions);
  if (!v.ok) {
    return text(`Invalid ask_user input: ${v.error} Fix it and call ask_user again, or ask in plain text.`, { status: 'invalid', error: v.error });
  }
  if (!interactive || typeof pick !== 'function') return text(UNAVAILABLE, { status: 'unavailable' });
  if (signal?.aborted) return text(DECLINED, { status: 'declined' });

  let res;
  try {
    res = await pick(v.questions);
  } catch {
    res = undefined;
  }
  if (res === undefined) return text(UNAVAILABLE, { status: 'unavailable' });
  if (!res || res.cancelled) return text(DECLINED, { status: 'declined' });
  return text(formatAnswers(res.answers), { status: 'answered', answers: res.answers });
}

module.exports = { runAsk };
