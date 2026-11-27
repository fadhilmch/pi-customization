const test = require('node:test');
const assert = require('node:assert/strict');

const { stripAnsi, visibleWidth } = require('../ansi.js');
const { validateQuestions } = require('../validate.js');
const answers = require('../answers.js');
const { createPicker } = require('../picker.js');
const render = require('../render.js');
const { runAsk } = require('../ask.js');

const opt = (label, description = 'desc') => ({ label, description });
const q = (header, extra = {}) => ({
  question: `Which ${header}?`,
  header,
  options: [opt('A (Recommended)'), opt('B'), opt('C')],
  ...extra,
});

// ---- validation ----

test('validate accepts good input and trims', () => {
  const r = validateQuestions([{ question: '  Scope  ? ', header: ' Scope ', options: [opt(' A '), opt('B', ' d  e ')] }]);
  assert.equal(r.ok, true);
  assert.equal(r.questions[0].header, 'Scope');
  assert.equal(r.questions[0].question, 'Scope ?');
  assert.deepEqual(r.questions[0].options, [{ label: 'A', description: 'desc' },{ label: 'B', description: 'd e' }]);
  assert.equal(r.questions[0].multiSelect, false);
});

test('validate rejects bad question counts', () => {
  assert.match(validateQuestions([]).error, /1-4/);
  assert.match(validateQuestions('x').error, /1-4/);
  assert.match(validateQuestions([1, 2, 3, 4, 5].map((i) => q(`H${i}`))).error, /1-4/);
  assert.equal(validateQuestions([1, 2, 3, 4].map((i) => q(`H${i}`))).ok, true);
});

test('validate rejects bad options, headers and labels', () => {
  const bad = (x) => validateQuestions([x]);
  assert.match(bad(q('H', { options: [opt('A')] })).error, /options must have 2-4/);
  assert.match(bad(q('H', { options: ['a', 'b', 'c', 'd', 'e'].map((l) => opt(l)) })).error, /options must have 2-4/);
  assert.match(bad(q('H', { options: [opt('A'), opt('a')] })).error, /duplicate option label/);
  assert.match(bad(q('H', { options: [opt('A'), opt('Other')] })).error, /Other/);
  assert.match(bad(q('H', { options: [opt('A'), opt('x'.repeat(80))] })).error, /60 or fewer/);
  assert.match(bad(q('A very long header')).error, /12 or fewer/);
  assert.match(bad(q('')).error, /header is required/);
  assert.match(bad({ ...q('H'), question: ' ' }).error, /question is required/);
  assert.match(validateQuestions([q('Same'), q('same')]).error, /used twice/);
  assert.match(bad(null).error, /must be an object/);
});

// ---- answer formatting ----

test('formatAnswers: single, multi-select, other, mixed', () => {
  const text = answers.formatAnswers([
    { header: 'Scope', selected: ['Only slugify'], other: null },
    { header: 'Libs', selected: ['A', 'B'], other: null },
    { header: 'Style', selected: [], other: 'tabs please' },
    { header: 'Both', selected: ['X'], other: 'and Y' },
  ]);
  assert.equal(text, 'User answers:\nScope: Only slugify\nLibs: A, B\nStyle: Other: tabs please\nBoth: X, Other: and Y');
});

// ---- picker ----

const keys = (p, ...ks) => ks.forEach((k) => p.press(k));

test('picker: single question, select option 2 with down+enter, finishes without a review tab', () => {
  const p = createPicker(validateQuestions([q('Scope')]).questions);
  assert.equal(p.result(), null);
  keys(p, 'down', 'enter');
  assert.deepEqual(p.result(), { cancelled: false, answers: [{ header: 'Scope', selected: ['B'], other: null }] });
});

test('picker: Other typed text; empty text keeps asking; escape inside input goes back', () => {
  const p = createPicker(validateQuestions([q('Scope')]).questions);
  keys(p, 'up', 'enter'); // wraps to Other row
  assert.equal(p.state().typing, true);
  keys(p, 'enter'); // empty: leave input, unanswered
  assert.equal(p.result(), null);
  keys(p, 'enter');
  p.type('do it ');
  p.type('my way');
  keys(p, 'backspace');
  assert.equal(p.state().buffer, 'do it my wa');
  keys(p, 'escape');
  assert.equal(p.result(), null); // escape in input only leaves input
  keys(p, 'enter');
  p.type('mine');
  keys(p, 'enter');
  assert.deepEqual(p.result(), { cancelled: false, answers: [{ header: 'Scope', selected: [], other: 'mine' }] });
});

