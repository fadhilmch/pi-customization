// git-checkpoint: one real edit, then /rewind restores the file.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "I'll make `slugify` trim leading and trailing separators.",
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
      { wait: 600, text: "Done. `slugify` now collapses runs of separators and trims the ends." },
    ],
  ],
};
