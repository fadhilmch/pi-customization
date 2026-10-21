# plan-mode

Read-only research mode like Claude Code's plan mode.

- Toggle: `/plan` (`/plan on|off`), shortcut `ctrl+alt+p`, or start with `--plan`. `shift+tab` is Pi's thinking-level cycle and `f1` is used by provider-statusline, so neither is taken.
- While on: `write`/`edit` are removed from the active tools and blocked in `tool_call`; `bash` is allowed only for read-only commands (`bash.js`: per-command allowlist; rejects redirects, `$()`/backticks, `find -exec/-delete`, `sed -i`, `git commit/add/push/...`, `curl -o/-X/-d`, etc.; anything unknown is blocked).
- A hidden `[PLAN MODE ACTIVE]` message tells the model to research and then call `exit_plan_mode` with a markdown plan. The tool is registered inactive and only added in plan mode.
- Approval via `ctx.ui.select`: **Approve & auto-execute** (plan mode off, normal), **Approve & keep asking** (plan mode off, but each write/edit/non-read-only bash is confirmed until the run ends), **Keep planning** (optional feedback prompt; Esc also keeps planning).
- On approval the plan's numbered steps seed the todo list through `pi.events.emit("todo:set", ...)` (handled by `extensions/todo`; ignored if it is not installed). Also emits `plan-mode:approved` `{ mode, plan, steps }` for other extensions.
- Indicator: teal `⏸ plan mode on (ctrl+alt+p or /plan to exit)` widget above the editor, plus `setStatus("plan-mode", ...)`. provider-statusline's custom footer does not render extension statuses, so the widget is what you see.
- Mode persists as a `plan-mode` session entry (restored on start and `/tree`).

Files: `bash.js`, `plan.js`, `ansi.js` (pure, tested in `tests/`), `index.ts` wires Pi.

Limits: other extension tools that write (MCP etc.) are not blocked; whether the tool list swap takes effect mid-turn after approval was not verified live.
