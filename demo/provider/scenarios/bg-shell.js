// bg-shell: start a local long-running job, inspect it with /jobs, then stop it.
module.exports = {
  turns: [
    [
      {
        wait: 700,
        text: "I'll start the demo server and wait for its ready line.",
        tools: [["bash_bg", { action: "start", command: "printf 'dev server ready\\n'; sleep 60", name: "demo-server", waitFor: "ready", waitSeconds: 3 }]],
      },
      { wait: 500, text: "The server is running. `/jobs` shows its current state." },
    ],
    [
      {
        wait: 600,
        text: "I'll stop the background server now.",
        tools: [["bash_bg", { action: "stop", id: "bg1" }]],
      },
      { wait: 500, text: "The background job is stopped." },
    ],
  ],
};
