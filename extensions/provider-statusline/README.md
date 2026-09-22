# provider-statusline

Two-line Pi footer inspired by your Claude Code status line.

## What it shows

Top line:
- playful provider/model symbol
- thinking value
- context usage bar
- Claude/Codex session (`5h`) and weekly (`7d`) quota bars when available
- otherwise session cost

Bottom line:
- current working directory
- git branch

## Auto-loading

This extension auto-loads from the standalone customization repository via:

- `~/.pi/agent/settings.json`
- `~/Documents/personal_repo/pi-customization/extensions/provider-statusline/index.ts`

Reload it with:

```bash
/reload
```

## Optional quota data for Claude/Codex

Pi can use quota headers when a provider exposes them. For providers that do not expose them, this extension reads optional external JSON.

The displayed windows match the Claude Code convention: `5h` session usage and `7d` weekly usage.

### Option 1: file

Put JSON in either:

- `~/.pi/agent/provider-statusline/claude.json`
- `~/.pi/agent/provider-statusline/codex.json`

Example:

```json
{
  "fiveHour": { "usedPct": 31 },
  "sevenDay": { "usedPct": 72, "resetAt": "2026-09-24T02:00:00Z" }
}
```

### Option 2: command

Set environment variables that print JSON:

- `PI_STATUSLINE_CLAUDE_USAGE_CMD`
- `PI_STATUSLINE_CODEX_USAGE_CMD`

Example shell output:

```json
{
  "fiveHourPct": 31,
  "sevenDayPct": 72,
  "resetAt": "2026-09-24T02:00:00Z"
}
```

You can also override the file path with:

- `PI_STATUSLINE_CLAUDE_USAGE_FILE`
- `PI_STATUSLINE_CODEX_USAGE_FILE`

## Vim query editing

The query editor now has a lightweight Vim modal mode:

- Start in `INSERT` mode
- `Esc` enters `NORMAL` mode
- `i` enters insert mode
- `a` enters insert mode after the cursor
- `h`, `j`, `k`, `l` navigate
- `0`, `$`, and `x` work in normal mode
- `Esc` again returns to Pi's normal abort behavior

For full Vim, use `Ctrl+G` to open the external editor configured by `$VISUAL`/`$EDITOR`.

## Tests

```bash
node --test ~/.pi/agent/extensions/provider-statusline/tests/format.test.js
```
