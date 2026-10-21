'use strict';
// The subagent tool's execute(): validate the call, run single / parallel / chain, build the result.
// Process start is injected (runChild) so tests can fake children.
const path = require('node:path');
const { applyOverrides } = require('./agents.js');
const { buildChildArgs, outputBudget, piInvocation } = require('./args.js');
const { createRun, runChild, mapLimit, isFailed, finish } = require('./run.js');
const { modelText } = require('./output.js');

const PREVIOUS = '{previous}';

function modeOf(params) {
  const p = params || {};
  const modes = [];
  if (Array.isArray(p.chain) && p.chain.length) modes.push('chain');
  if (Array.isArray(p.tasks) && p.tasks.length) modes.push('parallel');
  if (p.agent || p.task) modes.push('single');
  return modes.length === 1 ? modes[0] : null;
}

function available(agents) {
  return agents.map((a) => a.name).join(', ') || 'none';
}

// Tools that can change files or run arbitrary commands. An agent with no tool list gets Pi's defaults, which include them.
const MUTATING_TOOLS = ['write', 'edit', 'bash'];

// A session without write/edit (plan mode, or any read-only setup) must not delegate to a child that can change things.
function readOnlyViolation(agent) {
  if (!agent.tools || !agent.tools.length) return 'uses the default tool set (including write, edit and bash)';
  const risky = MUTATING_TOOLS.filter((t) => agent.tools.includes(t));
  return risky.length ? `has the ${risky.join(', ')} tool${risky.length > 1 ? 's' : ''}` : null;
}

function errorResult(text, mode = 'single') {
  return { content: [{ type: 'text', text }], details: { mode, runs: [] }, isError: true };
}

// Chain steps see the previous report; append it when the step forgot the placeholder.
function chainTask(task, previous, index) {
  const t = String(task ?? '');
  if (index === 0) return t.split(PREVIOUS).join('');
  return t.includes(PREVIOUS) ? t.split(PREVIOUS).join(previous) : `${t}\n\nOutput of the previous step:\n${previous}`;
}

async function executeSubagent(params, opts) {
  const {
    agents, config, dispatch = {}, cwd, signal, onUpdate, configDir,
    env = process.env, run = runChild, invocation = piInvocation, readOnly = false,
  } = opts;
  const mode = modeOf(params);
  if (!mode) return errorResult(`Provide exactly one of: agent + task, tasks (parallel) or chain. Agents: ${available(agents)}.`);
  if (mode === 'single' && !(params.agent && params.task)) return errorResult('Single mode needs both agent and task.');

  const items = mode === 'single' ? [{ agent: params.agent, task: params.task, cwd: params.cwd }] : mode === 'parallel' ? params.tasks : params.chain;
  if (mode === 'parallel' && items.length > config.maxParallel) {
    return errorResult(`Too many parallel tasks (${items.length}); the limit is ${config.maxParallel}. Merge related tasks or run them in batches.`, mode);
  }
  for (const it of items) {
    if (!it || typeof it.agent !== 'string' || typeof it.task !== 'string' || !it.task.trim()) return errorResult('Every item needs an agent name and a non-empty task.', mode);
    if (!agents.some((a) => a.name === it.agent)) return errorResult(`Unknown agent "${it.agent}". Agents: ${available(agents)}.`, mode);
  }

  if (readOnly) {
    for (const it of items) {
      const why = readOnlyViolation(agents.find((a) => a.name === it.agent));
      if (why) {
        return errorResult(`Refused: this session is read-only (write and edit are disabled, for example in plan mode), and agent "${it.agent}" ${why}. Only read-only agents such as scout may run now. Finish planning and get approval, then delegate.`, mode);
      }
    }
  }

  const depth = (Number(env.PI_SUBAGENT_DEPTH) || 0) + 1;
  const childEnv = { ...env, PI_SUBAGENT_DEPTH: String(depth) };
  const timeoutMs = (config.timeoutMinutes || 0) * 60000;
  // Parallel reports share roughly two single budgets, so fanning out does not multiply what the parent reads.
  const share = mode === 'parallel' ? Math.max(1500, Math.floor((2 * config.maxOutputChars) / items.length)) : config.maxOutputChars;

  const runs = [];
  const emit = () => onUpdate?.({ content: [{ type: 'text', text: 'running…' }], details: { mode, runs: runs.filter(Boolean).map((r) => ({ ...r })) } });

  const start = async (item, index, task) => {
    const agent = applyOverrides(agents.find((a) => a.name === item.agent), config);
    const built = buildChildArgs(agent, task, { dispatch, config, configDir, maxChars: share });
    const r = createRun({ agent: agent.name, source: agent.source, task, model: built.model, step: mode === 'chain' ? index + 1 : undefined });
    r.warnings = built.warnings;
    r.budget = outputBudget(agent, config, share);
    runs[index] = r;
    if (signal?.aborted) return finish(r, { exitCode: 1, aborted: true }); // cancelled before it started: do not spawn
    emit();
    const inv = invocation(built.args);
    const childCwd = item.cwd ? path.resolve(cwd, item.cwd) : cwd;
    await run(r, { command: inv.command, args: inv.args, cwd: childCwd, env: childEnv, signal, timeoutMs, onUpdate: emit });
    return r;
  };

  if (mode === 'chain') {
    let previous = '';
    for (let i = 0; i < items.length; i++) {
      const r = await start(items[i], i, chainTask(items[i].task, previous, i));
      if (isFailed(r)) break;
      previous = r.output || '(no output)';
    }
  } else {
    await mapLimit(items, mode === 'parallel' ? config.concurrency : 1, (item, i) => start(item, i, item.task));
  }

  const done = runs.filter(Boolean);
  const failed = mode === 'parallel' ? done.every(isFailed) : done.some(isFailed);
  const warnings = [...new Set(done.flatMap((r) => r.warnings))];
  let text = modelText(mode, done, { maxChars: mode === 'parallel' ? share : config.maxOutputChars });
  if (warnings.length) text += `\n\n(subagent warnings: ${warnings.join('; ')})`;
  return { content: [{ type: 'text', text }], details: { mode, runs: done }, isError: failed || undefined };
}

module.exports = { PREVIOUS, modeOf, chainTask, executeSubagent };
