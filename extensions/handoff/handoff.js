'use strict';
// Pure helpers for /handoff (no Pi runtime imports, so they are unit-testable).

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
   (if a Live State section is present, carry over the open todos, uncommitted changes and plan mode where relevant)
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

function entryToMessage(entry) {
  if (entry.type === 'message') return entry.message;
  if (entry.type === 'compaction') {
    return {
      role: 'compactionSummary',
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return undefined;
}

/**
 * Messages that make up the live context of a branch. If the branch was compacted, use the latest
 * compaction summary, the entries kept from firstKeptEntryId onward, and everything after it.
 */
function getHandoffMessages(branch) {
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === 'compaction') {
      compactionIndex = i;
      break;
    }
  }
  if (compactionIndex < 0) return branch.map(entryToMessage).filter((m) => m !== undefined);

  const compaction = branch[compactionIndex];
  const firstKeptIndex = branch.findIndex((e) => e.id === compaction.firstKeptEntryId);
  const kept = firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : [];
  return [compaction, ...kept, ...branch.slice(compactionIndex + 1)].map(entryToMessage).filter((m) => m !== undefined);
}

function buildUserMessageText(conversationText, goal, liveState) {
  const live = liveState ? `## Live State\n\n${liveState}\n\n` : '';
  return `## Conversation History\n\n${conversationText}\n\n${live}## User's Goal for New Thread\n\n${goal}`;
}

const MAX_STATUS_LINES = 15;
const MAX_TODOS = 20;

/** Todo list as the `todo` extension stores it: last todo tool result or todo-state entry on the branch (read-only). */
function todosFromBranch(branch) {
  let todos;
  for (const e of branch || []) {
    if (!e) continue;
    let raw;
    if (e.type === 'message' && e.message && e.message.role === 'toolResult' && e.message.toolName === 'todo') {
      if (e.message.details && !e.message.details.error) raw = e.message.details.todos;
    } else if (e.type === 'custom' && e.customType === 'todo-state') {
      raw = e.data && e.data.todos;
    }
    if (Array.isArray(raw)) todos = raw;
  }
  return todos;
}

/** Plan-mode flag from the last `plan-mode` custom entry; undefined when the extension never wrote one. */
function planModeFromBranch(branch) {
  let enabled;
  for (const e of branch || []) {
    if (e && e.type === 'custom' && e.customType === 'plan-mode' && e.data) enabled = Boolean(e.data.enabled);
  }
  return enabled;
}

/** Text block of live state for the generation input; missing pieces are skipped. Empty string when nothing is known. */
function buildLiveState({ branchName, statusLines, todos, planMode } = {}) {
  const parts = [];
  if (branchName) parts.push(`Git branch: ${branchName}`);
  const status = (statusLines || []).filter((l) => l && l.trim());
  if (status.length) {
    const shown = status.slice(0, MAX_STATUS_LINES);
    const more = status.length - shown.length;
    parts.push(`Git status (porcelain):\n${shown.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}`);
  } else if (branchName && statusLines) {
    parts.push('Git status: clean');
  }
  if (Array.isArray(todos) && todos.length) {
    const shown = todos.slice(0, MAX_TODOS).map((t) => `- [${t.status || 'pending'}] ${t.content}`);
    const more = todos.length - shown.length;
    parts.push(`Todo list:\n${shown.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}`);
  }
  if (planMode === true) parts.push('Plan mode: active (read-only planning)');
  return parts.join('\n\n');
}

function extractText(content) {
  return (content || [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/** Footer so the new session can read the old transcript if the summary missed something (keeps handoff "lossless"). */
function withParentReference(prompt, parentSessionFile) {
  const body = String(prompt || '').trim();
  if (!parentSessionFile) return body;
  return `${body}\n\n---\nPrevious session transcript (read it only if you need detail not covered above): ${parentSessionFile}\nUse the \`read_session\` tool (optional \`query\` and \`limit\`) to read it, not raw \`read\` on the JSONL.`;
}

function parseGoal(args) {
  return String(args || '').trim();
}

/** `/handoff [--no-review] <goal>` -> { goal, noReview }. The flag is only recognised as the first token. */
function parseArgs(args) {
  const text = String(args || '').trim();
  const m = /^--no-review(?:\s+|$)/.exec(text);
  return m ? { goal: text.slice(m[0].length).trim(), noReview: true } : { goal: text, noReview: false };
}

function previewStats(text) {
  const t = String(text || '');
  return { chars: t.length, lines: t ? t.split('\n').length : 0 };
}

module.exports = {
  SYSTEM_PROMPT,
  entryToMessage,
  getHandoffMessages,
  buildUserMessageText,
  extractText,
  withParentReference,
  parseGoal,
  parseArgs,
  todosFromBranch,
  planModeFromBranch,
  buildLiveState,
  previewStats,
};
