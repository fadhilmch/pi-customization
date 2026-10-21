---
description: Draft a PR title and description from the branch diff (does not create the PR)
argument-hint: "[base branch]"
---
Draft a pull request for the current branch. Base branch: ${1:-the repository's default branch}.

1. Find the base. If I did not name one, use the remote default (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`, else `master`). Run `git fetch` only if I ask; compare against the local ref.
2. Gather: `git branch --show-current`, `git log --format='%h %s%n%b' BASE..HEAD`, `git diff --stat BASE...HEAD` and `git diff BASE...HEAD`. If the diff is large, read the stat first and the important files selectively (or delegate to the `scout` subagent if the tool is available). If there are no commits ahead of the base, say so and stop.
3. Check for a PR template (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, `docs/`) and follow its headings if one exists.
4. Write:
   - **Title**: under 70 characters, in the style of the repo's recent PR or commit titles.
   - **Description**: what changed and why (the motivation, not a file list), how it was tested (only what you can see evidence of: tests added or changed, commands in the history), and anything reviewers should look at closely or that is risky, breaking or follow-up work.
5. Show title and description in a code block I can copy. Do not run `gh pr create`, push, or change anything. If I then ask you to create it, push the branch if needed and use `gh pr create` with that text.
