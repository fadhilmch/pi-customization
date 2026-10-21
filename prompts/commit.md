---
description: Draft a commit message from the staged diff and commit after approval
argument-hint: "[hint]"
---
Help me commit the staged changes. Hint from me (may be empty): $@

1. Run `git status --short`, `git diff --cached --stat` and `git diff --cached`. If nothing is staged, say so and stop. Do not stage anything yourself unless I ask.
2. Run `git log -n 15 --format=%s` and match the style you see (capitalization, tense, prefixes such as `feat:` or `Fix:`, length). If the log has no clear style, use a short imperative subject (under 72 characters).
3. Draft the message: a subject line, and a body only if the why is not obvious from the diff (wrap at 72). Describe what changed and why, not a file list. Never mention yourself or add co-author trailers unless the repo's log already uses them.
4. Show me the exact message in a code block and ask whether to commit. Do not run `git commit` yet.
5. Only after I approve (or give edits), commit with that exact message using `git commit -F -` with the message on stdin. Then show `git log -1 --stat`. Never push, amend or use `--no-verify` unless I ask.
