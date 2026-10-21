'use strict';
// Pure helpers for /handoff (no Pi runtime imports, so they are unit-testable).

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
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

function buildUserMessageText(conversationText, goal) {
  return `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`;
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
  return `${body}\n\n---\nPrevious session transcript (read it only if you need detail not covered above): ${parentSessionFile}`;
}

function parseGoal(args) {
  return String(args || '').trim();
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
  previewStats,
};
