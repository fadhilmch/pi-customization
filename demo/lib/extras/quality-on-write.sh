# Sourced by env.sh. No prettier/biome is available offline, so the (trusted) user config of the fake home
# points .js files at demo/lib/mini-format, the same override mechanism a real user would use.
chmod +x "$_demo_root/demo/lib/mini-format"
printf '{ "formatters": { "js": ["%s/demo/lib/mini-format", "{file}"] } }\n' "$_demo_root" > "$PI_CODING_AGENT_DIR/quality.json"
