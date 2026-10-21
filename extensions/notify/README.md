# notify

Desktop/terminal notification when Pi is waiting for you.

- `agent_settled` (the run is fully done; no retry, compaction or queued follow-up pending): "Ready for input (took 1m 23s)". Skipped when the run was aborted or took less than `minSeconds`.
- `ui_prompt_start` / `ui_prompt_end` (a blocking extension dialog: select, confirm, input, editor, custom): a "Waiting for you: <title>" ping if the dialog is still open after `minSeconds`. Answering earlier cancels it. Pi's built-in tool permission flow is not an extension dialog, so it is not covered unless an extension raises it through `ctx.ui`.

## Delivery

- `auto` (default): macOS uses `osascript` (`display notification` with a sound); other platforms use a terminal escape sequence (OSC 99 on Kitty, OSC 9 on iTerm2, OSC 777 elsewhere, e.g. Ghostty/WezTerm).
- `osascript`: macOS only. Runs through `execFile("osascript", ["-e", script])`, never a shell. User text is stripped of control characters and escaped for AppleScript. If `osascript` is missing it falls back to OSC; no failure ever reaches Pi.
- `osc`: always the terminal escape sequence. `none`: off.

## Config

Optional `~/.pi/agent/notify.json` (re-read on every event, no reload needed):

```json
{ "enabled": true, "minSeconds": 10, "sound": "Tink", "method": "auto" }
```

`sound` is a macOS system sound name (Tink, Basso, Glass, ...); `""` is silent. Names with unusual characters are ignored. Invalid values fall back to the defaults.

## Files

`notify.js` pure helpers (tested), `index.ts` wires Pi events. Tests: `node --test "extensions/notify/tests/*.test.js"`.

## Unverified

Not run in a live Pi session: the exact moment `ui_prompt_start` fires, and OSC delivery inside a particular terminal/tmux.
