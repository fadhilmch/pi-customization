import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const path = require("node:path");
const { discoverAgents, describeAgent, applyOverrides } = require("./agents.js");
const { loadConfig } = require("./config.js");
const { executeSubagent } = require("./dispatch.js");
const { formatCallLine, formatResult } = require("./render.js");
const { agentsPanel, MAX_WIDTH: PANEL_WIDTH } = require("./panel.js");

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

const Task = Type.Object({
  agent: Type.String({ description: "Agent" }),
  task: Type.String({ description: "Self-contained task" }),
  cwd: Type.Optional(Type.String({ description: "Working directory" })),
});

const Params = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent" })),
  task: Type.Optional(Type.String({ description: "Task" })),
  cwd: Type.Optional(Type.String({ description: "Working directory" })),
  tasks: Type.Optional(Type.Array(Task, { description: "Parallel tasks" })),
  chain: Type.Optional(Type.Array(Task, { description: "Ordered steps; {previous} inserts the last report" })),
});

function description(_agents: any[]) {
  return "Delegate read-heavy research to a fresh-context pi process; return only a capped report. Use {agent,task}, {tasks:[...]} for parallel work, or {chain:[...]}. Keep tasks self-contained. /agents lists scout, worker, and reviewer.";
}

export default function (pi: ExtensionAPI) {
  // Children start with -ne, so this normally never loads in one; the depth check covers configs that add it back.
  const { config: startConfig } = loadConfig();
  let deferredNotified = false;
  if ((Number(process.env.PI_SUBAGENT_DEPTH) || 0) >= startConfig.maxDepth) return;

  const discover = (ctx: any) => discoverAgents({ cwd: ctx?.cwd, trusted: Boolean(ctx?.isProjectTrusted?.()) });

  pi.on("session_start", async (_event, ctx) => {
    if (startConfig.exposure === "deferred") {
      const active: string[] = pi.getActiveTools();
      const registered = pi.getAllTools?.().some((tool: any) => tool.name === "tool_search");
      const fallback = registered ? "tool_search" : "subagent";
      if (!active.includes(fallback)) pi.setActiveTools([...active, fallback]);
      if (!deferredNotified && ctx?.hasUI) ctx.ui.notify(registered ? "subagent is deferred; tool_search was activated so it can still be discovered." : "tool_search is unavailable; subagent was activated directly.", "info");
      deferredNotified = true;
    }
    if (!ctx?.hasUI) return;
    const { warning } = loadConfig();
    const { errors } = discover(ctx);
    for (const w of [warning, ...errors].filter(Boolean)) ctx.ui.notify(`subagent: ${w}`, "warning");
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: description(discoverAgents({}).agents),
    promptSnippet: "Delegate read-heavy work or parallel tasks to a fresh-context subagent",
    promptGuidelines: [
      "Use self-contained tasks; keep parallel tasks independent. A read-only session blocks agents that can write.",
    ],
    parameters: Params,
    renderShell: "self",
    exposure: startConfig.exposure,

    async execute(_toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      const { config, file } = loadConfig();
      const { agents } = discover(ctx);
      // No write/edit among the parent's active tools (plan mode, --tools read, ...) means a read-only session:
      // a child with write, edit or bash would be a way around it.
      const active: string[] = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : [];
      const readOnly = active.length > 0 && !active.includes("write") && !active.includes("edit");
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      return executeSubagent(params, {
        agents,
        config,
        configDir: path.dirname(file),
        dispatch: { model, thinking: ctx.thinkingLevel },
        readOnly,
        cwd: ctx.cwd,
        signal,
        onUpdate,
      });
    },

    renderCall(args: any, _theme: any, context: any) {
      return lines((width) => {
        const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
        return [formatCallLine(args, { state, width, pad: context.outputPad ?? 0 })];
      });
    },

    renderResult(result: any, options: any, _theme: any, context: any) {
      return lines((width) =>
        formatResult(result.details, {
          expanded: options.expanded,
          width,
          pad: context.outputPad ?? 0,
          isError: context.isError,
          fallbackText: result.content?.[0]?.text,
        }),
      );
    },
  });

  pi.registerCommand("agents", {
    description: "List subagents (bundled, ~/.pi/agent/agents, trusted .pi/agents)",
    handler: async (_args: string, ctx: any) => {
      const { config, file } = loadConfig();
      const found = discover(ctx);
      const agents = found.agents.map((a: any) => applyOverrides(a, config)); // show the model that will actually run
      if (ctx.mode !== "tui") {
        const rows = agents.map(describeAgent);
        if (found.projectSkipped) rows.push(`(project agents in ${found.projectDir} not loaded: project is not trusted)`);
        for (const e of found.errors) rows.push(`! ${e}`);
        return ctx.ui.notify(rows.length ? `Subagents:\n${rows.join("\n")}` : "No subagents found.", "info");
      }
      const data = { ...found, agents, configFile: file, userDir: path.join(path.dirname(file), "agents") };
      // Runtime import from Pi; keeps this module loadable without it.
      const { matchesKey } = await import("@earendil-works/pi-tui");
      await ctx.ui.custom<void>(
        (_tui: any, _theme: any, _kb: any, done: (v: void) => void) => ({
          render: (width: number) => agentsPanel(data, width),
          invalidate() {},
          handleInput(input: string) {
            if (input === "q" || matchesKey(input, "escape") || matchesKey(input, "return")) done();
          },
        }),
        {
          overlay: true,
          overlayOptions: () => ({ width: Math.max(24, Math.min(PANEL_WIDTH, (process.stdout.columns || 80) - 4)), maxHeight: "90%" }),
        },
      );
    },
  });
}
