"use strict";
// Format step: run the detected formatter on a file and report whether it changed.
const path = require("node:path");
const { detectFormatter } = require("./formatters.js");

const FORMAT_TIMEOUT_MS = 20000;

/**
 * deps: { env, run(bin,args,opts), readFile(path)->string|undefined }
 * Returns { changed, name?, note?, failed? }. Never throws.
 */
async function formatFile(file, config, deps) {
  try {
    const fmt = detectFormatter(file, config, deps.env);
    if (!fmt) return { changed: false };
    const before = deps.readFile(file);
    if (before === undefined) return { changed: false };
    const res = await deps.run(fmt.bin, fmt.args, { cwd: fmt.cwd, timeoutMs: FORMAT_TIMEOUT_MS });
    if (!res.ok) return { changed: false, name: fmt.name, failed: res.timedOut ? "timed out" : res.missing ? "not found" : `exit ${res.code}` };
    const after = deps.readFile(file);
    if (after === undefined || after === before) return { changed: false, name: fmt.name };
    return { changed: true, name: fmt.name, note: formatNote(fmt.name, file, deps.cwd) };
  } catch {
    return { changed: false };
  }
}

/** Text appended to the write/edit tool result so the model knows the file changed on disk. */
function formatNote(name, file, cwd) {
  const shown = cwd ? path.relative(cwd, file) || file : file;
  return `[quality-on-write] ${name} reformatted ${shown} after this change. The file on disk may differ from what you wrote; re-read it before the next edit if exact text matters.`;
}

module.exports = { formatFile, formatNote, FORMAT_TIMEOUT_MS };
