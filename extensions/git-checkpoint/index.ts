import { createRequire } from "node:module";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const ck = load("./git.js");
const { checkpointLabel, describePlan, statusText, skipText } = load("./format.js");

const STATUS_KEY = "git-checkpoint";

function keepCount(): number {
  const n = Number(process.env.PI_CHECKPOINT_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : ck.DEFAULT_KEEP;
}

function entryText(entry: any): string {
  const msg = entry?.type === "message" ? entry.message : undefined;
  if (!msg || msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content;
  return (msg.content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  // user-message entry id -> checkpoint taken just before that prompt ran
  const byEntry = new Map<string, any>();
  let pending: any;

  const sessionId = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();

  function setStatus(ctx: ExtensionContext, text: string | undefined) {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
  }

  // One checkpoint per user prompt (not per LLM turn): a prompt is the unit you rewind to, and
  // turn_start fires after every tool round-trip, which would create many near-identical snapshots.
  pi.on("before_agent_start", async (event, ctx) => {
    pending = undefined;
    if (event.messageType !== "user") return;
    try {
      const res = await ck.createCheckpoint(ctx.cwd, {
        session: sessionId(ctx),
        prompt: event.prompt,
        keep: keepCount(),
      });
      if (res.status === "skipped") {
        setStatus(ctx, res.reason === "not-a-repo" ? undefined : skipText(res.reason));
        return;
      }
      pending = res.checkpoint;
      setStatus(ctx, res.status === "created" ? statusText(res.checkpoint) : undefined);
    } catch {
      setStatus(ctx, undefined); // never block the prompt because of a checkpoint failure
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const message: any = event.message;
    if (message?.role !== "user" || !pending) return;
    const id = ctx.sessionManager.getLeafId();
    if (id) byEntry.set(id, pending);
    pending = undefined;
  });

  async function checkpointForEntry(ctx: ExtensionContext, entryId: string) {
    const direct = byEntry.get(entryId);
    if (direct) return direct;
    const text = ck.oneLine(entryText(ctx.sessionManager.getEntry(entryId)));
    if (!text) return undefined; // only user prompts have a "code state before this point"
    const seg = ck.safeSegment(sessionId(ctx));
    const all = await ck.listCheckpoints(ctx.cwd);
    return all.find((c: any) => c.session === seg && c.kind === "auto" && c.prompt === text);
  }

  async function offerRestore(ctx: ExtensionContext, entryId: string, what: string) {
    if (!ctx.hasUI) return; // never restore automatically in non-interactive mode
    try {
      const cp = await checkpointForEntry(ctx, entryId);
      if (!cp) return;
      const plan = await ck.planRestore(ctx.cwd, cp);
      if (plan.write.length === 0 && plan.remove.length === 0) return; // code already matches
      const choice = await ctx.ui.select(`Restore code to before this prompt? (${what})\n${describePlan(plan)}`, [
        "Yes, restore code to that point",
        "No, keep current code",
      ]);
      if (!choice?.startsWith("Yes")) return;
      const out = await ck.restoreCheckpoint(ctx.cwd, cp, { session: sessionId(ctx), keep: keepCount() });
      ctx.ui.notify(`⏺ Code restored: ${out.written.length} rewritten, ${out.removed.length} removed. Undo with /rewind.`, "info");
    } catch (err: any) {
      ctx.ui.notify(`Checkpoint restore failed: ${err?.message ?? err}`, "error");
    }
  }

  pi.on("session_before_fork", async (event, ctx) => {
    await offerRestore(ctx, event.entryId, "fork");
  });

  pi.on("session_before_tree", async (event, ctx) => {
    await offerRestore(ctx, event.preparation.targetId, "tree navigation");
  });

  pi.registerCommand("rewind", {
    description: "Restore code to an earlier checkpoint (/rewind clean removes all checkpoint refs)",
    handler: async (args: string, ctx: any) => {
      const arg = args.trim();
      try {
        const info = await ck.repoInfo(ctx.cwd);
        if (!info) return ctx.ui.notify("Not a git repository", "warning");

        if (arg === "clean") {
          const all = await ck.listCheckpoints(ctx.cwd);
          if (all.length === 0) return ctx.ui.notify("No checkpoints to clean", "info");
          const ok = await ctx.ui.confirm(
            "Delete all checkpoints?",
            `Removes ${all.length} ref(s) under ${ck.REF_ROOT}/ in this repo. Your files, branches and stash are not touched.`,
          );
          if (!ok) return;
          const n = await ck.deleteAllCheckpoints(ctx.cwd);
          return ctx.ui.notify(`Deleted ${n} checkpoint(s). Unreferenced objects are removed by 'git gc'.`, "info");
        }
        if (arg) return ctx.ui.notify("Usage: /rewind  |  /rewind clean", "warning");

        if (info.busy) return ctx.ui.notify(`Rewind unavailable: ${info.busy}`, "warning");
        const all = (await ck.listCheckpoints(ctx.cwd)).slice(0, 20);
        if (all.length === 0) return ctx.ui.notify("No checkpoints yet. One is taken before each prompt.", "info");

        const current = sessionId(ctx);
        // Checkpoints are taken before the edits they precede, so "files in snapshot" is misleading. Count what
        // restoring would actually change in the current tree instead (computed now, only for the listed rows).
        const counts = await Promise.all(
          all.map((c: any) =>
            ck.planRestore(ctx.cwd, c).then(
              (pl: any) => pl.write.length + pl.remove.length,
              () => undefined,
            ),
          ),
        );
        const labels = all.map((c: any, i: number) =>
          checkpointLabel(c, { currentSession: ck.safeSegment(current), restores: counts[i] }),
        );
        const picked = await ctx.ui.select("⏺ Rewind code to…", labels);
        if (!picked) return;
        const cp = all[labels.indexOf(picked)];

        const plan = await ck.planRestore(ctx.cwd, cp);
        if (plan.write.length === 0 && plan.remove.length === 0) {
          return ctx.ui.notify("Working tree already matches that checkpoint", "info");
        }
        const ok = await ctx.ui.confirm(`Rewind to turn ${cp.turn}?`, describePlan(plan));
        if (!ok) return;
        const out = await ck.restoreCheckpoint(ctx.cwd, cp, { session: current, keep: keepCount() });
        ctx.ui.notify(
          `⏺ Rewound to turn ${cp.turn}: ${out.written.length} rewritten, ${out.removed.length} removed. Previous state saved as turn ${out.undo?.turn ?? "?"} (undo: /rewind).`,
          "info",
        );
      } catch (err: any) {
        ctx.ui.notify(`/rewind failed: ${err?.message ?? err}`, "error");
      }
    },
  });
}
