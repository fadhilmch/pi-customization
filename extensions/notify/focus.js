"use strict";
// Best-effort "is the terminal running Pi focused?" check. No Pi imports.
// Every failure or unknown answers false (= not focused), so a notification is never lost to a guess.

// TERM_PROGRAM value -> macOS process name that System Events reports for that terminal.
const MAC_TERMINALS = Object.freeze({
  "Apple_Terminal": "Terminal",
  "iTerm.app": "iTerm2",
  "ghostty": "Ghostty",
  "WezTerm": "wezterm-gui",
  "Hyper": "Hyper",
  "alacritty": "alacritty",
  "vscode": "Code",
});

const FRONTMOST_SCRIPT = 'tell application "System Events" to get name of first application process whose frontmost is true';

/** Run a command, resolve with trimmed stdout, or "" on any failure. Never rejects. */
function run(execFile, bin, args, timeout = 1500) {
  return new Promise((resolve) => {
    try {
      const child = execFile(bin, args, { timeout }, (err, stdout) => resolve(err ? "" : String(stdout ?? "").trim()));
      if (child && typeof child.on === "function") child.on("error", () => resolve(""));
    } catch {
      resolve("");
    }
  });
}

/** Terminal app name for this env on macOS, or "" when unknown. */
function macTerminalName(env) {
  if (env.KITTY_WINDOW_ID) return "kitty";
  return MAC_TERMINALS[env.TERM_PROGRAM] || "";
}

async function macFocused(env, execFile) {
  const want = macTerminalName(env);
  if (!want) return false;
  const front = await run(execFile, "osascript", ["-e", FRONTMOST_SCRIPT]);
  return front !== "" && front.toLowerCase() === want.toLowerCase();
}

/** Parse tmux output "<pane_active>|<window_active>|<session_attached>|<client_flags>". */
function parseTmux(out) {
  const [pane, win, attached, flags = ""] = String(out).split("|");
  // "focused" only appears in client_flags when focus-events is on; without it focus is unknown.
  return pane === "1" && win === "1" && Number(attached) >= 1 && /(^|,)focused(,|$)/.test(flags);
}

async function tmuxFocused(env, execFile) {
  const args = ["display-message", "-p"];
  if (env.TMUX_PANE) args.push("-t", env.TMUX_PANE);
  args.push("#{pane_active}|#{window_active}|#{session_attached}|#{client_flags}");
  return parseTmux(await run(execFile, "tmux", args));
}

/** deps: { platform, env, execFile }. Resolves true only when sure the terminal is focused. */
async function isTerminalFocused(deps) {
  try {
    const env = deps.env || {};
    if (env.TMUX) return await tmuxFocused(env, deps.execFile);
    if (deps.platform === "darwin") return await macFocused(env, deps.execFile);
  } catch {}
  return false;
}

module.exports = { MAC_TERMINALS, macTerminalName, parseTmux, isTerminalFocused };
