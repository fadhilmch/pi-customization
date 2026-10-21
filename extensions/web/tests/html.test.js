const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToMarkdown } = require('../html.js');

test('HTML converter keeps main content and drops page chrome', () => {
  const md = htmlToMarkdown('<nav>nav text</nav><main><h1>Agent &amp; tools</h1><p>Intro <a href="/guide">guide</a>.</p><script>alert(1)</script></main><footer>footer</footer>', 'https://docs.example/base');
  assert.equal(md, '# Agent & tools\n\nIntro [guide](https://docs.example/guide).');
});

test('HTML converter renders language code, nested lists, tables and entities', () => {
  const md = htmlToMarkdown('<article><pre><code class="language-js">const x = 1 &lt; 2;</code></pre><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>&nbsp;B</td></tr></table></article>', 'https://example.test');
  assert.match(md, /```js\nconst x = 1 < 2;\n```/);
  assert.match(md, /- one\n  - nested/);
  assert.match(md, /  - nested\n- two/);
  assert.match(md, /\| Name \| Value \|\n\| --- \| --- \|\n\| A \| B \|/);
});

test('HTML converter makes relative links absolute and collapses whitespace', () => {
  const md = htmlToMarkdown('<p> A\n  B<br>C <a href="../x"> X </a><!-- hidden --></p>', 'https://host.test/a/b');
  assert.equal(md, 'A B\nC [X](https://host.test/x)');
});
