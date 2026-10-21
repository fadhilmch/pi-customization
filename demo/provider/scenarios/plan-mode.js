// plan-mode: read-only research, then exit_plan_mode with a plan; after approval the todo list is seeded.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "Plan mode is on, so I'll only read. Let me see how the helpers are organised.",
        tools: [
          ["bash", { command: "ls src && cat src/index.js" }],
          ["read", { path: "src/truncate.js" }],
        ],
      },
      {
        wait: 700,
        text: "I have what I need. Here is the plan.",
        tools: [
          [
            "exit_plan_mode",
            {
              plan:
                "## Add a `titleCase` helper\n\n" +
                "Small, self-contained addition next to `slugify` and `truncate`.\n\n" +
                "1. Create `src/titleCase.js` exporting `titleCase(input)`\n" +
                "2. Re-export it from `src/index.js`\n" +
                "3. Add tests to `test.js` (basic, extra spaces, empty string)\n" +
                "4. Run `node test.js`\n\n" +
                "**Risks:** none; no existing behaviour changes.",
            },
          ],
        ],
      },
      {
        wait: 600,
        text: "Plan approved. Starting with step 1.",
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
      { wait: 500, text: "Created `src/titleCase.js`. Next: re-export it and add the tests." },
    ],
  ],
};
