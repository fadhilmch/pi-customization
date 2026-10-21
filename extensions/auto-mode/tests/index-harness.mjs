// Run with: node --experimental-strip-types tests/index-harness.mjs <cwd>
// Loads index.ts against a fake `pi` and prints a JSON report of what happened.
// (Pi loads extensions through its own TS loader that provides `require`; emulate that.)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(here, '..', 'index.ts');
globalThis.require = createRequire(indexPath);
const mod = await import(pathToFileURL(indexPath).href);

const handlers = {};
const commands = {};
const shortcuts = {};
const pi = {
  on(name, fn) { handlers[name] = fn; },
  registerCommand(name, opts) { commands[name] = opts; },
  registerShortcut(key, opts) { shortcuts[key] = opts; },
};
mod.default(pi);

const cwd = process.argv[2];
const log = { selects: [], statuses: [], notifications: [] };
let nextChoice = 'Allow once';
const ui = {
  select: async (title, options) => { log.selects.push({ title, options }); return nextChoice; },
  setStatus: (k, v) => log.statuses.push([k, v]),
  notify: (m, t) => log.notifications.push([m, t]),
};
const ctx = { cwd, hasUI: true, ui };
const noUi = { cwd, hasUI: false, ui: undefined };
const call = (command, c = ctx) => handlers.tool_call({ type: 'tool_call', toolName: 'bash', toolCallId: 'x', input: { command } }, c);

const r = {};
r.registered = { events: Object.keys(handlers), commands: Object.keys(commands), shortcuts: Object.keys(shortcuts) };
await handlers.session_start({ type: 'session_start' }, ctx);
r.afterStart = { statuses: [...log.statuses] };

r.safe = (await call('ls -la')) ?? null;
r.safeSelects = log.selects.length;

nextChoice = 'Allow once';
r.once = (await call('git push origin feature')) ?? null;
r.onceTitle = log.selects.at(-1).title;
r.onceOptions = log.selects.at(-1).options;
r.highTitle = (await call('git push --force origin main'), log.selects.at(-1).title);

nextChoice = 'Deny';
r.denied = (await call('git push origin feature')) ?? null;

nextChoice = 'Allow for this session';
const before = log.selects.length;
r.session1 = (await call('rm -rf dist')) ?? null;
r.session2 = (await call('rm -rf dist')) ?? null;
r.sessionPrompts = log.selects.length - before;
r.sessionOther = (await call('rm -rf other')) ?? null;
r.sessionOtherPrompts = log.selects.length - before;

nextChoice = undefined; // dialog cancelled
r.cancelled = (await call('git push origin feature2')) ?? null;
nextChoice = 'Allow once';

r.noUi = (await call('git push', noUi)) ?? null;
r.noUiSafe = (await call('ls', noUi)) ?? null;
r.catastrophic = (await call('rm -rf /')) ?? null;
r.writeInside = (await handlers.tool_call({ toolName: 'write', input: { path: 'a.txt', content: '' } }, ctx)) ?? null;
const sel0 = log.selects.length;
r.writeEnv = (await handlers.tool_call({ toolName: 'write', input: { path: '.env', content: '' } }, ctx)) ?? null;
r.writeEnvPrompted = log.selects.length - sel0;

await commands.auto.handler('ask', ctx);
r.askStatus = log.statuses.at(-1);
const s1 = log.selects.length;
await call('ls');
r.askPrompted = log.selects.length - s1;
await commands.auto.handler('off', ctx);
r.offStatus = log.statuses.at(-1);
const s2 = log.selects.length;
await call('git push --force origin main');
r.offPrompted = log.selects.length - s2;
r.offCatastrophic = (await call('rm -rf ~')) ?? null;
await commands.auto.handler('', ctx); // cycles off -> auto
r.cycleStatus = log.statuses.at(-1);
await commands.auto.handler('bogus', ctx);
r.bogus = log.notifications.at(-1);
await shortcuts['ctrl+alt+a'].handler(ctx); // auto -> ask
r.shortcutStatus = log.statuses.at(-1);
r.completions = commands.auto.getArgumentCompletions('a');

console.log(JSON.stringify(r));
