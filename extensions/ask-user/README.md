# ask-user

Claude Code's `AskUserQuestion` for Pi: an `ask_user` tool the model calls to ask you 1 to 4 multiple-choice questions at once, answered in a TUI picker, instead of guessing and being redone.

![ask-user](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/ask-user.gif)

Why: a wrong guess on scope, a library or a naming choice costs a whole round of edits and tool output. One question with options costs a few hundred tokens and one keypress. It is most useful in plan mode and before large changes.

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/ask-user ~/.pi/agent/extensions/ask-user
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/ask-user/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-ask-user`. See the [root README](../../README.md#install) for the other methods.

## Usage

There is no command; the model decides when to ask. The tool call:

```json
{ "questions": [
  { "question": "How far should the slugify fix go?", "header": "Scope",
    "options": [
      { "label": "Collapse separators (Recommended)", "description": "Only merge repeated dashes and spaces" },
      { "label": "Also trim edges", "description": "Collapse and strip leading/trailing separators" } ] },
  { "question": "Which checks?", "header": "Checks", "multiSelect": true,
    "options": [ { "label": "Unit tests", "description": "node test.js" }, { "label": "Lint", "description": "eslint ." } ] }
] }
```

What you see: `⏺ AskUser(Scope +1)`, then a picker with a tab per question and a final review tab. Every question also gets `Other (type your own)`.

| Key | Action |
|---|---|
| `↑` `↓` | move between choices |
| `Enter` | select (single-select) or confirm (multi-select), then go to the next question |
| `Space` | tick a choice in multi-select |
| `←` `→` / `Tab` | switch question or the review tab |
| `Enter` on Other | type a free-text answer; `Enter` confirms, `Esc` goes back |
| `Esc` | dismiss everything |

What the model gets back, for example:

```
User answers:
Scope: Also trim edges
Checks: Unit tests, Other: add a Windows run
```

and in the transcript `  ⎿  Scope: Also trim edges` rows. If you press `Esc` the model is told you declined and continues on its own judgement.

Limits the tool enforces (with a clear error result when violated): 1-4 questions, 2-4 options each, unique labels, unique headers of at most 12 characters, labels of at most 60 characters, no option named "Other".

## Config

Optional user config in `~/.pi/agent/ask-user.json`:

```json
{ "exposure": "direct" }
```

Set `exposure` to `"deferred"` to discover `ask_user` through `tool_search` when needed. The default is `direct`.

## How it works

`validate.js` checks input, `picker.js` is a pure state machine plus line renderer (so it is unit-tested without a terminal), `answers.js` formats the compact result text, `render.js` draws the claude-look rows, `ask.js` ties them together with an injected picker, `index.ts` wires Pi (`ctx.ui.custom`, key mapping). `ansi.js` is a copy of the claude-look helpers.

The tool definition (description, parameter schema, prompt snippet and guideline) is paid on every active turn. Use `/context` to see its estimated size.

Without an interactive TUI (`pi -p`, `--mode json`, `--mode rpc`, or `ctx.hasUI` false) the tool returns at once with a result telling the model the user cannot be asked and to proceed with the recommended option or a sensible default and state the assumption. It never waits.

Plan mode: [`plan-mode`](../plan-mode/) only removes `write` and `edit` while planning, so `ask_user` (read-only) stays available. A test in plan-mode pins this.

## Limits

- Models only use it as well as the short guideline persuades them; nothing forces a model to ask.
- RPC clients get the non-UI fallback; there is no RPC dialog version of the picker.
- With `auto-mode` in `ask` mode, unknown tools such as this one may trigger an approval prompt before the picker opens.
- Verified in real Pi with the demo fake model (picker, single choice, typed Other, result rows) and in print, JSON and RPC modes. Not verified with a real model, and not checked in terminals without the Kitty keyboard protocol beyond the basics (arrows, Enter, Esc, typing).
