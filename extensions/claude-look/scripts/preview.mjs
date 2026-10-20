// Prints sample "claude-look" output with real ANSI. Usage:
//   node scripts/preview.mjs [after|before] [width]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { spinnerFrames } = require('../spinner.js');
const { renderHeader } = require('../header.js');
const { transformMarkdown } = require('../markdown.js');
const tools = require('../tools.js');
const { fg, bg, bold, dim, padTo } = require('../ansi.js');

const mode = process.argv[2] || 'after';
const width = Number(process.argv[3]) || 80;
const out = [];
const say = (...l) => out.push(...l);
const sample10 = Array.from({ length: 10 }, (_, i) => `output line ${i + 1}`).join('\n');
const diff = ' 10 function add(a, b) {\n-11   return a - b;\n+11   return a + b;\n 12 }\n+13 export default add;';

if (mode === 'after') {
  say('# claude-look preview (real extension helpers)', '');
  say('spinner: ' + spinnerFrames().join(' ') + '  ' + fg('#d77757', 'Pondering…'), '');
  say(...renderHeader(width, { cwd: process.cwd(), home: process.env.HOME || '' }));
  say(transformMarkdown('fix the failing test', { messageType: 'user' }).replace('\\>', '>'), '');
  say(transformMarkdown('I will look at the test first.', { messageType: 'assistant' }), '');
  const o = { width };
  say(tools.formatCallLine('bash', { command: 'npm test' }, { state: 'success', width }));
  say(...tools.formatResult('bash', { content: [{ type: 'text', text: sample10 }] }, o), '');
  say(tools.formatCallLine('read', { path: 'src/add.js' }, { state: 'success', width }));
  say(...tools.formatResult('read', { content: [{ type: 'text', text: 'const add = ...\n// 42 lines' }] }, o), '');
  say(tools.formatCallLine('bash', { command: 'cat missing.txt' }, { state: 'error', width }));
  say(...tools.formatResult('bash', { content: [{ type: 'text', text: 'cat: missing.txt: No such file or directory' }] }, { ...o, isError: true }), '');
  say(tools.formatCallLine('edit', { path: 'src/add.js' }, { state: 'success', width }));
  say(...tools.formatResult('edit', { content: [], details: { diff } }, o), '');
} else {
  // APPROXIMATION of Pi default layout with midnight-aurora colours: boxed tool output on a background, no bullets.
  const pink = (s) => fg('#ff4fd8', s), teal = (s) => fg('#2ee6d6', s), lime = (s) => fg('#a6e22e', s);
  const box = (hex, lines) => lines.map((l) => bg(hex, padTo(' ' + l, width)));
  say('# APPROXIMATION of Pi default look (midnight-aurora colours, hand-built, not captured from Pi)', '');
  say(pink('pi') + dim(' v1.3.0  escape to interrupt · ctrl+c to clear'), '');
  say(...box('#2a2438', ['fix the failing test']), '');
  say('I will look at the test first.', '');
  say(...box('#1d2a2a', [bold(teal('$ npm test')), '', ...sample10.split('\n')]), '');
  say(...box('#1d2a2a', [bold(teal('read ')) + teal('src/add.js'), '', 'const add = ...', '// 42 lines']), '');
  say(...box('#3a1d28', [bold(teal('$ cat missing.txt')), '', fg('#ff6b6b', 'cat: missing.txt: No such file or directory')]), '');
  say(...box('#1d2a2a', [bold(teal('edit ')) + teal('src/add.js'), '', ...diff.split('\n').map((l) => (l[0] === '+' ? lime(l) : l[0] === '-' ? fg('#ff6b6b', l) : dim(l)))]), '');
}
console.log(out.join('\n'));
