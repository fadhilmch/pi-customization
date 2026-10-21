# claude-look

Gives Pi a Claude-Code-like look: `⏺` bullets, folded tool output, red/green diffs, a spinner and a welcome box. Ships the `claude-dark` theme. Does not touch the footer.

![claude-look](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/claude-look.gif)

## Install

Only this tool, by copying its folder (the theme comes with it):

```bash
npx degit fadhilmch/pi-customization/extensions/claude-look ~/.pi/agent/extensions/claude-look
```

From the whole package, loading only this extension and its theme:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/claude-look/index.ts"],
      "themes": ["extensions/claude-look/themes/claude-dark.json"]
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-claude-look`.

Then select the theme in `/settings`, or set it in `~/.pi/agent/settings.json`:

```json
{ "theme": "claude-dark", "hideThinkingBlock": true }
```

Run `/reload` in a running session. See the [root README](../../README.md#install) for the other install methods.

## Usage

Nothing to run. `ctrl+o` expands folded tool output.

## What you get

- Spinner `· ✢ ✳ ✶ ✻ ✽` (ping-pong, teal `#53e0e0` so it is distinct from Claude Code's orange, 120ms) and a rotating verb per turn ("Pondering…").
- Hidden-thinking label `✻ Thinking…`.
- Markdown transformer: `⏺ ` before the first line of assistant text, `❯ ` before user text (a bare `>` would become a blockquote, and Pi shows `\>` escapes literally). Headings, lists, tables, quotes and code fences are left untouched.
- Tool renderer (`renderShell: "self"`) for bash, read, edit, write, grep, find, ls: `⏺ Name(arg)` then `  ⎿  ` result lines, collapsed to 3 lines plus `… +N lines (ctrl+o to expand)`. Edit shows Pi's diff with green/red line backgrounds. Other tools fall back to `next()`.
- Header: rounded orange welcome box with cwd.
- Theme `claude-dark` (`themes/claude-dark.json`): orange `#d77757` accent, neutral greys, lavender links/code, and terminal-default (`""`) tool backgrounds so tool output is not boxed. Tests validate the colour keys against Pi's theme schema.

## Config

None. To revert, set `"theme"` to another theme (for example `midnight-aurora` from the root package) and remove the extension, then `/reload`.

## How it works

`ansi.js`, `spinner.js`, `markdown.js`, `header.js`, `tools.js` are pure helpers (tested in `tests/`). `index.ts` wires them to Pi. Preview without Pi:

```bash
node extensions/claude-look/scripts/preview.mjs [after|before] [width]
```

## Limits

- Bullet colour: dim while the call has not started or is streaming, green on success, red on `isError`. Pi re-renders the call line when the result arrives, but this was not verified live.
- Edit diff parsing assumes Pi's display diff lines start with `+`, `-` or a space.
- Not done: rounded input-box editor (see `vim-editor` for the modal editor) and a todo widget (see `todo`).
- Never run in a live Pi session by the author; only unit tests, a headless import check and a command-registration check over RPC.
