'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJobs } = require('../jobs.js');

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-bg-shell-test-'));
  const jobs = createJobs({ root, ...options });
  return { jobs, root, close: async () => { await jobs.stopAll(); await fs.rm(root, { recursive: true, force: true }); } };
}

test('start, incremental output, filter and exit status', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "printf 'hello\\n'; sleep 0.05; printf 'WARN done\\n'" });
  assert.match(started.id, /^bg\d+$/);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const first = await f.jobs.output(started.id);
  assert.match(first.text, /hello/);
  assert.match(first.text, /WARN done/);
  assert.match(first.state, /exited 0/);
  assert.equal((await f.jobs.output(started.id)).text, '');
  const second = await f.jobs.start({ command: "printf 'one\\ntwo\\n'" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const filtered = await f.jobs.output(second.id, 'two');
  assert.match(filtered.text, /two/);
  assert.doesNotMatch(filtered.text, /one/);
  assert.equal((await f.jobs.output(second.id)).text, '');
});

test('waitFor resolves on matching output and reports timeout without stopping job', async (t) => {
  const f = await fixture(); t.after(f.close);
  const ready = await f.jobs.start({ command: "sleep 0.05; printf 'listening on 4000\\n'; sleep 0.5", waitFor: 'listening on', waitSeconds: 1 });
  assert.match(ready.text, /listening on 4000/);
  const timed = await f.jobs.start({ command: 'sleep 0.4', waitFor: 'ready', waitSeconds: 0.05 });
  assert.equal(timed.waitTimedOut, true);
  assert.equal((await f.jobs.list()).find((job) => job.id === timed.id).state, 'running');
  const partial = await f.jobs.start({ command: "printf 'READY_NO_NEWLINE'; sleep 0.5", waitFor: 'READY_NO_NEWLINE', waitSeconds: 1 });
  assert.match(partial.text, /READY_NO_NEWLINE/);
  const controller = new AbortController(); controller.abort();
  const aborted = await f.jobs.start({ command: 'sleep 0.5', waitFor: 'ready', signal: controller.signal });
  assert.equal(aborted.waitAborted, true);
});

test('max jobs includes running processes and lists them on rejection', async (t) => {
  const f = await fixture({ maxJobs: 1 }); t.after(f.close);
  const results = await Promise.allSettled([
    f.jobs.start({ command: 'sleep 2', name: 'worker' }),
    f.jobs.start({ command: 'sleep 2', name: 'racer' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const first = results.find((r) => r.status === 'fulfilled').value;
  await assert.rejects(f.jobs.start({ command: 'sleep 2' }), /maxJobs.*bg\d+.*worker/i);
  await f.jobs.stop(first.id);
});

test('stop terminates a detached process group and stopAll is idempotent', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "sleep 30 & echo $! > child.pid; wait", cwd: f.root });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const childPid = Number((await fs.readFile(path.join(f.root, 'child.pid'), 'utf8')).trim());
  await f.jobs.stop(started.id, { graceMs: 100 });
  assert.equal(isAlive(childPid), false);
  await f.jobs.stopAll();
  await f.jobs.stopAll();
});

test('stop kills descendants that ignore TERM after the leader exits', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "trap 'exit 0' TERM; sh -c 'trap \"\" TERM; sleep 30' & echo $! > child.pid; wait", cwd: f.root });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const childPid = Number((await fs.readFile(path.join(f.root, 'child.pid'), 'utf8')).trim());
  await f.jobs.stop(started.id, { graceMs: 100 });
  assert.equal(isAlive(childPid), false);
});

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
