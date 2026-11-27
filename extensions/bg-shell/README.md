# Background shell jobs

`bash_bg` runs long-lived shell commands without blocking Pi. It keeps stdout and stderr in a private temporary log, returns new output only, and manages the whole process group on shutdown.

## Install

Install `@fadhilmch/pi-bg-shell` with Pi, or install this repository package to load all extensions.

## Usage

The `bash_bg` tool has four actions:

- `start`: provide `command` and optionally `cwd`, `name`, `waitFor`, and `waitSeconds`. A `waitFor` regular expression lets a server call wait briefly for a ready line; it is tested against the last 20,000 characters, so a match split across reads still counts. `cwd` must be an existing directory, and a command that cannot be spawned is reported as an error (the job shows as `failed`). Ctrl+C stops only that wait; the process keeps running.
- `output`: provide an `id` to read only new output, optionally filtering lines with a regular expression. With a filter, a last line without a newline is held back until it completes or the job ends.
- `stop`: send TERM to the process group and KILL after the grace period.
- `list`: show every job and its state.

Use `/jobs` to inspect jobs in a TUI overlay. A background job's exit is mentioned once before the next model turn, unless `output` already read it to the end or `stop` ended it; the tool never starts a turn by itself.

## Config

Optional user config in `~/.pi/agent/bg-shell.json`:

```json
{ "maxJobs": 5, "maxChars": 8000, "exposure": "direct" }
```

`maxJobs` is capped at 5. A project `.pi/bg-shell.json` may lower `maxJobs` or `maxChars`, never raise either limit. Output always includes a path to the full log when capped. Logs are created with mode `0600` in a temporary directory and removed on session shutdown.

Set user-level `exposure` to `"deferred"` to discover `bash_bg` through `tool_search` when needed. Project config cannot change exposure.

## How it works

On macOS and Linux, commands run under `bash -c` in a detached process group. Output is appended to a private log and decoded incrementally, including UTF-8 characters split across reads. Large output uses the repository's `output-diet` folding helper to keep the beginning, errors, and tail, with a hard character cap. At most five jobs can be active. Session shutdown stops jobs and removes the temporary directory.

Model-supplied regexes (`waitFor`, `filter`) are limited to 200 characters, run in a `node:vm` context with a one-second timeout, and match only the first 2,000 characters of each line. A catastrophic pattern fails with "regex took too long; use a simpler pattern" instead of freezing Pi. ANSI CSI and OSC escape sequences are stripped, including ones split across reads.

Each job writes a small `.pid` file in the temporary directory. When a session starts, jobs left by a previous Pi process of the same user that died without a clean shutdown are reaped: only if that Pi is no longer running and the recorded pid still leads a process group running `bash -c <the recorded command>`. Anything else is left alone.

## Cost

`/context` estimated `bash_bg` at about 267 tokens (characters divided by four). Pi's estimate covers its name, description, and parameter schema; it does not include prompt snippets or guidelines.

## Limits

The shell command has the same authority as the user's Pi process. Do not start untrusted commands. Windows termination uses `taskkill /T /F`; Windows behavior has not been tested. Job logs live only for the current Pi session. Reaping after a hard kill is skipped on Windows and cannot find a job whose group leader has already exited. A regex that takes over a second is rejected, so very heavy but legitimate patterns may need simplifying.
