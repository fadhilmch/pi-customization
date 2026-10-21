# provider-statusline

Two-line Pi footer inspired by the Claude Code status line: model, context, quota, cost, cwd, branch, PR and other extensions' status indicators.

![](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/provider-statusline.gif)

## Install

Whole package, only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/provider-statusline/index.ts"]
    }
  ]
}
```

Single folder:

```bash
npx degit fadhilmch/pi-customization/extensions/provider-statusline ~/.pi/agent/extensions/provider-statusline
```

Reload with `/reload`.

## Usage

Top line:

- provider symbol and model name (`◉ Claude Opus 4.5`, `✳ Codex GPT-5`, ...)
- thinking level
- context usage bar
- Claude/Codex session (`5h`) and weekly (`7d`) quota bars when known, otherwise the session cost

Bottom line, separated by `│`:

- working directory
- git branch
- open pull request for the branch (`↗ PR #42 title`), when `gh` can resolve one
- statuses set by other extensions via `ctx.ui.setStatus()`, dim, sorted by key

Example bottom line with the auto-mode and plan-mode extensions active:

```
⌂ ~/code/app │ ⎇ feature/x │ ↗ PR #42 Add retry │ ⏵⏵ auto mode │ ⏸ plan mode
```

On narrow terminals whole segments are dropped from the right (statuses first, then the PR), and the first segment is cut with an ellipsis as a last resort.

F1 fills the editor with `/hotkeys`, so you can press Enter to list the current shortcuts (including extension shortcuts and your custom keybindings).

## Config

Create `~/.pi/agent/statusline.json` (or point `PI_STATUSLINE_CONFIG` at another file). Every key is a boolean and defaults to `true`; missing, unknown or malformed values fall back to the default. The file is read on session start (`/reload` to apply changes).

```json
{
  "providerSymbol": true,
  "contextBar": true,
  "quota": true,
  "cost": true,
  "cwd": true,
  "gitBranch": true,
  "pullRequest": true,
  "extensionStatuses": true,
  "codexQuotaFetch": true,
  "hotkeysShortcut": true
}
```

| Key | Effect when `false` | Env override |
| --- | --- | --- |
| `providerSymbol` | no `◉ ✳ ✦ ◆` mark before the model name | `PI_STATUSLINE_PROVIDER_SYMBOL` |
| `contextBar` | hide `Ctx ████░░░░ 42%` | `PI_STATUSLINE_CONTEXT_BAR` |
| `quota` | hide 5h/7d bars and do no quota lookups at all | `PI_STATUSLINE_QUOTA` |
| `cost` | never show session cost | `PI_STATUSLINE_COST` |
| `cwd` | hide the working directory | `PI_STATUSLINE_CWD` |
| `gitBranch` | hide the branch | `PI_STATUSLINE_GIT_BRANCH` |
| `pullRequest` | never run `gh` | `PI_STATUSLINE_PULL_REQUEST` |
| `extensionStatuses` | hide other extensions' status text | `PI_STATUSLINE_EXTENSION_STATUSES` |
| `codexQuotaFetch` | no network call for Codex quota (see below) | `PI_STATUSLINE_CODEX_QUOTA_FETCH` |
| `hotkeysShortcut` | do not register F1 | `PI_STATUSLINE_HOTKEYS_SHORTCUT` |

Env values `0/false/off/no` and `1/true/on/yes` are accepted. Precedence: env, then file, then defaults. `hotkeysShortcut` is read when the extension loads.

## Quota data

- Claude: read from `anthropic-ratelimit-unified-*` headers on provider responses. No extra requests.
- Codex: fetched from ChatGPT's usage endpoint (see "Privacy" below), at startup, on model change, and every 60 seconds.
- Fallbacks for either provider (also used when the above give nothing): a JSON file at `~/.pi/agent/provider-statusline/{claude,codex}.json` (override with `PI_STATUSLINE_CLAUDE_USAGE_FILE` / `PI_STATUSLINE_CODEX_USAGE_FILE`) or a command printing JSON (`PI_STATUSLINE_CLAUDE_USAGE_CMD` / `PI_STATUSLINE_CODEX_USAGE_CMD`, run through `bash -lc` with a 5 s timeout, in the background).

```json
{
  "fiveHour": { "usedPct": 31 },
  "sevenDay": { "usedPct": 72, "resetAt": "2026-09-24T02:00:00Z" }
}
```

Flat `{ "fiveHourPct": 31, "sevenDayPct": 72, "resetAt": "..." }` also works.

### Privacy: what the Codex quota fetch reads and sends

Only when the active model's provider is `openai-codex` and `codexQuotaFetch` is not disabled:

- Reads: the first Codex access token (and account id) found in `$PI_STATUSLINE_CODEX_AUTH_FILE`, `~/.pi/agent/auth.json` (the `openai-codex` entry), `$CODEX_HOME/auth.json`, or `~/.codex/auth.json`. The token is never written anywhere or logged.
- Sends: one `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer <token>` and `ChatGPT-Account-Id` headers, 5 s timeout, repeated every 60 s. Nothing else (no prompts, no file contents) is sent. The URL can be overridden with `PI_STATUSLINE_CODEX_USAGE_URL`; the token is only sent to `https://` URLs (or `http://` on localhost).
- It is an internal, undocumented endpoint and may change or stop working. Set `codexQuotaFetch` to `false` (or `PI_STATUSLINE_CODEX_QUOTA_FETCH=0`) to disable it entirely.

## How it works

- Replaces the footer with `ctx.ui.setFooter()`; branch comes from `footerData.getGitBranch()` and statuses from `footerData.getExtensionStatuses()`, so the footer re-renders when they change.
- The PR label comes from `gh pr view`, run asynchronously at start, on branch change and every 60 s; the result is cached between runs. Nothing blocks rendering or startup.
- Quota files/commands are also read in the background; the render path only reads cached values.
- Missing `gh` (stops retrying), not a git repo, not logged in, no Codex auth or a network failure simply hide the corresponding segment.

## Limits

- Cost shown is computed from Pi's usage data; for models without pricing it shows `?`.
- The PR segment needs GitHub CLI (`gh`) authenticated for the repo; only open PRs are shown.
- Codex quota depends on an unofficial endpoint (see above). Claude quota only appears after the first response that carries rate-limit headers (or via the file/command fallback).
- Status text from other extensions is shown without its original colors.
- Replaces Pi's default footer entirely; it conflicts with any other extension that calls `setFooter`.
- The Vim editor that used to live here is now the separate `vim-editor` extension.

## Tests

```bash
node --test "extensions/provider-statusline/tests/*.test.js"
```
