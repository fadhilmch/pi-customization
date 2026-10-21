# Background shell jobs

`bash_bg` runs long-lived shell commands without blocking Pi. It keeps stdout and stderr in a private temporary log, returns new output only, and manages the whole process group on shutdown.

## Install

Install `@fadhilmch/pi-bg-shell` with Pi, or install this repository package to load all extensions.

## Usage

The `bash_bg` tool has four actions:

- `start`: provide `command` and optionally `cwd`, `name`, `waitFor`, and `waitSeconds`. A `waitFor` regular expression lets a server call wait briefly for a ready line. Ctrl+C stops only that wait; the process keeps running.
- `output`: provide an `id` to read only new output, optionally filtering lines with a regular expression.
- `stop`: send TERM to the process group and KILL after the grace period.
- `list`: show every job and its state.

Use `/jobs` to inspect jobs in a TUI overlay. A background job's exit is mentioned once before the next model turn; the tool never starts a turn by itself.

## Config

Optional user config in `~/.pi/agent/bg-shell.json`:

```json
{ "maxJobs": 5, "maxChars": 8000, "exposure": "direct" }
```

`maxJobs` is capped at 5. A project `.pi/bg-shell.json` may lower `maxJobs` or `maxChars`, never raise either limit. Output always includes a path to the full log when capped. Logs are created with mode `0600` in a temporary directory and removed on session shutdown.

Set user-level `exposure` to `"deferred"` to discover `bash_bg` through `tool_search` when needed. Project config cannot change exposure.

## How it works

On macOS and Linux, commands run under `bash -c` in a detached process group. Output is appended to a private log and decoded incrementally, including UTF-8 characters split across reads. Large output uses the repository's `output-diet` folding helper to keep the beginning, errors, and tail, with a hard character cap. At most five jobs can be active. Session shutdown stops jobs and removes the temporary directory.

## Cost

`/context` estimated `bash_bg` at about 267 tokens (characters divided by four). Pi's estimate covers its name, description, and parameter schema; it does not include prompt snippets or guidelines.

## Limits

The shell command has the same authority as the user's Pi process. Do not start untrusted commands. Windows termination uses `taskkill /T /F`; Windows behavior has not been tested. Job logs live only for the current Pi session.
