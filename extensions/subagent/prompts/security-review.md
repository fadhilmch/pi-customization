---
description: Security review of the current branch's diff against a base branch with the reviewer subagent
argument-hint: "[base branch, default main]"
---
Use the subagent tool with agent "reviewer" to run a security review of this branch. Base branch: ${@:-main}.

Write a task that stands alone (the reviewer has not seen this conversation). Tell it to read `git diff ${@:-main}...HEAD` plus any uncommitted changes from `git status` and `git diff`, and to read the surrounding code when the diff is not enough. Bash is for read-only git commands only; it must not edit anything.

Have it check, in the changed code and what it touches:
- Injection: SQL, shell and command, template, prompt, header and log injection, and unescaped output (XSS).
- Authentication and authorization: missing or bypassable checks, trusting client-supplied ids or roles, broken tenant isolation.
- Secrets: keys, tokens or passwords in code, config, tests or logs.
- Unsafe deserialization: pickle, yaml.load, eval and similar, or untyped input fed to an object loader.
- Path traversal: user-controlled file paths, archive extraction, symlink handling.
- SSRF: server-side requests to user-supplied URLs without an allow-list or private-address check.
- Dependency risk: new or bumped packages, unpinned versions, install scripts, known-vulnerable releases.

Ask for findings ranked high to low, each as `path:line [high|medium|low] what is wrong, how it could be exploited, the fix`, then one line saying whether anything blocks merging. Findings it cannot confirm go last and say what would confirm them.

Relay the findings to me briefly. Do not change any code until I say so.
