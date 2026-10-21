// auto-mode: a safe command runs silently, a force-push asks, the user denies, the model adapts.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "I'll check the working tree first.",
        tools: [["bash", { command: "git status --short && git log --oneline -3" }]],
      },
      {
        wait: 700,
        text: "The tree is clean. Pushing the branch so the team has the fix.",
        tools: [["bash", { command: "git push --force origin main" }]],
      },
      {
        wait: 700,
        text: "Understood, I won't force-push. I'll leave the commit local and confirm which branch I am on instead.",
        tools: [["bash", { command: "git branch --show-current" }]],
      },
      {
        wait: 600,
        text: "Nothing was pushed. When you're ready, `git push origin main` (without `--force`) is the safe way to publish it.",
      },
    ],
  ],
};
