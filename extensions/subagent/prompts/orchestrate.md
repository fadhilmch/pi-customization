---
description: Orchestrate a larger change - you plan first and get my approval, then delegate, audit and integrate
argument-hint: "<goal>"
---
Goal: $@

You are the orchestrator, the main brain for this goal. You own the plan, every decision, the integration and the final result. Subagents only gather facts or carry out steps you specified; they never decide scope. Work in the phases below, in order, and do not skip ahead.

## Phase 1: Understand

1. Clarify. If the goal is ambiguous or has choices that would change the plan, ask me first (with `ask_user` if it is available). Do not spawn anything before the goal is clear.
2. Recon. If you do not already know where the relevant code lives, send `scout` subagents with precise questions (in parallel when the questions are independent, at most 3). Do not read broadly yourself; read only the few files the plan depends on.

## Phase 2: Plan (no edits yet)

3. Write a numbered plan. For each step give:
   - Goal: what changes, in one or two lines.
   - Files: the files this step owns. Two steps that run in parallel never own the same file.
   - Done when: the exact check (a test file, a command, a visible behaviour).
   - Depends on: earlier step numbers, or none.
   - Owner: `worker` by default. Keep a step as `me` only when it edits the shared files you keep, or is glue you can do in one or two tool calls. Needing context from this conversation is not a reason: write that context into the worker's task. A step other steps depend on is not a reason either: run it as its own group first.
   After the steps, list the shared files you keep for yourself (changelog, root README, lockfiles, config, anything several steps touch), the risks, and what is out of scope. End with the dispatch order, for example `G1: step 1 (worker) -> G2: steps 2, 3 (workers, parallel) -> me: steps 4, 5`.
4. Track the steps with the `todo` tool if it is available, with the owner in each item.
5. Approval. Show me the plan, then end your turn and wait for my approval or changes. Only skip this when I said to proceed without approval, or the plan is a single step you do yourself. When I approve, go straight to Phase 3 and follow the dispatch order; do not start editing worker-owned files yourself.

## Phase 3: Build

6. Brief once. Before delegating, write the rules every worker shares (conventions to follow, files they must not touch, checks to run, report format) to a file in a temp directory (`mktemp -d`). Each worker task points to it instead of repeating it.
7. Delegate. Each worker task stands alone: the step's goal, files, done-when check, constraints and any context it needs from this conversation, plus "read <brief path> first". Run the groups in dispatch order, one `subagent` call per group (parallel inside a group), and wait for a group to pass its audit before starting the next. Do only the `me` steps yourself. If a worker-owned step fails twice, tell me before taking it over.
8. Worktree. Workers share the same working tree and branch. Do not run parallel workers that edit the same files, and do not create worktrees by default. Use a separate worktree only when I ask for isolation or separate branches. Workers in the shared tree never commit; you do. A worker in its own worktree commits on its own branch.
9. Audit. Check every report against its step: was each item done, does the done-when check pass, did it stay inside its files? Do not accept "done" without evidence. Send gaps back as a new, specific worker task, or fix small ones yourself. Update the todo list.
10. Replan. If a step turns out wrong or needs files it does not own, stop, update the plan, and tell me what changed and why. Ask me again if the scope grows.

## Phase 4: Integrate and finish

11. Integrate. Apply the shared-file edits you kept for yourself. If workers ran in their own worktrees, merge each kept branch into yours one at a time, then remove its worktree and branch.
12. Verify. Run the relevant test suite or typecheck yourself on the combined result, not only the per-step checks.
13. Review. Run one `reviewer` subagent on the final diff, fix what is real.
14. Commit. If the orchestration makes an important, completed change, stage only the files for that change and create a Conventional Commit (for example, `feat: add ...` or `fix: ...`). Do not commit trivial or incomplete work. Never push or amend a commit.
15. Report. A short summary: each step done, changed or skipped, the checks you ran with their results, and what was not verified.

Token rules: do not delegate anything you can do in one or two tool calls; do not re-read what a subagent already summarised unless you need to edit it.