test('picker: type() ignored outside input and control chars stripped', () => {
  const p = createPicker(validateQuestions([q('Scope')]).questions);
  p.type('zzz');
  assert.equal(p.state().buffer, '');
  keys(p, 'up', 'enter');
  p.type('a\nb\u0007c');
  assert.equal(p.state().buffer, 'a bc');
});

test('picker: multi-select toggles with space, enter confirms, other adds text', () => {
  const p = createPicker(validateQuestions([q('Libs', { multiSelect: true })]).questions);
  keys(p, 'space', 'down', 'down', 'space', 'enter');
  assert.deepEqual(p.result().answers, [{ header: 'Libs', selected: ['A (Recommended)', 'C'], other: null }]);

  const p2 = createPicker(validateQuestions([q('Libs', { multiSelect: true })]).questions);
  keys(p2, 'space', 'up', 'enter');
  p2.type('zod');
  keys(p2, 'enter');
  assert.deepEqual(p2.result().answers, [{ header: 'Libs', selected: ['A (Recommended)'], other: 'zod' }]);
});

test('picker: multi-select enter with nothing ticked takes the highlighted row; toggling off works', () => {
  const p = createPicker(validateQuestions([q('Libs', { multiSelect: true })]).questions);
  keys(p, 'down', 'enter');
  assert.deepEqual(p.result().answers[0].selected, ['B']);
  const p2 = createPicker(validateQuestions([q('Libs', { multiSelect: true })]).questions);
  keys(p2, 'space', 'space', 'down', 'enter');
  assert.deepEqual(p2.result().answers[0].selected, ['B']);
});

test('picker: several questions use a review tab; navigation and edits', () => {
  const p = createPicker(validateQuestions([q('One'), q('Two', { multiSelect: true })]).questions);
  keys(p, 'enter'); // One -> A, moves to Two
  assert.equal(p.state().tab, 1);
  keys(p, 'down', 'space', 'enter'); // Two -> B, review tab
  assert.equal(p.state().tab, 2);
  keys(p, 'left'); // back to Two
  keys(p, 'shift-tab'); // back to One
  assert.equal(p.state().tab, 0);
  keys(p, 'down', 'enter'); // change One to B
  keys(p, 'right'); // Two -> review
  assert.equal(p.state().tab, 2);
  assert.equal(p.result(), null);
  keys(p, 'enter');
  assert.deepEqual(p.result(), {
    cancelled: false,
    answers: [
      { header: 'One', selected: ['B'], other: null },
      { header: 'Two', selected: ['B'], other: null },
    ],
  });
});

test('picker: submitting with unanswered jumps to the first unanswered question', () => {
  const p = createPicker(validateQuestions([q('One'), q('Two')]).questions);
  keys(p, 'tab', 'tab'); // review
  assert.equal(p.state().tab, 2);
  keys(p, 'enter');
  assert.equal(p.result(), null);
  assert.equal(p.state().tab, 0);
});

test('picker: single-select typed Other replaces a chosen option and vice versa', () => {
  const p = createPicker(validateQuestions([q('One'), q('Two')]).questions);
  keys(p, 'up', 'enter');
  p.type('x');
  keys(p, 'enter'); // answered with Other, on Two
  keys(p, 'shift-tab', 'enter'); // back to One, cursor on Other row: open input again
  assert.equal(p.state().typing, true);
  keys(p, 'escape', 'up', 'up', 'up', 'enter'); // pick option A instead
  keys(p, 'enter');
  keys(p, 'enter');
  const r = p.result();
  assert.deepEqual(r.answers[0], { header: 'One', selected: ['A (Recommended)'], other: null });
});

test('picker: escape cancels, later keys are ignored', () => {
  const p = createPicker(validateQuestions([q('Scope')]).questions);
  keys(p, 'escape', 'enter');
  assert.deepEqual(p.result(), { cancelled: true });
});

