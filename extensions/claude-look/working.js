'use strict';

// "12s" / "1m 05s" / "1h 02m"
function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

// 950 -> "950", 1234 -> "1.2k", 12345 -> "12k", 1_500_000 -> "1.5m"
function formatTokens(n) {
  if (n < 1000) return String(Math.round(n));
  const f = (v, unit) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
  return n < 1e6 ? f(n / 1e3, 'k') : f(n / 1e6, 'm');
}

// Tracks one agent run: elapsed time and output tokens. Output tokens of finished assistant messages are
// summed; the message still streaming counts its (cumulative) usage.output so far. Providers that report
// no usage until the end make the token part appear only after each message ends.
function createWorking(now = Date.now) {
  let startedAt = null;
  let done = 0;
  let live = 0;
  const outputOf = (message) => {
    const o = message && message.role === 'assistant' && message.usage && message.usage.output;
    return typeof o === 'number' && Number.isFinite(o) && o > 0 ? o : 0;
  };
  return {
    start() { startedAt = now(); done = 0; live = 0; },
    stop() { startedAt = null; },
    active: () => startedAt !== null,
    update(message) { live = Math.max(live, outputOf(message)); },
    end(message) { done += Math.max(live, outputOf(message)); live = 0; },
    tokens: () => done + live,
    // verb already ends with "…", e.g. "Pondering…"
    text(verb) {
      const parts = [formatElapsed(startedAt === null ? 0 : now() - startedAt)];
      if (this.tokens() > 0) parts.push(`↓${formatTokens(this.tokens())} tokens`);
      return `${verb} ${parts.join(' · ')}`;
    },
  };
}

module.exports = { formatElapsed, formatTokens, createWorking };
