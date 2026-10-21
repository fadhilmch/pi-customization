# auto-mode

Claude Code style "auto mode" for Pi: safe tool calls run silently, risky ones ask, catastrophic ones are blocked.

![auto-mode](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/auto-mode.gif)

Pi by default runs `bash`, `write` and `edit` with no confirmation at all. This extension adds a deterministic, rule-based gate on every `tool_call` (no LLM call, no network). It is a guard, not a sandbox: see [Limits](#limits) and [SECURITY.md](../../SECURITY.md).

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/auto-mode ~/.pi/agent/extensions/auto-mode
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/auto-mode/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-auto-mode`. See the [root README](../../README.md#install) for the other methods.

## Usage

Commands: `/auto`, `/auto auto|ask|off|status`, shortcut `ctrl+alt+a`.

### Modes

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Classify each tool call. Safe calls run silently, risky ones ask, risky ones with no UI are blocked. |
| `ask` | Confirm every `bash` / `powershell` / `write` / `edit` call (and unknown/MCP tools). Plain reads still run. |
| `off` | Never ask. Catastrophic commands (below) and your own `deny` rules are still hard-blocked. |

Switch with `/auto` (no argument cycles `auto > ask > off`), `/auto auto`,
`/auto ask`, `/auto off`, `/auto status`, or the shortcut **Ctrl+Alt+A**
(same cycle). Ctrl+Alt+A is not bound by any Pi default; Shift+Tab is left
alone because Pi uses it for the thinking level. The mode is per session and not
persisted; set the startup mode in the config (below).

The mode is announced with `ctx.ui.setStatus("auto-mode", ...)` and a
`ctx.ui.notify` on every change. Pi's default footer and
`provider-statusline` both show the status (e.g. `⏵⏵ auto mode`).

### Confirmation prompt

A risky call shows a select dialog with a short reason (for example
`git push --force to main`) and the command, with options:

- **Allow once**
- **Allow for this session** - remembers the rule signature (rule plus its key
  argument, e.g. `rm-recursive:dist`), so `rm -rf dist` stops asking but
  `rm -rf other` and a force push still do
- **Deny** - the tool call is blocked with a message telling the model the user
  declined, so it adapts instead of retrying

Cancelling the dialog counts as Deny. With no UI (print/RPC mode) risky calls
are blocked.

### Rules (auto mode)

Bash commands are split on `&&`, `||`, `;`, `|`, `&`, newlines, subshells, `$(...)`,
backticks and `<(...)`; every part is classified and the call asks if any part
is risky. Wrappers (`sudo`, `env`, `time`, `nohup`, `timeout`, `xargs`,
`bash -c "..."`, `find -exec`) are unwrapped and the inner command classified.

| Category | Asks for |
| --- | --- |
| Delete | `rm -r/-rf/-fr/--recursive`, `rm -f` with wildcards, `find -delete`, `rimraf`, `shred` |
| Git | any `push` (higher severity: `--force`, `+ref`, `--delete`, `:ref`, or to main/master/trunk/prod/release); `reset --hard`; `clean -f`; `checkout`/`restore`/`switch` that discards changes; `branch -D`; `rebase` (not `--abort`); `stash drop/clear`; `filter-branch`; `reflog expire`; `gc --prune`; `tag -d` |
| Privilege | `sudo`, `doas`, `su`, `pkexec` |
| Permissions | `chmod`/`chown`/`chgrp` with `-R`, or `chmod 777`/`a+rwx` |
| Code from the network | `curl`/`wget` piped into `sh`/`bash`/`python`..., piping anything into a shell, `bash <(curl ...)`, `eval`, `base64 -d \| sh` |
| Publishing | `npm`/`pnpm`/`yarn`/`bun publish`, `unpublish`, `deprecate`, `twine upload`, `cargo publish`, `gem push`, `poetry/uv publish`, `gh release create/delete/upload`, `vsce publish` |
| GitHub | `gh pr merge`, `gh repo delete/archive/rename/edit`, `gh api` with `-X POST/PATCH/PUT/DELETE` or `-f/-F`, `gh secret/variable set/delete` |
| Infra / deploy | `kubectl apply/delete/scale/rollout/patch/exec/...`, `helm install/upgrade/uninstall/rollback`, `terraform/tofu apply/destroy/import/state rm`, `pulumi up/destroy`, `docker push`, `docker system/volume/... prune`, `docker volume rm`, `docker run --privileged`, `ansible-playbook`, `vercel/netlify/fly/firebase/wrangler/cdk/serverless/heroku deploy|destroy|--prod` |
| Cloud CLIs | `aws` actions that are not get/list/describe-style (and `s3 rm/sync/mv/rb/mb`, uploads), `gcloud`/`az` with mutating verbs (create, delete, update, set-*, ...), `gsutil rm/mv/rsync`, `bq rm/mk/load` |
| Databases | `DROP`, `TRUNCATE`, `DELETE FROM` / `UPDATE` without `WHERE` inside `psql`/`mysql`/`sqlite3`/`mongosh`/`redis-cli`..., `FLUSHALL`, `dropdb`, `prisma migrate reset`, `rails db:drop` |
| Processes / system | `killall`, `pkill`, `kill -9` and broad kills (plain `kill PID` is allowed), `shutdown`/`reboot`, `launchctl`/`systemctl` start/stop, `crontab` edits |
| Global installs | `npm/pnpm/yarn/bun -g`, `pip install/uninstall` with no active virtualenv, `brew install/uninstall/upgrade`, `apt/dnf/pacman...`, `cargo install`, `gem install`, `go install` |
| Network writes / remote | `curl -X POST/PUT/PATCH/DELETE`, `-d`, `-F`, `-T` (non-localhost), `ssh`, `scp`, `sftp`, `nc`, `rsync` to a remote host |
| Secrets | any command whose arguments or redirects touch `.env*` (not `.env.example`), `*.pem`, `*.key`, `*.p12`, `id_rsa*`/`id_ed25519*` (not `.pub`), `.ssh/`, `.aws/`, `.gnupg/`, `.azure/`, `.kube/config`, `.docker/config.json`, `.npmrc`, `.pypirc`, `.netrc`, `credentials*.*`, `secrets*.*` |
| Writes outside the project | redirections (`>`, `>>`, `&>`, `tee`) and `cp`/`mv`/`ln`/`install`/`rsync`/`touch`/`mkdir`/`sed -i`/`dd of=`/`curl -o` targets outside `ctx.cwd` (after resolving `~`, `..`, and symlinks) or built from unresolved variables |
| Parse uncertainty | unbalanced quotes, `$'...'`, a command name from a variable or substitution, very long commands, and heredocs fed to anything but `cat`/`tee`/`git`/`gh`/`jq`-style tools |

#### Hard denials (every mode, including `off`)

`rm -rf` (recursive) of `/`, `~`, `$HOME`, `/*`, `~/*`, `/usr`, `/etc`, `/Users`...,
`rm --no-preserve-root`, recursive `chmod`/`chown` of those, `mv` of those, `mkfs*`, `dd of=/dev/disk*`/`sd*`,
redirects into block devices, `diskutil erase*`, fork bombs, plus your own `deny` regexes.

#### File tools

| Tool | Behaviour |
| --- | --- |
| `write`, `edit` | Allowed inside `ctx.cwd`. Asks for paths outside it (including via `..`, `~`, symlinks), for secret files (list above), for `.git/` internals, CI config (`.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `Jenkinsfile`, `azure-pipelines.yml`), the auto-mode config itself and `.pi/extensions/`, and for `protectedPaths` matches. Lockfiles are not special. OS temp dirs (`/tmp`, `$TMPDIR`) are treated as scratch space and allowed. |
| `read`, `grep`, `find`, `ls` | Allowed anywhere, except secret files (the `path`, or a `grep` glob / `find` pattern that targets them). |
| Anything else (MCP / custom tools) | Allowed in `auto` (we cannot know what they do), asked in `ask`. Use `ask` rules in the config to gate specific tools (matched against `toolName {json input}`). |

## Config

Optional JSON, merged in this order: `~/.pi/agent/auto-mode.json` (user), `<cwd>/.pi/auto-mode.json` (project).

```json
{
  "mode": "auto",
  "allow": ["^git push origin feature/"],
  "ask": ["^make deploy"],
  "deny": ["^terraform destroy"],
  "protectedPaths": ["src/generated/**", "*.lock", "~/notes/**"]
}
```

- `mode`: startup mode (`auto`, `ask`, `off`).
- `allow`: JS regexes, each tested against a single command segment (so `^git push` cannot smuggle `&& rm -rf x`), or against `write /abs/path` / `edit /abs/path` for file tools. A match skips the built-in rules for that segment. It never overrides hard denials or parse uncertainty.
- `ask`: regexes that force a confirmation.
- `deny`: regexes that always block (also in `off` mode).
- `protectedPaths`: globs (`*`, `**`, `?`). A leading `/` or `~/` anchors the glob; anything else matches at any depth. Matching paths ask for writes, edits, redirects and reads.

Invalid JSON or regexes are skipped and reported as warnings at session start.

### Project config can only be stricter

A cloned repository can ship `.pi/auto-mode.json`, so it is untrusted. From the
project file only `ask`, `deny` and `protectedPaths` are used. `allow` is
ignored, and `mode` is honoured only when it is stricter than the user's
(`auto` -> `ask`); `"mode": "off"` from a project is ignored. Only the
user-level file, or the `/auto` command, can loosen anything. Warnings tell you
when project settings were ignored. Edits to `.pi/auto-mode.json` by the agent
are themselves a confirmation-required write.

## How it works

- `index.ts` - wires Pi: `tool_call` gate, `/auto` command, Ctrl+Alt+A shortcut, status.
- `gate.js` - mode state, session allow-list, confirmation prompt.
- `classify.js` - tool call -> `allow | ask | deny` decision.
- `bash-rules.js`, `shell.js`, `paths.js`, `config.js` - rules, splitter, path/glob helpers, config merge.
- `tests/` - `node --test extensions/auto-mode/tests/*.test.js`.

## Limits

- This is a regex/token-based heuristic, **not a sandbox**. A determined (or
  confused) model can bypass it: `python -c "shutil.rmtree(...)"`, `node -e`,
  scripts it wrote earlier and then runs (`bash ./cleanup.sh`), `curl -o x && sh x`,
  aliases/functions, `git -c alias...`, unusual flags the rules do not know, tools
  that run commands (make targets, npm scripts, package managers' lifecycle hooks).
- Wrapper handling is approximate (option values are not fully understood), and
  shell parsing is a purpose-built splitter, not a full POSIX parser; uncertain
  input leans to asking.
- Unknown/MCP tools are allowed in `auto`.
- Writes through `bash` to in-project paths are not checked beyond the rules above
  (the project itself is considered "yours").
- The session allow-list and the mode live in memory only.
- For real isolation use a container/VM or Pi's sandbox example.
