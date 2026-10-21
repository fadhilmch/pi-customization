const assert = require("node:assert");
const { slugify, truncate } = require("./src");

const cases = [
  ["slugify lowercases", () => assert.strictEqual(slugify("Hello"), "hello")],
  ["slugify collapses repeated separators", () => assert.strictEqual(slugify("Hello,  World!"), "hello-world")],
  ["truncate keeps short text", () => assert.strictEqual(truncate("abc", 5), "abc")],
  ["truncate adds an ellipsis", () => assert.strictEqual(truncate("abcdef", 4), "abc…")],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${JSON.stringify(err.expected)}, got ${JSON.stringify(err.actual)}`);
  }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
