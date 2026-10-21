import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const { fitPrimaryItems, formatWorkspacePath, getProviderKind } = require("./format.js");
const { getSessionCostText } = require("./cost.js");
const { loadQuotaSnapshotAsync, loadCodexQuota, normalizeHeaderQuota } = require("./quota.js");
const { formatPullRequestLabel, loadPullRequest } = require("./git.js");
const { loadConfig } = require("./config.js");
const { collectStatuses, fitSegments } = require("./statuses.js");
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

type Config = ReturnType<typeof loadConfig>;
type Quota = ReturnType<typeof normalizeHeaderQuota>;

function makePrimaryLine(ctx: ExtensionContext, config: Config, quota: Quota, width: number): string {
  const kind = getProviderKind(ctx.model);
  const items = fitPrimaryItems(
    {
      model: ctx.model,
      thinkingLevel: ctx.thinkingLevel,
      contextPct: getContextPct(ctx),
      sessionCostText: config.cost ? getSessionCostText(ctx) : "",
      quota: kind === "claude" || kind === "codex" ? quota : null,
      show: config,
    },
    width,
    { measure: visibleWidth },
  );

  return items.map(colorPrimaryItem).join(` ${DIM}│${RESET} `);
}

function makeSecondaryLine(
  ctx: ExtensionContext,
  config: Config,
  width: number,
  branch: string | null | undefined,
  pullRequest: { number: number; title: string } | null,
  statuses: ReadonlyMap<string, string> | undefined,
): string {
  const segments: string[] = [];
  if (config.cwd) segments.push(`⌂ ${colorPath(formatWorkspacePath(ctx.cwd))}`);
  if (config.gitBranch && branch) segments.push(`⎇ ${colorBranch(branch)}`);
  const pullRequestText = config.pullRequest ? formatPullRequestLabel(pullRequest) : "";
  if (pullRequestText) segments.push(colorPullRequest(pullRequestText));
  if (config.extensionStatuses) {
    // Subtle: dim, plain text, appended last so they are the first thing dropped on narrow terminals.
    for (const text of collectStatuses(statuses)) segments.push(`${DIM}${text}${RESET}`);
  }
  return fitSegments(segments, width, {
    sep: ` ${DIM}│${RESET} `,
    measure: visibleWidth,
    cut: (text: string, w: number) => truncateToWidth(text, w),
  });
}

export default function providerStatusline(pi: ExtensionAPI) {
  let config: Config = loadConfig();
  if (config.hotkeysShortcut) registerHotkeysShortcut(pi);

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let requestRender: (() => void) | undefined;
  // Headers from the provider response, or the Codex usage fetch.
  let responseQuota: Quota = null;
  // Optional external JSON file / command, refreshed in the background (never read during render).
  let externalQuota: Quota = null;
  let quotaRefresh = 0;
  let pullRequest: { number: number; title: string; url?: string } | null = null;
  let pullRequestRefresh = 0;

  const rerender = () => requestRender?.();

  async function refreshQuota(ctx: ExtensionContext) {
    const kind = getProviderKind(ctx.model);
    if (!config.quota || (kind !== "claude" && kind !== "codex")) return;
    const refreshId = ++quotaRefresh;
    try {
      const fetched = kind === "codex" && config.codexQuotaFetch ? await loadCodexQuota() : null;
      const external = fetched ? null : await loadQuotaSnapshotAsync(kind);
      if (refreshId !== quotaRefresh) return;
      if (fetched) responseQuota = fetched;
      externalQuota = external;
    } catch {
      // keep whatever we had
    }
    rerender();
  }

  async function refreshPullRequest(ctx: ExtensionContext) {
    const refreshId = ++pullRequestRefresh;
    if (!config.pullRequest) return;
    try {
      const next = await loadPullRequest(ctx.cwd);
      if (refreshId !== pullRequestRefresh) return;
      pullRequest = next;
    } catch {
      pullRequest = null;
    }
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
          const quota = responseQuota ?? externalQuota;
          const lines = [
            truncateToWidth(makePrimaryLine(ctx, config, quota, width), width),
            truncateToWidth(
              makeSecondaryLine(ctx, config, width, branch, pullRequest, footerData.getExtensionStatuses?.()),
              width,
            ),
          ];
          return lines.filter((line) => line.length > 0);
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
    quotaRefresh++;
    pullRequest = null;
  }

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig();
    responseQuota = null;
    externalQuota = null;
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
    externalQuota = null;
  });

  pi.on("model_select", async (_event, ctx) => {
    responseQuota = null;
    externalQuota = null;
    rerender();
    void refreshQuota(ctx);
  });

  for (const eventName of ["thinking_level_select", "turn_end", "message_end"] as const) {
    pi.on(eventName, async (_event, _ctx) => {
      rerender();
    });
  }
}
