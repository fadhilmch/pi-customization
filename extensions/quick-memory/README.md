# quick-memory

Type a line that starts with `# ` in Pi's editor and it is saved as a bullet in an instructions file instead of being sent to the model, like Claude Code's `#` shortcut.

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/quick-memory ~/.pi/agent/extensions/quick-memory
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/quick-memory/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-quick-memory`. See the [root README](../../README.md#install) for the other methods.

## Usage

```
# always use pnpm, never npm
```

A picker asks where to save it:

- **Project**: `AGENTS.md` in the current directory
- **User**: `AGENTS.md` in Pi's agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`)

The file is created if missing, the note is added as `- note`, and a notification says where it went. Escape cancels and puts your text back in the editor. Pi reads `AGENTS.md` on the next session start or `/reload`.

Not treated as a note: `## headings`, `#hashtag`, text that merely contains `#`, and multi-line input (so pasted markdown is sent as usual).

## Config

None.

## How it works

An `input` handler (`index.ts`) checks the text with `parseNote` and, for a note, asks with `ctx.ui.select`, appends with `saveNote` and returns `handled` so the model never sees it. `memory.js` is pure and tested.

## Limits

- Works only for text typed in the terminal UI. In print, JSON and RPC modes, and for messages from other extensions, `# ...` is sent as an ordinary prompt.
- Prompts with attached images are never intercepted.
- Notes are appended at the end of the file; edit it by hand to organise them. A new file starts with a `## Notes` heading.
- A one-line prompt that really starts with `# ` (a markdown heading) is taken as a note; write `#` after a word or use `##` to avoid it.
