import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const { isSafeCommand } = require("./bash.js");
const {
  EXIT_TOOL,
  CONTEXT_TAG,
  ENTRY_TYPE,
  CHOICES,
  planTools,
  restoredTools,
  isBlockedToolCall,
  planInstructions,
  approvalMessage,
  keepPlanningMessage,
  extractSteps,
  widgetLine,
  statusText,
  formatPlanCall,
  formatPlanHeader,
  formatPlanResult,
} = require("./plan.js");

// ctrl+shift+p style combos are not free everywhere; shift+tab is Pi's thinking-level cycle, so it is NOT used.
// ctrl+alt+p is unused by Pi's defaults and by provider-statusline (f1 only).
const SHORTCUT = "ctrl+alt+p";
const SEED_EVENT = "todo:set"; // handled by extensions/todo

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

export default function (pi: ExtensionAPI) {
  let planMode = false;
  let savedTools: string[] | undefined;
  let askGate = false; // "Approve & keep asking": confirm each mutating call until the run ends

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function renderIndicators(ctx: any) {
    if (!ctx?.hasUI || !ctx.ui) return;
    ctx.ui.setStatus("plan-mode", planMode ? statusText() : undefined);
    ctx.ui.setWidget("plan-mode", planMode ? [widgetLine(SHORTCUT)] : undefined, { placement: "aboveEditor" });
  }

  function applyTools() {
    if (planMode) {
      if (savedTools === undefined) savedTools = pi.getActiveTools();
      pi.setActiveTools(planTools(savedTools, pi.getActiveTools()));
    } else {
      pi.setActiveTools(restoredTools(savedTools, pi.getActiveTools()));
      savedTools = undefined;
    }
  }

  function persist() {
    pi.appendEntry(ENTRY_TYPE, { enabled: planMode, savedTools });
  }

  function setPlanMode(on: boolean, ctx: any) {
    if (on === planMode) return;
    planMode = on;
    askGate = false;
    applyTools();
    renderIndicators(ctx);
    persist();
  }

  function toggle(ctx: any) {
    setPlanMode(!planMode, ctx);
    ctx.ui?.notify(
      planMode
        ? "Plan mode on: read-only. The model will research and present a plan."
        : "Plan mode off: full access restored.",
      "info",
    );
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only research, then approve a plan). Args: on | off",
    handler: async (args: string, ctx: any) => {
      const a = (args || "").trim().toLowerCase();
      if (a === "on" && !planMode) return toggle(ctx);
      if (a === "off" && planMode) return toggle(ctx);
      if (a === "on" || a === "off") return ctx.ui.notify(`Plan mode already ${a}.`, "info");
      toggle(ctx);
    },
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Toggle plan mode",
    handler: async (ctx: any) => toggle(ctx),
  });

  // Registered inactive (defaultActive: false); setActiveTools() adds it only while plan mode is on.
  pi.registerTool({
    name: EXIT_TOOL,
    label: "Plan",
    description:
      "Present your finished implementation plan to the user for approval and leave plan mode. Only available in plan mode. " +
      "Pass the full plan as markdown (summary, numbered steps, risks). The user may approve it or ask you to keep planning.",
    promptSnippet: "Present the plan for approval (plan mode only)",
    parameters: Type.Object({
      plan: Type.String({ description: "The complete plan in markdown: summary, then a numbered list of steps" }),
    }),
    defaultActive: false,
    renderShell: "self",

    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const text = (t: string, details: any, isError = false) => ({
        content: [{ type: "text", text: t }],
        details: { ...details, isError },
      });
      if (!planMode) {
        return text("Not in plan mode; nothing to approve. Proceed normally.", { approved: false }, true);
      }
      if (!ctx?.hasUI) {
        return text("No interactive UI to ask for approval. Stay in plan mode and summarise the plan in your reply.", { approved: false }, true);
      }

      const choice = await ctx.ui.select("Plan ready. How do you want to proceed?", [CHOICES.auto, CHOICES.ask, CHOICES.keep]);

      if (choice === CHOICES.auto || choice === CHOICES.ask) {
        const mode = choice === CHOICES.ask ? "ask" : "auto";
        setPlanMode(false, ctx);
        askGate = mode === "ask";
        const steps = extractSteps(params.plan);
        if (steps.length) pi.events.emit(SEED_EVENT, { items: steps });
        pi.events.emit("plan-mode:approved", { mode, plan: params.plan, steps });
        return text(approvalMessage(mode), { approved: true, mode, steps });
      }

      // Keep planning (also on cancel/escape): optionally collect feedback.
      const feedback = await ctx.ui.input("What should change in the plan? (optional)", "");
      return text(keepPlanningMessage(feedback?.trim()), { approved: false, feedback: feedback?.trim() || undefined });
    },

    renderCall(args: any, _theme: any, context: any) {
      return lines((width) => {
        const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
        const pad = context.outputPad ?? 0;
        const head = formatPlanHeader(state, { width, pad });
        const plan = String(args?.plan ?? "").trim();
        if (!plan) return [head];
        try {
          // Real Markdown (headings, bold, code, lists) in the active theme, indented under the header.
          const md = new Markdown(plan, pad + 2, 0, getMarkdownTheme());
          return [head, ...md.render(width)];
        } catch {
          return formatPlanCall(plan, { state, width, pad });
        }
      });
    },

    renderResult(result: any, options: any, _theme: any, context: any) {
      const first = result.content?.find((c: any) => c.type === "text")?.text;
      return lines((width) =>
        formatPlanResult(first, {
          details: result.details,
          isError: Boolean(result.details?.isError) || context.isError,
          isPartial: options.isPartial,
          width,
          pad: context.outputPad ?? 0,
        }),
      );
    },
  });

  // Enforcement. The tool list already hides write/edit, but extension-provided tools can re-add them.
  pi.on("tool_call", async (event: any, ctx: any) => {
    const blockedTool = isBlockedToolCall(event.toolName, event.input);
    const mutating = blockedTool || ((event.toolName === "bash" || (event.toolName === "bash_bg" && event.input?.action === "start")) && !isSafeCommand(String(event.input?.command ?? "")));

    if (planMode) {
      if (blockedTool) {
        return { block: true, reason: `Plan mode is on: ${event.toolName} is disabled. Finish the plan and call ${EXIT_TOOL}.` };
      }
      if ((event.toolName === "bash" || (event.toolName === "bash_bg" && event.input?.action === "start")) && mutating) {
        return {
          block: true,
          reason: `Plan mode: command blocked (not on the read-only allowlist). Research with read-only commands, then call ${EXIT_TOOL}.\nCommand: ${event.input?.command}`,
        };
      }
      return;
    }

    if (askGate && mutating && ctx?.hasUI) {
      const what = event.toolName === "bash" || event.toolName === "bash_bg" ? String(event.input?.command ?? "") : `${event.toolName} ${event.input?.path ?? ""}`;
      const ok = await ctx.ui.confirm("Plan approved: allow this step?", what);
      if (!ok) return { block: true, reason: "The user declined this action." };
    }
  });

  // Drop stale plan context once plan mode is off.
  pi.on("context", async (event: any) => {
    if (planMode) return;
    return {
      messages: event.messages.filter((m: any) => {
        if (m.customType === "plan-mode-context") return false;
        if (m.role !== "user") return true;
        const c = m.content;
        if (typeof c === "string") return !c.includes(CONTEXT_TAG);
        if (Array.isArray(c)) return !c.some((p: any) => p.type === "text" && p.text?.includes(CONTEXT_TAG));
        return true;
      }),
    };
  });

  pi.on("before_agent_start", async (event: any) => {
    if (!planMode || event.messageType !== "user") return;
    return { message: { customType: "plan-mode-context", content: planInstructions(), display: false } };
  });

  pi.on("agent_end", async () => {
    askGate = false;
  });

  function restore(ctx: any) {
    const last = ctx.sessionManager
      .getBranch()
      .filter((e: any) => e.type === "custom" && e.customType === ENTRY_TYPE)
      .pop();
    planMode = Boolean(last?.data?.enabled);
    savedTools = last?.data?.savedTools;
    askGate = false;
    if (!planMode && pi.getFlag("plan") === true) {
      planMode = true;
    }
    if (planMode) applyTools();
    renderIndicators(ctx);
  }

  pi.on("session_start", async (_e: any, ctx: any) => restore(ctx));
  pi.on("session_tree", async (_e: any, ctx: any) => restore(ctx));
}
