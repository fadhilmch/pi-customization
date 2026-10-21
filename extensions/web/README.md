# web

Search for useful pages and fetch a selected page or section as readable Markdown. `web_fetch` is always available; `web_search` is registered only when its user-level API key is present.

## Install

Copy the folder:

```bash
npx degit fadhilmch/pi-customization/extensions/web ~/.pi/agent/extensions/web
```

Or install from this repository with Pi's package filters:

```json
{ "packages": [{ "source": "git:github.com/fadhilmch/pi-customization", "extensions": ["extensions/web/index.ts"] }] }
```

## Usage

`web_fetch({ url, section?, maxChars? })` reads an HTTP(S) page and returns Markdown. `section` selects a heading and its nested content. If no heading matches, the tool returns the page headings. GitHub blob links are rewritten to their raw file URLs.

`web_search({ query, maxResults? })` returns up to ten titles, URLs and short snippets. It is only registered when the configured API key environment variable exists at Pi startup. `/web` shows the active setup.

## Config

User config: `~/.pi/agent/web.json` (or `$PI_CODING_AGENT_DIR/web.json`):

```json
{
  "maxChars": 12000,
  "exposure": "direct",
  "timeoutSeconds": 20,
  "allowPrivate": false,
  "allowedDomains": [],
  "blockedDomains": [],
  "search": { "provider": "exa", "apiKeyEnv": "EXA_API_KEY", "maxResults": 5 }
}
```

Exa is the default provider: set `EXA_API_KEY` to enable search. `brave` and `tavily` also work; each reads its usual variable (`BRAVE_API_KEY`, `TAVILY_API_KEY`) unless `apiKeyEnv` names another one. Without a key, `web_search` is not registered and costs nothing. Keys are read from the process environment and are never returned to the model.

A trusted project may add `.pi/web.json` to lower `maxChars` and `timeoutSeconds`, add blocked domains, and narrow `allowedDomains`. Project config cannot enable private hosts or change the search provider or key variable. Link-local and unspecified (`0.0.0.0/8`, `::`) addresses are always blocked.

Set user-level `exposure` to `"deferred"` to load web tools through `tool_search` when needed. Project config cannot change exposure.

## How it works

`guard.js` checks schemes, hostname policies, DNS answers, and private/link-local address ranges before each request and redirect. `fetch.js` uses `node:http`/`node:https` with a socket-level DNS lookup that validates every resolved address, so the connected IP is always a checked one (no DNS rebinding). It follows at most five manually validated redirects, rewrites GitHub blob URLs, reads no more than 5 MB, applies a 20-second default timeout, and decompresses gzip, deflate and br, caches successful pages for 15 minutes (at most 50 pages / 20 MB of text). Saved full-text temp files are removed when the session shuts down. `html.js` converts common documentation HTML structures; `extract.js` selects sections; `output.js` caps results and saves complete text to a mode-0600 temporary file when needed. Search uses the official Brave Search or Tavily HTTP API with injected fetch functions in tests.

Fetched page text is untrusted data. The tool does not follow links in that text. It never sends cookies or authentication headers to page hosts.

## Cost

`/context` estimated `web_fetch` at about 127 tokens and `web_search` at about 98 (characters divided by four). Pi's estimate covers names, descriptions, and parameter schemas; it does not include prompt snippets or guidelines. `web_search` adds no per-turn definition when its key is unset. A real Microsoft Agent Framework overview request returned 57,542 raw HTML characters through a plain request and 10,593 formatted characters through `web_fetch` (under the 12,000-character cap). The site negotiated `text/markdown`, so HTML conversion was covered by fixtures rather than this live measurement.

## Limits

The HTML converter targets readable documentation, not pixel-perfect browser rendering. PDF, image and other binary page types return an error. Users who explicitly set `allowPrivate` can fetch private and loopback hosts, but never link-local or unspecified addresses. The tool uses Node's built-in http, https, zlib and DNS modules and adds no runtime dependencies. Real-model/API-key tests were not performed during unit testing; Windows behavior has not been tested.
