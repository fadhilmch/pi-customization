import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const path = require("node:path");
const { discoverAgents, describeAgent, applyOverrides } = require("./agents.js");
const { loadConfig } = require("./config.js");
const { executeSubagent, checkCall } = require("./dispatch.js");
const { createRegistry, formatWait, FINISHED_EVENT } = require("./background.js");
const { createLiveRuns, widgetLines } = require("./widget.js");
const { callSummary, formatCallLine, formatResult } = require("./render.js");
const { agentsPanel, MAX_WIDTH: PANEL_WIDTH } = require("./panel.js");

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

const Task = Type.Object({
  agent: Type.String({ description: "Agent name" }),
  task: Type.String({ description: "Self-contained task: the agent has not seen this conversation" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this agent (default: current)" })),
  isolation: Type.Optional(Type.String({ description: '"worktree": run in a new git worktree on its own branch ("none" overrides the agent default)' })),
});

const Params = Type.Object({
  agent: Type.Optional(Type.String({ description: "Single mode: agent name" })),
  task: Type.Optional(Type.String({ description: "Single mode: self-contained task" })),
  cwd: Type.Optional(Type.String({ description: "Single mode: working directory" })),
  tasks: Type.Optional(Type.Array(Task, { description: "Parallel mode: independent tasks run at the same time" })),
  isolation: Type.Optional(Type.String({ description: 'Single mode: "worktree" runs in a new git worktree on its own branch' })),
  background: Type.Optional(Type.Boolean({ description: "Return at once with a run id; collect the report later with subagent_wait" })),
  chain: Type.Optional(Type.Array(Task, { description: "Chain mode: steps run in order; {previous} is replaced by the previous step's report" })),
});

function description(agents: any[]) {
  const list = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  return `Delegate work to a subagent: a separate pi process with a fresh context, its own model and tool set. Only its final report comes back to you.

Delegate when a task needs a lot of reading but only a short answer (searching a codebase, tracing callers, reading docs, triaging long logs, reviewing a diff), or for independent pieces of work that can run in parallel. Do not delegate small lookups you can do in one or two tool calls, or work that depends on this conversation: the subagent starts with nothing but the task text, so write a self-contained task (goal, relevant paths, constraints, what to report).

Set isolation: "worktree" for workers that edit files, so each gets its own checkout and branch (kept when it changed something, removed when not). Set background: true to continue while it runs and collect the report with subagent_wait.

Modes (use exactly one): { agent, task } | { tasks: [{agent, task}, ...] } parallel | { chain: [{agent, task}, ...] } sequential, where {previous} in a step's task is replaced by the prior step's report.

Agents:
${list}
Project agents from .pi/agents load in trusted projects; /agents lists everything.`;
}

const WIDGET_KEY = "subagent";

export default function (pi: ExtensionAPI) {
  // Children start with -ne, so this normally never loads in one; the depth check covers configs that add it back.
  const { config: startConfig } = loadConfig();
  if ((Number(process.env.PI_SUBAGENT_DEPTH) || 0) >= startConfig.maxDepth) return;

  // Children started this session (all calls, background included); reset on session_start.
  const spawns = { count: 0, max: startConfig.maxSpawns };

  // Live widget: running children of foreground calls (keyed by tool call id) and background runs (keyed by run id).
  let uiCtx: any;
  const refreshWidget = () => {
    if (!uiCtx?.hasUI) return;
    try {
      if (!live.running().length) uiCtx.ui.setWidget(WIDGET_KEY, undefined);
      else uiCtx.ui.setWidget(WIDGET_KEY, () => lines((width) => widgetLines(live.running(), { width })), { placement: "belowEditor" });
    } catch {
      // the UI context can be stale after a reload or session switch
    }
  };
  const live = createLiveRuns(refreshWidget);
  const registry = createRegistry({
    emit: (name: string, data: unknown) => pi.events?.emit(name, data),
    onChange: (e: any) => (e.status === "running" ? live.set(e.id, e.runs) : live.delete(e.id)),
  });

  const discover = (ctx: any) => discoverAgents({ cwd: ctx?.cwd, trusted: Boolean(ctx?.isProjectTrusted?.()) });

  // Background children die with the session (quit, reload, /new, /resume, /fork).
  pi.on("session_shutdown", async () => {
    registry.killAll();
    live.clear();
    try {
      uiCtx?.ui?.setWidget(WIDGET_KEY, undefined);
    } catch {
      // already gone
    }
    uiCtx = undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    spawns.count = 0;
    uiCtx = ctx;
    if (!ctx.hasUI) return;
    const { warning } = loadConfig();
    const { errors } = discover(ctx);
    for (const w of [warning, ...errors].filter(Boolean)) ctx.ui.notify(`subagent: ${w}`, "warning");
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: description(discoverAgents({}).agents),
    promptSnippet: "Delegate read-heavy or parallel work to a subagent with a fresh context; only its short report returns",
    promptGuidelines: [
      "Use subagent for research that would pull many files or long output into this conversation; do quick lookups and the main implementation yourself.",
      "Give subagents self-contained tasks: they have not seen this conversation. Run parallel workers only on separate files.",
    ],
    parameters: Params,
    renderShell: "self",
    exposure: "model-only",

    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      const { config, file } = loadConfig();
      const { agents } = discover(ctx);
      // No write/edit among the parent's active tools (plan mode, --tools read, ...) means a read-only session:
      // a child with write, edit or bash would be a way around it.
      const active: string[] = typeof pi.getActiveTools === "function" ? pi.getActiveTools() : [];
      const readOnly = active.length > 0 && !active.includes("write") && !active.includes("edit");
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      spawns.max = config.maxSpawns;
      uiCtx = ctx;
      const opts = {
        agents,
        config,
        configDir: path.dirname(file),
        dispatch: { model, thinking: ctx.thinkingLevel },
        readOnly,
        cwd: ctx.cwd,
        spawns,
      };

      if (params.background) {
        const { background: _bg, ...call } = params;
        const bad = checkCall(call, opts).error; // refuse bad calls now, not when someone waits
        if (bad) return bad;
        const label = callSummary(call).slice(0, 80);
        // Not tied to this tool call's signal: the run outlives the turn. subagent_wait cancels, session_shutdown kills.
        const entry = registry.start({ label, task: ({ signal: s, onUpdate: u }: any) => executeSubagent(call, { ...opts, signal: s, onUpdate: u }) });
        const text = `Running in the background as ${entry.id} (${label}). Carry on with other work and call subagent_wait with ids ["${entry.id}"] when you need the report. It is stopped if this session ends.`;
        return { content: [{ type: "text", text }], details: { mode: "background", id: entry.id, runs: [] } };
      }

      live.set(toolCallId, []);
      try {
        return await executeSubagent(params, {
          ...opts,
          signal,
          onUpdate: (u: any) => {
            live.set(toolCallId, u?.details?.runs);
            onUpdate?.(u);
          },
        });
      } finally {
        live.delete(toolCallId);
      }
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

  pi.registerTool({
    name: "subagent_wait",
    label: "Subagent wait",
    description: `Check on or collect background subagent runs started with subagent { background: true }. Waits until the runs finish or timeoutSeconds passes (default 120; 0 returns the status at once), then returns finished reports and the state of those still running. Omit ids to cover every run not yet collected. cancel: true stops them. Finishing a background run also emits "${FINISHED_EVENT}" on pi.events.`,
    promptSnippet: "Collect or check background subagent runs by id",
    parameters: Type.Object({
      ids: Type.Optional(Type.Array(Type.String(), { description: 'Run ids such as "bg-1" (default: all uncollected runs)' })),
      timeoutSeconds: Type.Optional(Type.Number({ description: "How long to wait for them to finish (default 120, 0 = do not wait)" })),
      cancel: Type.Optional(Type.Boolean({ description: "Stop the selected runs instead of waiting for them" })),
    }),
    exposure: "model-only",

    async execute(_toolCallId: string, params: any, signal: any) {
      const { config } = loadConfig();
      const { entries, unknown } = registry.select(params.ids);
      if (params.cancel) {
        registry.cancel(entries);
        await registry.wait(entries, 5000, signal); // children get SIGTERM, then SIGKILL after 3s
      } else {
        const seconds = Number.isFinite(Number(params.timeoutSeconds)) ? Math.min(3600, Math.max(0, Number(params.timeoutSeconds))) : 120;
        await registry.wait(entries, seconds * 1000, signal);
      }
      return { content: [{ type: "text", text: formatWait(entries, unknown, { maxChars: config.maxOutputChars }) }], details: { mode: "wait", runs: [] } };
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
