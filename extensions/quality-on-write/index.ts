import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const fs = require("node:fs");
const os = require("node:os");
const { loadConfig } = require("./config.js");
const { run, resolveToolPath, realEnv } = require("./run.js");
const { formatFile } = require("./format.js");
const { planCheck, Batch, FeedbackGuard } = require("./typecheck.js");
const { planLint } = require("./lint.js");
const { runChecks } = require("./check.js");

const WRITE_TOOLS = new Set(["write", "edit"]);

export default function (pi: ExtensionAPI) {
  const env = realEnv();
  const batch = new Batch();
  const guard = new FeedbackGuard(3);
  const readFile = (p: string) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };
  const config = (cwd: string) => loadConfig({ home: os.homedir(), cwd, readFile: fs.readFileSync });

  // A new user prompt starts a fresh feedback budget.
  pi.on("input", async () => {
    guard.reset();
  });

  // After a successful write/edit: format the file in place (awaited, so the next tool call
  // sees the final bytes), tell the model if it changed, and queue the file for typecheck and lint.
  pi.on("tool_result", async (event, ctx) => {
    if (!WRITE_TOOLS.has(event.toolName) || event.isError) return;
    const raw = (event.input as { path?: unknown }).path;
    if (typeof raw !== "string" || !raw) return;
    const cfg = config(ctx.cwd);
    const file = resolveToolPath(raw, ctx.cwd);
    if (!fs.existsSync(file)) return;

    const plan = planCheck(file, cfg, env);
    if (plan) batch.add(plan, file);
    for (const p of planLint(file, cfg, env)) batch.add(p, file);

    const result = await formatFile(file, cfg, {
      env,
      cwd: ctx.cwd,
      run: (bin: string, args: string[], opts: object) => run(bin, args, { ...opts, signal: ctx.signal }),
      readFile,
    });
    if (result.changed) {
      return { content: [...event.content, { type: "text" as const, text: result.note }] };
    }
  });

  // End of the run (after retries/compaction): typecheck and lint every touched project once, and if the
  // agent's own files have errors, inject one follow-up message and continue for one more request.
  pi.on("agent_before_settle", async (_event, ctx) => {
    const groups = batch.take();
    if (groups.length === 0) return;
    const names = [...new Set(groups.map((g: any) => g.plan.name))].join(", ");
    if (ctx.hasUI) ctx.ui.setStatus("quality-on-write", `checking (${names})...`);
    let result;
    try {
      result = await runChecks(groups, { run, signal: ctx.signal });
    } finally {
      if (ctx.hasUI) ctx.ui.setStatus("quality-on-write", undefined);
    }
    for (const w of result.warnings) if (ctx.hasUI) ctx.ui.notify(`quality-on-write: ${w}`, "warning");
    if (result.problems.length === 0) {
      guard.passed();
      if (ctx.hasUI && result.warnings.length === 0) ctx.ui.notify(`checks ok (${names})`, "info");
      return;
    }
    const count = result.problems.reduce((n: number, p: any) => n + p.errors.length, 0);
    if (!guard.allow(result.signature)) {
      if (ctx.hasUI) ctx.ui.notify(`checks: ${count} error(s) remain; not re-sending to the model`, "warning");
      return;
    }
    if (ctx.hasUI) ctx.ui.notify(`checks: ${count} error(s), sending to the model`, "warning");
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: "quality-on-write",
          content: result.problems.map((p: any) => p.message).join("\n\n"),
          display: true,
        },
      ],
      continue: true,
    };
  });
}
