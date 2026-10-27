import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const {
  SESSION_ENTRY_TYPE,
  SEED_EVENT,
  normalizeTodos,
  widgetVisible,
  restoreFromBranch,
  seedFromSteps,
  resultText,
} = require("./state.js");
const { widgetLines, formatCallLine, formatResult, plainList } = require("./render.js");

const WIDGET_KEY = "todo";

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

const TodoItem = Type.Object({
  content: Type.String({ description: "Imperative task description, e.g. 'Run the tests'" }),
  status: StringEnum(["pending", "in_progress", "completed"] as const),
  activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Running the tests'" })),
});

const TodoParams = Type.Object({
  todos: Type.Array(TodoItem, { description: "The complete, updated todo list (replaces the previous list)" }),
});

const DESCRIPTION = `Create and manage a structured task list for the current session. It tracks progress on multi-step work and shows the user what you are doing.

Send the COMPLETE list every time: each call replaces the previous list.

When to use it:
- Tasks with 3 or more distinct steps, or non-trivial work needing several operations
- The user gives several tasks, or explicitly asks for a todo list
- After receiving new instructions, capture them as todos right away
Skip it for single trivial tasks, purely conversational replies, or anything doable in under 3 steps.

Rules:
- Statuses: pending (not started), in_progress (working now), completed (finished).
- Keep EXACTLY ONE task in_progress at a time. Start it before doing the work.
- Mark a task completed IMMEDIATELY after finishing it; do not batch completions.
- Only mark completed when fully done. If blocked, errors remain, or tests fail, keep it in_progress and add a task for what is needed.
- Remove tasks that are no longer relevant. Write each task as content (imperative) and activeForm (present continuous).`;

export default function (pi: ExtensionAPI) {
  let todos: any[] = [];
  let turnActive = false;

  function refreshWidget(ctx: any) {
    if (!ctx || !ctx.hasUI || !ctx.ui) return;
    if (!widgetVisible(todos, turnActive)) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(WIDGET_KEY, () => lines((width) => widgetLines(todos, { width })), { placement: "aboveEditor" });
  }

  function restore(ctx: any) {
    todos = restoreFromBranch(ctx.sessionManager.getBranch());
    refreshWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("agent_start", async (_event, ctx) => {
    turnActive = true;
    refreshWidget(ctx);
  });
  pi.on("agent_end", async (_event, ctx) => {
    turnActive = false;
    refreshWidget(ctx);
  });

  pi.registerTool({
    name: "todo",
    label: "Update Todos",
    description: DESCRIPTION,
    promptSnippet: "Track multi-step work in a todo list (send the whole list each time)",
    promptGuidelines: [
      "Use the todo tool for tasks with 3+ steps; keep exactly one task in_progress and mark each task completed immediately when done.",
    ],
    parameters: TodoParams,
    renderShell: "self",

    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const result = normalizeTodos(params.todos);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { todos, error: result.error },
        };
      }
      todos = result.todos;
      refreshWidget(ctx);
      return {
        content: [{ type: "text", text: resultText(todos, result.warnings) }],
        details: { todos: [...todos], error: undefined },
      };
    },

    renderCall(_args: any, _theme: any, context: any) {
      return lines((width) => {
        const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
        return [formatCallLine({ state, width, pad: context.outputPad ?? 0 })];
      });
    },

    renderResult(result: any, options: any, _theme: any, context: any) {
      return lines((width) =>
        formatResult(result.details?.todos, {
          isError: Boolean(result.details?.error) || context.isError,
          errorText: result.details?.error,
          isPartial: options.isPartial,
          expanded: options.expanded,
          width,
          pad: context.outputPad ?? 0,
        }),
      );
    },
  });

  // Other extensions (plan-mode) can replace the list: pi.events.emit("todo:set", { items: [{ content, status? }] }).
  pi.events.on(SEED_EVENT, (data: any) => {
    const r = normalizeTodos(seedFromSteps(data?.items));
    if (!r.ok) return;
    todos = r.todos;
    pi.appendEntry(SESSION_ENTRY_TYPE, { todos });
    refreshWidget(lastCtx);
  });
  let lastCtx: any;
  pi.on("session_start", async (_e, ctx) => {
    lastCtx = ctx;
  });
  pi.on("agent_start", async (_e, ctx) => {
    lastCtx = ctx;
  });

  pi.registerCommand("todos", {
    description: "Show the todo list (/todos clear to empty it)",
    handler: async (args: string, ctx: any) => {
      if ((args || "").trim() === "clear") {
        todos = [];
        pi.appendEntry(SESSION_ENTRY_TYPE, { todos });
        refreshWidget(ctx);
        ctx.ui.notify("Todo list cleared.", "info");
        return;
      }
      ctx.ui.notify(todos.length ? `Todos:\n${plainList(todos)}` : "No todos.", "info");
    },
  });
}
