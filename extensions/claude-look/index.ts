import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { workingIndicator, pickVerb } = require("./spinner.js");
const { transformMarkdown } = require("./markdown.js");
const { renderHeader } = require("./header.js");
const { isHandled, formatCallLine, formatResult } = require("./tools.js");

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingIndicator(workingIndicator());
    ctx.ui.setWorkingMessage(pickVerb());
    ctx.ui.setHiddenThinkingLabel("✻ Thinking…");
    ctx.ui.setHeader(() =>
      lines((width) => renderHeader(width, { cwd: ctx.cwd, home: process.env.HOME ?? "" })),
    );
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWorkingMessage(pickVerb());
  });

  pi.registerMarkdownTransformer((markdown, context) => transformMarkdown(markdown, context));

  pi.registerToolRenderer((toolName, next) => {
    if (!isHandled(toolName)) return next();
    return {
      renderShell: "self",
      renderCall(args: any, _theme: any, context: any) {
        return lines((width) => {
          const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
          return [formatCallLine(toolName, args, { state, cwd: context.cwd, width, pad: context.outputPad ?? 0 })];
        });
      },
      renderResult(result: any, options: any, _theme: any, context: any) {
        return lines((width) =>
          formatResult(toolName, result, {
            expanded: options.expanded,
            isPartial: options.isPartial,
            isError: context.isError,
            width,
            pad: context.outputPad ?? 0,
          }),
        );
      },
    };
  });
}
