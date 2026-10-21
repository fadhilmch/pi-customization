"use strict";
// Process + path helpers (the only impure helpers; everything is injectable).
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Run bin with args (no shell). Resolves, never rejects. */
function run(bin, args, { cwd, timeoutMs, signal, execFile = childProcess.execFile }) {
  return new Promise((resolve) => {
    try {
      execFile(bin, args, { cwd, timeout: timeoutMs, signal, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === "number" ? err.code : null) : 0,
          timedOut: !!(err && err.killed && err.signal),
          missing: !!(err && err.code === "ENOENT"),
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      });
    } catch (e) {
      resolve({ ok: false, code: null, timedOut: false, missing: true, stdout: "", stderr: String(e) });
    }
  });
}

/** Resolve a tool-supplied path the way Pi does: strip leading "@", expand "~", relative to cwd. */
function resolveToolPath(p, cwd, home = os.homedir()) {
  let s = String(p || "");
  if (s.startsWith("@")) s = s.slice(1);
  if (s === "~") s = home;
  else if (s.startsWith("~/") || s.startsWith("~" + path.sep)) s = path.join(home, s.slice(2));
  return path.resolve(cwd, s);
}

/** Lookup `bin` on PATH. Returns absolute path or undefined. */
function which(bin, envPath = process.env.PATH || "") {
  for (const d of envPath.split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return undefined;
}

function realEnv() {
  const cache = new Map();
  return {
    exists: (p) => fs.existsSync(p),
    read: (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    which: (b) => {
      if (!cache.has(b)) cache.set(b, which(b));
      return cache.get(b);
    },
  };
}

module.exports = { run, resolveToolPath, which, realEnv };
