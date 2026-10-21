'use strict';
// Input validation for ask_user. Pure: returns { ok, questions } (trimmed copies) or { ok: false, error }.

const LIMITS = { minQuestions: 1, maxQuestions: 4, minOptions: 2, maxOptions: 4, maxHeader: 12, maxLabel: 60 };

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function validateQuestions(input) {
  const L = LIMITS;
  if (!Array.isArray(input) || input.length < L.minQuestions || input.length > L.maxQuestions) {
    return { ok: false, error: `questions must be an array of ${L.minQuestions}-${L.maxQuestions} items (got ${Array.isArray(input) ? input.length : typeof input}).` };
  }
  const headers = new Set();
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const q = input[i];
    const at = `questions[${i}]`;
    if (!q || typeof q !== 'object') return { ok: false, error: `${at} must be an object.` };
    const question = clean(q.question);
    if (!question) return { ok: false, error: `${at}.question is required.` };
    const header = clean(q.header);
    if (!header) return { ok: false, error: `${at}.header is required (a 1-${L.maxHeader} character tag such as "Scope").` };
    if (header.length > L.maxHeader) return { ok: false, error: `${at}.header "${header}" is ${header.length} characters; keep it to ${L.maxHeader} or fewer.` };
    if (headers.has(header.toLowerCase())) return { ok: false, error: `${at}.header "${header}" is used twice; headers must be unique.` };
    headers.add(header.toLowerCase());
    if (!Array.isArray(q.options) || q.options.length < L.minOptions || q.options.length > L.maxOptions) {
      return { ok: false, error: `${at}.options must have ${L.minOptions}-${L.maxOptions} items (got ${Array.isArray(q.options) ? q.options.length : typeof q.options}). "Other" is added automatically, do not include it.` };
    }
    const labels = new Set();
    const options = [];
    for (let j = 0; j < q.options.length; j++) {
      const o = q.options[j];
      const oat = `${at}.options[${j}]`;
      if (!o || typeof o !== 'object') return { ok: false, error: `${oat} must be an object with label and description.` };
      const label = clean(o.label);
      if (!label) return { ok: false, error: `${oat}.label is required.` };
      if (label.length > L.maxLabel) return { ok: false, error: `${oat}.label is ${label.length} characters; keep it to ${L.maxLabel} or fewer and put detail in description.` };
      if (/^other\b/i.test(label)) return { ok: false, error: `${oat}.label "${label}" looks like "Other"; that choice is added automatically.` };
      if (labels.has(label.toLowerCase())) return { ok: false, error: `${at} has a duplicate option label "${label}".` };
      labels.add(label.toLowerCase());
      options.push({ label, description: clean(o.description) });
    }
    out.push({ question, header, options, multiSelect: q.multiSelect === true });
  }
  return { ok: true, questions: out };
}

module.exports = { LIMITS, validateQuestions };
