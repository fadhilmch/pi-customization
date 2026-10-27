# quick-memory

Type a line that starts with `# ` in Pi's editor and it is saved as a bullet in an instructions file instead of being sent to the model, like Claude Code's `#` shortcut.

Why: a rule you repeat every session ("use pnpm", "tests live in `spec/`") belongs in `AGENTS.md`, which Pi loads into every session. Opening the file, finding the right place and typing it is enough friction that people skip it. This makes it one line. Saving makes no model call.

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

- **Project**: the instruction file in the current directory
- **User**: the instruction file in Pi's agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`)

Pi reads only the first of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` that exists in a directory, so the note goes to that same file. `AGENTS.md` is created only when none of them exists.

The file is created if missing, the note is added as `- note`, and a notification says where it went. Escape cancels and puts your text back in the editor. Pi reads `AGENTS.md` on the next session start or `/reload`.

Example session (picker layout is illustrative):

```text
> # tests run with make check, not npm test
  Remember: tests run with make check, not npm test
  > Project  ./AGENTS.md
    User     ~/.pi/agent/AGENTS.md
Added to ./AGENTS.md: tests run with make check, not npm test
```

The file then ends with `- tests run with make check, not npm test`. In a new file the bullets go under a `## Notes` heading; in an existing file the bullet is appended after the last line (joining a trailing bullet list, otherwise after a blank line). Whitespace inside the note is collapsed to single spaces.

### `/memory`

`/memory` asks Project or User (same files as above), opens that file in Pi's editor dialog and saves what you change. Closing the dialog or leaving the text unchanged saves nothing. `/memory undo` removes the last note this extension appended in the current session, but only if that exact `- note` line is still in the file; if you edited or removed it, nothing is touched and you are told. Repeating `/memory undo` walks back through earlier notes of the session.

### Checks before saving

- **Secrets.** A note that looks like a credential is refused with an error notification and your text goes back into the editor. Patterns: AWS access keys, GitHub tokens (`ghp_`, `gho_`, `github_pat_`, ...), Slack `xox*` tokens, private key headers, `sk-` style API keys, and long random-looking values after `password=`, `token=`, `secret=` or `api_key=` (16+ characters, letters and digits, high entropy). The list lives in `secrets.js`.
- **Duplicates.** A note identical to an existing bullet (`-`, `*` or `+`, whitespace collapsed) is not added again; you get an "Already in ..." notification.

Not treated as a note: `## headings`, `#hashtag`, text that merely contains `#`, and multi-line input (so pasted markdown is sent as usual).

## Config

None. (Both checks are always on.)

## How it works

An `input` handler (`index.ts`) checks the text with `parseNote` and, for a note, asks with `ctx.ui.select`, appends with `saveNote` and returns `handled` so the model never sees it. `findSecret` (`secrets.js`) runs first, `saveNote` skips exact duplicates and returns the line it wrote, which the extension keeps in a per-session list for `/memory undo` (`undoNote` removes the last matching line). `/memory` uses `pi.registerCommand`, `ctx.ui.select` and `ctx.ui.editor`. `memory.js` and `secrets.js` are pure and tested.

Safety and cost: the only thing written is the text you typed, to one of two fixed paths. Nothing is read from the repo and no command runs. Every note you add is sent with every prompt in later sessions, so a long list costs tokens on every turn (about 1 token per 4 characters); keep notes short and prune the file. A project `AGENTS.md` is a normal repo file, so it can be committed and shared with your team; use the User choice for personal preferences.

## Limits

- Works only for text typed in the terminal UI. In print, JSON and RPC modes, and for messages from other extensions, `# ...` is sent as an ordinary prompt.
- Prompts with attached images are never intercepted.
- Notes are appended at the end of the file; edit it by hand to organise them. A new file starts with a `## Notes` heading.
- The project file is looked up in the directory Pi was started in, not the git root. If that directory has only a `CLAUDE.md`, notes go into it; a new `AGENTS.md` is created only when no candidate exists.
- The duplicate check is exact (after whitespace collapsing); a reworded note is added. Undo only knows notes added in the current session, not after a restart, and only while the line is unchanged.
- The secret check is a pattern list, not a scanner: it misses unusual formats and can refuse a harmless note that looks like a key. Type the rule without the value, or use `/memory` to edit the file directly (the editor path does not run the secret check).
- A one-line prompt that really starts with `# ` (a markdown heading) is taken as a note; write `#` after a word or use `##` to avoid it.
- Tested with unit tests only (note parsing, file creation and appending, secret patterns, duplicates, undo, with an injected file system, and the `input` handler and `/memory` command against a fake Pi). The interactive `#` input hook and the `/memory` editor dialog have not been checked in a live TUI session, so whether Pi hands the extension the editor text exactly as typed, and how the picker looks, is unverified.
