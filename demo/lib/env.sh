#!/usr/bin/env bash
# Source me:  source demo/lib/env.sh <scenario> [extension ...]
#
# Builds a throwaway sandbox and points Pi at it. Never touches the real ~/.pi:
#   $DEMO_HOME                 fake $HOME (so "~" in Pi's header/footer is short and neutral)
#   $DEMO_HOME/.pi/agent       PI_CODING_AGENT_DIR with its own settings.json (demo provider + chosen extensions)
#   $DEMO_HOME/work/tinylib    copy of demo/sample-project, git-initialised; this becomes the cwd
# Afterwards just run:  pi --provider demo --model demo

_demo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_scenario="${1:?usage: source env.sh <scenario> [extension ...]}"
shift

# Resolve the real pi binary before HOME changes.
export PI_BIN_REAL="${PI_BIN_REAL:-$(command -v pi)}"

export DEMO_HOME="$(cd "$(mktemp -d /tmp/pi-demo.XXXXXX)" && pwd -P)"
export HOME="$DEMO_HOME"
export PI_CODING_AGENT_DIR="$DEMO_HOME/.pi/agent"
export PI_OFFLINE=1
export PI_SKIP_VERSION_CHECK=1
export PI_TELEMETRY=0
export PI_DEMO_SCENARIO="$_scenario"
export PI_DEMO_SPEED="${PI_DEMO_SPEED:-1}"
export COLORTERM=truecolor
export GIT_AUTHOR_NAME="Demo" GIT_AUTHOR_EMAIL="demo@example.com"
export GIT_COMMITTER_NAME="Demo" GIT_COMMITTER_EMAIL="demo@example.com"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

mkdir -p "$PI_CODING_AGENT_DIR"

# settings.json: demo provider + the extensions this scenario needs + the repo's theme.
_exts="\"$_demo_root/demo/provider/index.ts\""
for e in "$@"; do _exts="$_exts, \"$_demo_root/extensions/$e/index.ts\""; done
cat > "$PI_CODING_AGENT_DIR/settings.json" <<EOF
{
  "theme": "claude-dark",
  "hideThinkingBlock": true,
  "quietStartup": "header",
  "defaultProvider": "demo",
  "defaultModel": "demo",
  "extensions": [$_exts],
  "themes": ["$_demo_root/extensions/claude-look/themes/claude-dark.json"]
}
EOF
# Pre-trust the sandbox project so no trust prompt appears.
printf '{ "%s/work": true, "%s/work/tinylib": true }\n' "$DEMO_HOME" "$DEMO_HOME" > "$PI_CODING_AGENT_DIR/trust.json"

# Optional per-scenario extras (e.g. quality-on-write formatter override).
if [ -f "$_demo_root/demo/lib/extras/$_scenario.sh" ]; then
  # shellcheck disable=SC1090
  source "$_demo_root/demo/lib/extras/$_scenario.sh"
fi

mkdir -p "$DEMO_HOME/work"
cp -R "$_demo_root/demo/sample-project" "$DEMO_HOME/work/tinylib"
cd "$DEMO_HOME/work/tinylib" || return 1
git init -q -b main
git add -A
git commit -q -m "Initial commit"

# `pi` inside the sandbox is the real binary; provider/model come from settings.json.
pi() { "$PI_BIN_REAL" "$@"; }
export -f pi 2>/dev/null || true
clear