test('picker render: fixed width, ANSI-safe, shows tabs, options, descriptions and help', () => {
  const p = createPicker(validateQuestions([q('One'), q('Two', { multiSelect: true })]).questions);
  for (const width of [30, 60, 100]) {
    const rows = p.render(width);
    for (const r of rows) assert.ok(visibleWidth(r) <= width, `${visibleWidth(r)} > ${width}: ${stripAnsi(r)}`);
  }
  const text = p.render(80).map(stripAnsi).join('\n');
  assert.match(text, /☐ One {2}☐ Two {2}✓ Submit/);
  assert.match(text, /Which One\?/);
  assert.match(text, /❯ 1\. A \(Recommended\)/);
  assert.match(text, /\n {6}desc/);
  assert.match(text, /4\. Other \(type your own\)/);
  assert.match(text, /Enter select/);
  keys(p, 'enter');
  assert.match(p.render(80).map(stripAnsi).join('\n'), /☒ One/);
  assert.match(p.render(80).map(stripAnsi).join('\n'), /\[ \] A \(Recommended\)/);
  keys(p, 'tab');
  const review = p.render(80).map(stripAnsi).join('\n');
  assert.match(review, /Review your answers/);
  assert.match(review, /One: A \(Recommended\)/);
  assert.match(review, /Two: \(unanswered\)/);
});

test('picker render: typing shows the buffer', () => {
  const p = createPicker(validateQuestions([q('Scope')]).questions);
  keys(p, 'up', 'enter');
  p.type('hello');
  const text = p.render(80).map(stripAnsi).join('\n');
  assert.match(text, /4\. Other: hello▏/);
  assert.match(text, /Enter confirm · Esc back/);
});

// ---- result rendering ----

test('call line: first header, extra questions as +N, fixed width', () => {
  const line = render.formatCallLine({ questions: [{ header: 'Scope' }, { header: 'Tests' }] }, { state: 'success', width: 60 });
  assert.equal(stripAnsi(line), '⏺ AskUser(Scope +1)');
  assert.equal(stripAnsi(render.formatCallLine({ questions: [{ header: 'Scope' }] }, { pad: 2 })), '  ⏺ AskUser(Scope)');
  assert.equal(stripAnsi(render.formatCallLine({}, {})), '⏺ AskUser');
  assert.ok(visibleWidth(render.formatCallLine({ questions: [{ header: 'x'.repeat(100) }] }, { width: 20 })) <= 20);
});

test('result rows: answers with the claude-look prefix, wrapped to width', () => {
  const details = {
    status: 'answered',
    answers: [
      { header: 'Scope', selected: ['Only slugify'], other: null },
      { header: 'Style', selected: [], other: 'a very long free text answer that must wrap onto another row' },
    ],
  };
  const rows = render.formatResult(details, { width: 40 }).map(stripAnsi);
  assert.equal(rows[0], '  ⎿  Scope: Only slugify');
  assert.match(rows[1], /^ {5}Style: Other: a very/);
  assert.ok(rows.length > 2);
  for (const r of render.formatResult(details, { width: 40 })) assert.ok(visibleWidth(r) <= 40);
});

test('result rows: declined, unavailable, invalid, partial', () => {
  const one = (d, o) => stripAnsi(render.formatResult(d, o)[0]);
  assert.equal(one({ status: 'declined' }), '  ⎿  User declined to answer');
  assert.match(one({ status: 'unavailable' }), /^ {2}⎿ {2}Not asked \(no interactive UI\)/);
  assert.equal(one({ status: 'invalid', error: 'bad' }), '  ⎿  bad');
  assert.equal(one(undefined, { isPartial: true }), '  ⎿  Waiting for answer…');
  assert.equal(one({ status: 'declined' }, { pad: 2 }), '    ⎿  User declined to answer');
});

// ---- tool logic ----

test('runAsk: answered', async () => {
  const r = await runAsk(
    { questions: [q('Scope')] },
    { interactive: true, pick: async (qs) => ({ cancelled: false, answers: [{ header: qs[0].header, selected: ['B'], other: null }] }) },
  );
  assert.equal(r.content[0].text, 'User answers:\nScope: B');
  assert.equal(r.details.status, 'answered');
});

test('runAsk: cancel returns the declined text', async () => {
  const r = await runAsk({ questions: [q('Scope')] }, { interactive: true, pick: async () => ({ cancelled: true }) });
  assert.match(r.content[0].text, /declined to answer/);
  assert.equal(r.details.status, 'declined');
});

