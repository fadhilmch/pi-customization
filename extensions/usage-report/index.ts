import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const { contextMessages } = load("./messages.js");
const { buildContext, formatContext } = load("./context.js");
const { aggregate, formatCost } = load("./cost.js");

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
      ctx.ui.notify(formatContext(report), "info");
    },
  });

  pi.registerCommand("cost", {
    description: "Show session cost and tokens per model, including subagents",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify(formatCost(aggregate(ctx.sessionManager.getBranch())), "info");
    },
  });
}
