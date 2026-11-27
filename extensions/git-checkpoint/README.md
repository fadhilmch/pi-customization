# git-checkpoint

Claude-Code-style rewind for Pi. Before each prompt the extension snapshots your working tree (tracked **and** untracked, minus git-ignored files). `/rewind`, `/fork` and tree navigation can put the code back.

![git-checkpoint](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/git-checkpoint.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/git-checkpoint ~/.pi/agent/extensions/git-checkpoint
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/git-checkpoint/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-git-checkpoint`. See the [root README](../../README.md#install) for the other methods. Requires `git` on PATH.

## Usage

- `/rewind` lists the 20 most recent checkpoints with `ctx.ui.select`: position, turn, age, line stats, prompt. Example row: `2. turn 5 · 3m ago · +42 −7, 3 files · fix the parser`. It shows exactly what would change, asks for confirmation, then restores.
  - The stats are **relative to the current working tree**: lines added and removed, and files touched, since that checkpoint was taken. That is the same direction as `/rewind diff`, and it is what a restore would undo, so it tells you how much work you lose by going back to that row. `no changes since` means the tree already matches.
- `/rewind diff <n>` shows the stat and patch between checkpoint `<n>` (the position in the `/rewind` list) and the current working tree. The patch is capped (120 lines / 12,000 characters, with a note on what was cut). It appears as a notification in the TUI and RPC, and on stdout in print mode.
- `/rewind <n> <path> [path...]` restores only those paths from checkpoint `<n>`. Paths are relative to the current directory (or absolute) and must be inside the repository; a directory selects everything under it. Same preview, confirmation and automatic pre-rewind checkpoint as a full restore. Quote paths that contain spaces.
- When the chosen checkpoint is a prompt of the current session, a full `/rewind` also asks whether to restore code only, or code **and** conversation (see below).
- `/rewind clean` deletes every `refs/pi-checkpoints/*` ref in this repo (after confirmation). Objects are reclaimed by `git gc`.
- On `/fork` and `/tree` navigation to a user prompt, Pi asks whether to restore code to the state before that prompt (interactive modes only; never automatic). Navigation is never cancelled by this extension.

### Conversation rewind

Pi's own `/tree` and `/fork` rewind the conversation, and this extension already offers the code restore there. Pi also exposes `ctx.navigateTree()` to commands, so `/rewind` can do both in one step: pick "Restore code + conversation" and, after the code restore, it navigates the session tree to just before that prompt (the same as choosing that prompt in `/tree`; the prompt text goes back to the editor). The tree hook is told to stand down for that navigation, so you are not asked twice. "Restore code only" leaves the conversation alone. Single-file restores never touch the conversation.

### Exactly what restore does

1. Computes the current work-tree state (same temp-index method) and diffs it against the checkpoint.
2. Shows the plan: files that will be rewritten and files that will be deleted. Asks to confirm.
3. **Saves the current state as a new checkpoint** ("before rewind"), so the restore can be undone from `/rewind`.
4. For each path that differs: rewrites it from the checkpoint (`git restore --source=<checkpoint> --worktree`), or deletes it if the checkpoint does not contain it (files created after the checkpoint, including untracked ones, plus directories emptied by that).

It does **not** touch: the index (staged state may differ from files afterwards), HEAD, branches, stash, git-ignored files, or any file identical in both states. Untracked files that exist now but not at the checkpoint *are* deleted, which is the point of a rewind; they are listed in the confirmation and recoverable through the pre-rewind checkpoint.

## Config

- `PI_CHECKPOINT_KEEP` (env, default `50`): checkpoints kept per repo; oldest are pruned after each new one.

## How it works

- Taken in `before_agent_start`, i.e. **once per user prompt**, not per LLM turn. `turn_start` fires after every tool round-trip, which would produce many near-identical snapshots; the prompt is the unit you actually rewind to.
- Built with a **temporary copy of the index** (`git add -A` + `write-tree` + `commit-tree`), stored at `refs/pi-checkpoints/<session>/<n>`. Your real index, HEAD, branches, reflog and `git stash list` are never touched (the Pi example uses `git stash create`, which is also stash-list-safe but ignores untracked files).
- Skipped silently outside a git repo, and when nothing changed since the latest checkpoint.
- Line stats and `/rewind diff` use `git diff` between tree objects: one snapshot of the current tree, then one cheap tree-to-tree diff per listed row (at most 20). Binary files count as a file with no lines.
- Skipped with a dim status note (`⏺ checkpoint skipped (rebase in progress)`) during a merge, rebase, cherry-pick or revert. `/rewind` refuses in those states too.
- Each checkpoint commit records session, turn, file count (vs HEAD) and the first line of the prompt in its message.

## Limits

- Large untracked, non-ignored files are copied into the object database on every changed snapshot; add them to `.gitignore`.
- Submodule contents are not snapshotted.
- Conversation rewind is offered only for checkpoints of the current session whose prompt is still on the active branch. Older sessions and pre-rewind checkpoints restore code only.
- `<n>` is a position in the current list (newest first), so it shifts when new checkpoints are taken.
- Code state for a prompt is looked up in memory (entry id), falling back to matching the prompt text within the session.
