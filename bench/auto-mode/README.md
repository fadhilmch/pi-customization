# auto-mode benchmark

Measures how the rule classifier in `extensions/auto-mode` behaves on a fixed set of tool calls. It calls `classifyToolCall` directly. No model, no network, nothing is executed.

```bash
node bench/auto-mode/run.js            # summary table
node bench/auto-mode/run.js --show     # also list every disagreement
node bench/auto-mode/run.js --json     # machine-readable
node bench/auto-mode/run.js --strict   # exit 1 on a regression (used by tests/bench-auto-mode.test.js)
node bench/auto-mode/run.js --extra my.jsonl   # add your own fixtures
```

## What it reports

| Measure | Meaning |
| --- | --- |
| Safe commands that asked or blocked | Friction: prompts for work that should run silently. |
| Risky commands allowed silently | Misses: risky calls that ran without a prompt. |
| Catastrophic not hard-blocked | Calls labelled `block` that were not denied. |
| Calls flagged "uncertain" | How often the rules could not tell (rule ids `uncertain`, `path-unknown`). This is the share a model tier could ever help with. |
| Decision time | Time for one `classifyToolCall` in this process (p50, p95, max). |

## Fixtures

`fixtures.jsonl`, one JSON object per line: `id`, `group`, `label`, `tool`, and `command` (bash/powershell) or `path` (read, write, edit), plus an optional `note`. `{{cwd}}`, `{{home}}` and `{{outside}}` are replaced with a temporary project, home and outside folder.

Labels are what a careful person would expect, written by hand. They are opinions, not ground truth:

- `safe`: should run silently in `auto` mode.
- `risky`: should ask (a deny also counts as caught).
- `block`: should be hard-blocked.

`known_gap: true` marks a fixture the rules get wrong today. These are **misses, not passes**: they stay in the "risky allowed silently" count and in the disagreement list. `--strict` is a regression check on the fixture set, not a safety verdict. It exits 1 when a fixture that is not marked `known_gap` disagrees with its label, or when a marked gap starts passing (so the flag gets removed). It exits 0 while the known gaps remain, so a green test does not mean the rules catch everything. Read the table, not the exit code.

Current known gaps: shell code hidden inside `python3 -c`, `node -e` and `perl -e`, an alias or function defined in the same command, and `npx prisma migrate reset`.

## Limits

- The set is small (a couple hundred calls) and written by the rule author, so the percentages are not a real-world rate. Add your own decision log lines to see your own traffic.
- It looks at one call at a time. It does not test whether a call matches what the user asked for.
- Timing is one process, warm, on whatever machine runs it.
- Public datasets (for example a shell-risk benchmark) could be added as extra files. Check each dataset's license before copying rows into this repo.
