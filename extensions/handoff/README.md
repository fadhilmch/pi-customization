# handoff

`/handoff <goal>` is a lossless alternative to compaction: instead of squashing the conversation, it asks the current model to write a self-contained prompt for the next task, lets you edit it, then starts a new session with that prompt as a draft.

![handoff](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/handoff.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/handoff ~/.pi/agent/extensions/handoff
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/handoff/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-handoff`. See the [root README](../../README.md#install) for the other methods.

## Usage

```
/handoff now implement this for teams as well
/handoff            (prompts for the goal)
/handoff --no-review now implement this for teams as well
```

`--no-review` (first token) skips the editor and puts the generated prompt straight into the new session's input, still unsent.

1. Serializes the current branch (respecting the latest compaction), adds a short live-state block, and asks the model for context, relevant files and the next task.
2. A loader shows progress; Esc aborts.
3. The result opens in an editor titled with line/char counts. Submit to continue, close/empty to cancel. Nothing changes until you submit.
4. A new session is created (linked via `parentSession`) with the prompt in the input box; press Enter to send.

The new session also gets a `read_session` tool: `path` (optional, defaults to the parent session), `query` (case-insensitive filter) and `limit` (messages, newest kept; default 40, max 200). It returns user and assistant text, one line per tool call and the first 3 lines of each tool result, capped at about 20 KB.

## Config

None.

## How it works

Live state added to the generation input (each piece skipped silently when unavailable): git branch and `git status --porcelain` (first 15 lines), the todo list, and whether plan mode is active. Todos and plan mode are read from the session branch (the `todo` tool results / `todo-state` entries and `plan-mode` entries those extensions write); nothing is imported from them. The footer tells the new session to use `read_session` instead of raw `read` on the JSONL.

`read_session` only opens `.jsonl` files inside the Pi sessions directory (this session's dir, `PI_CODING_AGENT_SESSION_DIR`, or `~/.pi/agent/sessions`), or the linked parent session. Symlinks are resolved before the check.

Polish over the Pi example: goal prompt when omitted, model errors reported instead of only logged, empty-output guard, and a footer pointing at the previous session file so the new session can read the full transcript if the summary missed something. Files: `handoff.js` and `session.js` (pure, tested), `index.ts` wires Pi.

## Limits

Needs a selected model and a UI: interactive (TUI) mode, or RPC mode where dialogs and `set_editor_text` are supported (no progress loader there, and not tested against a live RPC client). Print and JSON modes have no UI, so `/handoff` stops with an error. Costs one model call. `read_session` cannot read other sessions' files outside the sessions directory, and a very long session is shown newest-first-kept, not in full; the git/todo/plan-mode snapshot is a point-in-time summary.
