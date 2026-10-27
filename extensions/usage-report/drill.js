'use strict';
// /context <category>: show the text behind one row of the report, capped. Pure; input is what index.ts already has.
const { estimateTokens } = require('./messages.js');

const MAX_CHARS = 3000;

function cap(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_CHARS) return s;
  return `${s.slice(0, MAX_CHARS)}\n… ${s.length - MAX_CHARS} more characters (preview capped at ${MAX_CHARS})`;
}

const stringify = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const CATEGORIES = 'system, tools, tool <name>, files, file <name>, skills';

// input: { systemPrompt, contextFiles:[{path,content}], skills:[{name,description}], tools:[ToolInfo] }
// -> { title, text } or { error }
function drillDown(query, input) {
  const [head = '', ...rest] = String(query || '').trim().split(/\s+/);
  const name = rest.join(' ').toLowerCase();
  const key = head.toLowerCase();
  const files = input.contextFiles || [];
  const tools = input.tools || [];
  const skills = input.skills || [];

  const pickTool = (n) => tools.find((t) => t.name.toLowerCase() === n) || tools.find((t) => t.name.toLowerCase().includes(n));
  const pickFile = (n) => files.find((f) => f.path.toLowerCase().endsWith(n)) || files.find((f) => f.path.toLowerCase().includes(n));
  const toolResult = (t) => ({ title: `Tool: ${t.name} (~${estimateTokens(stringify(t).length)} tokens)`, text: cap(stringify({ name: t.name, description: t.description, parameters: t.parameters })) });
  const fileResult = (f) => ({ title: `Context file: ${f.path} (~${estimateTokens((f.content || '').length)} tokens)`, text: cap(f.content || '') });

  if (key === 'system' || key === 'system-prompt' || key === 'prompt') {
    const text = input.systemPrompt || '';
    return { title: `System prompt (~${estimateTokens(text.length)} tokens)`, text: cap(text) };
  }
  if (key === 'tools') return { title: `Tools (${tools.length})`, text: cap(tools.map((t) => `${t.name}  ~${estimateTokens(stringify(t).length)} tokens`).join('\n')) || 'No active tools.' };
  if (key === 'tool') {
    if (!name) return { error: 'Usage: /context tool <name>' };
    const t = pickTool(name);
    return t ? toolResult(t) : { error: `No active tool matching "${name}".` };
  }
  if (key === 'files' || key === 'context-files') {
    return { title: `Context files (${files.length})`, text: files.length ? files.map((f) => `${f.path}  ~${estimateTokens((f.content || '').length)} tokens`).join('\n') : 'Pi did not expose any context files.' };
  }
  if (key === 'file') {
    if (!name) return { error: 'Usage: /context file <name>' };
    const f = pickFile(name);
    return f ? fileResult(f) : { error: `No context file matching "${name}".` };
  }
  if (key === 'skills' || key === 'skill') {
    const list = skills.filter((s) => !name || (s.name || '').toLowerCase().includes(name));
    return { title: `Skills (${list.length})`, text: list.length ? cap(list.map((s) => `${s.name}: ${s.description || ''}`).join('\n')) : 'No matching skills (or Pi did not expose them).' };
  }
  // Bare name: a tool or a context file.
  const q = String(query).trim().toLowerCase();
  const t = tools.find((x) => x.name.toLowerCase() === q);
  if (t) return toolResult(t);
  const f = pickFile(q);
  if (f) return fileResult(f);
  return { error: `Unknown category "${query}". Try: ${CATEGORIES}.` };
}

module.exports = { drillDown, MAX_CHARS, CATEGORIES };
