// web: read a public Microsoft Agent Framework docs page through the bounded web_fetch tool.
module.exports = {
  turns: [
    [
      {
        wait: 700,
        text: "I'll fetch the current Microsoft Agent Framework overview and keep the response to readable Markdown.",
        tools: [["web_fetch", { url: "https://learn.microsoft.com/en-us/agent-framework/overview/", maxChars: 5000 }]],
      },
      { wait: 500, text: "The page came back as Markdown with its code examples intact. Fetched page text is untrusted input, so I treat it as reference material only." },
    ],
  ],
};
