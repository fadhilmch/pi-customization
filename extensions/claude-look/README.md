# claude-look

Gives Pi a Claude-Code-like look: `⏺` bullets, folded tool output, red/green diffs, a spinner with elapsed time and token count, and a welcome box. Ships the `claude-dark` and `claude-light` themes. Does not touch the footer.

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

For a light terminal use `claude-light` (Claude Code's light palette):

```json
{ "theme": "claude-light", "hideThinkingBlock": true }
```

Run `/reload` in a running session. See the [root README](../../README.md#install) for the other install methods.

## Usage

`ctrl+o` expands folded tool output.

`/claude-look on|compact|off` switches the look (no argument shows the current mode):

- `on`: everything described below.
- `compact`: tool output folds to 1 line (instead of 3; an edit diff to 1 row) and the welcome box is hidden.
- `off`: Pi's own spinner, labels, header, markdown and tool renderers. The extension stays loaded; the theme is separate (`/settings`).

## What you get

- Working line while the agent runs: `Pondering… 12s · ↓1.2k tokens` (verb, elapsed time, output tokens so far), updated every second and gone when idle. Tokens come from the `usage.output` of each assistant message as it streams plus finished messages of the run. If a provider reports usage only at the end of a message, the token part shows up after each message instead of live, and until any usage arrives it is elapsed time only.
- Spinner `· ✢ ✳ ✶ ✻ ✽` (ping-pong, teal `#53e0e0` so it is distinct from Claude Code's orange, 120ms) and a rotating verb per turn ("Pondering…").
- Hidden-thinking label `✻ Thinking…`.
- Markdown transformer: `⏺ ` before the first line of assistant text, `❯ ` before user text (a bare `>` would become a blockquote, and Pi shows `\>` escapes literally). Headings, lists, tables, quotes and code fences are left untouched.
- Tool renderer (`renderShell: "self"`) for bash, read, edit, write, grep, find, ls: `⏺ Name(arg)` then `  ⎿  ` result lines, collapsed to 3 source lines plus `… +N lines (ctrl+o to expand)`. Long lines wrap (never truncate), so `ctrl+o` shows everything. Edit shows Pi's diff with green/red line backgrounds. Other tools fall back to `next()`.
- Header: rounded orange welcome box with cwd.
- Theme `claude-light` (`themes/claude-light.json`): same keys as `claude-dark`, Claude Code's light palette (orange `#d77757` accent, black text, `#5769f7` links/code, dark green/red diffs).
- Theme `claude-dark` (`themes/claude-dark.json`): orange `#d77757` accent, neutral greys, lavender links/code, and terminal-default (`""`) tool backgrounds so tool output is not boxed. Tests validate the colour keys against Pi's theme schema.

## Config

The mode is stored in `~/.pi/agent/claude-look.json` (`{ "mode": "on" | "compact" | "off" }`, under `PI_CODING_AGENT_DIR` if set), written by `/claude-look`. Default `on`. There is no project config. To remove the look entirely, set `"theme"` to another theme (for example `midnight-aurora` from the root package) and remove the extension, then `/reload`.

## How it works

`ansi.js`, `spinner.js`, `markdown.js`, `header.js`, `tools.js`, `working.js` (elapsed and token text), `mode.js` (on/compact/off state) and `config.js` are pure helpers (tested in `tests/`). `index.ts` wires them to Pi. The markdown transformer and tool renderer are registered once and check the mode each time they run, because Pi has no way to unregister them; that is how `off` works without `/reload`. The header, spinner and labels are set or reset through `ctx.ui`. Preview without Pi:

```bash
node extensions/claude-look/scripts/preview.mjs [after|before] [width]
```

## Limits

- Bullet colour: dim while the call has not started or is streaming, green on success, red on `isError`. Pi re-renders the call line when the result arrives, but this was not verified live.
- After `/claude-look`, tool calls and messages already on screen keep their old look (Pi resolves a tool's renderer when it is drawn); new ones follow the mode. `/reload` or a new session redraws everything.
- `compact` shows light-theme text with the same fixed result colours as `on` (grey for output); the diff backgrounds are dark in both themes.
- Edit diff parsing assumes Pi's display diff lines start with `+`, `-` or a space.
- Not done: rounded input-box editor (see `vim-editor` for the modal editor) and a todo widget (see `todo`).
- The working line and `/claude-look` were not run in a live interactive Pi session; only unit tests with a fake `ui` and a command-registration check over RPC.
- Never run in a live Pi session by the author; only unit tests, a headless import check and a command-registration check over RPC.
