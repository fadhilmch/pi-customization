# quality-on-write

After the agent's `write` or `edit` succeeds, format the file with the project's own formatter and, at the end of the run, typecheck what it touched. Errors go back to the model.

![quality-on-write](https://raw.githubusercontent.com/fadhilmch/pi-customization/main/docs/media/quality-on-write.gif)

## Install

Only this tool, by copying its folder:

```bash
npx degit fadhilmch/pi-customization/extensions/quality-on-write ~/.pi/agent/extensions/quality-on-write
```

From the whole package, loading only this extension:

```json
{
  "packages": [
    {
      "source": "git:github.com/fadhilmch/pi-customization",
      "extensions": ["extensions/quality-on-write/index.ts"],
      "themes": []
    }
  ]
}
```

From npm (once published): `pi install npm:@fadhilmch/pi-quality-on-write`. See the [root README](../../README.md#install) for the other methods.

## Usage

Nothing to run. It acts after `write`/`edit` and at the end of each run, using only tools available locally.

### Formatter detection (only if available locally)

| Files | Tool | Requires |
|---|---|---|
| js ts jsx tsx mjs cjs json jsonc css | biome | `biome.json(c)` + `node_modules/.bin/biome` |
| above + scss less md mdx yaml yml html vue | prettier | `node_modules/.bin/prettier`, or a prettier config file plus `prettier` on PATH |
| py | ruff format, else black | `ruff.toml` / `[tool.ruff]`, or `[tool.black]`; binary in .venv or PATH |
| go | gofmt | on PATH |
| rs | rustfmt | on PATH (edition from Cargo.toml) |
| sh bash | shfmt | on PATH |

No formatter, no config: nothing happens.

## Config

`~/.pi/agent/quality.json` (user, trusted) and `<cwd>/.pi/quality.json` (project):

```json
{
  "format": true,
  "typecheck": true,
  "formatters": { "ts": ["prettier", "--write", "{file}"], ".lua": ["stylua"] },
  "disable": ["prettier", "mypy"]
}
```

- `formatters`: extension -> command array, replaces auto-detection for that extension. `{file}` is substituted, otherwise the file is appended. Commands run with `execFile` (no shell).
- `disable`: tool names: `biome prettier ruff black gofmt rustfmt shfmt tsc pyright mypy`, or the command name of an override.
- Merge: `format`/`typecheck` are AND-ed, `disable` lists are unioned.

**Security.** A cloned repo must not run commands via config. The project file is restrictive-only: it may set `format: false`, `typecheck: false` and add `disable` entries. Its `formatters` field and any `true` values are ignored. Only the user file may define commands. (Note that project-local `node_modules/.bin/*` binaries and `tsc` still run, as they do whenever you run your own build tools in that project.)

## How it works

1. `tool_result` for `write`/`edit` (not `isError`, path from `event.input.path`, resolved like Pi: leading `@` stripped, `~` expanded, relative to `ctx.cwd`).
   - Runs the detected formatter (20s timeout, `execFile`, in the project root). A failure never fails the tool call.
   - If the file changed, the handler appends a text note to the tool result ("prettier reformatted a.ts ... re-read before the next edit"). Pi's edit tool matches text against the file on disk, so this warns the model that its snapshot may be stale. The formatter is awaited, so the next tool call always sees the final bytes.
   - The file is queued for typecheck.
2. `agent_before_settle` (final actionable boundary, after retries/compaction). Each touched project is checked once (60s timeout):
   - TS/TSX: project-local `node_modules/.bin/tsc --noEmit --pretty false -p <nearest tsconfig.json>`. Global tsc is never used.
   - Python: `pyright` if `pyrightconfig.json` or `[tool.pyright]`; else `mypy` (on the touched files) if `mypy.ini`, `.mypy.ini`, `[tool.mypy]` or `[mypy` in setup.cfg. Binary from project `.venv`/`venv`, node_modules, or PATH.
   - Policy: only errors in files the agent touched are fed back; pre-existing errors elsewhere are counted ("N other pre-existing errors ignored") so the model is not sent chasing them.
   - Feedback is one `custom_message` entry (first 30 lines) returned from the handler with `continue: true`, giving exactly one more model request. This is less disruptive than `sendUserMessage`: no extra user turn, and it happens inside the settle boundary. A loop guard allows at most 3 feedback rounds per user prompt and never resends an identical error set; the counter resets on `input`. Short `ctx.ui.notify` / `setStatus` messages show progress.

Files: `config.js`, `formatters.js`, `format.js`, `typecheck.js`, `check.js`, `run.js` (helpers, file system / process access injectable), `index.ts` (Pi wiring). Tests: `node --test "extensions/quality-on-write/tests/*.test.js"`. `tests/index.test.js` loads `index.ts` with a fake pi and fake local prettier/tsc binaries.

## Limits

`agent_before_settle` returning `custom_message` + `continue: true` was only exercised against stubs, as was the `tool_result` content patch showing in the TUI. Pi's built-in tool renderers may not display the appended note.
