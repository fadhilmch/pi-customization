import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { loadConfig, shouldNotify, buildSettled, buildError, buildPrompt, notifyAll } = require("./notify.js");
const { isTerminalFocused } = require("./focus.js");

export default function (pi: ExtensionAPI) {
  let startedAt = 0;
  let lastError: string | undefined; // set by agent_end when the last assistant turn failed
  let promptTimer: ReturnType<typeof setTimeout> | undefined;

  const config = () => loadConfig(os.homedir(), fs.readFileSync);
  const send = (event: string, title: string, body: string) =>
    notifyAll(config(), { event, title, body }, {
      platform: process.platform,
      env: process.env,
      execFile,
      spawn,
      write: (s: string) => process.stdout.write(s),
      isFocused: isTerminalFocused,
    });
  const clearPrompt = () => {
    if (promptTimer) clearTimeout(promptTimer);
    promptTimer = undefined;
  };

  pi.on("agent_start", async () => {
    startedAt = Date.now();
  });

  // agent_end fires per low-level run (retries included), so only the last one before settling counts.
  pi.on("agent_end", async (event) => {
    const last = [...(event.messages ?? [])].reverse().find((m: any) => m?.role === "assistant") as any;
    lastError = last?.stopReason === "error" ? String(last.errorMessage ?? "") : undefined;
  });

  // Final boundary: Pi will not retry/compact/continue on its own, so it is waiting for the user.
  pi.on("agent_settled", async (event, ctx) => {
    const elapsedMs = startedAt ? Date.now() - startedAt : 0;
    const cfg = config();
    const error = lastError;
    lastError = undefined;
    if (event.aborted || !cfg.enabled || cfg.method === "none") return;
    // A failed run is worth a ping however short it was.
    if (error !== undefined) {
      const { title, body } = buildError({ cwd: ctx.cwd, message: error, elapsedMs });
      return send("error", title, body);
    }
    if (!shouldNotify({ config: cfg, elapsedMs, aborted: event.aborted })) return;
    const { title, body } = buildSettled({ cwd: ctx.cwd, elapsedMs });
    send("settled", title, body);
  });

  // A blocking extension dialog (select/confirm/input/editor/custom) is open. Ping only if the
  // user has not answered within minSeconds.
  pi.on("ui_prompt_start", async (event, ctx) => {
    const cfg = config();
    if (!cfg.enabled || cfg.method === "none") return;
    clearPrompt();
    promptTimer = setTimeout(() => {
      promptTimer = undefined;
      const { title, body } = buildPrompt({ cwd: ctx.cwd, title: event.title });
      send("prompt", title, body);
    }, cfg.minSeconds * 1000);
    promptTimer.unref?.();
  });

  pi.on("ui_prompt_end", async () => clearPrompt());
  pi.on("session_shutdown", async () => clearPrompt());
}
