'use strict';
// Child process command line. Pure apart from the existence checks, which are injectable.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expandHome } = require('./agents.js');

// Sibling extensions of this package (extensions/<name>/index.ts) can be named bare, e.g. "auto-mode".
const EXTENSIONS_ROOT = path.dirname(__dirname);
const BARE_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// Appended to every child's system prompt. The child's final message is all the parent ever sees,
// and the parent keeps paying for it on every later turn, so it has to be short.
function contractPrompt(maxChars) {
  const words = Math.max(80, Math.round(maxChars / 6 / 10) * 10);
  return [
    'You are running as a subagent: a separate process with a fresh context, started by another agent.',
    'Nobody can answer questions mid-task. Work with what you were given; if something is missing, say so in your report.',
    'Only your final message is returned to the agent that delegated to you. Make it a compact report:',
    'findings, decisions and changes, with path:line references. Quote only the lines that matter;',
    `never paste whole files or long logs. Stay under about ${words} words.`,
  ].join(' ');
}

// "auto-mode" -> sibling extension; "builtin:x" unchanged; anything else is a path relative to baseDir.
// A trailing "?" marks an entry optional: when it is missing it is skipped without a warning.
function resolveExtension(spec, { baseDir, home = os.homedir(), exists = fs.existsSync, root = EXTENSIONS_ROOT } = {}) {
  const s = String(spec).trim();
  if (s.endsWith('?')) {
    const r = resolveExtension(s.slice(0, -1), { baseDir, home, exists, root });
    return r.error ? { skip: true } : r;
  }
  if (!s) return { error: 'empty extension entry' };
  if (s.startsWith('builtin:')) return { value: s };
  if (BARE_RE.test(s)) {
    const p = path.join(root, s, 'index.ts');
    return exists(p) ? { value: p } : { error: `unknown extension "${s}" (no ${p})` };
  }
  const p = path.resolve(baseDir || process.cwd(), expandHome(s, home));
  return exists(p) ? { value: p } : { error: `extension not found: ${p}` };
}

function resolvePath(spec, { baseDir, home = os.homedir(), exists = fs.existsSync } = {}) {
  const p = path.resolve(baseDir || process.cwd(), expandHome(String(spec).trim(), home));
  return exists(p) ? { value: p } : { error: `not found: ${p}` };
}

// Characters of child output the parent accepts: the smallest of the agent's maxOutput, the config and the call's share.
function outputBudget(agent, config = {}, maxChars) {
  return Math.min(...[agent.maxOutput, config.maxOutputChars || 12000, maxChars].filter((n) => Number.isFinite(n) && n > 0));
}

// agent: parsed agent (after overrides). dispatch: { model, thinking } of the parent session.
// config: user config (extensions for every child, maxOutputChars). maxChars: this call's share of the output budget.
// Returns { args, model, warnings }.
function buildChildArgs(agent, task, { dispatch = {}, config = {}, configDir, home, exists, maxChars } = {}) {
  const warnings = [];
  const args = ['--mode', 'json', '-p', '--no-session', '-ne', '-ns'];

  const extensions = [];
  for (const spec of config.extensions || []) {
    const r = resolveExtension(spec, { baseDir: configDir, home, exists });
    if (r.error) warnings.push(`config: ${r.error}`);
    else if (r.value) extensions.push(r.value);
  }
  for (const spec of agent.extensions || []) {
    const r = resolveExtension(spec, { baseDir: agent.dir, home, exists });
    if (r.error) warnings.push(`${agent.name}: ${r.error}`);
    else if (r.value) extensions.push(r.value);
  }
  for (const e of [...new Set(extensions)]) args.push('-e', e);

  for (const spec of agent.skills || []) {
    const r = resolvePath(spec, { baseDir: agent.dir, home, exists });
    if (r.error) warnings.push(`${agent.name}: skill ${r.error}`);
    else args.push('--skill', r.value);
  }

  if (!agent.mcp) args.push('--no-mcp');
  if (agent.contextFiles === false) args.push('-nc');

  // No model on the agent: inherit the parent's model and, unless the agent sets one, its thinking level.
  const model = agent.model || dispatch.model;
  const thinking = agent.thinking || (agent.model ? undefined : dispatch.thinking);
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (agent.tools && agent.tools.length) args.push('--tools', agent.tools.join(','));

  const budget = outputBudget(agent, config, maxChars);
  args.push('--append-system-prompt', contractPrompt(budget));
  if (agent.systemPrompt) args.push('--append-system-prompt', agent.systemPrompt);
  args.push(`Task: ${String(task).trim()}`);
  return { args, model, warnings };
}

// How to start another Pi: reuse this runtime and script when we can see them, else "pi" from PATH.
function piInvocation(args, { argv = process.argv, execPath = process.execPath, exists = fs.existsSync } = {}) {
  const script = argv[1];
  if (script && !script.startsWith('/$bunfs/') && exists(script)) return { command: execPath, args: [script, ...args] };
  if (!/^(node|bun)(\.exe)?$/i.test(path.basename(execPath))) return { command: execPath, args };
  return { command: 'pi', args };
}

module.exports = { EXTENSIONS_ROOT, contractPrompt, outputBudget, resolveExtension, resolvePath, buildChildArgs, piInvocation };
