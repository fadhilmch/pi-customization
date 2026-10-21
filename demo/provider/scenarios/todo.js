// todo: multi-step task; the widget above the editor updates as the model checks items off.
const T = (statuses) =>
  [
    ["Add titleCase helper", "Adding titleCase helper"],
    ["Export it from the index", "Exporting it from the index"],
    ["Add tests for titleCase", "Adding tests for titleCase"],
    ["Run the test suite", "Running the test suite"],
  ].map(([content, activeForm], i) => ({ content, activeForm, status: statuses[i] }));

module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "This has a few steps, so I'll track them.",
        tools: [["todo", { todos: T(["in_progress", "pending", "pending", "pending"]) }]],
      },
      {
        wait: 500,
        tools: [
          [
            "write",
            {
              path: "src/titleCase.js",
              content:
                "// Capitalise the first letter of every word.\nfunction titleCase(input) {\n  return input.replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n\nmodule.exports = { titleCase };\n",
            },
          ],
        ],
      },
      { wait: 300, tools: [["todo", { todos: T(["completed", "in_progress", "pending", "pending"]) }]] },
      {
        wait: 500,
        tools: [
          [
            "edit",
            {
              path: "src/index.js",
              edits: [
                { oldText: 'const { truncate } = require("./truncate");', newText: 'const { truncate } = require("./truncate");\nconst { titleCase } = require("./titleCase");' },
                { oldText: "module.exports = { slugify, truncate };", newText: "module.exports = { slugify, truncate, titleCase };" },
              ],
            },
          ],
        ],
      },
      { wait: 300, tools: [["todo", { todos: T(["completed", "completed", "in_progress", "pending"]) }]] },
      {
        wait: 500,
        tools: [
          [
            "edit",
            {
              path: "test.js",
              edits: [
                { oldText: 'const { slugify, truncate } = require("./src");', newText: 'const { slugify, truncate, titleCase } = require("./src");' },
                {
                  oldText: '  ["truncate keeps short text"',
                  newText: '  ["titleCase capitalises each word", () => assert.strictEqual(titleCase("hello brave world"), "Hello Brave World")],\n  ["truncate keeps short text"',
                },
              ],
            },
          ],
        ],
      },
      { wait: 300, tools: [["todo", { todos: T(["completed", "completed", "completed", "in_progress"]) }]] },
      { wait: 400, tools: [["bash", { command: "node -e \"console.log(require('./src').titleCase('hello brave world'))\"" }]] },
      { wait: 300, tools: [["todo", { todos: T(["completed", "completed", "completed", "completed"]) }]] },
      { wait: 500, text: "Done. `titleCase` is added, exported, covered by a test, and `titleCase('hello brave world')` returns `Hello Brave World`." },
    ],
  ],
};
