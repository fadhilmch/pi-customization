'use strict';

const vm = require('node:vm');

const MAX_PATTERN = 200;
const MAX_LINE = 2000;
const DEFAULT_TIMEOUT_MS = 1000;

// Model-supplied regexes run in a separate vm context with a timeout, so a
// catastrophic pattern fails with an error instead of freezing Pi's main thread.
function createMatcher(pattern, label, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const source = String(pattern);
  if (source.length > MAX_PATTERN) throw new Error(`${label} regex is limited to ${MAX_PATTERN} characters`);
  try { new RegExp(source, 'i'); } catch { throw new Error(`${label} must be a valid regular expression`); }
  const context = vm.createContext({ __source: source, __text: '', __max: MAX_LINE });
  vm.runInContext('var __re = new RegExp(__source, "i");', context);
  const testScript = new vm.Script('__re.test(__text)');
  const filterScript = new vm.Script('__text.split(/(?<=\\n)/).filter((l) => __re.test(l.length > __max ? l.slice(0, __max) : l)).join("")');
  const run = (script, text) => {
    context.__text = text;
    try { return script.runInContext(context, { timeout: timeoutMs }); }
    catch (error) {
      if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error(`${label} regex took too long; use a simpler pattern`);
      throw error;
    } finally { context.__text = ''; }
  };
  return {
    test: (text) => run(testScript, String(text)),
    // Keeps whole lines whose first MAX_LINE characters match.
    filterLines: (text) => run(filterScript, String(text)),
  };
}

module.exports = { createMatcher, MAX_PATTERN, MAX_LINE };
