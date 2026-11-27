'use strict';
// Pure plan-mode helpers: tool sets, prompts, approval choices, plan parsing, rendering.

const fs = require('node:fs');
const path = require('node:path');

const TEAL = '#48968c';
const { fg, bold, dim, truncate, wrapAnsi } = require('./ansi.js');

const EXIT_TOOL = 'exit_plan_mode';
const WRITE_TOOLS = new Set(['write', 'edit']);
const CONTEXT_TAG = '[PLAN MODE ACTIVE]';
const ENTRY_TYPE = 'plan-mode';

const CHOICES = {
  auto: 'Approve & auto-execute',
  ask: 'Approve & keep asking',
  edit: 'Edit plan',
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

const approvalMessage = (mode, edited = false) =>
  `User approved the plan${edited ? ' after editing it (follow their edited version, shown below)' : ''}${mode === 'ask' ? ' (they will be asked before each file change or non-read-only command)' : ''}. Plan mode is now OFF and write/edit/bash are available again. Implement the plan now. If it has 3 or more steps, use the todo tool to track progress (a todo list was already created from the plan steps if the todo extension is installed).`;

const keepPlanningMessage = (feedback) =>
  `The user did not approve the plan yet and wants you to keep planning.${feedback ? `\nTheir feedback: ${feedback}` : ''}\nRevise the plan, then call ${EXIT_TOOL} again.`;

// Line diff between two plan submissions (LCS, no deps). Returns [{ op: ' ' | '+' | '-', text }] in order.
function diffLines(prev, next) {
  const a = String(prev || '').replace(/\r/g, '').split('\n');
  const b = String(next || '').replace(/\r/g, '').split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ op: ' ', text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: '-', text: a[i++] });
    else out.push({ op: '+', text: b[j++] });
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] });
  while (j < b.length) out.push({ op: '+', text: b[j++] });
  return out;
}

// Compact diff for the approval dialog: only changed lines, capped. '' when there is no previous plan or nothing changed.
function formatPlanDiff(prev, next, { maxLines = 12 } = {}) {
  if (prev === undefined || prev === null) return '';
  const changed = diffLines(prev, next).filter((d) => d.op !== ' ' && d.text.trim());
  if (!changed.length) return '';
  const added = changed.filter((d) => d.op === '+').length;
  const rows = changed.slice(0, maxLines).map((d) => `${d.op} ${d.text}`);
  if (changed.length > maxLines) rows.push(`... ${changed.length - maxLines} more changed lines`);
  return `Changes since last submission (+${added} -${changed.length - added}):\n${rows.join('\n')}`;
}

// Save an approved plan to <dir>/<timestamp>.md without overwriting (suffix -2, -3 ... on a clash). Returns the file path.
function savePlan(dir, plan, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  for (let n = 1; n < 100; n++) {
    const file = path.join(dir, `${stamp}${n > 1 ? `-${n}` : ''}.md`);
    try {
      fs.writeFileSync(file, `${String(plan).replace(/\n*$/, '')}\n`, { flag: 'wx' });
      return file;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('could not find a free plan file name');
}

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

// Rendering of the exit_plan_mode call: header line. The plan body is rendered as Markdown by index.ts
// (Pi's Markdown component); formatPlanBody is the plain-text fallback used when that is unavailable.
function formatPlanHeader(state = 'pending', { width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  const bullet = state === 'error' ? fg('#ff6b80', '⏺') : state === 'success' ? fg('#4eba65', '⏺') : dim('⏺');
  return truncate(`${p}${bullet} ${bold('Plan')}${dim(' (plan mode)')}`, width);
}

function formatPlanBody(plan, { width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  const body = String(plan || '').replace(/\r/g, '').replace(/\n+$/, '');
  const out = [];
  if (body) for (const l of body.split('\n')) for (const row of wrapAnsi(l, Math.max(1, width - pad - 2))) out.push(`${p}  ${row}`);
  return out;
}

function formatPlanCall(plan, { state = 'pending', width = 80, pad = 0 } = {}) {
  return [formatPlanHeader(state, { width, pad }), ...formatPlanBody(plan, { width, pad })];
}

// Short, user-facing line for the outcome; the model-facing text is long and only a fallback.
function planOutcome(details, text) {
  if (details && details.approved) {
    return details.mode === 'ask' ? 'Plan approved · asking before each change' : 'Plan approved · executing';
  }
  if (details && details.approved === false && !details.isError) {
    return `Still planning${details.feedback ? ` · ${details.feedback}` : ''}`;
  }
  return String(text || '').split('\n')[0];
}

function formatPlanResult(text, { details, isError = false, isPartial = false, width = 80, pad = 0 } = {}) {
  const p = ' '.repeat(pad);
  if (isPartial) return [truncate(`${p}  ⎿  ${dim('Waiting for approval…')}`, width)];
  const color = (l) => (isError ? fg('#ff6b80', l) : fg('#999999', l));
  return wrapAnsi(planOutcome(details, text), Math.max(1, width - pad - 5)).map(
    (row, i) => `${p}${i === 0 ? '  ⎿  ' : '     '}${color(row)}`,
  );
}

module.exports = {
  TEAL, EXIT_TOOL, WRITE_TOOLS, CONTEXT_TAG, ENTRY_TYPE, CHOICES,
  planTools, restoredTools, planInstructions, approvalMessage, keepPlanningMessage,
  diffLines, formatPlanDiff, savePlan, extractSteps, widgetLine, statusText, formatPlanCall, formatPlanHeader, formatPlanBody, planOutcome, formatPlanResult,
};
