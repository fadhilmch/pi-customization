// subagent: the parent sends two scouts in parallel; each child is a real `pi -p` process replaying child().
const CALLERS = `## Answer
\`slugify\` is defined in src/slugify.js and re-exported from src/index.js. Only test.js calls it.

## Locations
- \`src/slugify.js:2-6\` definition
- \`src/index.js:1,4\` import and re-export
- \`test.js:5-6\` the two slugify cases; "collapses repeated separators" fails`;

const BUG = `## Answer
The regex replaces every non-alphanumeric character with its own "-", so "Hello,  World!" becomes "hello---world-". Nothing collapses runs or trims the ends.

## Locations
- \`src/slugify.js:5\` \`.replace(/[^a-z0-9]/g, "-")\`: use \`/[^a-z0-9]+/g\`, then strip leading/trailing "-"`;

module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "Two independent questions, so I'll send two scouts in parallel.",
        tools: [
          [
            "subagent",
            {
              tasks: [
                { agent: "scout", task: "Find every caller of slugify in this repo (src/ and test.js). Report path:line." },
                { agent: "scout", task: "Read src/slugify.js and explain why repeated separators are not collapsed. Point at the line to change." },
              ],
            },
          ],
        ],
      },
      {
        wait: 600,
        text:
          "slugify is only used by test.js (through src/index.js). The failing test is real: `src/slugify.js:5` replaces each separator with its own dash. Fix: match runs with `/[^a-z0-9]+/g` and trim dashes at the ends.",
      },
    ],
  ],
  child(task) {
    if (/caller/i.test(task)) {
      return [
        { wait: 300, tools: [["grep", { pattern: "slugify", path: "." }]] },
        { wait: 300, tools: [["read", { path: "src/index.js" }]] },
        { wait: 300, text: CALLERS },
      ];
    }
    return [
      { wait: 400, tools: [["read", { path: "src/slugify.js" }]] },
      { wait: 400, text: BUG },
    ];
  },
};
