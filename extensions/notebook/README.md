# Notebook tools

The notebook extension renders `.ipynb` files as cells when `read` completes and adds `notebook_edit` for cell-based changes. Outputs that do not help with code are omitted instead of sending raw JSON and image payloads to the model.

## Install

Install `@fadhilmch/pi-notebook` with Pi, or install this repository package to load all extensions.

## Usage

Read `.ipynb` with the normal `read` tool. Its `offset` and `limit` are cell numbers for notebooks. Markdown and code sources are rendered as text; stream outputs are capped at 20 lines; errors keep the exception and last five traceback lines; image and other binary data become small placeholders. If the full rendering exceeds the cap, the result includes a private temporary file path.

Use `notebook_edit` with a cell number or cell id:

```json
{ "path": "train.ipynb", "cell": 3, "mode": "replace", "source": "model.fit(x, y)" }
```

Modes are `replace`, `insert`, and `delete`. Insert `cell: 0` at the top; a numeric cell inserts after that cell. For code cells, replace clears saved outputs and execution count. The tool serializes with Jupyter's one-space JSON formatting and a trailing newline.

## Config

Optional user config in `~/.pi/agent/notebook.json`:

```json
{ "maxChars": 12000, "exposure": "direct" }
```

The cap is bounded to 50,000 characters. A project `.pi/notebook.json` may lower it, never raise it.

Set user-level `exposure` to `"deferred"` to discover `notebook_edit` through `tool_search`; direct mode still activates it only in projects with notebooks. Project config cannot change exposure.

## How it works

The `read` result hook reads the file from disk, so Pi's raw JSON truncation does not prevent rendering. `notebook_edit` queues its complete read-modify-write with Pi's `withFileMutationQueue`, preventing races with the built-in `write` and `edit`. Cell ids are generated for nbformat 4.5 or newer. The editor is inactive in projects without notebooks and activates when a tracked notebook is found or the first notebook is read.

## Cost

`/context` estimated `notebook_edit` at about 183 tokens (characters divided by four). Pi's estimate covers its name, description, and parameter schema; it does not include prompt snippets or guidelines. Its direct mode activates only in projects with notebooks; deferred mode uses `tool_search`.

## Limits

Notebook source is prioritized over outputs. HTML display output is stripped to text only when no `text/plain` alternative exists. Oversized rendered content is saved in a mode-0600 temp file and removed at session shutdown. Real MLOps notebook size measurements and validation with Jupyter/VS Code are pending; automated fixtures cover the nbformat 4.4/4.5 boundary and output types.
