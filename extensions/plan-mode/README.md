# plan-mode

Read-only research mode like Claude Code's plan mode: the model explores, proposes a plan, and you approve it before anything is written.

![plan-mode](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/plan-mode.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/plan-mode ~/.pi/agent/extensions/plan-mode
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/plan-mode/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-plan-mode`. See the [root README](../../README.md#install) for the other methods. Install `todo` too if you want approved plans to seed the todo list.

## Usage

- Toggle: `/plan` (`/plan on|off`), shortcut `ctrl+alt+p`, or start with `--plan`. `shift+tab` is Pi's thinking-level cycle and `f1` is used by provider-statusline, so neither is taken.
- While on: `write`/`edit` are removed from the active tools and blocked in `tool_call`; `bash` is allowed only for read-only commands (`bash.js`: per-command allowlist; rejects redirects, `$()`/backticks, `find -exec/-delete`, `sed -i`, `git commit/add/push/...`, `curl -o/-X/-d`, etc.; anything unknown is blocked).
- Approval via `ctx.ui.select`: **Approve & auto-execute** (plan mode off, normal), **Approve & keep asking** (plan mode off, but each write/edit/non-read-only bash is confirmed until the run ends), **Edit plan** (opens the plan in Pi's editor via `ctx.ui.editor`, then asks again; the edited text is what gets approved, saved and seeded into todo), **Keep planning** (optional feedback prompt; Esc also keeps planning).
- Revised plans: when the model re-submits after **Keep planning**, the dialog shows a compact line diff against the previous submission (changed lines only, capped at 12). The first submission shows no diff.
- Saved plans: every approved plan is written to `.pi/plans/<timestamp>.md` in the project (directory created, existing files never overwritten). If the write fails you get a warning and approval continues.
- Indicator: teal `⏸ plan mode on (ctrl+alt+p or /plan to exit)` widget above the editor, plus `setStatus("plan-mode", ...)`. The status also shows in Pi's default footer and in `provider-statusline`.
- Mode persists as a `plan-mode` session entry (restored on start and `/tree`).

## Config

None.

## How it works

- A hidden `[PLAN MODE ACTIVE]` message tells the model to research and then call `exit_plan_mode` with a markdown plan. The tool is registered inactive and only added in plan mode.
- On approval the plan's numbered steps seed the todo list through `pi.events.emit("todo:set", ...)` (handled by `extensions/todo`; ignored if it is not installed). Also emits `plan-mode:approved` `{ mode, plan, steps }` for other extensions.
- The diff is a plain LCS over lines (`diffLines` in `plan.js`). Files: `bash.js`, `plan.js`, `ansi.js` (pure, tested in `tests/`), `index.ts` wires Pi.

## Limits

The diff compares only consecutive submissions in the current plan-mode session (it resets on approval or when plan mode is toggled), is line-based (a reworded line shows as one removal and one addition), and is shown in the select dialog title, so very long diffs are truncated. `.pi/plans/` is not gitignored automatically. The Edit plan, diff and save flows were unit-tested for logic only; the interactive dialogs were not exercised in a live TUI. Other extension tools that write (MCP etc.) are not blocked. Whether the tool list swap takes effect mid-turn after approval was not verified live.
