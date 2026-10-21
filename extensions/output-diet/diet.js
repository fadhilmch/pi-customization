'use strict';
const fsDefault = require('node:fs');
const osDefault = require('node:os');
const path = require('node:path');
const { fold, isAllowlisted } = require('./fold.js');
const { ReadTracker, dedupeNote } = require('./dedupe.js');
const { Stats } = require('./stats.js');

const textOf = (content) => content.map((c) => c.text).join('\n');
const MAX_FULL_BYTES = 20 * 1024 * 1024;
const safeId = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'x';

// Only plain text results are touched; anything with images is left alone.
const onlyText = (content) => Array.isArray(content) && content.length > 0 && content.every((c) => c && c.type === 'text' && typeof c.text === 'string');

// Tool call ids whose results are in the live (post-compaction, current branch) context, or null if unknown.
function liveToolCallIds(ctx) {
  try {
    const entries = ctx.sessionManager.buildContextEntries();
    const ids = new Set();
    for (const e of entries) {
      const m = e && e.type === 'message' ? e.message : undefined;
      if (m && m.role === 'toolResult') ids.add(m.toolCallId);
    }
    return ids;
  } catch {
    return null;
  }
}

// Holds the per-session state and the tool_result logic. Injected deps keep it testable without Pi.
function createDiet({ loadConfig, fs = fsDefault, os = osDefault, emit = () => {} } = {}) {
  const state = { cfg: loadConfig({}), stats: new Stats(), tracker: new ReadTracker() };

  const publish = () => { try { emit('output-diet:stats', state.stats.snapshot()); } catch { /* ignore */ } };

  function saveFull(text, ctx, toolCallId) {
    const session = safeId(ctx.sessionManager?.getSessionId?.() ?? `pid-${process.pid}`);
    const dir = path.join(os.tmpdir(), 'pi-output-diet', session);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${safeId(toolCallId)}.log`);
    fs.writeFileSync(file, text, { mode: 0o600 });
    return file;
  }

  function foldBash(event, ctx) {
    if (isAllowlisted(event.input?.command, state.cfg)) return undefined;
    if (!onlyText(event.content)) return undefined;
    const shown = textOf(event.content);
    const piPath = event.details?.fullOutputPath;
    // Pi already truncated to its tail and saved the whole output: fold that file instead, so the head and
    // any errors Pi dropped come back. Fall back to the truncated text (line numbers then do not match).
    let text = shown;
    let numbered = !piPath;
    if (piPath) {
      try {
        if (fs.statSync(piPath).size <= MAX_FULL_BYTES) { text = fs.readFileSync(piPath, 'utf8'); numbered = true; }
      } catch { /* keep the truncated text */ }
    }
    let fullPath = piPath;
    if (!fold(text, state.cfg, { fullPath: fullPath || '<path>', numbered })) return undefined;
    if (!fullPath) {
      try { fullPath = saveFull(text, ctx, event.toolCallId); } catch { return undefined; } // cannot save: never lose output
    }
    const result = fold(text, state.cfg, { fullPath, numbered });
    if (!result) return undefined;
    state.stats.record('fold', shown.length, result.text.length);
    publish();
    return {
      content: [{ type: 'text', text: result.text }],
      details: { ...(event.details || {}), outputDiet: { kind: 'fold', before: shown.length, after: result.text.length, path: fullPath } },
    };
  }

  function dedupeRead(event, ctx) {
    if (event.isError || !onlyText(event.content)) return undefined;
    const text = textOf(event.content);
    if (text.length < state.cfg.minDedupeChars) return undefined;
    const d = state.tracker.decide(event.input, text, event.toolCallId, liveToolCallIds(ctx));
    if (!d.dedupe) return undefined;
    const note = dedupeNote(d.earlier);
    state.stats.record('dedupe', text.length, note.length);
    publish();
    return {
      content: [{ type: 'text', text: note }],
      details: { ...(event.details || {}), outputDiet: { kind: 'dedupe', before: text.length, after: note.length, path: event.input.path } },
    };
  }

  return {
    state,
    start(ctx) {
      state.cfg = loadConfig({ cwd: ctx.cwd });
      state.tracker.reset();
      let messages = [];
      try { messages = ctx.sessionManager.getBranch().filter((e) => e.type === 'message').map((e) => e.message); } catch { /* new session */ }
      state.stats.restore(messages);
    },
    reloadConfig(ctx) { state.cfg = loadConfig({ cwd: ctx.cwd }); return state.cfg; },
    onToolResult(event, ctx) {
      if (!state.cfg.enabled) return undefined;
      try {
        if (event.toolName === 'bash') return foldBash(event, ctx);
        if (event.toolName === 'read' && state.cfg.dedupeReads) return dedupeRead(event, ctx);
        if ((event.toolName === 'edit' || event.toolName === 'write') && typeof event.input?.path === 'string') state.tracker.invalidatePath(event.input.path);
      } catch { /* never break a tool result */ }
      return undefined;
    },
  };
}

module.exports = { createDiet, liveToolCallIds };
