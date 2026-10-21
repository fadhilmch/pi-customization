// ask-user: the model asks two questions in one ask_user call instead of guessing, then acts on the answers.
// The tape answers Scope with the second option and Output with a typed "Other" answer.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "Two details change how I fix this, and I can't infer them from the code, so I'll ask once.",
        tools: [
          [
            "ask_user",
            {
              questions: [
                {
                  question: "How far should the slugify fix go?",
                  header: "Scope",
                  options: [
                    { label: "Collapse separators (Recommended)", description: "Only merge repeated dashes and spaces; smallest diff" },
                    { label: "Also trim edges", description: "Collapse and strip leading/trailing separators" },
                    { label: "Rewrite with a library", description: "Replace the helper with a slug package" },
                  ],
                },
                {
                  question: "What should slugify return for an empty string?",
                  header: "Empty input",
                  options: [
                    { label: "Empty string (Recommended)", description: "Keeps the current behaviour" },
                    { label: "Throw an error", description: "Callers must handle bad input" },
                    { label: "null", description: "Signals that there is no slug" },
                  ],
                },
              ],
            },
          ],
        ],
      },
      {
        wait: 700,
        text: "Thanks. I'll collapse repeated separators and trim the edges, and return the fallback you typed for empty input. No library needed, so no new dependency.",
      },
    ],
  ],
};
