import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  parseArgs,
  todosFromBranch,
  planModeFromBranch,
  buildLiveState,
  previewStats,
} = load("./handoff.js");
const { sessionRoots, resolveSessionPath, parseSessionText, formatTranscript, DEFAULT_LIMIT, MAX_LIMIT } = load("./session.js");

// Plain JSON Schema (what TypeBox emits) so the folder needs no extra dependency.
const ReadSessionParams = {
  type: "object",
  properties: {
    path: { type: "string", description: "Session .jsonl file. Omit to read the parent session this one was handed off from." },
    query: { type: "string", description: "Only show messages containing this text (case-insensitive)." },
    limit: { type: "number", description: `Max messages to return, newest kept (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
  },
};

// /handoff <goal>: summarize the current branch into a self-contained prompt, let the user edit it,
// then start a fresh session (linked to the old one via parentSession) with that prompt as an editor draft.
// read_session lets the new session pull detail from the old transcript without dumping raw JSONL.
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_session",
    label: "Read Session",
    description:
      "Read a compact transcript of a Pi session (user and assistant text, one line per tool call, short tool results). Defaults to the parent session this one was handed off from. Use `query` to find specific messages.",
    promptSnippet: "Read a previous Pi session transcript (parent session by default)",
    parameters: ReadSessionParams as any,
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const sm = ctx.sessionManager;
      const resolved = resolveSessionPath(params?.path, {
        parentSession: sm.getHeader?.()?.parentSession,
        roots: sessionRoots({ sessionDir: sm.getSessionDir?.() }),
      });
      if (resolved.error) return { content: [{ type: "text", text: `Error: ${resolved.error}` }], details: { error: resolved.error } };
      let text: string;
      try {
        text = readFileSync(resolved.path, "utf8");
      } catch (err: any) {
        const msg = `Could not read session: ${err?.message ?? err}`;
        return { content: [{ type: "text", text: `Error: ${msg}` }], details: { error: msg } };
      }
      const out = formatTranscript(parseSessionText(text), { query: params?.query, limit: params?.limit });
      return { content: [{ type: "text", text: out }], details: { path: resolved.path } };
    },
  });

  // Read-only snapshot of branch, git status, todos and plan mode. Anything unavailable is skipped.
  async function collectLiveState(ctx: any, branch: any[]): Promise<string> {
    let branchName: string | undefined;
    let statusLines: string[] | undefined;
    try {
      const b = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.cwd, timeout: 5000 });
      if (b.code === 0) branchName = b.stdout.trim() || undefined;
      const s = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd, timeout: 5000 });
      if (s.code === 0) statusLines = s.stdout.split("\n").filter(Boolean);
    } catch {
      // not a git repo or git missing
    }
    return buildLiveState({ branchName, statusLines, todos: todosFromBranch(branch), planMode: planModeFromBranch(branch) });
  }

  pi.registerCommand("handoff", {
    description: "Transfer context to a new focused session (lossless alternative to /compact)",
    handler: async (args: string, ctx: any) => {
      // TUI and RPC have dialogs and an input box; print/json have no UI to show or hold the prompt.
      if (!ctx.hasUI && ctx.mode !== "tui") return ctx.ui.notify("/handoff requires interactive or RPC mode", "error");
      if (!ctx.model) return ctx.ui.notify("No model selected", "error");

      const parsed = parseArgs(args);
      const noReview: boolean = parsed.noReview;
      let goal = parseGoal(parsed.goal);
      if (!goal) goal = parseGoal(await ctx.ui.input("⏺ Handoff goal", "What should the new session do?"));
      if (!goal) return ctx.ui.notify("Usage: /handoff [--no-review] <goal for new thread>", "error");

      const branch = ctx.sessionManager.getBranch();
      const messages = getHandoffMessages(branch);
      if (messages.length === 0) return ctx.ui.notify("No conversation to hand off", "error");

      // Runtime values come from the Pi package; import lazily so the module stays loadable without it.
      const { BorderedLoader, convertToLlm, serializeConversation } = await import("@earendil-works/pi-coding-agent");
      const conversationText = serializeConversation(convertToLlm(messages));
      const liveState = await collectLiveState(ctx, branch);
      const parentFile: string | undefined = ctx.sessionManager.getSessionFile();
      const model = ctx.model;

      const generate = async (signal?: AbortSignal): Promise<string | null> => {
        const response = await ctx.modelRegistry.complete(
          model,
          {
            systemPrompt: SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: buildUserMessageText(conversationText, goal, liveState) }],
                timestamp: Date.now(),
              },
            ],
          },
          { signal, cacheRetention: "none", sessionId: randomUUID() },
        );
        if (response.stopReason === "aborted") return null;
        if (response.stopReason === "error") throw new Error(response.errorMessage ?? "model error");
        return extractText(response.content);
      };

      let failure: string | undefined;
      let generated: string | null;
      if (ctx.mode === "tui") {
        generated = await ctx.ui.custom<string | null>((tui: any, theme: any, _kb: any, done: (v: string | null) => void) => {
          const loader = new BorderedLoader(tui, theme, "⏺ Generating handoff prompt…");
          loader.onAbort = () => done(null);
          generate(loader.signal)
            .then(done)
            .catch((err: any) => {
              failure = err?.message ?? String(err);
              done(null);
            });
          return loader;
        });
      } else {
        // RPC: no loader component; run the call directly.
        ctx.ui.notify("⏺ Generating handoff prompt…", "info");
        try {
          generated = await generate(ctx.signal);
        } catch (err: any) {
          failure = err?.message ?? String(err);
          generated = null;
        }
      }

      if (failure) return ctx.ui.notify(`Handoff generation failed: ${failure}`, "error");
      if (generated === null) return ctx.ui.notify("Handoff cancelled", "info");
      if (!generated) return ctx.ui.notify("Model returned an empty handoff prompt", "error");

      // Preview + edit (skipped with --no-review). Closing the editor without submitting cancels the handoff (nothing has changed yet).
      const draft = withParentReference(generated, parentFile);
      const { chars, lines } = previewStats(draft);
      const edited = noReview
        ? draft
        : await ctx.ui.editor(`⏺ Handoff prompt (${lines} lines, ${chars} chars) - edit, then submit to start the new session`, draft);
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
