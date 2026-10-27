# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- `subagent`: a `subagent` tool that runs single, parallel or chained tasks in separate `pi -p` processes, each with its own model, thinking level, tools, skills and extensions. Children start lean (no extensions, skills or MCP unless the agent asks), get a report-size contract, and their reports are capped before reaching the parent. Usage, cost and tool calls are shown per child. Bundled `scout`, `worker` and `reviewer` agents, user (`~/.pi/agent/agents`) and trusted-project (`.pi/agents`) agents, `/agents`, and `/orchestrate`, `/scout`, `/review` prompt templates. Config in `~/.pi/agent/subagent.json`.
- `usage-report`: `/context` (estimated breakdown of the context window next to the provider's real size, with the biggest tool results) and `/cost` (tokens and cost per model on the current branch, plus subagent spend).
- `quick-memory`: a line starting with `# ` in the editor is saved as a bullet in the project or user `AGENTS.md` (asks which) instead of being sent to the model.
- Root `prompts/` folder with `/init`, `/commit` and `/pr` prompt templates (shipped by the root package, `pi.prompts` now includes `./prompts/*.md`); `tests/prompts.test.js` validates every template.
- `/context`, `/cost` and `/agents` open framed panels in the TUI (proportional window bar, per-category bars, cost split, cache-read share, effective agent models) instead of a plain-text notification; print/RPC mode keeps the text. `/context` names subagent calls in its biggest results (`subagent parallel: scout ×2`).
- Demo: the fake provider can script subagent child processes (`child(task)` in a scenario), plus `subagent` and `usage-report` tapes.
- `ask-user`: an `ask_user` tool (Claude Code's AskUserQuestion) that asks 1-4 multiple-choice questions in a TUI picker (single or multi-select, automatic "Other" free text, review tab) and returns compact answers; returns immediately with a "use your default" result in print/JSON/RPC mode; stays available in plan mode. Includes an `ask-user` demo scenario and tape.
- `output-diet`: folds long `bash` results to head, error lines and tail (full output saved to a 0600 temp file, or Pi's own `full_output_path`), replaces repeated identical `read`s with a short note, and `/diet` shows the estimated tokens saved. Config in `~/.pi/agent/output-diet.json`; a project `.pi/output-diet.json` can only tighten. Demo scenario and tape included.
- README: "Pairs well with" section listing Pi packages for what this repo does not cover (web access, MCP, Vim keys, searchable memory, no-LLM compaction, LSP, plan review) and the two that replace parts of it (`pi-subagents`, `pi-code`), with the name collisions found.
- `auto-mode`: per-session decision log (JSONL in the OS temp dir, mode 0600, secrets masked) and `/auto log [n]` to show recent decisions.
- `auto-mode`: `/auto test "<cmd>"` and `/auto test write <path>` dry run showing verdict, matched rule and reason, executing nothing.
- `auto-mode`: branch guard, so `git commit` and `git push` on a protected branch (`protectedBranches`, default `main`/`master`; project config can only add) ask first.
- `plan-mode`: "Edit plan" choice in the approval dialog (opens Pi's editor; the edited plan is what gets approved and seeds todo), compact line diff against the previous submission when a revised plan is re-submitted, and every approved plan is saved to `.pi/plans/<timestamp>.md`.
- `todo`: `/todos done <n>` and `/todos undo <n>` to toggle an item by number; a test and README note confirming the list survives compaction.
- `subagent`: `isolation: "worktree"` (per task or agent) runs a child in its own git worktree and branch; kept with a "changes in branch X at path Y" note when it changed something, removed otherwise.
- `subagent`: `background: true` returns a run id; new `subagent_wait` tool collects, checks or cancels runs; `subagent:finished` is emitted on `pi.events`; background children are killed on session shutdown.
- `subagent`: `maxTurns` per agent (frontmatter and config override), `maxSpawns` per session (default 64), and a live widget listing running children.
- `subagent`: `/security-review [base]` prompt.
- `handoff`: `read_session` tool for the new session to read the parent transcript (compact, filterable with `query`, capped, sessions dir only); the handoff footer points to it instead of raw `read`.
- `handoff`: `--no-review` flag (`/handoff --no-review <goal>`) puts the prompt straight into the new session's input.
- `git-checkpoint`: `/rewind` rows show line stats since each checkpoint (`+A −D, N files`) and a list position.
- `git-checkpoint`: `/rewind diff <n>` shows the stat and a capped patch between checkpoint n and the working tree.
- `git-checkpoint`: `/rewind <n> <path>...` restores only the given paths, with the same preview, confirm and pre-rewind checkpoint.
- `git-checkpoint`: `/rewind` can restore code and conversation together (via Pi's `ctx.navigateTree`).
- `output-diet`: command-aware folders for `git log`/`status`, test runners (pytest, jest, vitest, `node --test`, `go test`, `cargo test`), `tsc`, `eslint`, `npm`/`pnpm`/`yarn`/`pip` installs, `grep -r`/`rg`, `find` and `ls -R`. The generic head/error/tail fold stays as the fallback.
- `output-diet`: `disableFolders` in the user config switches individual folders off; a project `.pi/output-diet.json` can only switch them on (`enableFolders`). `/diet` shows the savings per folder.
- `quality-on-write`: lint lane at end of run (eslint, `ruff check`, `go vet`, `cargo check`), project-local and touched-files-only, with `lint` and per-linter `disable` config.
- `quick-memory`: `/memory` opens the instruction file in the editor, `/memory undo` removes the last note added this session.
- `quick-memory`: notes that look like secrets are refused, and exact duplicate bullets are skipped.
- `usage-report`: `/cost daily` and `/cost monthly` aggregate spend and tokens per day or month and per model across all session files (`--since`, `--project`); `--json` on `/context` and `/cost`; `/context <category>` previews the text of the system prompt, a tool, a context file or the skills.
- `provider-statusline`: git dirty count and ahead/behind next to the branch (`gitStatus`), cache hit % segment (`cacheHit`), live quota reset countdowns including the 5h window, and a `budget` setting that colours the cost segment at 80% and 100%.
- `notify`: skips the notification when the terminal running Pi is focused (macOS frontmost app, tmux focus; `suppressWhenFocused`, default on).
- `notify`: `quietHours` window (may wrap midnight) with no sound or popup; `command` hook (argv array, user config only, `PI_NOTIFY_*` env) for phone push such as ntfy.
- `notify`: pings with an error title when a run ends in an error; `notify-send` delivery on Linux.
- `ask-user`: optional `preview` per option, shown beside or under the picker for the focused option.
- `claude-look`: `claude-light` theme; diff and tool colours follow the active theme.
- `claude-look`: `/claude-look on|compact|off` (compact folds tool output to 1 line and hides the welcome box; off restores Pi's defaults; choice saved in `~/.pi/agent/claude-look.json`).
- `claude-look`: working line `Pondering… 12s · ↓1.2k tokens` while the agent runs.

### Changed

- `handoff`: generation input now includes live state (git branch and status, todo list, plan mode) when available, and `/handoff` works in RPC mode; print and JSON modes still get an error.
- `git-checkpoint`: `/rewind` list rows show line stats instead of "restores N files".
- `output-diet`: with the default allowlist, plain `git log` is now summarised. `git diff` and `git show` stay whole, as do `git log --format=...` and `--stat`. The `git-diff` folder runs only with a custom `allowlist` that omits them.
- `quality-on-write`: end-of-run notifications say "checks" instead of "typecheck".
- `ask-user`: the tool definition grows by about 70 tokens (about 440 total) for the `preview` field.

### Removed

- `vim-editor`: removed in favour of [`pi-vimmode`](https://github.com/pekochan069/pi-vimmode), which has visual modes, operators, Ex commands and macros. Uninstall: drop `extensions/vim-editor/index.ts` from your package filter, or delete `~/.pi/agent/extensions/vim-editor` if you copied the folder.

### Fixed

- `subagent`: plan-mode bypass. When the parent session has neither `write` nor `edit` active (plan mode, `--tools read`), the tool now refuses any agent whose tools are empty (Pi's default set) or include `write`, `edit` or `bash`; only read-only agents such as `scout` run. The bundled `worker` no longer claims that risky commands are blocked when `auto-mode` is not loaded.
- `subagent`: an agent's `maxOutput` is now enforced on the parent side (single, last chain step, parallel), not only requested in the child's prompt.
- `subagent`: UTF-8 characters split across stdout or stderr chunks are no longer corrupted.
- `subagent`: aborting a parallel call no longer starts the tasks still queued.
- `subagent`: children run in their own process group (POSIX) and abort or timeout kills the group, so grandchildren do not linger; a run settles shortly after the child exits instead of waiting for `close`; the timeout message shows seconds under a minute; a nonexistent `cwd` gives a clear error; the Windows PATH fallback starts `pi.cmd`.
- `subagent`: agent frontmatter keeps ` #` in descriptions (`issue #12`), folds `>` and `|` block scalars, and accepts empty frontmatter (`---` / `---`).
- `usage-report`: `/context` uses Pi's own session projection, so old compaction summaries are no longer counted and `context_edit` replacements are honoured.
- `usage-report`: `/cost` includes `usage` session entries (such as `cache_warm`) and branch summary usage.
- `quick-memory`: notes go to the file Pi actually loads (first existing of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`) instead of creating an `AGENTS.md` that shadows `CLAUDE.md`.
- Home-directory expansion (`~`) also accepts the platform path separator in `subagent`, `quick-memory`, `auto-mode` and `quality-on-write`.
- `git-checkpoint`: a same-size edit made in the same second as the last index write could be missing from the checkpoint, so `/rewind` restored the older content. The temporary index copy now keeps the original index mtime, so git's racy-entry check still rehashes such files. This was the intermittent `index.test.js` CI failure.
- Demo sandbox pointed at the old `themes/claude-dark.json` path, so recordings fell back to the default theme.

## [0.1.0] - 2026-10-21

First release as an installable Pi package.

### Added

- Each extension is also a standalone package (`@fadhilmch/pi-<name>`) with its own `package.json`, so a single tool can be installed on its own.
- `claude-look` ships the `claude-dark` theme (moved from `themes/` to `extensions/claude-look/themes/`).
- Theme validation tests for every shipped theme.
- CI workflow, issue and pull request templates, CONTRIBUTING, SECURITY and `.editorconfig`.

### Fixed

- `claude-look`: tool output no longer truncates long lines; they wrap, and `ctrl+o` shows everything. Leading/trailing blank lines are trimmed (no dangling `⎿`). The call line shows only the tool name until its argument has streamed in (no more `Update(.)`).
- `todo`: the tool result is a one-line summary (`1/3 done · ◼ task`) instead of repeating the widget; `ctrl+o` expands to the full list.
- `plan-mode`: the plan is rendered as Markdown, and the approval result is a short wrapped line instead of a truncated one.
- `provider-statusline`: the primary line degrades by priority on narrow terminals (shorter bars, then no bars, then drops 7d, thinking level, ...) so the reset countdown is not cut off.
- `git-checkpoint`: `/rewind` rows show how many files restoring would change now, not the number of files in the snapshot (which was 0 for checkpoints taken before an edit).

### Extensions

- `claude-look`: Claude Code look (bullets, folded tool output, diffs, spinner, welcome box) and the `claude-dark` theme.
- `auto-mode`: rule-based confirmation gate for risky tool calls.
- `plan-mode`: read-only research mode with plan approval.
- `todo`: `todo` tool and live checklist.
- `git-checkpoint`: pre-prompt working-tree snapshots and `/rewind`.
- `handoff`: `/handoff` fresh session from a generated prompt.
- `notify`: desktop or terminal notification when Pi is waiting.
- `quality-on-write`: format and typecheck after edits.
- `provider-statusline`: two-line footer with context bar, quota or cost, cwd, git branch and open PR.
- `vim-editor`: modal Vim keys for the prompt editor.

### Themes

- `claude-dark`, `midnight-aurora`.
