// hero: fix a failing test. bash (fail) -> read -> edit (diff) -> bash (pass) -> summary.
module.exports = {
  turns: [
    [
      {
        wait: 900,
        think: "Run the tests first to see what fails.",
        text: "I'll run the test suite to see what's failing.",
        tools: [["bash", { command: "node test.js" }]],
      },
      {
        wait: 600,
        text: "`slugify` leaves repeated separators in place. Let me look at the implementation.",
        tools: [["read", { path: "src/slugify.js" }]],
      },
      {
        wait: 700,
        text: "Every non-alphanumeric character becomes its own hyphen. Collapsing runs of them and trimming the ends fixes it.",
        tools: [
          [
            "edit",
            {
              path: "src/slugify.js",
              edits: [
                {
                  oldText: '    .replace(/[^a-z0-9]/g, "-");',
                  newText: '    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-+|-+$/g, "");',
                },
              ],
            },
          ],
        ],
      },
      { wait: 500, tools: [["bash", { command: "node test.js" }]] },
      {
        wait: 600,
        text: "All four tests pass now. `slugify` collapses repeated separators and trims leading/trailing hyphens, so `\"Hello,  World!\"` becomes `hello-world`.",
      },
    ],
  ],
};
