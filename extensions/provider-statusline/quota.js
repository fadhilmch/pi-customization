const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  return { fiveHourPct, sevenDayPct, resetText };
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
  return {
    fiveHourPct: Number.isFinite(fiveHourPct) ? fiveHourPct : null,
    sevenDayPct: Number.isFinite(sevenDayPct) ? sevenDayPct : null,
    resetText,
  };
}

function loadQuotaSnapshot(kind, nowMs = Date.now()) {
  const upper = kind.toUpperCase();
  const command = process.env[`PI_STATUSLINE_${upper}_USAGE_CMD`];
  const filePath = process.env[`PI_STATUSLINE_${upper}_USAGE_FILE`] || path.join(os.homedir(), '.pi', 'agent', 'provider-statusline', `${kind}.json`);
  const payload = runJsonCommand(command) || readJsonFile(filePath);
  return normalizeQuotaPayload(payload, nowMs);
}

module.exports = {
  loadQuotaSnapshot,
  normalizeHeaderQuota,
};
