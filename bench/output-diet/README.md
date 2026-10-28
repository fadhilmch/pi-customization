# output-diet benchmark

Measures how much text `extensions/output-diet` removes from long `bash` output and whether the important lines are still visible. It calls `fold()` with the default config. No model, no network.

```bash
node bench/output-diet/run.js            # table
node bench/output-diet/run.js --json
node bench/output-diet/run.js --strict   # regression check, see below
```

Tokens are `chars / 4`, the estimate output-diet uses for its own `/diet` numbers. It is not a tokenizer count and not a price.

## What it shows

Each case is a generated output shaped like a common tool run (tests, install, build, repeated errors) with a list of lines the model must still see. The table gives tokens before and after, the share removed, and how many of those lines are no longer visible in the folded text.

The outputs are **synthetic**. The saving is illustrative, not a rate you will see in real sessions; it depends on how much of your output is noise. Use `/diet` for real numbers in a session.

## Losses are findings

Three cases lose visible lines on purpose, because they show what the fold does:

- more than 40 distinct error lines: only the first 40 are shown, the rest are counted in a note;
- error lines that differ only in numbers or hashes count as repeats of the first one;
- a long middle with no error keyword is folded away (the full output is saved to a file and the note says where).

The full output is saved to a file in every case and the note says how many lines were folded, so nothing is gone for good. But the model only sees the folded text unless it reads the file.

`--strict` exits 1 when a loss appears in a case that is not listed as an expected loss in `run.js`, or when a listed loss stops happening. It exits 0 while the three losses above remain. A green run is a regression check, not proof that folding is safe.

## Limits

- Synthetic inputs, one config (the defaults).
- Visibility is a substring check on the folded text, not whether the model would notice the line.
- Per-tool folders (git, tests, tsc, installs) in a separate PR (#19) are not in this benchmark.
