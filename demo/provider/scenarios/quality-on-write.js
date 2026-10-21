// quality-on-write: the model writes a sloppily formatted file; the formatter rewrites it and the tool result says so.
module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "I'll add the `titleCase` helper.",
        tools: [
          [
            "write",
            {
              path: "src/titleCase.js",
              content:
                "function   titleCase( input ){\n" +
                "return input.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')\n" +
                "}\n" +
                "module.exports={titleCase}\n",
            },
          ],
        ],
      },
      {
        wait: 600,
        text: "The tool result says the formatter rewrote the file, so I'll re-read it before editing again.",
        tools: [["read", { path: "src/titleCase.js" }]],
      },
      { wait: 500, text: "`titleCase` is in place and formatted: two-space indent, double quotes, semicolons, one call per line." },
    ],
  ],
};
