# Security policy

## Reporting a vulnerability

Please report privately through GitHub security advisories: <https://github.com/fadhilmch/pi-customization/security/advisories/new>. Do not open a public issue. Expect an acknowledgement within a few days.

## Scope and expectations

- Extensions run with your user's permissions inside Pi. Read the source before installing, this package included.
- **auto-mode is not a sandbox.** It classifies tool calls with patterns and tokenizing, so a determined or confused model can get around it (interpreters like `python -c`, scripts written and then run, aliases, unknown tools). Use a container or VM for untrusted work. A command that should have asked but did not is a rule gap: please file a normal issue.
- Worth a private report: a way to bypass a hard denial, a way for a cloned repository's `.pi/*.json` to loosen `auto-mode` or run commands via `quality-on-write`, command injection through notification text, or leaking secrets via the statusline or quota snapshots.
- Quota snapshots for the statusline are local-only. Keep them in `*.local.json` (git-ignored) and never commit credentials.

## Supported versions

Only the latest release.
