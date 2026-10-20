# Custom Pi themes

## Midnight Aurora

`midnight-aurora.json` is a dark, high-contrast companion to the provider statusline. The statusline stays saturated and high-signal, while the main UI uses neon pink, teal, and lime accents so the two layers remain distinct:

- neon pink for the main UI and headings
- electric teal for links, tools, and navigation
- lime for code and successful operations
- amber/red reserved for warnings and errors

It is registered globally through `~/.pi/agent/settings.json` and can also be selected from `/settings`.

## Claude Dark

`claude-dark.json` approximates the Claude Code palette: orange `#d77757` accent, neutral greys, lavender links/code, and terminal-default (`""`) tool backgrounds so tool output is not boxed. Pair it with `extensions/claude-look/` for the bullets, spinner and header. Tests validate the colour keys against Pi's theme schema.
