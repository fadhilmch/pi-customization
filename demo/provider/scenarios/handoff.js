// handoff: a short first session, then /handoff generates a prompt (the `complete` text) for the next one.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "Let me look at how `slugify` is written.",
        tools: [["read", { path: "src/slugify.js" }]],
      },
      {
        wait: 600,
        text: "It replaces every non-alphanumeric character with its own hyphen, so `\"Hello,  World!\"` becomes `hello---world-`. The fix is to collapse runs and trim the ends, plus a test for unicode input.",
      },
    ],
  ],
  complete:
    "## Context\n" +
    "We are fixing `slugify` in the tinylib project. Findings so far:\n" +
    "- `src/slugify.js` turns every non-alphanumeric character into its own hyphen, so `\"Hello,  World!\"` gives `hello---world-`.\n" +
    "- The failing test is `slugify collapses repeated separators` in `test.js` (run with `node test.js`).\n\n" +
    "Files involved:\n" +
    "- src/slugify.js\n" +
    "- test.js\n\n" +
    "## Task\n" +
    "Collapse runs of separators into one hyphen, trim leading and trailing hyphens, then add a test for accented input.",
};
