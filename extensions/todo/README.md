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

- `/todos` shows the list, `/todos clear` empties it.
- `todo` tool: the model sends the whole list each call (`todos: [{ content, status: pending|in_progress|completed, activeForm? }]`). The description tells it to use the tool for 3+ step work, keep exactly one task `in_progress`, and mark tasks completed immediately. Several `in_progress` items are accepted with a warning; bad input returns an error result.
- Widget above the editor: `  ☒ done` (dim, strikethrough), `  ◼ doing` (bold, teal glyph), `  ☐ pending`. Shown during a turn, hidden after the turn when the list is empty or all done. Lists over 12 rows fold completed rows first.
- Tool rendering matches claude-look: `⏺ Update Todos` then `  ⎿  ` rows.
- Other extensions can replace the list with `pi.events.emit("todo:set", { items: ["step", ...] })` (strings or `{content, status?, activeForm?}`; first item becomes in_progress). plan-mode does this on approval.

## Config

None.

## How it works

State is rebuilt from the current branch (last `todo` tool result or `todo-state` entry), so it survives reload and follows branching. Files: `state.js`, `render.js`, `ansi.js` (pure, tested in `tests/`), `index.ts` wires Pi. Needs `typebox` and `@earendil-works/pi-ai` as provided by Pi.

## Limits

Not verified in a live Pi session: widget placement/redraw timing and the self-rendered tool rows.
