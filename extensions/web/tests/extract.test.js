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
