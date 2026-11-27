# Contributing

Thanks for helping. Small, focused changes are easiest to review.

## Layout

```
extensions/<name>/
  index.ts        wires Pi (events, commands, tools); keep it thin
  *.js            CommonJS helpers holding the logic
  tests/*.test.js node:test unit tests (and index tests with a fake pi)
  package.json    standalone package (@fadhilmch/pi-<name>) with a `pi` manifest
  README.md       Install / Usage / Config / How it works / Limits
themes/           themes that belong to no single extension
prompts/          prompt templates (/init, /commit, /pr, /ship) that belong to no single extension
tests/            repo-wide tests (themes and prompt templates)
docs/media/       gifs and screenshots used by the READMEs
```

The root `package.json` is the whole-repo Pi package: `pi.extensions` is `./extensions/*/index.ts` and `pi.themes` covers `themes/` and `extensions/*/themes/`, and `pi.prompts` covers `prompts/` and `extensions/*/prompts/`. A prompt template that needs a tool from one extension (like `/scout`) lives in that extension's `prompts/`; a general one lives in the root `prompts/`.

## Conventions

- Every extension folder must be self-contained: no imports or `require`s that reach outside it, because people install one folder at a time. Shared code is copied, not shared.
- `index.ts` imports only `@earendil-works/*` and `typebox` (provided by Pi, declared as `peerDependencies: "*"` in the folder's `package.json`) plus relative files. Add a peer dependency to the folder's `package.json` when you import a new host package.
- Logic goes in CommonJS helpers (`'use strict'`, `module.exports`) so it can be tested without Pi. Inject file system and process access where it helps tests.
- Tests use `node:test` and `node:assert/strict`. Tests that load `index.ts` run it under `node --experimental-strip-types` (Node 22.6 or newer; CI uses Node 24).
- Config files that a cloned repo can influence (`.pi/*.json`) may only tighten behaviour. Never let project config define commands to run or allow-list risky actions.
- No new runtime dependencies without a strong reason.
- Prompt templates are Markdown files with a `description` in the front matter; the file name is the command. Do not reuse a Pi built-in command name (`tests/prompts.test.js` checks the list) or another template's name. Use only the argument syntax Pi documents (`$1`, `$@`, `${@:-default}`).
- Themes: a theme file is named after its `name` and must validate (`tests/themes.test.js`).

## Running tests

```bash
npm test
```

## Testing against a real Pi

No model or API key is needed to check that an extension loads and registers its commands. Use an isolated agent directory so your own settings are untouched:

```bash
export PI_CODING_AGENT_DIR=$(mktemp -d)
echo '{"packages":["/abs/path/to/pi-customization"]}' > "$PI_CODING_AGENT_DIR/settings.json"
cd "$(mktemp -d)"
(printf '{"type":"get_commands","id":"1"}\n'; sleep 8) | pi --mode rpc --no-session --offline
```

The response lists every command with its source file, so you can confirm which extensions loaded. To test one folder, either point `packages` at `/abs/path/to/pi-customization/extensions/<name>`, use a filter object, or copy the folder into `$PI_CODING_AGENT_DIR/extensions/<name>/`.

For interactive behaviour (widgets, shortcuts, dialogs), run `pi` with the same `PI_CODING_AGENT_DIR` and a model you have access to.

## Adding an extension

1. Create `extensions/<name>/` with `index.ts`, helpers and `tests/`.
2. Copy another extension's `package.json` and change `name` (`@fadhilmch/pi-<name>`), `description`, `keywords`, `repository.directory`, `peerDependencies` and `files`.
3. Write the README with the sections Install, Usage, Config, How it works, Limits. Install shows the single-folder copy command and the filter snippet.
4. Add a row to the catalog in the root `README.md` and an entry to `CHANGELOG.md`.
5. Add `docs/media/<name>.gif` and `<name>.png` if you can record them.
6. Run `npm test`, then check the load with RPC as above.

## Pull requests

Describe what changed and why, note how you tested it, and keep unrelated changes out. Security issues go through private advisories, see [SECURITY.md](SECURITY.md).
