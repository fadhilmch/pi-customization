import { createRequire } from "node:module";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const ck = load("./git.js");
const { checkpointLabel, describePlan, statusText, skipText, splitArgs, diffReport } = load("./format.js");

const STATUS_KEY = "git-checkpoint";
const USAGE = "Usage: /rewind  |  /rewind diff <n>  |  /rewind <n> <path>...  |  /rewind clean";
const LIST_MAX = 20;

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
  let navigating = false; // set while /rewind itself navigates the tree, so the tree hook does not prompt a second time

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
    if (navigating) return;
    await offerRestore(ctx, event.preparation.targetId, "tree navigation");
  });

  // Session entry of the user prompt a checkpoint was taken before (current session only), for conversation rewind.
  function entryForCheckpoint(ctx: any, cp: any): string | undefined {
    if (cp.kind !== "auto" || cp.session !== ck.safeSegment(sessionId(ctx))) return undefined;
    for (const [id, c] of byEntry) if (c.sha === cp.sha) return id;
    for (const e of ctx.sessionManager.getBranch?.() ?? []) {
      if (ck.oneLine(entryText(e)) === cp.prompt && cp.prompt) return e.id;
    }
    return undefined;
  }

  function show(ctx: any, text: string) {
    if (ctx.hasUI) ctx.ui.notify(text, "info");
    else process.stdout.write(text + "\n"); // print mode: no UI to notify
  }

  async function runRewind(ctx: any, arg: string) {
    const info = await ck.repoInfo(ctx.cwd);
    if (!info) return ctx.ui.notify("Not a git repository", "warning");
    const words: string[] = splitArgs(arg);

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

    const all = (await ck.listCheckpoints(ctx.cwd)).slice(0, LIST_MAX);
    const current = sessionId(ctx);
    const pick = (word: string) => {
      const n = Number(word);
      return /^\d+$/.test(word) && n >= 1 ? all[n - 1] : undefined;
    };

    // /rewind diff <n>
    if (words[0] === "diff") {
      if (words.length !== 2) return ctx.ui.notify(USAGE, "warning");
      const cp = pick(words[1]);
      if (!cp) return ctx.ui.notify(`No checkpoint ${words[1]} (the list shows 1-${all.length})`, "warning");
      const d = await ck.diffText(ctx.cwd, cp.tree, await ck.currentTree(ctx.cwd));
      return show(ctx, diffReport(cp, d));
    }

    let cp: any;
    let paths: string[] | undefined;
    if (words.length > 0) {
      // /rewind <n> <path>...
      cp = pick(words[0]);
      if (!cp || words.length < 2) return ctx.ui.notify(cp ? USAGE : `${USAGE}\nNo checkpoint ${words[0]}.`, "warning");
      try {
        paths = ck.resolveRepoPaths(ctx.cwd, info.root, words.slice(1));
      } catch (err: any) {
        return ctx.ui.notify(err.message, "warning");
      }
      if (info.busy) return ctx.ui.notify(`Rewind unavailable: ${info.busy}`, "warning");
    } else {
      if (info.busy) return ctx.ui.notify(`Rewind unavailable: ${info.busy}`, "warning");
      if (all.length === 0) return ctx.ui.notify("No checkpoints yet. One is taken before each prompt.", "info");
      // Line stats = what changed after each checkpoint (checkpoint -> current tree), the same direction as
      // /rewind diff. One current-tree snapshot, then one cheap tree-to-tree numstat per listed row.
      const now = await ck.currentTree(ctx.cwd);
      const stats = await Promise.all(all.map((c: any) => ck.numstat(ctx.cwd, c.tree, now).catch(() => undefined)));
      const labels = all.map((c: any, i: number) =>
        checkpointLabel(c, { currentSession: ck.safeSegment(current), stats: stats[i], index: i + 1 }),
      );
      const picked = await ctx.ui.select("⏺ Rewind code to…", labels);
      if (!picked) return;
      cp = all[labels.indexOf(picked)];
    }

    const plan = await ck.planRestore(ctx.cwd, cp, { paths });
    if (plan.write.length === 0 && plan.remove.length === 0) {
      return ctx.ui.notify(paths ? "Those paths already match that checkpoint" : "Working tree already matches that checkpoint", "info");
    }

    // Conversation rewind: Pi lets a command navigate the session tree (ctx.navigateTree), so offer it for full
    // restores of a prompt in this session. Same effect as /tree to that prompt, without a second restore prompt.
    let entryId: string | undefined;
    if (!paths && ctx.hasUI && typeof ctx.navigateTree === "function") {
      entryId = entryForCheckpoint(ctx, cp);
      if (entryId) {
        const choice = await ctx.ui.select(`Rewind to turn ${cp.turn}`, [
          "Restore code only",
          "Restore code + conversation (go back to before that prompt)",
        ]);
        if (!choice) return;
        if (!choice.startsWith("Restore code +")) entryId = undefined;
      }
    }

    const title = paths ? `Restore ${paths.length} path(s) from turn ${cp.turn}?` : `Rewind to turn ${cp.turn}?`;
    const ok = await ctx.ui.confirm(title, describePlan(plan));
    if (!ok) return;
    const out = await ck.restoreCheckpoint(ctx.cwd, cp, { session: current, keep: keepCount(), paths });
    const what = paths ? `Restored from turn ${cp.turn}` : `Rewound to turn ${cp.turn}`;
    ctx.ui.notify(
      `⏺ ${what}: ${out.written.length} rewritten, ${out.removed.length} removed. Previous state saved as turn ${out.undo?.turn ?? "?"} (undo: /rewind).`,
      "info",
    );
    if (entryId) {
      navigating = true;
      try {
        await ctx.navigateTree(entryId);
      } finally {
        navigating = false;
      }
    }
  }

  pi.registerCommand("rewind", {
    description: "Restore code to an earlier checkpoint (/rewind diff <n>, /rewind <n> <path>..., /rewind clean)",
    handler: async (args: string, ctx: any) => {
      try {
        await runRewind(ctx, args.trim());
      } catch (err: any) {
        ctx.ui.notify(`/rewind failed: ${err?.message ?? err}`, "error");
      }
    },
  });
}
