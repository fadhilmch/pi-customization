# git-checkpoint

Claude-Code-style rewind for Pi. Before each prompt the extension snapshots your working tree (tracked **and** untracked, minus git-ignored files). `/rewind`, `/fork` and tree navigation can put the code back.

## How snapshots work

- Taken in `before_agent_start`, i.e. **once per user prompt**, not per LLM turn. `turn_start` fires after every tool round-trip, which would produce many near-identical snapshots; the prompt is the unit you actually rewind to.
- Built with a **temporary copy of the index** (`git add -A` + `write-tree` + `commit-tree`), stored at `refs/pi-checkpoints/<session>/<n>`. Your real index, HEAD, branches, reflog and `git stash list` are never touched (the Pi example uses `git stash create`, which is also stash-list-safe but ignores untracked files).
- Skipped silently outside a git repo, and when nothing changed since the latest checkpoint.
- Skipped with a dim status note (`⏺ checkpoint skipped (rebase in progress)`) during a merge, rebase, cherry-pick or revert. `/rewind` refuses in those states too.
- Each checkpoint commit records session, turn, file count (vs HEAD) and the first line of the prompt in its message.

## Commands

- `/rewind` lists the 20 most recent checkpoints (turn, age, files changed, prompt) with `ctx.ui.select`, shows exactly what would change, asks for confirmation, then restores.
- `/rewind clean` deletes every `refs/pi-checkpoints/*` ref in this repo (after confirmation). Objects are reclaimed by `git gc`.

On `/fork` and `/tree` navigation to a user prompt, Pi asks whether to restore code to the state before that prompt (interactive modes only; never automatic). Navigation is never cancelled by this extension.

## Exactly what restore does

1. Computes the current work-tree state (same temp-index method) and diffs it against the checkpoint.
2. Shows the plan: files that will be rewritten and files that will be deleted. Asks to confirm.
3. **Saves the current state as a new checkpoint** ("before rewind"), so the restore can be undone from `/rewind`.
4. For each path that differs: rewrites it from the checkpoint (`git restore --source=<checkpoint> --worktree`), or deletes it if the checkpoint does not contain it (files created after the checkpoint, including untracked ones, plus directories emptied by that).

It does **not** touch: the index (staged state may differ from files afterwards), HEAD, branches, stash, git-ignored files, or any file identical in both states. Untracked files that exist now but not at the checkpoint *are* deleted, which is the point of a rewind; they are listed in the confirmation and recoverable through the pre-rewind checkpoint.

## Config

- `PI_CHECKPOINT_KEEP` (env, default `50`): checkpoints kept per repo; oldest are pruned after each new one.

## Caveats

- Large untracked, non-ignored files are copied into the object database on every changed snapshot; add them to `.gitignore`.
- Submodule contents are not snapshotted.
- Code state for a prompt is looked up in memory (entry id), falling back to matching the prompt text within the session.
