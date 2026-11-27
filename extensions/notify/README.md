# notify

Desktop or terminal notification when Pi is waiting for you after a long run or a failed one, with optional focus suppression, quiet hours and a command hook (for example a phone push).

_No recording: the notification appears outside the terminal (macOS Notification Center, Linux `notify-send`, or your terminal's own notification via OSC 9/99/777)._

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/notify ~/.pi/agent/extensions/notify
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/notify/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-notify`. See the [root README](../../README.md#install) for the other methods.

## Usage

Nothing to run. Notifications fire on:

- `agent_settled` (the run is fully done; no retry, compaction or queued follow-up pending): "Ready for input (took 1m 23s)". Skipped when the run was aborted or took less than `minSeconds`.
- `ui_prompt_start` / `ui_prompt_end` (a blocking extension dialog: select, confirm, input, editor, custom): a "Waiting for you: <title>" ping if the dialog is still open after `minSeconds`. Answering earlier cancels it. Pi's built-in tool permission flow is not an extension dialog, so it is not covered unless an extension raises it through `ctx.ui`.
- A run whose last assistant turn ended with an error (seen on `agent_end`, reported at `agent_settled`): title `Pi - <project> - error`, body "Run ended with an error (after 1m 5s): <message>". Not subject to `minSeconds`; skipped when aborted. A retry that succeeds clears it.

Any of these is skipped when the terminal running Pi is focused (see `suppressWhenFocused`).

## Config

Optional `~/.pi/agent/notify.json` (re-read on every event, no reload needed):

```json
{
  "enabled": true,
  "minSeconds": 10,
  "sound": "Tink",
  "method": "auto",
  "suppressWhenFocused": true,
  "quietHours": { "start": "22:00", "end": "07:00" },
  "command": ["sh", "-c", "curl -s -H \"Title: $PI_NOTIFY_TITLE\" -d \"$PI_NOTIFY_MESSAGE\" https://ntfy.sh/my-topic"]
}
```

`sound` is a macOS system sound name (Tink, Basso, Glass, ...); `""` is silent. Names with unusual characters are ignored. Invalid values fall back to the defaults.

`method`:

- `auto` (default): macOS uses `osascript` (`display notification` with a sound); Linux uses `notify-send` when a session bus is visible (`DISPLAY`, `WAYLAND_DISPLAY` or `DBUS_SESSION_BUS_ADDRESS`), falling back to the terminal sequence if it is missing or fails; other platforms use a terminal escape sequence (OSC 99 on Kitty, OSC 9 on iTerm2, OSC 777 elsewhere, e.g. Ghostty/WezTerm).
- `osascript`: macOS only. Runs through `execFile("osascript", ["-e", script])`, never a shell. User text is stripped of control characters and escaped for AppleScript. If `osascript` is missing it falls back to OSC; no failure ever reaches Pi.
- `notify-send`: Linux only, `execFile("notify-send", ["--app-name=Pi", "--", title, body])`; any failure falls back to OSC. No sound.
- `osc`: always the terminal escape sequence.
- `none`: off.

`suppressWhenFocused` (default `true`): skip the notification, including `command`, when the terminal running Pi is focused. Best effort, and it only ever suppresses when it is sure:

- macOS (not in tmux): the frontmost app, read with `osascript` and System Events, must match the terminal named by `TERM_PROGRAM` (Terminal, iTerm2, Ghostty, WezTerm, Hyper, alacritty, VS Code) or `KITTY_WINDOW_ID` (kitty). macOS may ask once to let your terminal control System Events; if refused, nothing is suppressed. Other terminals (for example Warp) are never suppressed.
- tmux (`TMUX` set): the pane and its window must be active, the session attached, and the client report `focused`, which tmux only does with `set -g focus-events on`. Without focus events nothing is suppressed. Over tmux on macOS the tmux answer is used alone.
- Anything else, any error, or a probe slower than 1.5 s: not focused, notify as usual.

`quietHours` (`"HH:MM"` 24h local time, may wrap midnight; `start` equal to `end` or a bad value disables it): inside the window there is no sound, no desktop popup and no terminal OSC sequence. `command` still runs, with `PI_NOTIFY_QUIET=1`, because it is your own remote channel; check that variable in your script if you want it silent too.

`command` (argv array, never a shell string): run for every notification that is not focus-suppressed, detached with stdio ignored and a 10 s timeout, so it cannot block Pi. Environment: `PI_NOTIFY_TITLE`, `PI_NOTIFY_MESSAGE`, `PI_NOTIFY_EVENT` (`settled`, `error` or `prompt`), `PI_NOTIFY_QUIET` (`0` or `1`). Values are stripped of control characters. Pi runs the argv directly, with no shell; the example uses `sh -c` itself, so the quoted string is yours and the values reach it only as environment variables (not interpolated into the command text). Only `~/.pi/agent/notify.json` is read; a project cannot set it.

## How it works

`notify.js` pure helpers (config, quiet hours, delivery, command hook; tested), `focus.js` the focus probe (tested with a fake `execFile`), `index.ts` wires Pi events. Tests: `node --test "extensions/notify/tests/*.test.js"`.

## Limits

Not run in a live Pi session: the exact moment `ui_prompt_start` fires, OSC delivery inside a particular terminal/tmux, focus detection in real terminals, and `notify-send` on a real Linux desktop. Error detection relies on the last assistant message of `agent_end` having `stopReason: "error"`.
