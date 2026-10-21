"use strict";
// Pure helpers for the notify extension. No Pi imports.
const path = require("node:path");

const DEFAULTS = Object.freeze({ enabled: true, minSeconds: 10, sound: "Tink", method: "auto" });
const METHODS = ["auto", "osc", "osascript", "none"];

/** Merge a raw parsed notify.json over the defaults, ignoring invalid values. */
function normalizeConfig(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.minSeconds === "number" && Number.isFinite(raw.minSeconds) && raw.minSeconds >= 0) out.minSeconds = raw.minSeconds;
  if (typeof raw.sound === "string") out.sound = raw.sound.trim(); // "" disables the sound
  if (typeof raw.method === "string" && METHODS.includes(raw.method)) out.method = raw.method;
  return out;
}

/** Read <home>/.pi/agent/notify.json. Missing or broken file gives defaults. */
function loadConfig(home, readFile) {
  try {
    return normalizeConfig(JSON.parse(readFile(path.join(home, ".pi", "agent", "notify.json"), "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Strip control characters (terminal escape injection) and collapse whitespace. */
function cleanText(s, max = 200) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Escape for use inside an AppleScript double-quoted string literal. */
function escapeAppleScript(s) {
  return cleanText(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Sound names are plain identifiers ("Tink", "Basso", "Submarine"...). Anything else is dropped. */
function safeSound(sound) {
  return typeof sound === "string" && /^[A-Za-z0-9 _.-]{1,40}$/.test(sound) ? sound : "";
}

/** Args for execFile("osascript", args). The script is one argv item, never a shell string. */
function osascriptArgs(title, body, sound) {
  const snd = safeSound(sound);
  const script =
    `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"` +
    (snd ? ` sound name "${snd}"` : "");
  return ["-e", script];
}

/** Terminal notification escape sequence for the given env. ";" is not allowed in OSC 777 fields. */
function oscSequence(title, body, env = {}) {
  const t = cleanText(title, 80).replace(/;/g, ",");
  const b = cleanText(body, 160).replace(/;/g, ",");
  if (env.KITTY_WINDOW_ID) return `\x1b]99;i=1:d=0;${t}\x1b\\\x1b]99;i=1:p=body;${b}\x1b\\`;
  if (env.TERM_PROGRAM === "iTerm.app") return `\x1b]9;${t}: ${b}\x07`;
  return `\x1b]777;notify;${t};${b}\x07`;
}

/** Which delivery to use: "osascript" | "osc" | "none". */
function resolveMethod(config, platform) {
  if (!config.enabled || config.method === "none") return "none";
  if (config.method === "osascript") return platform === "darwin" ? "osascript" : "none";
  if (config.method === "osc") return "osc";
  return platform === "darwin" ? "osascript" : "osc";
}

function shouldNotify({ config, elapsedMs, aborted }) {
  if (!config.enabled || config.method === "none" || aborted) return false;
  return elapsedMs >= config.minSeconds * 1000;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function projectTitle(cwd) {
  const project = cwd ? path.basename(cwd) : "";
  return project ? `Pi - ${project}` : "Pi";
}

function buildSettled({ cwd, elapsedMs }) {
  return { title: projectTitle(cwd), body: `Ready for input (took ${formatDuration(elapsedMs)})` };
}

function buildPrompt({ cwd, title }) {
  return { title: projectTitle(cwd), body: title ? `Waiting for you: ${title}` : "Waiting for your confirmation" };
}

/**
 * Deliver a notification. deps: { platform, env, execFile, write }.
 * Never throws; a missing osascript falls back to OSC.
 */
function deliver(config, title, body, deps) {
  const method = resolveMethod(config, deps.platform);
  const osc = () => {
    try {
      deps.write(oscSequence(title, body, deps.env));
    } catch {}
  };
  if (method === "osc") return osc();
  if (method !== "osascript") return;
  try {
    const child = deps.execFile("osascript", osascriptArgs(title, body, config.sound), { timeout: 5000 }, (err) => {
      if (err && err.code === "ENOENT") osc();
    });
    if (child && typeof child.on === "function") child.on("error", () => {});
  } catch {
    osc();
  }
}

module.exports = {
  DEFAULTS,
  normalizeConfig,
  loadConfig,
  cleanText,
  escapeAppleScript,
  safeSound,
  osascriptArgs,
  oscSequence,
  resolveMethod,
  shouldNotify,
  formatDuration,
  buildSettled,
  buildPrompt,
  deliver,
};
