# pi-customization

Personal Pi customizations, kept separately from project repositories.

## Contents

- `extensions/provider-statusline/` — dark, provider-aware footer and Vim query editor
- `themes/` — custom Pi themes
- `adapters/` — provider-specific quota integrations

The global Pi settings load the provider statusline extension from this repository.

## Development

```bash
npm test
```

Reload a running Pi session with `/reload`.

Quota snapshots are intentionally local-only. Keep them in `*.local.json` files and never commit credentials or subscription data.
