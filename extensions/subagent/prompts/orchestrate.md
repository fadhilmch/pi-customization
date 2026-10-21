---
description: Orchestrate a larger change - you plan and integrate, subagents do recon, independent pieces and the final review
argument-hint: "<goal>"
---
Goal: $@

Act as the orchestrator for this goal. You own the plan, the integration and the final result. Subagents do the read-heavy and independent parts so this conversation stays small.

1. Recon. If you do not already know where the relevant code lives, send `scout` subagents with precise questions (in parallel when the questions are independent, at most 3). Do not read broadly yourself.
2. Plan. Write a short numbered plan and track it with the todo tool if it is available. Mark which steps are independent (separate files, no shared edits).
3. Build. Do the steps that need this conversation's context or touch shared files yourself. Delegate independent, well-specified steps to `worker` subagents, in parallel only when they touch different files. Every worker task must stand alone: goal, files, constraints, and how to check it.
4. Verify. Run the relevant tests or typecheck yourself after integrating.
5. Review. Run one `reviewer` subagent on the final diff, fix what is real, then give me a short summary.
6. Ship (optional). Only if I asked you to commit, push or open a PR, follow the `/ship` prompt's steps for it.

Token rules: do not delegate anything you can do in one or two tool calls; do not re-read what a subagent already summarised unless you need to edit it; if the goal is ambiguous, ask me before spawning anything.
