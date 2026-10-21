// claude-look: tool rendering. A grep, a multi-line read (collapsed), an edit with diff, a failing command.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "Let me find where `truncate` is used and read it.",
        tools: [
          ["bash", { command: "grep -rn truncate src test.js" }],
          ["read", { path: "src/truncate.js" }],
        ],
      },
      {
        wait: 600,
        text: "The ellipsis is appended after slicing to `max - 1`, so that part is right. Let me add a word-boundary option so words are not cut in half.",
        tools: [
          [
            "edit",
            {
              path: "src/truncate.js",
              edits: [
                {
                  oldText:
                    "function truncate(text, max) {\n  if (text.length <= max) return text;\n  return text.slice(0, max - 1) + \"…\";\n}",
                  newText:
                    "function truncate(text, max, { wordBoundary = false } = {}) {\n  if (text.length <= max) return text;\n  let cut = text.slice(0, max - 1);\n  if (wordBoundary) cut = cut.replace(/\\s+\\S*$/, \"\");\n  return cut + \"…\";\n}",
                },
              ],
            },
          ],
        ],
      },
      { wait: 500, tools: [["bash", { command: "node -e \"console.log(require('./src').truncate('hello brave new world', 12, { wordBoundary: true }))\"" }]] },
      { wait: 500, tools: [["bash", { command: "node test.js" }]] },
      {
        wait: 600,
        text: "`truncate` now takes `{ wordBoundary: true }` and returns `hello brave…` instead of cutting `new` in half. The last command is a test run that still has one failing case, shown as an error result.",
      },
    ],
  ],
};
