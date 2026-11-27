"use strict";
// Pure helpers for the notify extension. No Pi imports.
const path = require("node:path");

const DEFAULTS = Object.freeze({
  enabled: true,
  minSeconds: 10,
  sound: "Tink",
  method: "auto",
  suppressWhenFocused: true,
  quietHours: null,
  command: null,
});
const METHODS = ["auto", "osc", "osascript", "notify-send", "none"];
const COMMAND_TIMEOUT_MS = 10000;

/** "HH:MM" -> minutes since midnight, or null. */
function parseClock(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(typeof s === "string" ? s.trim() : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Keep quietHours only when both ends parse and differ. */
function normalizeQuietHours(q) {
  if (!q || typeof q !== "object") return null;
  const a = parseClock(q.start);
  const b = parseClock(q.end);
  return a === null || b === null || a === b ? null : { start: q.start.trim(), end: q.end.trim() };
}

/** argv array of non-empty strings, or null. A shell string is rejected on purpose. */
function normalizeCommand(c) {
  return Array.isArray(c) && c.length > 0 && c.every((x) => typeof x === "string" && x !== "") ? [...c] : null;
}

/** True when `now` is inside the window; the window may wrap midnight (22:00 -> 07:00). */
function inQuietHours(quietHours, now) {
  const q = normalizeQuietHours(quietHours);
  if (!q) return false;
  const start = parseClock(q.start);
  const end = parseClock(q.end);
  const t = now.getHours() * 60 + now.getMinutes();
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** Merge a raw parsed notify.json over the defaults, ignoring invalid values. */
function normalizeConfig(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.minSeconds === "number" && Number.isFinite(raw.minSeconds) && raw.minSeconds >= 0) out.minSeconds = raw.minSeconds;
  if (typeof raw.sound === "string") out.sound = raw.sound.trim(); // "" disables the sound
  if (typeof raw.method === "string" && METHODS.includes(raw.method)) out.method = raw.method;
  if (typeof raw.suppressWhenFocused === "boolean") out.suppressWhenFocused = raw.suppressWhenFocused;
  out.quietHours = normalizeQuietHours(raw.quietHours);
  out.command = normalizeCommand(raw.command);
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

/** Which delivery to use: "osascript" | "notify-send" | "osc" | "none". */
function resolveMethod(config, platform) {
  if (!config.enabled || config.method === "none") return "none";
  if (config.method === "osascript") return platform === "darwin" ? "osascript" : "none";
  if (config.method === "osc") return "osc";
  if (config.method === "notify-send") return platform === "linux" ? "notify-send" : "none";
  if (platform === "darwin") return "osascript";
  return platform === "linux" ? "notify-send" : "osc";
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

function buildError({ cwd, message, elapsedMs }) {
  const detail = cleanText(message, 120);
  const took = elapsedMs ? ` (after ${formatDuration(elapsedMs)})` : "";
  return { title: `${projectTitle(cwd)} - error`, body: `Run ended with an error${took}${detail ? `: ${detail}` : ""}` };
}

function buildPrompt({ cwd, title }) {
  return { title: projectTitle(cwd), body: title ? `Waiting for you: ${title}` : "Waiting for your confirmation" };
}

/** Linux needs a session bus to show anything; over plain ssh the OSC sequence is the better bet. */
function canNotifySend(env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.DBUS_SESSION_BUS_ADDRESS);
}

/** Args for execFile("notify-send", args). "--" keeps a title starting with "-" from being read as an option. */
function notifySendArgs(title, body) {
  return ["--app-name=Pi", "--", cleanText(title, 80), cleanText(body, 200)];
}

/**
 * Deliver a desktop/terminal notification. deps: { platform, env, execFile, write }.
 * Never throws; a missing osascript, or a failing notify-send, falls back to OSC.
 */
function deliver(config, title, body, deps) {
  let method = resolveMethod(config, deps.platform);
  const osc = () => {
    try {
      deps.write(oscSequence(title, body, deps.env));
    } catch {}
  };
  if (method === "notify-send" && config.method === "auto" && !canNotifySend(deps.env || {})) method = "osc";
  if (method === "osc") return osc();
  if (method !== "osascript" && method !== "notify-send") return;
  const [bin, args, fallsBack] =
    method === "osascript"
      ? ["osascript", osascriptArgs(title, body, config.sound), (err) => err.code === "ENOENT"]
      : ["notify-send", notifySendArgs(title, body), () => true];
  try {
    const child = deps.execFile(bin, args, { timeout: 5000 }, (err) => {
      if (err && fallsBack(err)) osc();
    });
    if (child && typeof child.on === "function") child.on("error", () => {});
  } catch {
    osc();
  }
}

/**
 * Run the user's command hook: argv only (no shell), detached, stdio ignored, killed after
 * COMMAND_TIMEOUT_MS. Never throws. deps: { spawn, env }.
 */
function runCommand(command, ev, deps) {
  if (!command) return;
  try {
    const child = deps.spawn(command[0], command.slice(1), {
      detached: true,
      stdio: "ignore",
      timeout: COMMAND_TIMEOUT_MS,
      env: {
        ...deps.env,
        PI_NOTIFY_TITLE: cleanText(ev.title, 200),
        PI_NOTIFY_MESSAGE: cleanText(ev.body, 400),
        PI_NOTIFY_EVENT: ev.event,
        PI_NOTIFY_QUIET: ev.quiet ? "1" : "0",
      },
    });
    if (child && typeof child.on === "function") child.on("error", () => {});
    if (child && typeof child.unref === "function") child.unref();
  } catch {}
}

/**
 * Full pipeline for one event {title, body, event: "settled"|"error"|"prompt"}.
 * Focused terminal: nothing at all. Quiet hours: no sound, popup or OSC, but the command still
 * runs (PI_NOTIFY_QUIET=1) because it is the user's own remote channel.
 * deps: { platform, env, execFile, spawn, write, now?, isFocused? }. Never throws.
 */
async function notifyAll(config, ev, deps) {
  try {
    if (!config.enabled || config.method === "none") return;
    if (config.suppressWhenFocused && deps.isFocused && (await deps.isFocused(deps))) return;
    const quiet = inQuietHours(config.quietHours, deps.now ? deps.now() : new Date());
    runCommand(config.command, { ...ev, quiet }, deps);
    if (!quiet) deliver(config, ev.title, ev.body, deps);
  } catch {}
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
  parseClock,
  normalizeQuietHours,
  normalizeCommand,
  inQuietHours,
  notifySendArgs,
  runCommand,
  notifyAll,
  buildError,
  shouldNotify,
  formatDuration,
  buildSettled,
  buildPrompt,
  deliver,
};
