// output-diet: a noisy 2000-line build/test log with a few errors in the middle, then the same file read twice.
// The tool results Pi keeps (and re-sends every turn) are folded / deduplicated by the extension.
const script =
  "for (let i = 1; i <= 2000; i++) {" +
  " if (i === 700) console.log('FAIL src/slugify.test.js: AssertionError: expected a-b but got a--b');" +
  " else if (i === 1200) console.log('ERROR: Traceback (most recent call last): ValueError at step 1200');" +
  " else if (i === 1201 || i === 1202) console.log('  File train.py, line ' + i + ', in step');" +
  " else if (i === 1650) console.log('npm ERR! code ELIFECYCLE');" +
  " else console.log('2026-10-21T10:00:00Z INFO step ' + i + '/2000 loss=0.' + (9000 - i) + ' lr=3e-4 batch=' + (i % 64));" +
  "}";

module.exports = {
  turns: [
    [
      {
        wait: 800,
        text: "I'll run the full build and look at what it reports.",
        tools: [["bash", { command: `node -e "${script}"` }]],
      },
      {
        wait: 600,
        text: "Three problems in the middle of the log. Let me read the test file.",
        tools: [["read", { path: "test.js" }]],
      },
      {
        wait: 600,
        text: "Reading it once more to double-check the expectations.",
        tools: [["read", { path: "test.js" }]],
      },
      { wait: 500, text: "The test file is unchanged since my first read, and the log shows one failing test, one traceback and an npm failure." },
    ],
  ],
};
