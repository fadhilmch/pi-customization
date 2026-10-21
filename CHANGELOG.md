# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- `subagent`: a `subagent` tool that runs single, parallel or chained tasks in separate `pi -p` processes, each with its own model, thinking level, tools, skills and extensions. Children start lean (no extensions, skills or MCP unless the agent asks), get a report-size contract, and their reports are capped before reaching the parent. Usage, cost and tool calls are shown per child. Bundled `scout`, `worker` and `reviewer` agents, user (`~/.pi/agent/agents`) and trusted-project (`.pi/agents`) agents, `/agents`, and `/orchestrate`, `/scout`, `/review` prompt templates. Config in `~/.pi/agent/subagent.json`.
- `usage-report`: `/context` (estimated breakdown of the context window next to the provider's real size, with the biggest tool results) and `/cost` (tokens and cost per model on the current branch, plus subagent spend).
- `quick-memory`: a line starting with `# ` in the editor is saved as a bullet in the project or user `AGENTS.md` (asks which) instead of being sent to the model.
- Root `prompts/` folder with `/init`, `/commit` and `/pr` prompt templates (shipped by the root package, `pi.prompts` now includes `./prompts/*.md`); `tests/prompts.test.js` validates every template.
- The root package now ships prompt templates (`extensions/*/prompts/*.md`).
- `/context`, `/cost` and `/agents` open framed panels in the TUI (proportional window bar, per-category bars, cost split, cache-read share, effective agent models) instead of a plain-text notification; print/RPC mode keeps the text. `/context` names subagent calls in its biggest results (`subagent parallel: scout ×2`).
- Demo: the fake provider can script subagent child processes (`child(task)` in a scenario), plus `subagent` and `usage-report` tapes.
- `ask-user`: an `ask_user` tool (Claude Code's AskUserQuestion) that asks 1-4 multiple-choice questions in a TUI picker (single or multi-select, automatic "Other" free text, review tab) and returns compact answers; returns immediately with a "use your default" result in print/JSON/RPC mode; stays available in plan mode. Includes an `ask-user` demo scenario and tape.

### Fixed

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
