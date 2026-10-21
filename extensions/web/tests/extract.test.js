const test = require('node:test');
const assert = require('node:assert/strict');
const { pickSection, listHeadings } = require('../extract.js');

const md = '# Guide\n\nIntro\n\n## Tools\n\nTool intro\n\n### Search\n\nDetails\n\n## Limits\n\nBoundaries';

test('section extraction includes nested headings and stops at the next peer', () => {
  assert.equal(pickSection(md, 'tools').text, '## Tools\n\nTool intro\n\n### Search\n\nDetails');
});

test('missing sections return the heading list', () => {
  const result = pickSection(md, 'not here');
  assert.equal(result.found, false);
  assert.deepEqual(result.headings, ['Guide', 'Tools', 'Search', 'Limits']);
  assert.match(result.text, /# Guide/);
});

test('heading listing handles levels, trailing hashes and inline markup', () => {
  assert.deepEqual(listHeadings('## **A** ##\n### `B`\nnot a heading'), ['A', 'B']);
});

test('hash lines inside fenced code are not headings', () => {
  const doc = '# Guide\n\n```sh\n# install\nnpm i\n```\n\n~~~\n## also code\n~~~\n\n## Real\n\ntext';
  assert.deepEqual(listHeadings(doc), ['Guide', 'Real']);
  assert.equal(pickSection(doc, 'guide').text, doc);
  assert.equal(pickSection(doc, 'install').found, false);
  assert.equal(pickSection(doc, 'Real').text, '## Real\n\ntext');
});

test('a longer fence is not closed by a shorter one', () => {
  assert.deepEqual(listHeadings('# A\n````\n```\n# no\n```\n````\n# B'), ['A', 'B']);
});
