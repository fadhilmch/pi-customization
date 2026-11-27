'use strict';
// Tool-call classifier: (toolName, input, {cwd, home, mode, config, env}) -> decision
//   decision = { action: 'allow' | 'ask' | 'deny', reason, severity, signatures, findings }
const os = require('node:os');
const path = require('node:path');
const { classifyBash, checkWritePath, checkReadPath, mk } = require('./bash-rules.js');
const { parseShell } = require('./shell.js');
const P = require('./paths.js');
const { emptyConfig } = require('./config.js');

const WRITE_TOOLS = new Set(['write', 'edit']);
const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);
const SHELL_TOOLS = new Set(['bash', 'powershell']);

const PS_RISK = [
  [/Remove-Item\b[^|;]*-Recurse/i, 'Remove-Item -Recurse'],
  [/\b(iex|Invoke-Expression)\b/i, 'Invoke-Expression'],
  [/Set-ExecutionPolicy/i, 'Set-ExecutionPolicy'],
  [/\b(Stop-Computer|Restart-Computer)\b/i, 'shutdown/restart'],
  [/\b(Stop-Process)\b[^|;]*-Force/i, 'Stop-Process -Force'],
];
const PS_CATASTROPHIC = /\b(Format-Volume|Clear-Disk|Remove-Partition)\b/i;
const SENSITIVE_NAME_HINT = /(^|[\\/*])(\.env|\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|credentials|\.netrc|\.npmrc|\.pypirc)|\*\.(pem|key)$|\.(pem|key)$/i;

function summarize(findings) {
  const reasons = [];
  for (const f of findings) if (!reasons.includes(f.reason)) reasons.push(f.reason);
  return reasons.join('; ');
}

function ask(findings) {
  return {
    action: 'ask',
    reason: summarize(findings),
    severity: findings.some((f) => f.severity === 'high') ? 'high' : 'normal',
    signatures: findings.map((f) => f.signature),
    findings,
  };
}
const allow = () => ({ action: 'allow', reason: '', severity: 'normal', signatures: [], findings: [] });
const deny = (reasons) => ({ action: 'deny', reason: reasons.join('; '), severity: 'high', signatures: [], findings: [] });

function configMatches(list, text) {
  return (list || []).find((r) => r.re.test(text));
}

function allSegmentsAllowed(command, config) {
  if (!config.allow || !config.allow.length) return false;
  const parsed = parseShell(command);
  if (parsed.uncertain.length || !parsed.segments.length) return false;
  return parsed.segments.every((s) => config.allow.some((a) => a.re.test(s.raw.trim())));
}

function classifyToolCall(toolName, input, opts = {}) {
  const home = opts.home || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const mode = opts.mode || 'auto';
  const config = opts.config || emptyConfig();
  const ctx = { cwd, home, env: opts.env || process.env, config, tmpRoots: opts.tmpRoots, currentBranch: opts.currentBranch, protectedBranches: config.protectedBranches };
  const inp = input || {};

  // ---- shell tools ----
  if (SHELL_TOOLS.has(toolName)) {
    const command = String(inp.command == null ? '' : inp.command);
    const r = classifyBash(command, ctx);
    const denies = r.denies.map((d) => d.reason);
    if (toolName === 'powershell' && PS_CATASTROPHIC.test(command)) denies.push('disk formatting command');
    if (denies.length) return deny(denies);
    if (mode === 'off') return allow();
    let findings = r.findings;
    if (toolName === 'powershell') {
      for (const [re, label] of PS_RISK) if (re.test(command)) findings = findings.concat(mk('powershell-risk', label, label));
    }
    if (mode === 'ask') {
      if (!findings.length && allSegmentsAllowed(command, config)) return allow();
      const why = findings.length ? summarize(findings) : 'ask mode: confirm every command';
      return Object.assign(ask([mk('ask-mode', why, `cmd:${command}`, findings.some((f) => f.severity === 'high') ? 'high' : 'normal')]), { findings });
    }
    return findings.length ? ask(findings) : allow();
  }

  // ---- file mutation ----
  if (WRITE_TOOLS.has(toolName)) {
    const p = inp.path || inp.file_path;
    if (!p) return mode === 'ask' ? ask([mk('ask-mode', `ask mode: ${toolName} without path`, `${toolName}:?`)]) : allow();
    const abs = P.resolvePath(String(p), cwd, home);
    const text = `${toolName} ${abs}`;
    const d = configMatches(config.deny, text);
    if (d) return deny([`matches deny rule /${d.source}/`]);
    if (mode === 'off') return allow();
    const findings = [];
    const f = checkWritePath(String(p), Object.assign({ cwdReal: P.realish(path.resolve(cwd)), tmpRoots: ctx.tmpRoots || P.tmpRoots() }, ctx), toolName === 'edit' ? 'editing' : 'writing');
    if (f) findings.push(f);
    const a = configMatches(config.ask, text);
    if (a) findings.push(mk('config-ask', `matches ask rule /${a.source}/`, a.source));
    const allowed = configMatches(config.allow, text);
    if (mode === 'ask') {
      if (allowed && !findings.length) return allow();
      const why = findings.length ? summarize(findings) : `ask mode: confirm ${toolName}`;
      return ask([mk('ask-mode', why, `${toolName}:${abs}`, findings.some((x) => x.severity === 'high') ? 'high' : 'normal')]);
    }
    if (allowed && !findings.some((x) => x.id === 'config-ask')) return allow();
    return findings.length ? ask(findings) : allow();
  }

  // ---- read-only tools ----
  if (READ_TOOLS.has(toolName)) {
    const candidates = [];
    if (inp.path) candidates.push(String(inp.path));
    const findings = [];
    for (const c of candidates) {
      const abs = P.resolvePath(c, cwd, home);
      const d = configMatches(config.deny, `${toolName} ${abs}`);
      if (d) return deny([`matches deny rule /${d.source}/`]);
      if (mode === 'off') continue;
      const f = checkReadPath(c, Object.assign({ cwd, home }, ctx), toolName === 'read' ? 'reading' : `${toolName} on`, true);
      if (f) findings.push(f);
      const a = configMatches(config.ask, `${toolName} ${abs}`);
      if (a) findings.push(mk('config-ask', `matches ask rule /${a.source}/`, a.source));
    }
    if (mode !== 'off') {
      const hint = toolName === 'grep' ? inp.glob : toolName === 'find' ? inp.pattern : null;
      if (hint && SENSITIVE_NAME_HINT.test(String(hint))) findings.push(mk('sensitive-read', `${toolName} targeting secret files (${hint})`, `${toolName}:${hint}`));
    }
    return findings.length ? ask(findings) : allow();
  }

  // ---- everything else (MCP / custom tools) ----
  const text = `${toolName} ${safeJson(inp)}`;
  const d = configMatches(config.deny, text);
  if (d) return deny([`matches deny rule /${d.source}/`]);
  if (mode === 'off') return allow();
  const a = configMatches(config.ask, text);
  if (a) return ask([mk('config-ask', `matches ask rule /${a.source}/`, a.source)]);
  if (mode === 'ask' && !configMatches(config.allow, text)) return ask([mk('ask-mode', `ask mode: tool "${toolName}"`, `tool:${toolName}`)]);
  return allow();
}

function safeJson(v) {
  try { return JSON.stringify(v).slice(0, 2000); } catch { return ''; }
}

module.exports = { classifyToolCall };
