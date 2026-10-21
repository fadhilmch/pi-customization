import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const { buildPrimaryItems, formatWorkspacePath, getProviderKind } = require("./format.js");
const { getSessionCostText } = require("./cost.js");
function loadFresh(relativePath: string) {
  const modulePath = require.resolve(relativePath);
  delete require.cache[modulePath];
  return require(modulePath);
}

const { loadQuotaSnapshot, loadCodexQuota, normalizeHeaderQuota } = loadFresh("./quota.js");
const { formatPullRequestLabel, loadPullRequest } = loadFresh("./git.js");
const { registerHotkeysShortcut } = require("./shortcuts.js");

const REFRESH_MS = 60_000;
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

function fg256(code: number, text: string, bold = true): string {
  return `\u001b[38;5;${code}m${bold ? BOLD : ""}${text}${RESET}`;
}

function pctColor(pct?: number | null): number {
  const value = Number(pct ?? 0);
  if (value < 50) return 76;
  if (value < 80) return 214;
  return 196;
}

function colorPrimaryItem(item: { key: string; text: string; pct?: number | null }): string {
  switch (item.key) {
    case "model":
      return fg256(141, item.text);
    case "thinking":
      return fg256(208, item.text);
    case "context":
    case "fiveHour":
    case "sevenDay":
      return fg256(pctColor(item.pct), item.text);
    case "cost":
      return fg256(item.text.includes("?") ? 196 : 214, item.text);
    case "reset":
      return fg256(244, item.text, false);
    default:
      return fg256(252, item.text);
  }
}

function colorPath(text: string): string {
  return fg256(39, text);
}

function colorBranch(text: string): string {
  return fg256(76, text);
}

function colorPullRequest(text: string): string {
  return fg256(213, text);
}

function getContextPct(ctx: ExtensionContext): number {
  const usage = ctx.getContextUsage();
  const max = ctx.model?.contextWindow ?? 0;
  if (!usage || !max) return 0;
  return Math.max(0, Math.min(100, (usage.tokens / max) * 100));
}

function makePrimaryLine(
  ctx: ExtensionContext,
  responseQuota: ReturnType<typeof normalizeHeaderQuota>,
): string {
  const kind = getProviderKind(ctx.model);
  const quota = kind === "claude" || kind === "codex"
    ? responseQuota ?? loadQuotaSnapshot(kind)
    : null;
  const items = buildPrimaryItems({
    model: ctx.model,
    thinkingLevel: ctx.thinkingLevel,
    contextPct: getContextPct(ctx),
    sessionCostText: getSessionCostText(ctx),
    quota,
  });

  return items.map(colorPrimaryItem).join(` ${DIM}│${RESET} `);
}

function makeSecondaryLine(ctx: ExtensionContext, branch?: string, pullRequest?: { number: number; title: string } | null): string {
  const pathText = colorPath(formatWorkspacePath(ctx.cwd));
  let line = `⌂ ${pathText}`;
  if (branch) line += ` ${DIM}│${RESET} ⎇ ${colorBranch(branch)}`;
  const pullRequestText = formatPullRequestLabel(pullRequest);
  if (pullRequestText) line += ` ${DIM}│${RESET} ${colorPullRequest(pullRequestText)}`;
  return line;
}

export default function providerStatusline(pi: ExtensionAPI) {
  registerHotkeysShortcut(pi);
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let requestRender: (() => void) | undefined;
  let responseQuota: ReturnType<typeof normalizeHeaderQuota> = null;
  let pullRequest: { number: number; title: string; url?: string } | null = null;
  let pullRequestRefresh = 0;

  const rerender = () => requestRender?.();

  async function refreshQuota(ctx: ExtensionContext) {
    if (getProviderKind(ctx.model) !== "codex") return;
    responseQuota = await loadCodexQuota();
    rerender();
  }

  async function refreshPullRequest(ctx: ExtensionContext) {
    const refreshId = ++pullRequestRefresh;
    const nextPullRequest = await loadPullRequest(ctx.cwd);
    if (refreshId !== pullRequestRefresh) return;
    pullRequest = nextPullRequest;
    rerender();
  }

  function mount(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, _theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => {
        pullRequest = null;
        tui.requestRender();
        void refreshPullRequest(ctx);
      });
      requestRender = () => tui.requestRender();

      return {
        dispose() {
          unsubscribe();
          if (requestRender === tui.requestRender) requestRender = undefined;
        },
        invalidate() {
          tui.requestRender();
        },
        render(width: number) {
          const branch = footerData.getGitBranch?.();
          const line1 = truncateToWidth(makePrimaryLine(ctx, responseQuota), width);
          const line2 = truncateToWidth(makeSecondaryLine(ctx, branch, pullRequest), width);
          return [line1, line2];
        },
      };
    });

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      rerender();
      void refreshQuota(ctx);
      void refreshPullRequest(ctx);
    }, REFRESH_MS);
  }

  function cleanup() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = undefined;
    requestRender = undefined;
    pullRequestRefresh++;
    pullRequest = null;
  }

  pi.on("session_start", async (_event, ctx) => {
    responseQuota = null;
    pullRequest = null;
    mount(ctx);
    void refreshQuota(ctx);
    void refreshPullRequest(ctx);
  });

  pi.on("after_provider_response", (event, ctx) => {
    const kind = getProviderKind(ctx.model);
    if (kind !== "claude" && kind !== "codex") return;
    const quota = normalizeHeaderQuota(event.headers);
    if (quota) {
      responseQuota = quota;
      rerender();
    } else if (kind === "codex" && !responseQuota) {
      void refreshQuota(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    cleanup();
    responseQuota = null;
  });

  pi.on("model_select", async (_event, ctx) => {
    responseQuota = null;
    rerender();
    void refreshQuota(ctx);
  });

  for (const eventName of ["model_select", "thinking_level_select", "turn_end", "message_end"] as const) {
    pi.on(eventName, async (_event, _ctx) => {
      rerender();
    });
  }
}
