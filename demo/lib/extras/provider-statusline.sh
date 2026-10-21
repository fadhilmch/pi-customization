# Sourced by env.sh. Footer demo: quota bars only render for the claude/codex provider kinds, so the demo
# model is registered under the id "openai-codex" and fed a fixture quota file (no network, no real account).
export PI_DEMO_PROVIDER=openai-codex
mkdir -p "$PI_CODING_AGENT_DIR/provider-statusline"
_reset="$(date -u -v+2d -v+5H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+2 days 5 hours' +%Y-%m-%dT%H:%M:%SZ)"
printf '{ "fiveHourPct": 42, "sevenDayPct": 18, "resetAt": "%s" }\n' "$_reset" > "$PI_CODING_AGENT_DIR/provider-statusline/codex.json"
