# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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

## [0.1.0]

First release as an installable Pi package.

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
