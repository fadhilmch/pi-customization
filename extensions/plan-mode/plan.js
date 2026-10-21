'use strict';
// Pure plan-mode helpers: tool sets, prompts, approval choices, plan parsing, rendering.

const TEAL = '#48968c';
const { fg, bold, dim, truncate } = require('./ansi.js');

const EXIT_TOOL = 'exit_plan_mode';
const WRITE_TOOLS = new Set(['write', 'edit']);
const CONTEXT_TAG = '[PLAN MODE ACTIVE]';
const ENTRY_TYPE = 'plan-mode';

const CHOICES = {
  auto: 'Approve & auto-execute',
  ask: 'Approve & keep asking',
  keep: 'Keep planning',
};

// Active tool list while planning: drop write/edit, add exit_plan_mode.
function planTools(active) {
  return [...new Set([...active.filter((n) => !WRITE_TOOLS.has(n)), EXIT_TOOL])];
}

// Active tool list after leaving plan mode: the saved list, minus exit_plan_mode.
function restoredTools(saved, current) {
  const base = saved && saved.length ? saved : current;
  return base.filter((n) => n !== EXIT_TOOL);
}

function planInstructions() {
  return `${CONTEXT_TAG}
You are in plan mode: a read-only research phase. The user wants a plan before any change is made.

Rules:
- The write and edit tools are disabled, and bash only allows read-only commands (ls, cat, grep, git log/diff/status, ...). Any attempt to modify files or run other commands will be blocked.
- Explore the codebase thoroughly (read, grep, find, ls) and ask the user clarifying questions in plain text when something essential is ambiguous.
- Do NOT start implementing.

When you have a concrete plan, call the \`${EXIT_TOOL}\` tool with the full plan as markdown in its \`plan\` parameter. Format the plan as:
- a short summary of the approach,
- a numbered list of implementation steps (one action per step, naming the files involved),
- optionally a short "Risks / open questions" list.
The user will approve it or ask you to keep planning. Do not repeat the plan in a normal message; present it only through \`${EXIT_TOOL}\`.`;
}

const approvalMessage = (mode) =>
  `User approved the plan${mode === 'ask' ? ' (they will be asked before each file change or non-read-only command)' : ''}. Plan mode is now OFF and write/edit/bash are available again. Implement the plan now. If it has 3 or more steps, use the todo tool to track progress (a todo list was already created from the plan steps if the todo extension is installed).`;

const keepPlanningMessage = (feedback) =>
  `The user did not approve the plan yet and wants you to keep planning.${feedback ? `\nTheir feedback: ${feedback}` : ''}\nRevise the plan, then call ${EXIT_TOOL} again.`;

// Extract step texts from a markdown plan: numbered items ("1. foo", "1) foo"); falls back to "- foo" bullets.
function extractSteps(plan) {
  const text = String(plan || '');
  const clean = (s) => s.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
  const grab = (re) => {
    const out = [];
    for (const m of text.matchAll(re)) {
      const s = clean(m[1]);
      if (s.length > 2) out.push(s.length > 120 ? `${s.slice(0, 117)}...` : s);
    }
    return out;
  };
  const numbered = grab(/^\s{0,3}\d+[.)]\s+(.+)$/gm);
  return numbered.length ? numbered : grab(/^\s{0,3}[-*]\s+(?!\[)(.+)$/gm);
}

function widgetLine(shortcut) {
  return fg(TEAL, `⏸ plan mode on (${shortcut} or /plan to exit)`);
}

function statusText() {
  return fg(TEAL, '⏸ plan');
}

// Rendering of the exit_plan_mode call: header plus the plan body, so the user can read it before the prompt.
function formatPlanCall(plan, { state = 'pending', width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  const bullet = state === 'error' ? fg('#ff6b80', '⏺') : state === 'success' ? fg('#4eba65', '⏺') : dim('⏺');
  const out = [truncate(`${p}${bullet} ${bold('Plan')}${dim(' (plan mode)')}`, width)];
  const body = String(plan || '').replace(/\r/g, '').replace(/\n+$/, '');
  if (body) for (const l of body.split('\n')) out.push(truncate(`${p}  ${l}`, width));
  return out;
}

function formatPlanResult(text, { isError = false, isPartial = false, width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  if (isPartial) return [truncate(`${p}  ⎿  ${dim('Waiting for approval…')}`, width)];
  const first = String(text || '').split('\n')[0];
  return [truncate(`${p}  ⎿  ${isError ? fg('#ff6b80', first) : fg('#999999', first)}`, width)];
}

module.exports = {
  TEAL, EXIT_TOOL, WRITE_TOOLS, CONTEXT_TAG, ENTRY_TYPE, CHOICES,
  planTools, restoredTools, planInstructions, approvalMessage, keepPlanningMessage,
  extractSteps, widgetLine, statusText, formatPlanCall, formatPlanResult,
};
