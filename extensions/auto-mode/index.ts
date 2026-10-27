import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const {
  createState, ensureConfig, gate, showLog, runTest, setMode, nextMode, parseModeArg, showStatus, statusText,
} = require("./gate.js");

// ctrl+alt+a: not bound by any Pi default (docs/keybindings.md); shift+tab is taken by thinking-level cycling.
const SHORTCUT = "ctrl+alt+a";

export default function (pi: ExtensionAPI) {
  const state = createState();

  pi.on("session_start", async (_event, ctx) => {
    state.sessionAllow.clear();
    state.logFile = null;
    state.config = null;
    const cfg = ensureConfig(state, ctx.cwd);
    if (!ctx.hasUI) return;
    showStatus(state, ctx);
    for (const w of cfg.warnings) ctx.ui.notify(`auto-mode: ${w}`, "warning");
  });

  pi.on("tool_call", async (event, ctx) => gate(event, ctx, state));

  pi.registerCommand("auto", {
    description: "Auto mode: /auto [auto|ask|off|status|log [n]|test <cmd>] (no argument cycles auto > ask > off)",
    getArgumentCompletions: (prefix: string) =>
      ["auto", "ask", "off", "status", "log", "test"]
        .filter((m) => m.startsWith(prefix.trim().toLowerCase()))
        .map((m) => ({ value: m, label: m })),
    handler: async (args, ctx) => {
      const parsed = parseModeArg(args);
      if (parsed.error) return ctx.ui.notify(parsed.error, "error");
      if (parsed.log) return showLog(state, ctx, parsed.log);
      if (parsed.test) return runTest(state, ctx, parsed.test);
      if (parsed.status) return ctx.ui.notify(`${statusText(state.mode)} (${state.sessionAllow.size} session allow rule(s))`, "info");
      setMode(state, parsed.cycle ? nextMode(state.mode) : parsed.mode, ctx);
    },
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Cycle auto mode (auto > ask > off)",
    handler: async (ctx) => setMode(state, nextMode(state.mode), ctx),
  });
}
