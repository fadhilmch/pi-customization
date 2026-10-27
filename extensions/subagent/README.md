# subagent

Subagents for Pi. A `subagent` tool runs work in a separate `pi` process with a fresh context, its own model, tools and system prompt. Only the child's final report comes back. It ships three agents (`scout`, `worker`, `reviewer`), a `/agents` command, and the `/orchestrate`, `/scout` and `/review` prompts.

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
| `/orchestrate <goal>` | The main session is the planner. It clarifies the goal, sends scouts for recon, then writes a plan where each step names its files, a done-when check and an owner (workers by default; itself only for shared files and small glue) plus a dispatch order, and waits for your approval. After that it writes one shared brief for the workers, runs the groups in order (parallel inside a group), audits each report against its step, applies shared-file edits itself, runs the tests on the combined result, and has one reviewer check the final diff. About 1,100 tokens of instructions. |
| `/agents` | Opens a panel listing every agent: source (bundled, user, project), the model it will actually run after config overrides, thinking level, tools, extensions it loads, and its description. It also says when project agents were skipped because the project is not trusted, and which agent files failed to parse. Plain text outside the TUI. |

![/agents panel](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/subagent-agents.png)

The tool takes exactly one mode:

```text
{ agent: "scout", task: "..." }                                   single
{ tasks: [{ agent, task }, { agent, task }] }                     parallel (max 6, 3 at a time)
{ chain: [{ agent, task }, { agent, task: "... {previous} ..." }] }  sequential; {previous} = prior report
```

Each item can set `cwd`. A chain stops at the first failed step. If a step has no `{previous}`, the prior report is appended to its task.

### Bundled agents

| Agent | Tools | Defaults | Use it for |
|---|---|---|---|
| `scout` | read, grep, find, ls | thinking `low`, no AGENTS.md/CLAUDE.md, 6k-char report | Finding code, tracing callers, reading docs or logs. Read-only and the cheapest agent. |
| `worker` | read, grep, find, ls, bash, edit, write | auto-mode + quality-on-write in the child, 6k-char report | One well-specified, independent piece of a plan. Reads the task's brief file first, keeps the diff small, runs the task's check. Never commits in the shared tree; commits on its own branch when it runs in a worktree. |
| `reviewer` | read, grep, find, ls, bash | auto-mode in the child, 8k-char report | One review of a finished diff |

Every agent inherits your current model unless it names one, so they work with any provider. The thinking level is inherited too, unless the agent sets one or pins its own model (`scout` sets `low`). Inheriting means a `scout` costs as much per token as your main session. To make it cheap, pin a small model for it in `~/.pi/agent/subagent.json`:

```json
{ "models": { "scout": "anthropic/claude-haiku-4-5" } }
```

`/agents` shows the model each agent will use.

### Cost

- **Every turn:** the `subagent` tool definition (description plus the agent list) is about 640 tokens in the system prompt, whether or not it is used. Disable the extension if you never delegate.
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
  "maxDepth": 1
}
```

- `models` / `thinking`: per-agent overrides, so you don't have to copy an agent file just to change its model.
- `extensions`: loaded into **every** child. Use this when your model comes from a provider extension, since children start with no extensions. Paths are relative to the config file.
- `maxOutputChars`: the most report text the parent receives from one child. Parallel calls share about twice this amount across their tasks. An agent's `maxOutput` can lower it.
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
- **Budget sharing.** A single call may return up to the smallest of the agent's `maxOutput`, `maxOutputChars`, and (in parallel mode) `max(1500, 2 * maxOutputChars / number of tasks)` characters.

Files: `agents.js` (frontmatter, discovery), `config.js`, `args.js` (child command line), `run.js` (spawn and event parsing), `output.js` (caps, usage), `render.js`, `dispatch.js` (modes), `index.ts` (wiring). The tests in `tests/` run real child processes against a fake `pi`.

## Limits

- A child cannot ask you anything. If the task is unclear, it guesses or reports the gap, so write tasks that leave nothing to clarify.
- A child does not inherit your `/model` scoping, session or todo list, only what is in the task.
- Parallel workers share one working tree. Nothing stops two of them from editing the same file.
- Windows is untested. The PATH fallback starts `pi.cmd` through the shell with quoted arguments, and process groups are not used there, so abort and timeout kill only the direct child.
- The bundled agents inherit the parent model, so cost savings depend on pinning a cheaper model for `scout`.
- The output cap is characters, not tokens, and truncation can cut a report mid-sentence. The child is asked to stay under a word limit, but that is a request, not a guarantee.
- Parallel `worker` calls are not isolated from each other (no git worktrees).
- Verified end to end against Pi 1.3.0 with the repo's fake demo provider (`demo/`): real child `pi` processes talking to a scripted model, including parallel runs and the recorded GIF. Not verified against a real model provider. Rendering inside other tool-rendering extensions has not been checked.
