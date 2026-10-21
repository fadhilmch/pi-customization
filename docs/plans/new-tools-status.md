# New tools implementation status

Implementation lives on `feat/new-tools` in worktree `/private/tmp/pi-customization-web-fetch`. The output-diet prerequisite was merged to `origin/main` as `2542d1b`; the isolated branch merged that prerequisite as `fb05696`. Main in the original worktree was not edited. Tool implementation is in `5f36a90`, following guard commit `9cb5262`; searchable-description fix is `e7433c1`; web review fixes are `ca5f1b9`.

## Implemented

- `web_fetch` validates public HTTP(S) targets and redirects, caps response bytes and returned text, converts common HTML, extracts heading sections, caches results, and marks fetched content untrusted. `web_search` supports Brave and Tavily, registers only when its configured key exists, caps results, blocks redirects, and combines caller cancellation with a timeout.
- `bash_bg` starts background jobs, reads incremental output, handles process-group shutdown, limits and folds output, reports exits once, and exposes `/jobs` plus a status line.
- Notebook reads render `.ipynb` files by cell; `notebook_edit` replaces, inserts, or deletes a cell through Pi's file mutation queue. Fixtures cover nbformat 4.4/4.5, images, errors, cell edits, output caps, and serialization.
- Guards cover the new shell, notebook, and web tools. Five user configs support `direct` or `deferred`; project config cannot set exposure. Deferred startup activates `tool_search`, or activates the target tool if search is unavailable. Notebook direct mode remains context-activated.
- Added web, notebook, and background-shell demo scenarios and tapes, plus a notebook fixture.

## Validated

- Final full `npm test` passed 323/323 after merging the prerequisite and web review fixes.
- Pi 1.3.0 post-merge RPC passed: `/web`, `/jobs`, and `/diet` loaded among 18 commands with empty stderr. An all-deferred load showed six active tools and omitted `ask_user`, `subagent`, `web_fetch`, `bash_bg`, and `notebook_edit`; every extension reported its fallback action.
- A real `github-copilot/gpt-6-luna` session used `tool_search` to load `ask_user`, then called it successfully; the expected noninteractive result was returned. Three provider-reported request totals were 1,382, 2,201, and 2,314 tokens (5,897 total, estimated $0.00045352). This is the complete scenario cost, not the marginal discovery cost. Temporary auth was removed after the check.
- Direct `/context` estimates (characters divided by four) were: `ask_user` 316, `subagent` 260, `bash_bg` 267, `notebook_edit` 183, `web_fetch` 127, `web_search` 98. These estimates include name, description, and parameter schema only; prompt snippets and guidelines are excluded.
- A live Microsoft Agent Framework overview returned 57,542 raw HTML characters via a plain request and 10,593 formatted characters through `web_fetch`. The server negotiated Markdown, so the live check did not exercise HTML conversion.
- Root separately smoke-tested the real background-job helper with a local HTTP server: readiness wait, HTTP 200, log output, stop, and no surviving process.
- Local `node:http` fetch tests require permission to bind loopback. Jupyter is not installed.

## Still pending

- Test Brave or Tavily against a real API key; no key was used.
- Run real-model deferred discovery and calls for `subagent`, `web_fetch`, `web_search`, `bash_bg`, and `notebook_edit`; only `ask_user` has real-model coverage. Measure marginal discovery cost separately if needed.
- Validate notebook open/save in Jupyter or VS Code and benchmark a representative MLOps notebook.
- Record the visible UI tapes. VHS crashed with a runtime SIGSEGV in this environment, so no screenshots or GIFs are claimed.
- Organize separate non-stacked tool branches/PRs from updated `main`; this integration branch is not a substitute for that delivery workflow.
