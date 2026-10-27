import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { transformMarkdown } = require("./markdown.js");
const { createLook, lines } = require("./mode.js");
const { paletteFromTheme } = require("./palette.js");
const { MODES, isMode, loadMode, saveMode } = require("./config.js");
const { isHandled, formatCallLine, formatResult } = require("./tools.js");

export default function (pi: ExtensionAPI) {
  const look = createLook({ initial: loadMode() });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) look.apply(ctx.ui, ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (ctx.hasUI) look.runStart(ctx.ui);
  });
  pi.on("turn_start", async (_event, ctx) => {
    if (ctx.hasUI) look.turnStart(ctx.ui);
  });
  pi.on("message_update", async (event: any) => look.messageUpdate(event.message));
  pi.on("message_end", async (event: any) => look.messageEnd(event.message));
  pi.on("agent_end", async () => look.runEnd());

  pi.registerCommand("claude-look", {
    description: "Claude look: on, compact (1-line tool output, no welcome box) or off. Saved in ~/.pi/agent/claude-look.json",
    getArgumentCompletions: (prefix: string) =>
      MODES.filter((m: string) => m.startsWith(prefix)).map((m: string) => ({ value: m, label: m })),
    handler: async (args: string, ctx: any) => {
      const mode = args.trim();
      if (!mode) return ctx.ui.notify(`claude-look: ${look.mode()} (on | compact | off)`, "info");
      if (!isMode(mode)) return ctx.ui.notify(`claude-look: unknown mode "${mode}". Use on, compact or off.`, "warning");
      look.setMode(mode, ctx.ui, ctx);
      try {
        saveMode(mode);
      } catch (e: any) {
        return ctx.ui.notify(`claude-look: ${mode} (could not save: ${e?.message ?? e})`, "warning");
      }
      ctx.ui.notify(`claude-look: ${mode}. Tool calls already on screen keep their old look.`, "info");
    },
  });

  pi.registerMarkdownTransformer((markdown, context) => (look.mode() === "off" ? markdown : transformMarkdown(markdown, context)));

  pi.registerToolRenderer((toolName, next) => {
    if (!isHandled(toolName) || look.mode() === "off") return next();
    return {
      renderShell: "self",
      renderCall(args: any, theme: any, context: any) {
        return lines((width) => {
          const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
          return [formatCallLine(toolName, args, { state, cwd: context.cwd, width, pad: context.outputPad ?? 0, palette: paletteFromTheme(theme) })];
        });
      },
      renderResult(result: any, options: any, theme: any, context: any) {
        return lines((width) =>
          formatResult(toolName, result, {
            expanded: options.expanded,
            isPartial: options.isPartial,
            isError: context.isError,
            width,
            pad: context.outputPad ?? 0,
            compact: look.mode() === "compact",
            palette: paletteFromTheme(theme),
          }),
        );
      },
    };
  });
}
