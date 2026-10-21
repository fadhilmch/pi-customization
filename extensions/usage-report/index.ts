import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const { contextMessages } = load("./messages.js");
const { buildContext, formatContext } = load("./context.js");
const { aggregate, formatCost } = load("./cost.js");
const { contextPanel, costPanel, MAX_WIDTH } = load("./panel.js");

// Interactive: a framed overlay (esc/enter/q closes). Elsewhere (print, rpc): the plain text report.
// Neither path adds anything to the conversation, so the commands cost no tokens.
async function show(ctx: any, panel: (width: number) => string[], text: () => string) {
  if (ctx.mode !== "tui") return ctx.ui.notify(text(), "info");
  // Runtime import from Pi; keeps this module loadable without it.
  const { matchesKey } = await import("@earendil-works/pi-tui");
  await ctx.ui.custom<void>(
    (_tui: any, _theme: any, _kb: any, done: (v: void) => void) => ({
      render: panel,
      invalidate() {},
      handleInput(data: string) {
        if (data === "q" || matchesKey(data, "escape") || matchesKey(data, "return")) done();
      },
    }),
    {
      overlay: true,
      overlayOptions: () => ({ width: Math.max(24, Math.min(MAX_WIDTH, (process.stdout.columns || 80) - 4)), maxHeight: "90%" }),
    },
  );
}

// /context: where the context window goes. /cost: what the session (and its subagents) has spent.
export default function (pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show what is using the context window (estimates) to find token waste",
    handler: async (_args: string, ctx: any) => {
      const branch = ctx.sessionManager.getBranch();
      const opts = typeof ctx.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : {};
      const active = new Set(pi.getActiveTools());
      const tools = pi.getAllTools().filter((t: any) => active.has(t.name));
      const report = buildContext({
        systemPrompt: ctx.getSystemPrompt(),
        contextFiles: opts.contextFiles,
        skills: opts.skills,
        tools,
        messages: contextMessages(branch),
        usage: ctx.getContextUsage(),
      });
      await show(ctx, (w) => contextPanel(report, w), () => formatContext(report));
    },
  });

  pi.registerCommand("cost", {
    description: "Show session cost and tokens per model, including subagents",
    handler: async (_args: string, ctx: any) => {
      const agg = aggregate(ctx.sessionManager.getBranch());
      await show(ctx, (w) => costPanel(agg, w), () => formatCost(agg));
    },
  });
}
