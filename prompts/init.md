---
description: Generate or update AGENTS.md for this repository
argument-hint: "[focus]"
---
Create or update `AGENTS.md` at the root of this repository so a coding agent can work here without rediscovering the basics. Extra focus from me (may be empty): $@

1. Recon. If the `subagent` tool is available, use the `scout` agent for this (one task per area, in parallel if the repo is large) so the file reads stay out of this conversation; otherwise read the files yourself. Look at: README and CONTRIBUTING, the manifest and lockfile (package.json, pyproject.toml, Cargo.toml, go.mod, ...), CI config, the Makefile or scripts, the top-level folder layout, and a sample of the source and tests to see the naming and style in use. Also check for existing agent instructions (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) and fold in what is still true.
2. If `AGENTS.md` already exists, read it first. Keep what is accurate, fix what is stale, and do not delete the author's hand-written rules.
3. Write it short and factual. Only things that are true of this repo and that you verified, with exact commands:
   - **Commands**: install, build, test (including how to run one test), lint, format, typecheck, run.
   - **Layout**: the few directories that matter and what lives in each, one line each.
   - **Conventions**: code style, naming, test layout, commit and branch style when it is not obvious.
   - **Gotchas**: things that fail in surprising ways (required env vars, generated files, slow or flaky tests, files not to edit).
4. Leave out generic advice ("write clean code"), long file listings, and anything you could not confirm. Aim for under 60 lines.
5. Show me the final file content and say whether you created or updated it. Do not commit.
