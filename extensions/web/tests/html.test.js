const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToMarkdown, decodeEntities } = require('../html.js');

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

test('HTML converter treats script and style bodies as raw text', () => {
  assert.equal(htmlToMarkdown('<h1>A</h1><script>if(a<b){x()}</script><p>after</p>'), '# A\n\nafter');
  assert.equal(htmlToMarkdown('<style>a>b{}</STYLE ><p>x</p><textarea><b>raw</textarea><p>y</p>'), 'x\n\n<b>raw\n\ny');
});

test('HTML converter keeps pages wrapped in forms and article headers', () => {
  assert.equal(htmlToMarkdown('<form id="aspnetForm"><h1>Title</h1><p>Body</p></form>'), '# Title\n\nBody');
  assert.equal(htmlToMarkdown('<header>Site</header><article><header><h1>Post</h1></header><p>Text</p></article>'), '# Post\n\nText');
});

test('HTML converter falls back when the main container is empty', () => {
  assert.equal(htmlToMarkdown('<main> </main><article><p>from article</p></article>'), 'from article');
  assert.equal(htmlToMarkdown('<main></main><p>whole body</p>'), 'whole body');
  assert.equal(htmlToMarkdown('<nav>only nav</nav>'), 'only nav');
});

test('HTML tokenizer respects ">" inside quoted attribute values', () => {
  assert.equal(htmlToMarkdown('<p><a title="a>b" href="/x">link</a> after</p>', 'https://h.test/'), '[link](https://h.test/x) after');
});

test('HTML converter drops heading permalink anchors', () => {
  assert.equal(htmlToMarkdown('<h2 id=x>Install<a class="headerlink" href="#x">¶</a></h2>'), '## Install');
  assert.equal(htmlToMarkdown('<h2><a href="#y">#</a> Usage</h2><h3><a href="#z">Linked</a></h3>'), '## Usage\n\n### Linked');
  assert.equal(htmlToMarkdown('<h2>See <a href="/d">docs</a></h2>', 'https://h.test/'), '## See [docs](https://h.test/d)');
});

test('entities need a trailing semicolon and the table covers common typography', () => {
  assert.equal(decodeEntities('&rsquo;&ldquo;&rarr;&times;&hellip;&le;'), '’“→×…≤');
  assert.equal(decodeEntities('/p?a=1&copy=2&amp;b'), '/p?a=1&copy=2&b');
  assert.equal(htmlToMarkdown('<a href="/p?a=1&copy=2">x</a>', 'https://h.test/'), '[x](https://h.test/p?a=1&copy=2)');
});

test('unclosed list items, paragraphs and cells close when a sibling opens', () => {
  assert.equal(htmlToMarkdown('<ul><li>a<li>b</ul>'), '- a\n- b');
  assert.match(htmlToMarkdown('<p>one<p>two<div>three</div>'), /^one\n\ntwo\n\nthree$/);
  assert.match(htmlToMarkdown('<table><tr><td>a<td>b<tr><td>c<td>d</table>'), /\| a \| b \|\n\| --- \| --- \|\n\| c \| d \|/);
  assert.equal(htmlToMarkdown('<ul><li>a<ul><li>n1<li>n2</ul><li>b</ul>'), '- a\n  - n1\n  - n2\n- b');
});

test('ordered lists number items and honour start', () => {
  assert.equal(htmlToMarkdown('<ol><li>a</li><li>b</li><li>c</li></ol>'), '1. a\n2. b\n3. c');
  assert.equal(htmlToMarkdown('<ol start="5"><li>a</li><li>b</li></ol>'), '5. a\n6. b');
});

test('code blocks inside list items keep newlines and indentation', () => {
  const md = htmlToMarkdown('<ul><li>Run<pre><code>a\n  b\n\nc</code></pre></li><li>Next</li></ul>');
  assert.match(md, /- Run\n  ```\n  a\n    b\n\n  c\n  ```/);
  assert.match(md, /- Next/);
});

test('whitespace cleanup leaves fenced code untouched', () => {
  const md = htmlToMarkdown('<p>a</p><pre>x  \n\n\n\n    y   </pre><p>b</p>');
  assert.equal(md, 'a\n\n```\nx  \n\n\n\n    y   \n```\n\nb');
});
