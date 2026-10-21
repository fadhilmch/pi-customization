---
description: Verify, commit, push and open (or update) a PR for the current work, confirming before each irreversible step
argument-hint: "[base branch] [hint]"
---
Ship the current work: verify, commit, push, open a PR. Base branch: ${1:-the repository's default branch}. Hint from me (may be empty): ${@:2}

Same rules as `/commit` and `/pr`, in one flow. Confirm with me before `git commit`, `git push` and `gh pr create`/`gh pr edit`, unless my message already told you to proceed without asking. Never use `--no-verify`, force-push or amend unless I ask.

1. Look. Run `git status --short`, `git branch --show-current`, `git remote -v`. If there is no remote, do the commit steps only and say the push and PR were skipped. If there is nothing to commit and no commits ahead of the base, say so and stop.
2. Find the base: the one I named, else `git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`, else `master`.
3. Verify. Look for the project's check commands (`package.json` scripts, `Makefile`, `pyproject.toml`, CI workflow, AGENTS.md) and run the tests and lint you find. If none are discoverable, say so and continue. If anything fails, show the failure and stop.
4. Branch. If on the base branch, create a feature branch named from the change (short, kebab-case, with a prefix such as `feat/` or `fix/` matching the repo's existing branches). Never commit directly to the base branch.
5. Commit. Stage only files that belong to this change (name them; leave unrelated or untracked scratch files out and tell me). Run `git log -n 15 --format=%s` and write the message in that style: short subject, a body only if the why is not obvious, no co-author trailers unless the log uses them. Show the exact message in a code block and wait for approval, then `git commit -F -`. Skip this step if the work is already committed.
6. Push. Show the branch and remote, then `git push -u origin HEAD`.
7. PR. Gather `git log --format='%h %s%n%b' BASE..HEAD` and `git diff --stat BASE...HEAD` (read the diff selectively if large). Follow the repo's PR template if one exists (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, `docs/`). Write a title under 70 characters in the repo's style, and a description covering what changed and why, how it was tested (only what you saw), and risks or follow-ups.
8. Create. Check `gh auth status`; if `gh` is missing or not signed in, show the title and description for me to paste and stop. Check `gh pr view --json url,state 2>/dev/null` for this branch: if an open PR exists, show the new body and, after approval, update it with `gh pr edit --title ... --body-file -`; otherwise show title and body, and after approval run `gh pr create --base BASE --title ... --body-file -`. Print the PR URL.
