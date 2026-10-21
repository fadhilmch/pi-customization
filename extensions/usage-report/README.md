# usage-report

`/context` shows what is using the context window, so you can find token waste. `/cost` shows what the session has spent, per model, including subagent children.

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

`/cost` sums assistant `usage` on the current branch per `provider/model` (input, output, cache read, cache write, cost, turns), adds compaction summaries, then lists subagent spend read from `subagent` tool results (`details.runs[].usage`), and a total.

## Config

None.

## How it works

`messages.js` rebuilds the live context from the session branch (latest compaction summary, kept entries, later entries) and measures each message. `context.js` and `cost.js` turn that into text; `index.ts` wires the commands and shows the result as a notification.

Pi's own `/session` shows totals, and `@tmustier/pi-usage-extension` registers `/usage` (provider quota and history). Neither command name here collides with them.

## Limits

- Sizes in `/context` are estimates (characters / 4, 1200 tokens per image). Compare against the provider's number; they will not match exactly. Skills and context files only appear if Pi exposes them to extensions.
- `/cost` can only count what the session file records. Cost is $0 for models without pricing. Subagent spend appears only for `subagent` results still on the branch, and parallel runs started outside this session are not seen.
- `/cost` covers the current branch, not other branches of the session tree.
