import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const { runAsk } = require("./ask.js");
const { createPicker } = require("./picker.js");
const { formatCallLine, formatResult } = require("./render.js");

// Minimal Component: Pi's TUI only needs render(width) and invalidate().
function lines(produce: (width: number) => string[]) {
  return { render: produce, invalidate() {} };
}

const Option = Type.Object({
  label: Type.String({ description: "Choice text, 1-5 words. Put '(Recommended)' at the end of the recommended one." }),
  description: Type.String({ description: "One short sentence on what this choice means or implies." }),
});

const Question = Type.Object({
  question: Type.String({ description: "The complete question, ending with '?'." }),
  header: Type.String({ description: "Very short tag, max 12 characters, unique per call (e.g. 'Scope')." }),
  options: Type.Array(Option, { description: "2-4 distinct choices, recommended first. Do not add 'Other'; it is added for you." }),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow several choices (default false)." })),
});

const Params = Type.Object({
  questions: Type.Array(Question, { description: "1-4 questions asked together." }),
});

const DESCRIPTION =
  "Ask the user 1-4 multiple-choice questions at once, with 2-4 options each; an 'Other' free-text choice is added automatically. " +
  "Use it only when a decision is the user's and cannot be inferred from the code or sensible defaults. " +
  "Put the recommended option first and end its label with '(Recommended)'. Returns the user's answers.";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "AskUser",
    description: DESCRIPTION,
    promptSnippet: "Ask the user structured multiple-choice questions instead of guessing",
    promptGuidelines: [
      "Use ask_user only for decisions that are the user's to make and cannot be inferred from the code; batch all questions into one call, recommended option first.",
    ],
    parameters: Params,
    renderShell: "self",

    async execute(_toolCallId: string, params: any, signal: any, _onUpdate: any, ctx: any) {
      const interactive = Boolean(ctx?.hasUI) && ctx?.mode === "tui";
      return runAsk(params, {
        interactive,
        signal,
        pick: (questions: any[]) =>
          ctx.ui.custom((tui: any, _theme: any, _kb: any, done: (r: any) => void) => {
            const picker = createPicker(questions);
            let finished = false;
            const check = () => {
              const r = picker.result();
              if (r && !finished) {
                finished = true;
                done(r);
              }
            };
            signal?.addEventListener?.("abort", () => {
              if (!finished) {
                finished = true;
                done({ cancelled: true });
              }
            });
            const handleInput = (data: string) => {
              const typing = picker.state().typing;
              const key = matchesKey(data, "escape")
                ? "escape"
                : matchesKey(data, "enter") || matchesKey(data, "return")
                  ? "enter"
                  : matchesKey(data, "backspace")
                    ? "backspace"
                    : null;
              if (key) picker.press(key);
              else if (typing) {
                const ch = decodeKittyPrintable(data) ?? (/^[^\u0000-\u001f\u007f]+$/.test(data) ? data : undefined);
                if (ch) picker.type(ch);
              } else if (matchesKey(data, "up")) picker.press("up");
              else if (matchesKey(data, "down")) picker.press("down");
              else if (matchesKey(data, "left")) picker.press("left");
              else if (matchesKey(data, "right")) picker.press("right");
              else if (matchesKey(data, "shift+tab")) picker.press("shift-tab");
              else if (matchesKey(data, "tab")) picker.press("tab");
              else if (matchesKey(data, "space")) picker.press("space");
              check();
              tui.requestRender();
            };
            return { render: (width: number) => picker.render(width), invalidate() {}, handleInput };
          }),
      });
    },

    renderCall(args: any, _theme: any, context: any) {
      return lines((width) => {
        const state = context.isError ? "error" : context.isPartial || !context.executionStarted ? "pending" : "success";
        return [formatCallLine(args, { state, width, pad: context.outputPad ?? 0 })];
      });
    },

    renderResult(result: any, options: any, _theme: any, context: any) {
      const first = result.content?.find((c: any) => c.type === "text")?.text;
      return lines((width) =>
        formatResult(result.details, {
          isError: context.isError,
          isPartial: options.isPartial,
          width,
          pad: context.outputPad ?? 0,
          fallbackText: first,
        }),
      );
    },
  });
}
