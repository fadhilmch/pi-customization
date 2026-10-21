import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { loadConfig, shouldNotify, buildSettled, buildPrompt, deliver } = require("./notify.js");

export default function (pi: ExtensionAPI) {
  let startedAt = 0;
  let promptTimer: ReturnType<typeof setTimeout> | undefined;

  const config = () => loadConfig(os.homedir(), fs.readFileSync);
  const send = (title: string, body: string) =>
    deliver(config(), title, body, {
      platform: process.platform,
      env: process.env,
      execFile,
      write: (s: string) => process.stdout.write(s),
    });
  const clearPrompt = () => {
    if (promptTimer) clearTimeout(promptTimer);
    promptTimer = undefined;
  };

  pi.on("agent_start", async () => {
    startedAt = Date.now();
  });

  // Final boundary: Pi will not retry/compact/continue on its own, so it is waiting for the user.
  pi.on("agent_settled", async (event, ctx) => {
    const elapsedMs = startedAt ? Date.now() - startedAt : 0;
    if (!shouldNotify({ config: config(), elapsedMs, aborted: event.aborted })) return;
    const { title, body } = buildSettled({ cwd: ctx.cwd, elapsedMs });
    send(title, body);
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
      send(title, body);
    }, cfg.minSeconds * 1000);
    promptTimer.unref?.();
  });

  pi.on("ui_prompt_end", async () => clearPrompt());
  pi.on("session_shutdown", async () => clearPrompt());
}
