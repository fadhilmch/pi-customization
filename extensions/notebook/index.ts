import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { Type } = require("typebox");
const { withFileMutationQueue } = require("@earendil-works/pi-coding-agent");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadConfig } = require("./config.js");
const { hasNotebook } = require("./activation.js");
const { parseNotebook, serializeNotebook } = require("./nbio.js");
const { applyEdit, resolveCell } = require("./edit.js");
const { capText, renderNotebookResult } = require("./output.js");
const { renderCell } = require("./render.js");

const Cell = Type.Union([Type.Integer({ minimum: 0, description: "1-based cell number (0 inserts at the top)" }), Type.String({ description: "Cell id" })]);
const Params = Type.Object({
  path: Type.String({ description: "Path to a Jupyter notebook" }),
  cell: Cell,
  mode: Type.Union([Type.Literal("replace"), Type.Literal("insert"), Type.Literal("delete")]),
  source: Type.Optional(Type.String({ description: "New cell source for replace or insert" })),
  cellType: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("markdown")])),
});

export default function (pi: ExtensionAPI) {
  const tempDirs = new Set<string>();
  const startupConfig = loadConfig();
  let deferredNotified = false;
  const active = () => pi.getActiveTools();
  function activate() {
    const current = active();
    if (!current.includes("notebook_edit")) pi.setActiveTools([...current, "notebook_edit"]);
  }

  pi.registerTool({
    name: "notebook_edit", label: "NotebookEdit",
    description: "Edit one Jupyter notebook cell by number or id. Replace source, insert a cell, or delete a cell; replacing code clears stale outputs.",
    promptSnippet: "Edit a Jupyter notebook by cell instead of matching JSON",
    promptGuidelines: ["Use read with offset and limit as cell numbers for .ipynb files. Read the cell first, then make a focused notebook_edit."],
    parameters: Params,
    ...(startupConfig.exposure === "deferred" ? { exposure: "deferred" } : { defaultActive: false }),
    annotations: { readOnlyHint: false, openWorldHint: false },
    renderShell: "self",

    async execute(_id: string, params: any, signal: any, _onUpdate: any, ctx: any) {
      const file = path.resolve(ctx?.cwd || process.cwd(), params.path);
      const cfg = loadConfig({ cwd: ctx?.cwd });
      if (!file.toLowerCase().endsWith(".ipynb")) return { content: [{ type: "text", text: "notebook_edit only accepts .ipynb files." }], details: { error: "invalid_extension" }, isError: true };
      try {
        return await withFileMutationQueue(file, async () => {
          if (signal?.aborted) throw new Error("Operation aborted");
          const original = await fs.readFile(file, "utf8");
          const nb = parseNotebook(original);
          const index = resolveCell(nb.cells, params.cell, { insertion: params.mode === "insert" });
          const edited = applyEdit(nb, params);
          if (signal?.aborted) throw new Error("Operation aborted");
          await fs.writeFile(file, serializeNotebook(edited), "utf8");
          const cellNumber = index + 1;
          let text: string;
          if (params.mode === "delete") text = `Deleted cell ${cellNumber}.`;
          else {
            const target = edited.cells[params.mode === "insert" ? index : index];
            const language = edited.metadata?.kernelspec?.language || "python";
            text = `${params.mode === "insert" ? "Inserted" : "Replaced"} cell ${cellNumber} (${target.cell_type})\n\n${renderCell(target, cellNumber, { language })}`;
          }
          const capped = await capText(text, cfg.maxChars);
          if (capped.dir) tempDirs.add(capped.dir);
          return { content: [{ type: "text", text: capped.text }], details: { path: file, cell: cellNumber, mode: params.mode, truncated: capped.truncated, fullOutputPath: capped.file } };
        });
      } catch (error: any) {
        const capped = await capText(`Notebook edit failed: ${String(error?.message || error)}`, cfg.maxChars);
        if (capped.dir) tempDirs.add(capped.dir);
        return { content: [{ type: "text", text: capped.text }], details: { path: file, error: capped.text, truncated: capped.truncated, fullOutputPath: capped.file }, isError: true };
      }
    },

    renderCall(args: any) { return { render: (width: number) => [`⏺ NotebookEdit(${args?.mode || "?"} cell ${args?.cell ?? "?"})`.slice(0, width)], invalidate() {} }; },
    renderResult(result: any) { return { render: (width: number) => [`  ⎿ ${result.details?.mode || "notebook edit"} · cell ${result.details?.cell ?? "?"}`.slice(0, width)], invalidate() {} }; },
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    if (startupConfig.exposure === "deferred") {
      const current = active();
      const registered = pi.getAllTools?.().some((tool: any) => tool.name === "tool_search");
      const fallback = registered ? "tool_search" : "notebook_edit";
      if (!current.includes(fallback)) pi.setActiveTools([...current, fallback]);
      if (!deferredNotified && ctx?.hasUI) ctx.ui.notify(registered ? "notebook_edit is deferred; tool_search was activated so it can still be discovered." : "tool_search is unavailable; notebook_edit was activated directly.", "info");
      deferredNotified = true;
      return;
    }
    if (hasNotebook(ctx?.cwd)) activate();
  });

  pi.on("tool_result", async (event: any, ctx: any) => {
    if (event.toolName !== "read" || event.isError || !String(event.input?.path || "").toLowerCase().endsWith(".ipynb")) return;
    const file = path.resolve(ctx?.cwd || process.cwd(), event.input.path);
    if (startupConfig.exposure === "direct") activate();
    try {
      const raw = await fs.readFile(file, "utf8");
      const nb = parseNotebook(raw);
      const cfg = loadConfig({ cwd: ctx?.cwd });
      const from = Number.isInteger(event.input?.offset) ? event.input.offset : 1;
      const limit = Number.isInteger(event.input?.limit) ? event.input.limit : undefined;
      const result = await renderNotebookResult(nb, { fileName: path.basename(file), from, limit, maxChars: cfg.maxChars });
      if (result.dir) tempDirs.add(result.dir);
      const replaced: any = { content: [{ type: "text", text: result.text }], details: { path: file, notebook: { cells: nb.cells.length, from, limit, truncated: result.truncated, fullOutputPath: result.file } } };
      if (Object.prototype.hasOwnProperty.call(event, "structuredContent")) replaced.structuredContent = undefined;
      return replaced;
    } catch (error: any) {
      const cfg = loadConfig({ cwd: ctx?.cwd });
      const capped = await capText(`Notebook read failed: ${String(error?.message || error)}`, cfg.maxChars);
      if (capped.dir) tempDirs.add(capped.dir);
      return { content: [{ type: "text", text: capped.text }], details: { path: file, notebookError: capped.text, fullOutputPath: capped.file, truncated: capped.truncated }, isError: true };
    }
  });

  pi.on("session_shutdown", async () => {
    await Promise.all([...tempDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.clear();
  });
}