test('runAsk: non-interactive returns immediately without calling pick', async () => {
  let called = false;
  const r = await runAsk({ questions: [q('Scope')] }, { interactive: false, pick: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(r.details.status, 'unavailable');
  assert.match(r.content[0].text, /cannot be asked/);
  assert.match(r.content[0].text, /recommended/);
  assert.match(r.content[0].text, /state the assumption/);
});

test('runAsk: a picker that returns nothing or throws is treated as unavailable', async () => {
  assert.equal((await runAsk({ questions: [q('S')] }, { interactive: true, pick: async () => undefined })).details.status, 'unavailable');
  assert.equal((await runAsk({ questions: [q('S')] }, { interactive: true, pick: async () => { throw new Error('x'); } })).details.status, 'unavailable');
});

test('runAsk: invalid input gives a helpful error and never asks', async () => {
  let called = false;
  const r = await runAsk({ questions: [q('S', { options: [opt('only')] })] }, { interactive: true, pick: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(r.details.status, 'invalid');
  assert.match(r.content[0].text, /Invalid ask_user input: questions\[0\]\.options must have 2-4/);
});

test('runAsk: an already aborted signal does not open the picker', async () => {
  const ac = new AbortController();
  ac.abort();
  let called = false;
  const r = await runAsk({ questions: [q('S')] }, { interactive: true, signal: ac.signal, pick: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(r.details.status, 'declined');
});

// ---- option previews ----

const withPreview = () => [
  { question: 'Layout?', header: 'Layout', options: [
    { label: 'A', description: 'a', preview: '+--+\n|  |\n+--+' },
    { label: 'B', description: 'b' } ] },
];

test('validate: preview keeps newlines and indentation, drops control chars, empty is omitted, long is capped', () => {
  const v = validateQuestions([{ question: 'Q?', header: 'H', options: [
    { label: 'A', description: '', preview: '\n  if (x) {\r\n\ty();\x1b[31m\n}\n\n' },
    { label: 'B', description: '', preview: '   \n ' },
    { label: 'C', description: '', preview: 'z'.repeat(5000) },
    { label: 'D', description: '', preview: 42 } ] }]);
  assert.equal(v.ok, true);
  const o = v.questions[0].options;
  assert.equal(o[0].preview, '  if (x) {\n  y();[31m\n}');
  assert.ok(!('preview' in o[1]) && !('preview' in o[3]));
  assert.equal(o[2].preview.length, 2000);
});

test('picker render: preview of the focused option goes below on narrow, beside on wide, follows the cursor', () => {
  const p = createPicker(withPreview());
  const narrow = p.render(60).map(stripAnsi);
  const at = narrow.findIndex((r) => r.includes('| |') || r.includes('|  |'));
  assert.ok(at > narrow.findIndex((r) => r.includes('2. B')), 'preview rows come after the option list');
  assert.ok(narrow.some((r) => /│ \+--\+/.test(r)));

  const wide = p.render(120).map(stripAnsi);
  const row = wide.find((r) => r.includes('1. A'));
  assert.match(row, /│ \+--\+/); // same row as the first option
  for (const r of p.render(120)) assert.ok(visibleWidth(r) <= 120);

  p.press('down'); // B has no preview
  assert.ok(!p.render(120).map(stripAnsi).join('\n').includes('+--+'));
  p.press('down'); // Other
  assert.ok(!p.render(60).map(stripAnsi).join('\n').includes('+--+'));
});

test('picker render: preview height is capped with a "more lines" row, widths stay fixed', () => {
  const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const p = createPicker([{ question: 'Q?', header: 'H', options: [{ label: 'A', description: '', preview: big }, { label: 'B', description: '' }] }]);
  const narrow = p.render(60).map(stripAnsi);
  assert.ok(narrow.some((r) => /… 33 more lines/.test(r)));
  assert.ok(!narrow.join('\n').includes('line 8'));
  const wide = p.render(120).map(stripAnsi);
  assert.ok(wide.some((r) => /… 27 more lines/.test(r)));
  for (const w of [30, 60, 99, 100, 140]) for (const r of p.render(w)) assert.ok(visibleWidth(r) <= w, `width ${w}`);
});
