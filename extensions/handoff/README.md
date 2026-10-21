# handoff

`/handoff <goal>` is a lossless alternative to compaction: instead of squashing the conversation, it asks the current model to write a self-contained prompt for the next task, lets you edit it, then starts a new session with that prompt as a draft.

```
/handoff now implement this for teams as well
/handoff            (prompts for the goal)
```

Flow:

1. Serializes the current branch (respecting the latest compaction) and asks the model for context, relevant files and the next task.
2. A loader shows progress; Esc aborts.
3. The result opens in an editor titled with line/char counts. Submit to continue, close/empty to cancel. Nothing changes until you submit.
4. A new session is created (linked via `parentSession`) with the prompt in the input box; press Enter to send.

Polish over the Pi example: goal prompt when omitted, model errors reported instead of only logged, empty-output guard, and a footer pointing at the previous session file so the new session can read the full transcript if the summary missed something.

Requires interactive (TUI) mode and a selected model. Costs one model call.
