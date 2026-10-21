import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { Type } = require("typebox");
const { createJobs } = require("./jobs.js");
const { loadConfig } = require("./config.js");
const { capOutput } = require("./output.js");
const { jobsPanel } = require("./panel.js");

const Start = Type.Object({
  action: Type.Literal("start"), command: Type.String({ description: "Shell command to run" }),
  cwd: Type.Optional(Type.String({ description: "Working directory" })),
  name: Type.Optional(Type.String({ description: "Short job name" })),
  waitFor: Type.Optional(Type.String({ description: "Regex indicating readiness" })),
  waitSeconds: Type.Optional(Type.Number({ minimum: 0.01, maximum: 120, description: "Readiness wait, at most 120 seconds" })),
});
const Output = Type.Object({ action: Type.Literal("output"), id: Type.String(), filter: Type.Optional(Type.String({ description: "Regex to keep matching lines" })) });
const Stop = Type.Object({ action: Type.Literal("stop"), id: Type.String() });
const List = Type.Object({ action: Type.Literal("list") });
const Params = Type.Union([Start, Output, Stop, List]);

function lines(produce: (width: number) => string[]) { return { render: produce, invalidate() {} }; }

export default function (pi: ExtensionAPI) {
  const jobs = createJobs({ maxJobs: loadConfig({ cwd: process.cwd() }).maxJobs });
  let lastState = "";
  let latestCtx: any;
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let deferredNotified = false;

  async function status(ctx: any) {
    if (ctx?.hasUI) latestCtx = ctx;
    const live = (await jobs.list()).filter((job: any) => job.state === "running").length;
    const value = live ? `${live} job${live === 1 ? "" : "s"} running` : undefined;
    const key = value || "";
    if (ctx?.hasUI && key !== lastState) ctx.ui.setStatus("bg-shell", value);
    lastState = key;
  }

  async function showJobs(ctx: any) {
    const all = await jobs.list();
    if (ctx.mode !== "tui") return ctx.ui.notify(jobsPanel(all, 120).join("\n"), "info");
    const { matchesKey } = await import("@earendil-works/pi-tui");
    await ctx.ui.custom<void>((_tui: any, _theme: any, _kb: any, done: (value: void) => void) => ({
      render: (width: number) => jobsPanel(all, width), invalidate() {},
      handleInput(data: string) { if (data === "q" || matchesKey(data, "escape") || matchesKey(data, "return")) done(); },
    }), { overlay: true, overlayOptions: () => ({ width: Math.max(24, Math.min(100, (process.stdout.columns || 80) - 4)), maxHeight: "90%" }) });
  }

  pi.registerTool({
    name: "bash_bg", label: "BashBg",
    description: "Run long-lived shell commands in the background, then read new output, stop jobs, or list status. Results are capped and point to the full log when needed.",
    promptSnippet: "Run long-lived shell commands in the background and read incremental output",
    promptGuidelines: ["Use start with waitFor to launch a server and confirm readiness; use output to read new logs and stop when done."],
    parameters: Params,
    annotations: { readOnlyHint: false, openWorldHint: true },
    renderShell: "self",
    exposure: loadConfig({ cwd: process.cwd() }).exposure,

    async execute(_id: string, params: any, signal: any, _onUpdate: any, ctx: any) {
      const cfg = loadConfig({ cwd: ctx?.cwd });
      try {
        let text: string;
        let details: any = {};
        if (params.action === "start") {
          const job = await jobs.start({ ...params, signal });
          if (job.text !== undefined) {
            text = `Started ${job.id} · ${job.state}${job.waitTimedOut ? " · waitFor timed out; job remains running" : ""}${job.waitAborted ? " · wait aborted; job remains running" : ""}\n${job.text}`;
            if (job.waitTruncated) text += `\nStart output shortened; full log: ${job.logPath}`;
            details = { id: job.id, name: job.name, state: job.state, runtimeMs: job.runtimeMs, pid: job.pid, logPath: job.logPath };
          } else {
            text = `Started ${job.id} · ${job.name} · pid ${job.pid}`;
            details = { id: job.id, name: job.name, state: job.state, runtimeMs: job.runtimeMs, pid: job.pid, logPath: job.logPath };
          }
        } else if (params.action === "output") {
          const job = await jobs.output(params.id, params.filter);
          text = `${job.id} · ${job.state}${job.text ? `\n${job.text}` : "\nNo new output."}`;
          details = { id: job.id, name: job.name, state: job.state, runtimeMs: job.runtimeMs, logPath: job.logPath };
        } else if (params.action === "stop") {
          const job = await jobs.stop(params.id);
          text = `Stopped ${job.id} · ${job.state}`;
          details = { id: job.id, name: job.name, state: job.state, runtimeMs: job.runtimeMs };
        } else {
          const all = await jobs.list();
          text = all.length ? all.map((j: any) => `${j.id} · ${j.state} · ${Math.floor(j.runtimeMs / 1000)}s · ${j.name} · ${j.command}`).join("\n") : "No background jobs.";
          details = { jobs: all.map((j: any) => ({ id: j.id, name: j.name, state: j.state, runtimeMs: j.runtimeMs })) };
        }
        const cap = await capOutput(text, { maxChars: cfg.maxChars, logPath: details.logPath });
        text = cap.text;
        if (cap.truncated) details = { ...details, truncated: true, logPath: cap.logPath };
        await status(ctx);
        return { content: [{ type: "text", text }], details };
      } catch (error: any) {
        const cap = await capOutput(`bash_bg failed: ${String(error?.message || error)}`, { maxChars: cfg.maxChars });
        return { content: [{ type: "text", text: cap.text }], details: { error: cap.text }, isError: true };
      }
    },

    renderCall(args: any) {
      const arg = args?.action === "start" ? String(args.command || "").replace(/\s+/g, " ").slice(0, 70) : String(args?.id || "");
      return lines((width) => [`⏺ BashBg(${args?.action || "?"}${arg ? ` ${arg}` : ""})`.slice(0, width)]);
    },
    renderResult(result: any) {
      const state = result.details?.state || (result.details?.jobs ? `${result.details.jobs.length} jobs` : "done");
      const count = result.details?.text?.length;
      return lines((width) => [`  ⎿ ${state}${count ? ` · ${count} chars` : ""}`.slice(0, width)]);
    },
  });

  pi.registerCommand("jobs", { description: "Show background shell jobs", handler: async (_args: string, ctx: any) => showJobs(ctx) });
  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    const notices = jobs.takeExitedNotices();
    await status(ctx);
    return notices.length ? { message: { customType: "bg-shell-exit", content: notices.join("\n"), display: false } } : undefined;
  });
  pi.on("session_start", async (_event: any, ctx: any) => {
    const cfg = loadConfig({ cwd: ctx?.cwd });
    if (cfg.exposure === "deferred") {
      const active = pi.getActiveTools();
      const registered = pi.getAllTools?.().some((tool: any) => tool.name === "tool_search");
      const fallback = registered ? "tool_search" : "bash_bg";
      if (!active.includes(fallback)) pi.setActiveTools([...active, fallback]);
      if (!deferredNotified && ctx?.hasUI) ctx.ui.notify(registered ? "bash_bg is deferred; tool_search was activated so it can still be discovered." : "tool_search is unavailable; bash_bg was activated directly.", "info");
      deferredNotified = true;
    }
    await status(ctx);
    statusTimer = setInterval(() => { if (latestCtx) void status(latestCtx); }, 1000);
    statusTimer.unref();
  });
  pi.on("session_shutdown", async () => { if (statusTimer) clearInterval(statusTimer); await jobs.cleanup(); if (latestCtx?.hasUI) latestCtx.ui.setStatus("bg-shell", undefined); });
}
