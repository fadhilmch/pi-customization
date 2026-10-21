---
description: Review the current changes with the reviewer subagent
argument-hint: "[focus or base branch]"
---
Use the subagent tool with agent "reviewer" to review the current uncommitted changes in this repository. Focus: ${@:-correctness, regressions and missing edge cases}.

Pass along anything from this conversation the reviewer needs to judge the change (the intent, constraints, known trade-offs) in a few lines. Relay its verdict and issues to me briefly, and do not change any code until I say so.
