# pi-customization

Extensions and themes that make the [Pi coding agent](https://pi.dev) feel like Claude Code: the same look, an auto mode that only asks before risky actions, plan mode, a todo list, rewind checkpoints, notifications, and format/typecheck after edits.

Everything ships as one Pi package (see `docs/packages.md` in your Pi install, or the [package gallery](https://pi.dev/packages)). Install all of it, or pick only the parts you want.

## Install

```bash
pi install git:github.com/fadhilmch/pi-customization
```

Then pick the theme in `/settings`, or set it in `~/.pi/agent/settings.json`:

```json
{ "theme": "claude-dark", "hideThinkingBlock": true }
```

Run `/reload` in a running session to pick up changes.

### Install only some extensions

Package filters narrow what loads. For example, everything except the custom footer:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/*/index.ts", "!extensions/provider-statusline/index.ts"]
    }
  ]
}
```

Or a single extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/auto-mode/index.ts"],
      "themes": []
    }
  ]
}
```

## What's inside

| Extension | What it does | Commands and keys |
|---|---|---|
| [`claude-look`](extensions/claude-look/) | `⏺` bullets, `⏺ Bash(cmd)` tool lines with `⎿` output folded to 3 lines, red/green diff backgrounds, a teal `· ✢ ✳ ✶ ✻ ✽` spinner, welcome box. Pair with the `claude-dark` theme. | `ctrl+o` expands tool output |
| [`auto-mode`](extensions/auto-mode/) | Pi runs tools without asking. This adds a rule-based gate: safe calls run silently; risky ones ask (force push, `rm -rf`, `sudo`, deploys, secrets, writes outside the project). Catastrophic commands are always blocked. | `/auto` · `ctrl+alt+a` cycles auto → ask → off |
| [`plan-mode`](extensions/plan-mode/) | Read-only research mode. The model explores, then proposes a plan for you to approve. Approval seeds the todo list. | `/plan` · `ctrl+alt+p` · `pi --plan` |
| [`todo`](extensions/todo/) | A `todo` tool for multi-step work, shown above the editor as `☒ ◼ ☐`. | `/todos` · `/todos clear` |
| [`git-checkpoint`](extensions/git-checkpoint/) | Snapshots the working tree (including untracked files) before each prompt, without touching your index, stash or branches. Restore is undoable. | `/rewind` · `/rewind clean` |
| [`handoff`](extensions/handoff/) | Writes a focused prompt from the current session and starts a fresh one with it, instead of lossy compaction. | `/handoff <goal>` |
| [`notify`](extensions/notify/) | Desktop or terminal notification when Pi is waiting for you after a long run. | config: `~/.pi/agent/notify.json` |
| [`quality-on-write`](extensions/quality-on-write/) | Formats files after edits with the project's own formatter, then typechecks touched files and sends errors back to the model. | config: `~/.pi/agent/quality.json` |
| [`provider-statusline`](extensions/provider-statusline/) | Two-line footer: model, thinking level, context bar, quota or cost, folder and git branch. Replaces Pi's footer. | `f1` shortcut help |

Themes: `claude-dark` (Claude Code's dark palette) and `midnight-aurora` (neon pink/teal/lime).

Each extension's README has the details and limits.

## Safety notes

- **Project config can only tighten rules.** `auto-mode` and `quality-on-write` read an optional `.pi/*.json` in the project. A cloned repo can add ask/deny rules or turn features off, but it can't allow commands or define commands to run.
- **auto-mode is a guard, not a sandbox.** It uses pattern matching, and a determined model could get past it. Use containers for untrusted work.
- **Review before installing.** Extensions run with your user's permissions, so read the source of any package first, this one included.

## Development

```bash
git clone https://github.com/fadhilmch/pi-customization
cd pi-customization
npm test
```

To develop locally, point Pi at your clone instead of the git source:

```json
{ "packages": ["/path/to/pi-customization"] }
```

Extensions are TypeScript entry points (`index.ts`) that wire small CommonJS helpers. The helpers hold the logic and are unit-tested with `node:test`. Pi supplies `@earendil-works/*` and `typebox` at runtime.

Quota snapshots for the statusline are local-only. Keep them in `*.local.json` files (git-ignored) and never commit credentials.

## License

MIT
