const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { formatCountdown } = require('./format.js');

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function runJsonCommand(command) {
  if (!command) return null;
  try {
    const output = execFileSync('/bin/bash', ['-lc', command], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function normalizeQuotaPayload(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') return null;

  const fiveHourPct = numberOrNull(payload.fiveHourPct ?? payload.fiveHour?.usedPct ?? payload.five_hour?.used_percentage);
  const sevenDayPct = numberOrNull(payload.sevenDayPct ?? payload.sevenDay?.usedPct ?? payload.seven_day?.used_percentage);
  const resetAt =
    payload.resetAt ??
    payload.sevenDay?.resetAt ??
    payload.sevenDay?.resetsAt ??
    payload.seven_day?.resets_at ??
    null;

  const resetText = resetAt ? formatCountdown(resetAt, nowMs) : '';
  if (!Number.isFinite(fiveHourPct) && !Number.isFinite(sevenDayPct) && !resetText) return null;
  const fiveHourResetAt = payload.fiveHour?.resetAt ?? payload.fiveHour?.resetsAt ?? payload.five_hour?.resets_at ?? null;
  return { fiveHourPct, sevenDayPct, resetText, resetAtMs: timestampToMs(resetAt), fiveHourResetAtMs: timestampToMs(fiveHourResetAt) };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function utilizationToPercent(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return null;
  return number <= 1 ? number * 100 : number;
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers?.[name] ?? headers?.[name.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeHeaderQuota(headers, nowMs = Date.now()) {
  if (!headers || typeof headers !== 'object') return null;
  const fiveHourPct = utilizationToPercent(firstHeader(headers, [
    'anthropic-ratelimit-unified-5h-utilization',
    'x-ratelimit-5h-utilization',
  ]));
  const sevenDayPct = utilizationToPercent(firstHeader(headers, [
    'anthropic-ratelimit-unified-7d-utilization',
    'x-ratelimit-7d-utilization',
  ]));
  const resetAt = firstHeader(headers, [
    'anthropic-ratelimit-unified-7d-reset',
    'x-ratelimit-7d-reset',
  ]);
  const resetText = resetAt ? formatCountdown(resetAt, nowMs) : '';
  if (!Number.isFinite(fiveHourPct) && !Number.isFinite(sevenDayPct) && !resetText) return null;
  const fiveHourResetAt = firstHeader(headers, [
    'anthropic-ratelimit-unified-5h-reset',
    'x-ratelimit-5h-reset',
  ]);
  return {
    fiveHourPct: Number.isFinite(fiveHourPct) ? fiveHourPct : null,
    sevenDayPct: Number.isFinite(sevenDayPct) ? sevenDayPct : null,
    resetText,
    resetAtMs: timestampToMs(resetAt),
    fiveHourResetAtMs: timestampToMs(fiveHourResetAt),
  };
}

function timestampToMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCodexWindow(window, nowMs) {
  if (!window || typeof window !== 'object') return null;

  let usedPct = numberOrNull(window.used_percent ?? window.usedPercent);
  if (!Number.isFinite(usedPct)) {
    const percentLeft = numberOrNull(window.percent_left ?? window.percentLeft);
    if (Number.isFinite(percentLeft)) usedPct = 100 - percentLeft;
  }
  if (Number.isFinite(usedPct)) usedPct = Math.max(0, Math.min(100, usedPct));

  let resetAt = timestampToMs(window.reset_at ?? window.resetAt ?? window.reset_time_ms ?? window.resetTimeMs);
  const resetAfter = numberOrNull(window.reset_after_seconds ?? window.resetAfterSeconds);
  if (!Number.isFinite(resetAt) && Number.isFinite(resetAfter)) resetAt = nowMs + resetAfter * 1000;

  const resetText = Number.isFinite(resetAt) ? formatCountdown(resetAt, nowMs) : '';
  if (!Number.isFinite(usedPct) && !resetText) return null;
  return {
    usedPct: Number.isFinite(usedPct) ? usedPct : null,
    resetText,
    resetAtMs: Number.isFinite(resetAt) ? resetAt : null,
    durationSeconds: numberOrNull(window.limit_window_seconds ?? window.limitWindowSeconds),
  };
}

function normalizeCodexUsage(payload, nowMs = Date.now()) {
  const rateLimit = payload?.rate_limit ?? payload?.rate_limits;
  if (!rateLimit || typeof rateLimit !== 'object') return null;

  const slots = { fiveHour: null, sevenDay: null };
  const assign = (window, preferredSlot) => {
    const normalized = normalizeCodexWindow(window, nowMs);
    if (!normalized) return;
    let slot = preferredSlot;
    if (!slot) {
      slot = Number.isFinite(normalized.durationSeconds) && normalized.durationSeconds >= 172800
        ? 'sevenDay'
        : 'fiveHour';
    }
    if (!slots[slot]) slots[slot] = normalized;
  };

  assign(rateLimit.five_hour, 'fiveHour');
  assign(rateLimit.weekly, 'sevenDay');
  assign(rateLimit.primary_window, null);
  assign(rateLimit.secondary_window, null);
  assign(rateLimit.primary, null);
  assign(rateLimit.secondary, null);

  if (!slots.fiveHour && !slots.sevenDay) return null;
  const resetWindow = slots.sevenDay ?? slots.fiveHour;
  return {
    fiveHourPct: slots.fiveHour?.usedPct ?? null,
    sevenDayPct: slots.sevenDay?.usedPct ?? null,
    resetText: resetWindow?.resetText ?? '',
    resetAtMs: resetWindow?.resetAtMs ?? null,
    fiveHourResetAtMs: slots.fiveHour?.resetAtMs ?? null,
  };
}

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

function readCodexAuth() {
  const candidates = [
    process.env.PI_STATUSLINE_CODEX_AUTH_FILE,
    path.join(os.homedir(), '.pi', 'agent', 'auth.json'),
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'auth.json') : null,
    path.join(os.homedir(), '.codex', 'auth.json'),
  ].filter(Boolean);

  for (const filePath of candidates) {
    const auth = readJsonFile(filePath);
    const credentials = auth?.['openai-codex'] ?? auth?.tokens ?? auth;
    const accessToken = credentials?.access ?? credentials?.access_token;
    if (accessToken) {
      return {
        accessToken,
        accountId: credentials.accountId ?? credentials.account_id,
      };
    }
  }
  return null;
}

async function loadCodexQuota(nowMs = Date.now()) {
  const auth = readCodexAuth();
  if (!auth) return null;
  const url = process.env.PI_STATUSLINE_CODEX_USAGE_URL || CODEX_USAGE_URL;
  if (!isSafeUsageUrl(url)) return null; // never send the token over plain http to a remote host

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      url,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: 'application/json',
          'ChatGPT-Account-Id': auth.accountId || '',
          'OpenAI-Beta': 'codex-1',
          originator: 'codex_cli_rs',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    return normalizeCodexUsage(await response.json(), nowMs);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isSafeUsageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

function quotaSources(kind) {
  const upper = kind.toUpperCase();
  return {
    command: process.env[`PI_STATUSLINE_${upper}_USAGE_CMD`],
    filePath: process.env[`PI_STATUSLINE_${upper}_USAGE_FILE`] || path.join(os.homedir(), '.pi', 'agent', 'provider-statusline', `${kind}.json`),
  };
}

// Non-blocking variant used by the footer: never stalls rendering on a slow command.
function runJsonCommandAsync(command) {
  if (!command) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/bin/bash', ['-lc', command], { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function loadQuotaSnapshotAsync(kind, nowMs = Date.now()) {
  const { command, filePath } = quotaSources(kind);
  const payload = (await runJsonCommandAsync(command)) || readJsonFile(filePath);
  return normalizeQuotaPayload(payload, nowMs);
}

function loadQuotaSnapshot(kind, nowMs = Date.now()) {
  const { command, filePath } = quotaSources(kind);
  const payload = runJsonCommand(command) || readJsonFile(filePath);
  return normalizeQuotaPayload(payload, nowMs);
}

module.exports = {
  loadQuotaSnapshot,
  loadQuotaSnapshotAsync,
  isSafeUsageUrl,
  readCodexAuth,
  normalizeHeaderQuota,
  loadCodexQuota,
  normalizeCodexUsage,
};
