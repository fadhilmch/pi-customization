# subagent

Subagents for Pi. A `subagent` tool runs work in a separate `pi` process with a fresh context, its own model, tools and system prompt. Only the child's final report comes back. It ships three agents (`scout`, `worker`, `reviewer`), a `/agents` command, a `subagent_wait` tool for background runs, and the `/orchestrate`, `/scout`, `/review` and `/security-review` prompts.

![subagent](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/subagent.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/subagent ~/.pi/agent/extensions/subagent
```

Copying the folder this way skips the prompt templates, because Pi only auto-discovers templates from `~/.pi/agent/prompts/`. Copy `prompts/*.md` there if you want them. Installing as a package (below) includes them.

From the whole package, loading only this extension and its prompts:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/subagent/index.ts"],
      "prompts": ["extensions/subagent/prompts/*.md"],
      "themes": []
    }
  ]
}
```

`worker` and `reviewer` also load `auto-mode` (and `worker` loads `quality-on-write`) inside the child when those folders sit next to this one. Without them, the agents run without those guards.

From npm (once published): `pi install npm:@fadhilmch/pi-subagent`. See the [root README](../../README.md#install) for the other methods.

## Usage

### Ways to call it

| You type | What happens |
|---|---|
| A normal request ("where is X used?", "review my changes") | The model decides whether to call `subagent`. The tool description tells it to delegate only read-heavy or parallel work. |
| "use a scout to …", "run 3 scouts in parallel …" | You name the agent or mode and the model follows. |
| `/scout <question>` | One `scout` call. The cheapest way to ask a codebase question without filling your context. |
| `/review [focus]` | One `reviewer` call on the uncommitted diff. Its findings are relayed, nothing is changed. |
| `/security-review [base]` | One `reviewer` call with a security checklist (injection, authorization, secrets, unsafe deserialization, path traversal, SSRF, dependency risk) on the branch diff against `base` (default `main`) plus uncommitted changes. Findings come back ranked with `path:line`; nothing is changed. |
| `/orchestrate <goal>` | The main session plans and integrates, scouts do recon, workers take independent pieces, and one reviewer checks the end result. |
| `/agents` | Opens a panel listing every agent: source (bundled, user, project), the model it will actually run after config overrides, thinking level, tools, extensions it loads, and its description. It also says when project agents were skipped because the project is not trusted, and which agent files failed to parse. Plain text outside the TUI. |

![/agents panel](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/subagent-agents.png)

The tool takes exactly one mode:

```text
{ agent: "scout", task: "..." }                                   single
{ tasks: [{ agent, task }, { agent, task }] }                     parallel (max 6, 3 at a time)
{ chain: [{ agent, task }, { agent, task: "... {previous} ..." }] }  sequential; {previous} = prior report
```

Each item can set `cwd`. A chain stops at the first failed step. If a step has no `{previous}`, the prior report is appended to its task.

Two options on top of the modes:

- **`isolation: "worktree"`** (per item, or `isolation: worktree` in an agent file; `"none"` on an item overrides the agent). The child runs in a new `git worktree` on a new branch `pi-subagent/<agent>-<id>`, under `<tmp>/pi-subagent-worktrees/`, so parallel workers cannot overwrite each other. When the child finishes with no changes and no new commits, the worktree and branch are removed. Otherwise both are kept and the report ends with `Changes in branch X at path Y`. Merge or cherry-pick the branch yourself. The call is refused outside a git repository and in read-only sessions.
- **`background: true`** (any mode). The call returns at once with an id such as `bg-1` and the work continues while you and the model carry on. `subagent_wait` collects it:

```text
subagent_wait { ids: ["bg-1"], timeoutSeconds: 120 }   wait for those runs (default 120 s)
subagent_wait {}                                       every run not yet collected
subagent_wait { timeoutSeconds: 0 }                    status only, do not wait
subagent_wait { ids: ["bg-1"], cancel: true }          stop them
```

  Finished reports obey the same output caps as foreground calls (several at once share about twice `maxOutputChars`). When a background run ends, `subagent:finished` is emitted on `pi.events` with `{ id, label, status: "done" | "failed" | "cancelled", agents, durationMs, cost, summary, worktrees: [{ branch, path }] }`, so another extension (for example `notify`) can react. Nothing in this repo listens to it yet.

### Bundled agents

| Agent | Tools | Defaults | Use it for |
|---|---|---|---|
| `scout` | read, grep, find, ls | thinking `low`, no AGENTS.md/CLAUDE.md, 6k-char report | Finding code, tracing callers, reading docs or logs. Read-only and the cheapest agent. |
| `worker` | read, grep, find, ls, bash, edit, write | auto-mode + quality-on-write in the child, 6k-char report | One well-specified, independent piece of a plan |
| `reviewer` | read, grep, find, ls, bash | auto-mode in the child, 8k-char report | One review of a finished diff |

Every agent inherits your current model unless it names one, so they work with any provider. The thinking level is inherited too, unless the agent sets one or pins its own model (`scout` sets `low`). Inheriting means a `scout` costs as much per token as your main session. To make it cheap, pin a small model for it in `~/.pi/agent/subagent.json`:

```json
{ "models": { "scout": "anthropic/claude-haiku-4-5" } }
```

`/agents` shows the model each agent will use.

### Cost

- **Every turn:** the `subagent` and `subagent_wait` tool definitions (descriptions plus the agent list) are roughly 950 tokens in the system prompt (an estimate from the text length, not measured), whether or not they are used. Disable the extension if you never delegate.
- **Per call:** each child pays its own startup (its system prompt, tool definitions, AGENTS.md/CLAUDE.md unless dropped) and everything it reads, billed to your provider like any other request. Only the capped report enters the main session, where it is re-sent on later turns.
- **Parallel:** up to 3 children run at once and each bills separately, so 6 scouts cost about 6 times one scout. The shared budget keeps their combined reports to about twice `maxOutputChars` (12k characters, about 3k tokens, by default).
- Each result row shows the child's own `↑input ↓output R(cache read) $cost`. `/cost` from the `usage-report` extension, if installed, adds the subagent spend to the session total.

### Guidelines: when a subagent saves tokens

A subagent pays its own startup cost (system prompt, tool definitions, re-reading files). It saves tokens only when it **reads a lot and reports a little**, because everything read in the main session is re-sent on every later turn, and a subagent's reading is paid once.

- **Delegate:** codebase searches across many files, tracing a flow, reading long docs (framework APIs, specs), triaging long CI, k8s or training logs, reviewing a diff, and independent pieces of work that can run side by side.
- **Do it yourself:** anything that takes one or two tool calls, the main implementation (the main session already has the context), and anything that depends on what was said in the conversation.
- **Write self-contained tasks.** The child has seen nothing. Include the goal, the paths, the constraints and what to report. A vague task makes the child explore, and exploring costs tokens.
- **Run parallel workers only on separate files.** Two workers editing the same file will overwrite each other.
- **Review once,** at the end, not after every edit.
- Watch the usage on each result row (`↑input ↓output $cost`). If a scout costs more than the answer is worth, ask a narrower question.

### Your own agents

Add Markdown files to `~/.pi/agent/agents/` (yours) or `.pi/agents/` (per project, loaded only when the project is trusted). A file with the same name as a bundled agent replaces it.

```markdown
---
name: maf-docs
description: Looks up Microsoft Agent Framework APIs and returns only the snippet needed
tools: read, grep, find, ls, bash
model: anthropic/claude-haiku-4-5   # omit or "inherit" to use the parent's model
thinking: low                       # off|minimal|low|medium|high|xhigh|max
skills: ~/agent-skills/maf          # --skill paths, relative to this file
extensions: auto-mode?              # sibling name, builtin:x or a path; trailing ? = optional
mcp: false                          # true keeps MCP servers/tools in the child
contextFiles: true                  # false drops AGENTS.md/CLAUDE.md from the child
maxOutput: 4000                     # max characters of report returned to the parent
maxTurns: 30                        # stop the child after this many model turns (omit = no limit)
isolation: worktree                 # run in a new git worktree on its own branch (omit = shared tree)
---

System prompt for the agent. Say what to look for and how to format the report.
```

## Config

`~/.pi/agent/subagent.json` (user only, all keys optional):

```json
{
  "models": { "scout": "anthropic/claude-haiku-4-5", "reviewer": "inherit" },
  "thinking": { "worker": "medium" },
  "extensions": ["./my-provider.ts"],
  "maxOutputChars": 12000,
  "maxParallel": 6,
  "concurrency": 3,
  "timeoutMinutes": 20,
  "maxDepth": 1,
  "maxSpawns": 64,
  "maxTurns": { "scout": 20 }
}
```

- `models` / `thinking`: per-agent overrides, so you don't have to copy an agent file just to change its model.
- `extensions`: loaded into **every** child. Use this when your model comes from a provider extension, since children start with no extensions. Paths are relative to the config file.
- `maxOutputChars`: the most report text the parent receives from one child. Parallel calls share about twice this amount across their tasks. An agent's `maxOutput` can lower it.
- `maxTurns`: per-agent turn limit that overrides the agent file (1 to 1000). `maxSpawns`: how many children one session may start across all calls, background ones included (default 64, reset when a session starts); a call that would go over is refused.
- `timeoutMinutes`: kills a child that runs too long (0 = no limit). `maxDepth`: how deep delegation may go. The default of 1 means a child cannot start its own subagents.

There is deliberately no project-level config: it could add extensions to every child.

## How it works

Each call spawns `pi --mode json -p --no-session -ne -ns --no-mcp [--model] [--thinking] [--tools] [-e ...] [--skill ...] --append-system-prompt <contract> --append-system-prompt <agent prompt> "Task: ..."` and reads its JSON event stream:

- **Lean child.** No extensions (`-ne`), skills (`-ns`) or MCP unless the agent asks for them. That keeps the child's system prompt and tool list small. AGENTS.md/CLAUDE.md stay in unless `contextFiles: false`.
- **Report contract.** Every child gets a short system-prompt addition: only your final message returns, keep it under N words, cite `path:line`, don't paste files. N comes from the output budget.
- **Hard cap.** The report is truncated to the budget before it reaches the parent, with a note saying how much was cut.
- **Usage.** Tool calls, tokens, cost and duration are collected per child and shown on the result rows (ctrl+o expands each task, its tool calls and the full report). They are kept in the tool details for the UI, not sent to the model.
- **Safety.** A child inherits your environment, credentials and cwd, and runs without a sandbox. A `worker` can write anywhere your user can, and a `scout`'s `read` tool can read any file you can. Risky commands in a `worker` or `reviewer` child hit auto-mode, which blocks anything that would need a confirmation (there is no UI to ask); without the sibling `auto-mode` folder, nothing guards them. Project agents (`.pi/agents`) are repo-controlled prompts that can name tools, and `extensions:` and `skills:` paths that run code in the child just like `.pi/extensions` does, so they load only in trusted projects (`/agents` says when they were skipped); trust a project only if you would trust its `.pi/extensions`. Config is user-only for the same reason. The `PI_SUBAGENT_DEPTH` environment variable stops recursion: a child at the depth limit does not register the tool. Ctrl+C kills running children (each runs in its own process group on Linux and macOS, and the whole group is killed), tasks still queued in a parallel call are not started, and `timeoutMinutes` kills slow ones.
- **Read-only sessions.** If the parent has neither `write` nor `edit` active (plan mode, `pi --tools read`), the tool refuses any agent whose tool list is empty (Pi's default set) or includes `write`, `edit` or `bash`, without starting a process. Only read-only agents like `scout` run, so a `worker` cannot be used to edit files while planning. `reviewer` has `bash`, so it is refused too. Custom agents that need to run in plan mode must list only read-only tools.
- **Plan mode, after approval.** `plan-mode`'s "Approve & keep asking" asks before each write or command the main session makes. A delegated `worker` is a separate process and is not gated step by step: once the plan is approved, whatever a `worker` does inside its task is not shown to you first. Use `auto-mode` in the child (the bundled `worker` loads it when present) or do the risky steps in the main session.
- **Turn limit.** With `maxTurns` the child is told its limit in its system prompt ("wrap up by turn N-2, you are stopped after turn N"). Turns are counted from the child's JSON stream, one per assistant message. When turn N ends with tool calls still pending, the child is killed and the last assistant text it wrote is returned, followed by `[truncated: stopped at the turn limit]`. A truncated run counts as done, not failed. A child that finishes on its own on turn N is not truncated.
- **Worktrees.** `git worktree add -b pi-subagent/<agent>-<id> <tmp>/pi-subagent-worktrees/<repo>-<id> HEAD` before the child starts, and the child's cwd is the same relative folder inside it. After it ends, `git status --porcelain` and `git rev-list --count <base>..HEAD` decide: clean and no new commits means `git worktree remove --force` and `git branch -D`; anything else is kept and reported. Worktrees do not count as write access to the session: a read-only session (plan mode) refuses `isolation: "worktree"` because it creates branches.
- **Background runs.** The call is validated first (bad agent, spawn cap, read-only, not a repository are refused immediately), then runs unattached to the tool call, so interrupting the turn does not stop it. Their own abort signal is used by `subagent_wait` with `cancel: true`, and every background child is killed on `session_shutdown` (quit, reload, `/new`, `/resume`, `/fork`).
- **Live widget.** While any child runs, a widget below the editor lists one row per running child: name, tool count and cost so far. It updates as the child's events arrive and is removed when nothing is running.
- **Budget sharing.** A single call may return up to the smallest of the agent's `maxOutput`, `maxOutputChars`, and (in parallel mode) `max(1500, 2 * maxOutputChars / number of tasks)` characters.

Files: `agents.js` (frontmatter, discovery), `config.js`, `args.js` (child command line), `run.js` (spawn and event parsing), `output.js` (caps, usage), `render.js`, `dispatch.js` (validation, modes), `worktree.js` (git isolation), `background.js` (run registry, wait text, finish event), `widget.js` (live rows), `index.ts` (wiring). The tests in `tests/` run real child processes against a fake `pi`.

## Limits

- A child cannot ask you anything. If the task is unclear, it guesses or reports the gap, so write tasks that leave nothing to clarify.
- A child does not inherit your `/model` scoping, session or todo list, only what is in the task.
- Parallel workers share one working tree unless you use `isolation: "worktree"`. Nothing else stops two of them from editing the same file.
- Windows is untested. The PATH fallback starts `pi.cmd` through the shell with quoted arguments, and process groups are not used there, so abort and timeout kill only the direct child.
- The bundled agents inherit the parent model, so cost savings depend on pinning a cheaper model for `scout`.
- The output cap is characters, not tokens, and truncation can cut a report mid-sentence. The child is asked to stay under a word limit, but that is a request, not a guarantee.
- A worktree is a clean checkout of `HEAD`: uncommitted changes in your tree are not in it, and ignored files (`node_modules`, `.env`, build output) are not either, so a child that needs them must install or build first. Kept worktrees and branches are never deleted for you (`git worktree remove <path>`, `git branch -D <branch>`). Worktrees live in the OS temp folder and may disappear on reboot, so merge what you want to keep.
- The turn limit cannot be changed while the child runs: a child is a one-shot `pi -p` process with no input channel, so the "wrap up by turn N-2" warning is part of its prompt, not a message sent two turns before the end. A child that ignores it is cut off after turn N and returns whatever its last message said, possibly nothing if that turn only made tool calls.
- Background runs live in this Pi process. They are killed when the session ends, and a result nobody collects with `subagent_wait` is lost (only the `subagent:finished` event and its 200-character summary remain). Killing a run while it finishes can leave its worktree behind.
- The live widget and background completion were checked against fake children and a fake Pi API in the tests; how the widget looks in the real TUI has not been checked.
- Verified end to end against Pi 1.3.0 with the repo's fake demo provider (`demo/`): real child `pi` processes talking to a scripted model, including parallel runs and the recorded GIF. Not verified against a real model provider. Rendering inside other tool-rendering extensions has not been checked.
