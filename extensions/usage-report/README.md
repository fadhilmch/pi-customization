# usage-report

`/context` shows what is using the context window, so you can find token waste. `/cost` shows what the session has spent, per model, including subagent children. `/cost daily` and `/cost monthly` add history across all your sessions.

Pi's footer shows one total. When a session gets slow or expensive you usually want to know why: a huge system prompt, many tool definitions, or one big file read that is re-sent on every turn. These two commands answer that. Both are local: they read the session file and the live prompt, make no model call and cost no tokens. The report opens as a panel over the chat (or a plain-text notification outside the TUI), never as a message, so it never enters the context.

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
/context <category>
/cost
/cost daily | monthly [--since YYYY-MM-DD] [--project]
/context --json
/cost [session|daily|monthly] ... --json
```

In the interactive TUI each command opens a framed panel over the chat; `esc`, `enter` or `q` closes it. In print or RPC mode the same report comes back as plain text.

### `/context`

![/context panel](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/usage-report-context.png)

- **Headline**: the real context size from the provider (`ctx.getContextUsage()`) against the model's window. Before the first response of a session it shows the estimate instead and says so.
- **Window bar**: the whole context window, one cell per 1/N of it, coloured by category (system prompt, tools, user, assistant, tool results); the dotted rest is free. It is proportional, so a 2% context fills 2% of the bar.
- **Breakdown**: each category with an estimated size, its share of the estimate and a bar. Under the system prompt: the context files (AGENTS.md, CLAUDE.md) and skill listing when Pi exposes them. Under tools: the biggest tool definitions by name.
- **Biggest tool results**: the five largest results with the call that produced them (`read src/server.ts`, `subagent parallel: scout ×2`).
- **Tips** (only when they apply): tool results are over half the conversation, the window is over 70% full, or tool definitions outweigh the system prompt.

### `/context <category>`

Previews the text behind one row, capped at 3000 characters (the notification says how much was cut). Categories: `system` (system prompt), `tools` (names and sizes), `tool <name>` (one definition: name, description, parameters), `files` (context file paths), `file <name>` (a context file's content; matches the end or any part of the path), `skills` and `skill <name>`. A bare tool name or file name also works (`/context bash`, `/context AGENTS.md`). It comes back as a notification, not a panel, and never enters the conversation.

### `--json`

Add `--json` to `/context`, `/context <category>`, `/cost` and `/cost daily|monthly` to get the data as JSON text (a notification) instead of the panel, for scripts or pasting. It is the same report object the panel is drawn from.

### `/cost daily` and `/cost monthly`

History like [ccusage](https://github.com/ryoppippi/ccusage), but for Pi: spend and tokens per day (or month) and per model, summed over every session file. Subagent spend is included as `↳ agent (model)` rows when the session recorded it. A total line closes the report, with the subagent share.

- `--since YYYY-MM-DD`: only that day and later.
- `--project`: only sessions started in the current working directory.
- `/cost session` is the default `/cost` (current branch).

The panel (and plain text) show the newest 30 days or months (10 in the TUI panel, which does not scroll); `--since` narrows the range and `--json` returns all rows.

### `/cost`

![/cost panel](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/usage-report-cost.png)

- **Headline**: total spend on the current branch, split into main agent and subagents, with a bar of that split.
- **Main agent**: one row per `provider/model` with cost, share and a bar, and under it input `↑`, output `↓`, cache read `R`, cache write `W` and turns. Compaction entries that recorded usage get their own `(compaction)` row, branch summaries `(branch summary)`. Out-of-band usage entries (such as a cache warm-up) are added to their `provider/model` row without counting as a turn, or get a row named after their kind when no model is recorded.
- **Subagents**: spend read from `subagent` tool results (`details.runs[].usage`), one row per agent and model, with runs instead of turns.
- **Cache reads**: the share of all input tokens that came from the prompt cache. Cache reads cost a fraction of normal input, so a low share in a long session means the prompt is not being reused (for example after switching models or editing early messages).

The screenshots come from the demo tape `demo/tapes/usage-report.tape` (fake model, real Pi). Plain-text output in print/RPC mode has the same numbers without colours or bars.

## Config

None. Session files are found the way Pi finds them: `PI_CODING_AGENT_SESSION_DIR`, then the `sessionDir` setting in `<agent dir>/settings.json`, then `<agent dir>/sessions` (`PI_CODING_AGENT_DIR` moves the agent dir).

## How it works

`messages.js` takes the live context from Pi's own `sessionManager.buildSessionProjection()` (latest compaction only, `context_edit` applied; older Pi versions fall back to a local walk of the branch) and measures each message. `context.js` and `cost.js` aggregate it and format the plain-text reports; `panel.js` draws the framed panels (pure functions of the report and the terminal width, unit-tested for a fixed width and proportional bars); `index.ts` wires the commands, opens the panel with `ctx.ui.custom` as an overlay in the TUI and falls back to `ctx.ui.notify` elsewhere.

`history.js` backs `/cost daily|monthly`: it lists the `.jsonl` files (one project folder with `--project`), skips files not modified since `--since`, and reads the rest line by line with a few files in parallel. Only lines mentioning `usage` are parsed; malformed lines are skipped. Days use your local time zone. Entries repeated by a forked session (same entry id and timestamp) are counted once. `args.js` parses the arguments and `drill.js` builds the `/context <category>` previews.

Subagent spend is read from the details that the `subagent` extension attaches to its tool results, so it needs that extension; without it `/cost` shows only the main agent. Those details are kept for the UI and are not sent to the model.

Pi's own `/session` shows totals, and `@tmustier/pi-usage-extension` registers `/usage` (provider quota and history). Neither command name here collides with them.

## Limits

- Sizes in `/context` are estimates (characters / 4, 1200 tokens per image). Only the first line, the total, comes from the provider. The per-category numbers are not tokenizer counts and their sum will not match that total (tool schemas and provider framing are not measured exactly). Skills and context files only appear if Pi exposes them to extensions.
- `/cost` can only count what the session file records. Cost is $0 for models without pricing. Cost uses the prices configured in Pi, not your provider's bill. Subagent spend appears only for `subagent` results on the current branch; a child's own usage is whatever its `pi` process reported.
- `/cost daily|monthly` counts every branch of every session file, so it can be higher than the branch-only `/cost`. It only sees spend that the files record: a subagent child that ran without a session file shows up only through the parent's `subagent` result. Cost comes from the prices recorded at the time. Not benchmarked beyond hundreds of small files.
- Sessions are found under the project folder name Pi uses (`--<path>--`); with a custom `sessionDir` that is not grouped that way, `--project` finds nothing.
- `--json` output goes through a notification, so a very long report may be cut by your terminal.
- `/cost` covers the current branch, not other branches of the session tree.
- Verified by unit tests, by running `/context` and `/cost` over RPC against Pi 1.3.0 after a demo session (fake provider) with parallel subagents, and by recording the panels in the TUI (the screenshots above); the breakdowns were correct. Not checked against a real provider's billing, or in a long session with several compactions.
