import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Works under Pi's loader (CJS require) and plain Node ESM (--experimental-strip-types).
const load = typeof require === "function" ? require : createRequire(import.meta.url);

const { createDiet } = load("./diet.js");
const { loadConfig } = load("./config.js");
const { formatStats } = load("./stats.js");

// Folds long bash output (head + error lines + tail, full text saved to a temp file) and replaces
// repeated identical reads with a short note, so tool results cost fewer tokens on every later turn.
export default function (pi: ExtensionAPI) {
  const diet = createDiet({ loadConfig, emit: (name: string, data: unknown) => pi.events.emit(name, data) });

  pi.on("session_start", async (_event: any, ctx: any) => diet.start(ctx));
  pi.on("tool_result", async (event: any, ctx: any) => diet.onToolResult(event, ctx));

  pi.registerCommand("diet", {
    description: "Show output-diet savings (tokens not sent to the model) and config",
    handler: async (_args: string, ctx: any) => {
      diet.reloadConfig(ctx);
      ctx.ui.notify(formatStats(diet.state.stats, diet.state.cfg), "info");
    },
  });
}
