# usage-report

`/context` shows what is using the context window, so you can find token waste. `/cost` shows what the session has spent, per model, including subagent children.

Pi's footer shows one total. When a session gets slow or expensive you usually want to know why: a huge system prompt, many tool definitions, or one big file read that is re-sent on every turn. These two commands answer that. Both are local: they read the session file and the live prompt, make no model call and cost no tokens. The result is a notification, not a message, so it never enters the context.

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/usage-report ~/.pi/agent/extensions/usage-report
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/usage-report/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-usage-report`. See the [root README](../../README.md#install) for the other methods.

## Usage

```
/context
/cost
```

`/context` prints the real context size from the provider (`ctx.getContextUsage()`) and, next to it, an estimate split into:

- the system prompt, with the context files and skill listing inside it
- active tool definitions (the biggest few by name)
- messages: user, assistant, tool results, and the five largest tool results with the call that produced them

Example (shortened):

```text
Context: 41k used of 200k (20.5%), as reported by the provider
Estimated below (chars/4, rough): ~38k tokens

System prompt                 ~  6.1k   16.0%
  AGENTS.md                   ~  1.2k    3.2%
Tool definitions (9)          ~  3.4k    8.9%
  subagent                    ~   640    1.7%
Messages                      ~   28k   73.9%
  tool results (14)           ~   24k   63.1%

Biggest tool results:
  ~  9.8k  read src/server.ts
Tool results are over half of the messages: consider /compact, /handoff, or narrower reads ...
```

`/cost` sums assistant `usage` on the current branch per `provider/model` (input, output, cache read, cache write, cost, turns). Compaction entries that recorded usage get their own `(compaction)` row. It then lists subagent spend read from `subagent` tool results (`details.runs[].usage`), grouped by agent and model, and a total of main agent plus subagents.

```text
Session cost (current branch)

anthropic/claude-sonnet-4-5          $0.412  ↑96k ↓7.1k R210k W18k  23 turns

Subagents (children are separate pi processes)
scout (anthropic/claude-sonnet-4-5)  $0.071  ↑31k ↓2.2k R0 W0  3 runs
Subagent total                       $0.071  ↑31k ↓2.2k R0 W0

Total $0.483   ↑ input  ↓ output  R cache read  W cache write
```

(The numbers above are illustrative, not from a real session.)

## Config

None.

## How it works

`messages.js` rebuilds the live context from the session branch (latest compaction summary, kept entries, later entries) and measures each message. `context.js` and `cost.js` turn that into text; `index.ts` wires the commands and shows the result as a notification.

Subagent spend is read from the details that the `subagent` extension attaches to its tool results, so it needs that extension; without it `/cost` shows only the main agent. Those details are kept for the UI and are not sent to the model.

Pi's own `/session` shows totals, and `@tmustier/pi-usage-extension` registers `/usage` (provider quota and history). Neither command name here collides with them.

## Limits

- Sizes in `/context` are estimates (characters / 4, 1200 tokens per image). Only the first line, the total, comes from the provider. The per-category numbers are not tokenizer counts and their sum will not match that total (tool schemas and provider framing are not measured exactly). Skills and context files only appear if Pi exposes them to extensions.
- `/cost` can only count what the session file records. Cost is $0 for models without pricing. Cost uses the prices configured in Pi, not your provider's bill. Subagent spend appears only for `subagent` results on the current branch; a child's own usage is whatever its `pi` process reported.
- `/cost` covers the current branch, not other branches of the session tree.
- Verified by unit tests and by running `/context` and `/cost` over RPC against Pi 1.3.0 after a demo session (fake provider) with parallel subagents; the breakdowns were correct. Not checked against a real provider's billing, or in a long session with several compactions.
