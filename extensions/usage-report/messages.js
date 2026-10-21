'use strict';
// Session branch -> the messages that make up live context, plus size estimates. No Pi imports.

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1200; // rough flat guess per image block

const estimateTokens = (chars) => Math.ceil((chars || 0) / CHARS_PER_TOKEN);

function entryToMessage(entry) {
  if (entry.type === 'message') return entry.message;
  if (entry.type === 'compaction') return { role: 'compactionSummary', summary: entry.summary };
  if (entry.type === 'branch_summary') return { role: 'branchSummary', summary: entry.summary };
  if (entry.type === 'custom_message') return { role: 'custom', customType: entry.customType, content: entry.content };
  return undefined;
}

// After a compaction the context is: summary, entries from firstKeptEntryId, then everything later.
function contextMessages(branch) {
  let ci = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === 'compaction') {
      ci = i;
      break;
    }
  }
  let entries = branch;
  if (ci >= 0) {
    const c = branch[ci];
    const first = branch.findIndex((e) => e.id === c.firstKeptEntryId);
    entries = [c, ...(first >= 0 ? branch.slice(first, ci) : []), ...branch.slice(ci + 1)];
  }
  return entries.map(entryToMessage).filter(Boolean);
}

function blocksSize(content) {
  if (typeof content === 'string') return { chars: content.length, images: 0 };
  let chars = 0;
  let images = 0;
  for (const b of content || []) {
    if (!b) continue;
    if (b.type === 'text') chars += (b.text || '').length;
    else if (b.type === 'image') images++;
  }
  return { chars, images };
}

const jsonLen = (v) => {
  try {
    return JSON.stringify(v ?? {}).length;
  } catch {
    return 0;
  }
};

// { kind, chars, tokens, label? } for one message. kind: user | assistant | toolResult | other
function measureMessage(m) {
  let kind = 'other';
  let chars = 0;
  let images = 0;
  switch (m.role) {
    case 'user': {
      kind = 'user';
      ({ chars, images } = blocksSize(m.content));
      break;
    }
    case 'assistant': {
      kind = 'assistant';
      for (const b of m.content || []) {
        if (b.type === 'text') chars += (b.text || '').length;
        else if (b.type === 'thinking') chars += (b.thinking || '').length;
        else if (b.type === 'toolCall') chars += (b.name || '').length + jsonLen(b.arguments);
      }
      break;
    }
    case 'toolResult': {
      kind = 'toolResult';
      ({ chars, images } = blocksSize(m.content));
      break;
    }
    case 'bashExecution':
      chars = (m.command || '').length + (m.output || '').length;
      break;
    case 'compactionSummary':
    case 'branchSummary':
      chars = (m.summary || '').length;
      break;
    case 'custom':
      ({ chars, images } = blocksSize(m.content));
      break;
    default:
      chars = jsonLen(m.content);
  }
  return { kind, chars, tokens: estimateTokens(chars) + images * IMAGE_TOKENS };
}

function describeCall(call) {
  const a = call?.arguments || {};
  // subagent calls: "parallel: scout ×2", "chain: scout → worker", "scout: task"
  if (Array.isArray(a.tasks) && a.tasks.length) {
    const counts = new Map();
    for (const t of a.tasks) counts.set(t?.agent || '?', (counts.get(t?.agent || '?') || 0) + 1);
    return `parallel: ${[...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')}`;
  }
  if (Array.isArray(a.chain) && a.chain.length) return `chain: ${a.chain.map((s) => s?.agent || '?').join(' → ')}`;
  if (typeof a.agent === 'string' && typeof a.task === 'string') return clip(`${a.agent}: ${a.task}`);
  return clip(a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.query ?? a.url ?? a.task ?? Object.values(a).find((x) => typeof x === 'string'));
}

function clip(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 50 ? `${s.slice(0, 49)}…` : s;
}

// Totals per kind and the largest tool results (with the call that produced them).
function summarizeMessages(messages, { top = 5 } = {}) {
  const totals = {
    user: { count: 0, tokens: 0 },
    assistant: { count: 0, tokens: 0 },
    toolResult: { count: 0, tokens: 0 },
    other: { count: 0, tokens: 0 },
  };
  const calls = new Map();
  for (const m of messages) {
    if (m.role === 'assistant') for (const b of m.content || []) if (b.type === 'toolCall') calls.set(b.id, b);
  }
  const results = [];
  for (const m of messages) {
    const meas = measureMessage(m);
    totals[meas.kind].count++;
    totals[meas.kind].tokens += meas.tokens;
    if (meas.kind === 'toolResult') {
      const call = calls.get(m.toolCallId);
      results.push({ tool: m.toolName || call?.name || 'tool', what: describeCall(call), tokens: meas.tokens });
    }
  }
  results.sort((a, b) => b.tokens - a.tokens);
  return { totals, biggest: results.slice(0, top) };
}

module.exports = { CHARS_PER_TOKEN, estimateTokens, contextMessages, measureMessage, summarizeMessages, describeCall };
