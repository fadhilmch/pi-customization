# Demo recordings

Reproducible screenshots and GIFs of the extensions running in real Pi, without calling any paid model.
Output goes to `docs/media/`.

## Regenerate

```sh
brew install vhs          # pulls ttyd; also needs ffmpeg (brew install ffmpeg)
brew install gifsicle     # optional, shrinks the GIFs
demo/record.sh            # all tapes
demo/record.sh hero todo  # just some
```

Requirements: `vhs`, `pi` on `PATH` (tested with Pi 1.3.0), `ffmpeg`, macOS or Linux, and the
"MesloLGS Nerd Font Mono" font (falls back to Menlo/monospace; glyphs such as the tool-result corner
and the todo boxes need a font that has them). Run from anywhere; the script `cd`s to the repo root.
No network is used.

## How it works

- `provider/index.ts` is a demo-only Pi provider (`--provider demo --model demo`) that replays scripted
  assistant turns: streamed text, thinking, tool calls (`bash`, `read`, `edit`, `write`, `todo`,
  `exit_plan_mode`) with small delays. `PI_DEMO_SCENARIO` picks `provider/scenarios/<name>.js`;
  `PI_DEMO_SPEED=2` plays twice as fast. Tools run for real, only the model is fake.
- `lib/env.sh <scenario> [extension...]` builds a sandbox in `/tmp/pi-demo.XXXXXX`: a fake `$HOME`,
  its own `PI_CODING_AGENT_DIR` (settings.json: theme `claude-dark`, hidden thinking, the demo provider
  and only the listed extensions), a git-initialised copy of `sample-project/` as the cwd, and
  `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1`. Your real `~/.pi` is never read or written.
  Per-scenario extras live in `lib/extras/<scenario>.sh`.
- `tapes/*.tape` are VHS scripts (shared look in `tapes/_common.tape`: about 100x30 cells, Catppuccin Mocha).
  Each hides the sandbox setup, starts Pi, types the prompt and takes PNG key frames.
- `sample-project/` is a tiny JS lib with one failing test (`slugify` does not collapse separators).

## Media

| Tape | Output | Extensions |
|---|---|---|
| `hero` | `hero.gif/png` | claude-look, provider-statusline, todo |
| `claude-look` | `claude-look.gif/png`, `claude-look-expanded.png` (ctrl+o) | claude-look |
| `auto-mode` | `auto-mode.gif/png`, `auto-mode-after.png` | auto-mode |
| `plan-mode` | `plan-mode.gif/png`, `plan-mode-approved.png` | plan-mode, todo |
| `todo` | `todo.gif/png` | todo |
| `git-checkpoint` | `git-checkpoint.gif/png`, `-confirm.png`, `-restored.png` | git-checkpoint |
| `handoff` | `handoff.gif/png`, `handoff-end.png` | handoff |
| `quality-on-write` | `quality-on-write.gif/png`, `-expanded.png` | quality-on-write |
| `provider-statusline` | `provider-statusline.gif/png` | provider-statusline (quota bars from a fixture file) |
| `subagent` | `subagent.gif/png`, `subagent-running.png`, `subagent-expanded.png` | subagent, claude-look (children are real `pi -p` processes on the demo provider) |
| `usage-report` | `usage-report.gif`, `usage-report-context.png`, `usage-report-cost.png`, `subagent-agents.png` | subagent, usage-report, claude-look (a subagent session, then `/context`, `/cost`, `/agents`) |
| `ask-user` | `ask-user.gif/png`, `ask-user-picker.png` | ask-user, claude-look (answers one question, types an "Other" answer) |
| `bg-shell` | `bg-shell.gif/png`, `bg-shell-stopped.png` (tape included, not yet recorded) | bg-shell, claude-look (starts a background job, opens `/jobs`, then stops it) |
| `web` | `web.gif/png` (tape included, not yet recorded) | web, claude-look (fetches the public Microsoft Agent Framework overview; requires network access) |
| `notebook` | `notebook.gif/png` (tape included, not yet recorded) | notebook, claude-look (reads the sample notebook and edits one cell) |
| `output-diet` | `output-diet.gif/png` | output-diet, claude-look (a 2000-line log folded, a repeated read deduped, then `/diet`) |
| `vim-editor` | `vim-editor.gif/png`, `vim-editor-insert.png` | provider-statusline (Vim editor lives here for now) |

`notify` is not recorded (a macOS notification cannot be captured in the terminal). The `web` tape needs network access. The web search tool is absent unless a provider key is configured, so its keyed request is not recorded.

## Caveats

- quality-on-write: prettier/biome are not installed offline, so the demo points `.js` at
  `lib/mini-format`, a ~50 line stand-in, through the extension's own user-config `formatters` override.
  Typecheck feedback is not demonstrated (needs a project-local `tsc`).
- provider-statusline: quota bars only render for claude/codex providers, so that tape registers the
  demo model as `openai-codex` (footer reads "Codex Demo Model") and feeds a fake quota file.
- Timing depends on the machine; if a PNG catches an intermediate state, adjust the `Sleep` before its `Screenshot`.
