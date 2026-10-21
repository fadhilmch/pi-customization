# subagent: child processes start with no extensions (-ne), so give them the demo provider through
# the extension's own user config. Children then reach the same fake "demo/demo" model as the parent.
cat > "$PI_CODING_AGENT_DIR/subagent.json" <<JSON
{ "extensions": ["$_demo_root/demo/provider/index.ts"] }
JSON
