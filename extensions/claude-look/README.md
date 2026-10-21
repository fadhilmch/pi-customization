# claude-look

Gives Pi a Claude-Code-like look. Pairs with `themes/claude-dark.json`. Does not touch the footer/statusline.

- Spinner `· ✢ ✳ ✶ ✻ ✽` (ping-pong, teal `#53e0e0` so it is distinct from Claude Code's orange, 120ms) and a rotating verb per turn ("Pondering…").
- Hidden-thinking label `✻ Thinking…`.
- Markdown transformer: `⏺ ` before the first line of assistant text, `❯ ` before user text (a bare `>` would become a blockquote, and Pi shows `\>` escapes literally). Headings, lists, tables, quotes and code fences are left untouched.
- Tool renderer (`renderShell: "self"`) for bash, read, edit, write, grep, find, ls: `⏺ Name(arg)` then `  ⎿  ` result lines, collapsed to 3 lines plus `… +N lines (ctrl+o to expand)`. Edit shows Pi's diff with green/red line backgrounds. Other tools fall back to `next()`.
- Header: rounded orange welcome box with cwd.

## Layout

`ansi.js`, `spinner.js`, `markdown.js`, `header.js`, `tools.js` are pure helpers (tested in `tests/`). `index.ts` wires them to Pi.

## Preview

```bash
node extensions/claude-look/scripts/preview.mjs [after|before] [width]
```

## Limits

- Bullet colour: dim while the call has not started or is streaming, green on success, red on `isError`. Pi re-renders the call line when the result arrives, but this was not verified live.
- Edit diff parsing assumes Pi's display diff lines start with `+`, `-` or a space.
- Not done: rounded input-box editor (vim-editor.ts is risky) and a todo widget.
- Never run in a live Pi session by the author; only unit tests and a headless import check.

## Revert

Set `"theme": "midnight-aurora"` and remove the `claude-look/index.ts` entry from `extensions` in `~/.pi/agent/settings.json`, then `/reload`.
