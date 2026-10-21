# vim-editor

Lightweight Vim-style modal editing for Pi's prompt input.

![](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/vim-editor.gif)

## Install

Whole package, only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/vim-editor/index.ts"]
    }
  ]
}
```

Single folder:

```bash
npx degit fadhilmch/pi-customization/extensions/vim-editor ~/.pi/agent/extensions/vim-editor
```

## Usage

The prompt starts in `INSERT` mode. An `INSERT` / `NORMAL` label is drawn at the end of the editor's last line.

| Key | Action |
| --- | --- |
| `Esc` (in INSERT) | enter NORMAL mode |
| `i` | enter INSERT mode |
| `a` | enter INSERT mode after the cursor |
| `h` `j` `k` `l` | left / down / up / right |
| `0` / `$` | start / end of line |
| `x` | delete the character under the cursor |
| `Esc` (in NORMAL) | Pi's normal Esc behavior (abort / clear) |

Control keys (Enter, Ctrl+..., arrows) keep working in NORMAL mode; other printable keys are ignored there.
For full Vim, use `Ctrl+G` to open `$VISUAL` / `$EDITOR`.

## Config

None.

## How it works

On `session_start` it calls `ctx.ui.setEditorComponent()` with a `CustomEditor` subclass. In NORMAL mode it translates the keys above into the equivalent cursor/edit escape sequences and forwards everything else to the stock editor.

## Limits

- Only the keys above: no operators, motions, registers, visual mode or undo.
- Replaces the editor component, so it conflicts with any other extension that also calls `setEditorComponent` (the last one loaded wins).
- Interactive UI only (no effect in print/RPC mode without a UI).
