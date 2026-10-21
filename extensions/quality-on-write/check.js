"use strict";
// Run pending typecheck groups and turn results into feedback.
const { parseOutput, selectErrors, buildFeedback, signatureOf } = require("./typecheck.js");

const TYPECHECK_TIMEOUT_MS = 60000;

/**
 * groups: [{ plan, files }] from Batch.take().
 * deps: { run }.
 * Returns { problems: [{ name, cwd, errors, others, message }], warnings: [string] }.
 */
async function runChecks(groups, deps) {
  const problems = [];
  const warnings = [];
  for (const { plan, files } of groups) {
    const args = plan.appendFiles ? [...plan.args, ...files] : plan.args;
    const res = await deps.run(plan.bin, args, { cwd: plan.cwd, timeoutMs: TYPECHECK_TIMEOUT_MS, signal: deps.signal });
    if (res.ok) continue;
    if (res.timedOut) {
      warnings.push(`${plan.name} timed out after ${TYPECHECK_TIMEOUT_MS / 1000}s`);
      continue;
    }
    if (res.missing) continue;
    const all = parseOutput(plan.name, res.stdout + "\n" + res.stderr, plan.cwd);
    if (all.length === 0) {
      warnings.push(`${plan.name} failed (exit ${res.code}) with unparseable output`);
      continue;
    }
    const { mine, others } = selectErrors(all, files);
    if (mine.length === 0) continue;
    problems.push({ name: plan.name, cwd: plan.cwd, errors: mine, others, message: buildFeedback({ name: plan.name, cwd: plan.cwd, errors: mine, others }) });
  }
  return { problems, warnings, signature: signatureOf(problems.flatMap((p) => p.errors)) };
}

module.exports = { runChecks, TYPECHECK_TIMEOUT_MS };
