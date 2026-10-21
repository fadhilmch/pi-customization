# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Each extension is also a standalone package (`@fadhilmch/pi-<name>`) with its own `package.json`, so a single tool can be installed on its own.
- `claude-look` ships the `claude-dark` theme (moved from `themes/` to `extensions/claude-look/themes/`).
- Theme validation tests for every shipped theme.
- CI workflow, issue and pull request templates, CONTRIBUTING, SECURITY and `.editorconfig`.

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
