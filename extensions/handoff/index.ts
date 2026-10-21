import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const {
  SYSTEM_PROMPT,
  getHandoffMessages,
  buildUserMessageText,
  extractText,
  withParentReference,
  parseGoal,
  previewStats,
} = load("./handoff.js");

// /handoff <goal>: summarize the current branch into a self-contained prompt, let the user edit it,
// then start a fresh session (linked to the old one via parentSession) with that prompt as an editor draft.
export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Transfer context to a new focused session (lossless alternative to /compact)",
    handler: async (args: string, ctx: any) => {
      if (ctx.mode !== "tui") return ctx.ui.notify("/handoff requires interactive mode", "error");
      if (!ctx.model) return ctx.ui.notify("No model selected", "error");

      let goal = parseGoal(args);
      if (!goal) goal = parseGoal(await ctx.ui.input("⏺ Handoff goal", "What should the new session do?"));
      if (!goal) return ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");

      const messages = getHandoffMessages(ctx.sessionManager.getBranch());
      if (messages.length === 0) return ctx.ui.notify("No conversation to hand off", "error");

      // Runtime values come from the Pi package; import lazily so the module stays loadable without it.
      const { BorderedLoader, convertToLlm, serializeConversation } = await import("@earendil-works/pi-coding-agent");
      const conversationText = serializeConversation(convertToLlm(messages));
      const parentFile: string | undefined = ctx.sessionManager.getSessionFile();
      const model = ctx.model;

      let failure: string | undefined;
      const generated = await ctx.ui.custom<string | null>((tui: any, theme: any, _kb: any, done: (v: string | null) => void) => {
        const loader = new BorderedLoader(tui, theme, "⏺ Generating handoff prompt…");
        loader.onAbort = () => done(null);

        const generate = async (): Promise<string | null> => {
          const response = await ctx.modelRegistry.complete(
            model,
            {
              systemPrompt: SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: buildUserMessageText(conversationText, goal) }],
                  timestamp: Date.now(),
                },
              ],
            },
            { signal: loader.signal, cacheRetention: "none", sessionId: randomUUID() },
          );
          if (response.stopReason === "aborted") return null;
          if (response.stopReason === "error") throw new Error(response.errorMessage ?? "model error");
          return extractText(response.content);
        };

        generate()
          .then(done)
          .catch((err: any) => {
            failure = err?.message ?? String(err);
            done(null);
          });
        return loader;
      });

      if (failure) return ctx.ui.notify(`Handoff generation failed: ${failure}`, "error");
      if (generated === null) return ctx.ui.notify("Handoff cancelled", "info");
      if (!generated) return ctx.ui.notify("Model returned an empty handoff prompt", "error");

      // Preview + edit. Closing the editor without submitting cancels the handoff (nothing has changed yet).
      const draft = withParentReference(generated, parentFile);
      const { chars, lines } = previewStats(draft);
      const edited = await ctx.ui.editor(`⏺ Handoff prompt (${lines} lines, ${chars} chars) - edit, then submit to start the new session`, draft);
      if (edited === undefined || !edited.trim()) return ctx.ui.notify("Handoff cancelled - current session unchanged", "info");

      // The original ctx is stale after a successful switch; do post-switch UI through replacementCtx.
      const result = await ctx.newSession({
        parentSession: parentFile,
        withSession: async (next: any) => {
          next.ui.setEditorText(edited);
          next.ui.notify("⏺ Handoff ready. Review and press Enter to send.", "info");
        },
      });
      if (result.cancelled) ctx.ui.notify("New session cancelled - current session unchanged", "info");
    },
  });
}
