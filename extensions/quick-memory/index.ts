import { createRequire } from "node:module";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const { parseNote, projectFile, userFile, saveNote, shortPath } = load("./memory.js");

// "# note" in the editor: append the note to AGENTS.md (project or user) instead of sending it to the model.
export default function (pi: ExtensionAPI) {
  pi.on("input", async (event: any, ctx: any) => {
    // Only a person typing in the terminal editor. Scripts (rpc/print/json) and extension messages pass through.
    if (event.source !== "interactive" || ctx.mode !== "tui" || !ctx.hasUI) return { action: "continue" };
    if (event.images?.length) return { action: "continue" };
    const note = parseNote(event.text);
    if (!note) return { action: "continue" };

    const project = projectFile(ctx.cwd);
    const user = userFile(process.env);
    const projectLabel = `Project  ${shortPath(project)}`;
    const userLabel = `User     ${shortPath(user)}`;
    const choice: string | undefined = await ctx.ui.select(`Remember: ${note}`, [projectLabel, userLabel]);
    if (!choice) {
      ctx.ui.setEditorText(event.text); // do not lose what was typed
      ctx.ui.notify("Note not saved", "info");
      return { action: "handled" };
    }
    const file = choice === userLabel ? user : project;
    try {
      const { created } = saveNote(file, note, fs);
      ctx.ui.notify(`${created ? "Created" : "Added to"} ${shortPath(file)}: ${note}`, "info");
    } catch (err: any) {
      ctx.ui.setEditorText(event.text);
      ctx.ui.notify(`Could not save note to ${shortPath(file)}: ${err?.message ?? err}`, "error");
    }
    return { action: "handled" };
  });
}
