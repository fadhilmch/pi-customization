# todo

Claude-Code-style todo list for Pi: a `todo` tool for multi-step work, shown above the editor as `☒ ◼ ☐`.

![todo](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/todo.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/todo ~/.pi/agent/extensions/todo
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/todo/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-todo`. See the [root README](../../README.md#install) for the other methods.

## Usage

- `/todos` shows the list, `/todos clear` empties it, `/todos done <n>` marks item number `n` (1-based, as listed) completed, `/todos undo <n>` sets it back to pending.
- `todo` tool: the model sends the whole list each call (`todos: [{ content, status: pending|in_progress|completed, activeForm? }]`). The description tells it to use the tool for 3+ step work, keep exactly one task `in_progress`, and mark tasks completed immediately. Several `in_progress` items are accepted with a warning; bad input returns an error result.
- Widget above the editor: `  ☒ done` (dim, strikethrough), `  ◼ doing` (bold, teal glyph), `  ☐ pending`. The tool result itself is one line (`⎿  1/3 done · ◼ Write fix`) so the list is not printed twice; ctrl+o expands it to every item. Shown during a turn, hidden after the turn when the list is empty or all done. Lists over 12 rows fold completed rows first.
- Tool rendering matches claude-look: `⏺ Update Todos` then `  ⎿  ` rows.
- Other extensions can replace the list with `pi.events.emit("todo:set", { items: ["step", ...] })` (strings or `{content, status?, activeForm?}`; first item becomes in_progress). plan-mode does this on approval.

## Config

None.

## How it works

State is rebuilt from the current branch (last `todo` tool result or `todo-state` entry), so it survives reload and follows branching. It also survives compaction: Pi's compaction never deletes session entries, and `getBranch()` returns the whole path including entries before the compaction (covered by a test), so the widget and `/todos` keep the list. Manual `/todos done|undo|clear` edits are saved as `todo-state` entries. Files: `state.js`, `render.js`, `ansi.js` (pure, tested in `tests/`), `index.ts` wires Pi. Needs `typebox` and `@earendil-works/pi-ai` as provided by Pi.

## Limits

After a compaction the model's own context may only have the summary, so it can lose sight of the list until it calls `todo` again (which needs the full list); the widget still shows it. Not verified in a live Pi session: widget placement/redraw timing and the self-rendered tool rows.
