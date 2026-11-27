import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const { parseNote, projectFile, userFile, saveNote, undoNote, shortPath } = load("./memory.js");
const { findSecret } = load("./secrets.js");

// "# note" in the editor: append the note to AGENTS.md (project or user) instead of sending it to the model.
export default function (pi: ExtensionAPI) {
  // Notes appended in this session (newest last), for `/memory undo`.
  const added: { file: string; line: string }[] = [];

  pi.on("input", async (event: any, ctx: any) => {
    // Only a person typing in the terminal editor. Scripts (rpc/print/json) and extension messages pass through.
    if (event.source !== "interactive" || ctx.mode !== "tui" || !ctx.hasUI) return { action: "continue" };
    if (event.images?.length) return { action: "continue" };
    const note = parseNote(event.text);
    if (!note) return { action: "continue" };

    const secret = findSecret(note);
    if (secret) {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(`Note not saved: looks like a secret (${secret}). Instruction files are sent to the model and often committed.`, "error");
      return { action: "handled" };
    }

    const { project, user, projectLabel, userLabel } = targets(ctx);
    const choice: string | undefined = await ctx.ui.select(`Remember: ${note}`, [projectLabel, userLabel]);
    if (!choice) {
      ctx.ui.setEditorText(event.text); // do not lose what was typed
      ctx.ui.notify("Note not saved", "info");
      return { action: "handled" };
    }
    const file = choice === userLabel ? user : project;
    try {
      const { created, duplicate, line } = saveNote(file, note, fs);
      if (duplicate) {
        ctx.ui.notify(`Already in ${shortPath(file)}: ${note}`, "info");
      } else {
        added.push({ file, line });
        ctx.ui.notify(`${created ? "Created" : "Added to"} ${shortPath(file)}: ${note}`, "info");
      }
    } catch (err: any) {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(`Could not save note to ${shortPath(file)}: ${err?.message ?? err}`, "error");
    }
    return { action: "handled" };
  });

  // /memory opens the instruction file in the editor; /memory undo removes the last note added here.
  pi.registerCommand("memory", {
    description: "Edit AGENTS.md (project or user) in the editor; \"/memory undo\" removes the last # note",
    handler: async (args: string, ctx: any) => {
      if (args.trim() === "undo") {
        const last = added.pop();
        if (!last) return ctx.ui.notify("No note to undo in this session", "info");
        try {
          if (undoNote(last.file, last.line, fs).removed) ctx.ui.notify(`Removed from ${shortPath(last.file)}: ${last.line.slice(2)}`, "info");
          else ctx.ui.notify(`Not undone: that line in ${shortPath(last.file)} was changed or removed`, "warning");
        } catch (err: any) {
          ctx.ui.notify(`Could not undo: ${err?.message ?? err}`, "error");
        }
        return;
      }
      if (!ctx.hasUI) return;
      const { project, user, projectLabel, userLabel } = targets(ctx);
      const choice: string | undefined = await ctx.ui.select("Edit which instruction file?", [projectLabel, userLabel]);
      if (!choice) return;
      const file = choice === userLabel ? user : project;
      try {
        let before = "";
        try {
          before = fs.readFileSync(file, "utf8");
        } catch (e: any) {
          if (e?.code !== "ENOENT") throw e;
        }
        const after: string | undefined = await ctx.ui.editor(shortPath(file), before);
        if (after === undefined || after === before) return ctx.ui.notify("No changes saved", "info");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, after);
        ctx.ui.notify(`Saved ${shortPath(file)}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`Could not edit ${shortPath(file)}: ${err?.message ?? err}`, "error");
      }
    },
  });
}

function targets(ctx: any) {
  const project = projectFile(ctx.cwd);
  const user = userFile(process.env);
  return { project, user, projectLabel: `Project  ${shortPath(project)}`, userLabel: `User     ${shortPath(user)}` };
}
