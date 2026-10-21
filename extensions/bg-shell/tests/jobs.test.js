'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  assert.equal(await isGone(childPid), true, psLine(childPid));
  await f.jobs.stopAll();
  await f.jobs.stopAll();
});

test('stop kills descendants that ignore TERM after the leader exits', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "trap 'exit 0' TERM; sh -c 'trap \"\" TERM; sleep 30' & echo $! > child.pid; wait", cwd: f.root });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const childPid = Number((await fs.readFile(path.join(f.root, 'child.pid'), 'utf8')).trim());
  await f.jobs.stop(started.id, { graceMs: 100 });
  assert.equal(await isGone(childPid), true, psLine(childPid));
});

async function waitUntil(check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const closed = (jobs, id) => waitUntil(async () => (await jobs.list()).find((job) => job.id === id).closed);

test('waitFor matches text split across reads', async (t) => {
  const f = await fixture(); t.after(f.close);
  const pending = f.jobs.start({ command: "printf 'Listening on po'; while [ ! -f go ]; do sleep 0.02; done; printf 'rt 3000\\n'; sleep 30", cwd: f.root, waitFor: 'port 3000', waitSeconds: 60, pollMs: 5 });
  // Release the second half only after the first half is in the log (and so has been read separately).
  await waitUntil(async () => {
    const dir = await f.jobs.tempDir;
    return dir && (await fs.readFile(path.join(dir, 'bg1.log'), 'utf8').catch(() => '')).includes('po');
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fs.writeFile(path.join(f.root, 'go'), '');
  const started = await pending;
  assert.equal(started.waitTimedOut, false);
  assert.match(started.text, /Listening on port 3000/);
});

test('exit notice is suppressed once output() has read a closed job, and signal exits are worded as such', async (t) => {
  const f = await fixture(); t.after(f.close);
  const read = await f.jobs.start({ command: 'echo done' });
  const unread = await f.jobs.start({ command: 'echo unread' });
  const killed = await f.jobs.start({ command: 'kill -TERM $$' });
  for (const job of [read, unread, killed]) await closed(f.jobs, job.id);
  assert.match((await f.jobs.output(read.id)).text, /done/);
  const notices = f.jobs.takeExitedNotices();
  assert.equal(notices.length, 2);
  assert.ok(notices.some((n) => n.includes(unread.id) && /exited with code 0/.test(n)));
  assert.ok(notices.some((n) => n.includes(killed.id) && /was stopped by SIGTERM/.test(n)));
  assert.ok(!notices.some((n) => /code SIGTERM/.test(n) || n.includes(read.id)));
});

test('a job that exits while its pid file is being written is still seen to exit', async (t) => {
  // Slow pid-file write: the job exits and closes before start() resumes, so listeners must already be attached.
  const slowFs = { ...fs, writeFile: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 300)); return fs.writeFile(...args); } };
  const f = await fixture({ fsApi: slowFs }); t.after(f.close);
  const started = await f.jobs.start({ command: 'echo quick' });
  await closed(f.jobs, started.id);
  const out = await f.jobs.output(started.id);
  assert.match(out.text, /quick/);
  assert.equal((await f.jobs.list()).find((job) => job.id === started.id).state.startsWith('running'), false);
});

test('stop() suppresses the exit notice', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: 'sleep 30' });
  await f.jobs.stop(started.id, { graceMs: 2000 });
  assert.deepEqual(f.jobs.takeExitedNotices(), []);
});

test('invalid and catastrophic regexes fail fast with a clear error', async (t) => {
  const f = await fixture(); t.after(f.close);
  await assert.rejects(f.jobs.start({ command: 'echo x', waitFor: '(' }), /waitFor must be a valid regular expression/);
  await assert.rejects(f.jobs.start({ command: 'echo x', waitFor: 'a'.repeat(201) }), /limited to 200/);
  const started = await f.jobs.start({ command: `printf '${'a'.repeat(40)}!\\n'` });
  await closed(f.jobs, started.id);
  await assert.rejects(f.jobs.output(started.id, 'x('), /filter must be a valid/);
  const t0 = Date.now();
  await assert.rejects(f.jobs.output(started.id, '(a|a)*$'), /filter regex took too long; use a simpler pattern/);
  assert.ok(Date.now() - t0 < 8000);
  // waitFor: the wait is abandoned with a message, the job keeps running.
  const t1 = Date.now();
  const waiting = await f.jobs.start({ command: `printf '${'a'.repeat(40)}!\\n'; sleep 30`, waitFor: '(a|a)+$', waitSeconds: 60 });
  assert.match(waiting.waitError, /waitFor regex took too long/);
  assert.ok(Date.now() - t1 < 8000);
  assert.equal(waiting.state, 'running');
});

test('start fails clearly for a missing cwd and does not use up a job slot', async (t) => {
  const f = await fixture({ maxJobs: 1 }); t.after(f.close);
  await assert.rejects(f.jobs.start({ command: 'echo hi', cwd: path.join(f.root, 'missing') }), /cwd does not exist or is not a directory/);
  await assert.rejects(f.jobs.start({ command: 'echo hi', cwd: __filename }), /not a directory/);
  const ok = await f.jobs.start({ command: 'echo ok', cwd: f.root });
  assert.match(ok.id, /^bg\d+$/);
});

test('a spawn error marks the job failed instead of leaving it running', async (t) => {
  const f = await fixture({ spawnProcess: (_cmd, args, options) => spawn('/nonexistent/bash', args, options) });
  t.after(f.close);
  await assert.rejects(f.jobs.start({ command: 'echo hi' }), /failed to start: .*ENOENT/);
  const [job] = await f.jobs.list();
  assert.match(job.state, /^failed: .*ENOENT/);
  assert.equal(job.closed, true);
  assert.deepEqual(f.jobs.takeExitedNotices(), []);
  const again = f.jobs.start({ command: 'echo hi' });
  await assert.rejects(again, /failed to start/);
});

test('aborting during an in-progress wait returns promptly and leaves the job running', async (t) => {
  const f = await fixture(); t.after(f.close);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const result = await f.jobs.start({ command: 'sleep 30', waitFor: 'never', waitSeconds: 100, signal: controller.signal });
  assert.equal(result.waitAborted, true);
  assert.equal(result.state, 'running');
});

test('waitSeconds is clamped to 120 seconds', async (t) => {
  let fake = 0;
  const f = await fixture({ now: () => (fake += 1000), pollMs: 1 }); t.after(f.close);
  const result = await f.jobs.start({ command: 'sleep 30', waitFor: 'never', waitSeconds: 100000 });
  assert.equal(result.waitTimedOut, true);
  assert.ok(fake >= 120000 && fake < 130000, `fake clock ended at ${fake}`);
});

test('stop escalates to SIGKILL when the leader ignores TERM', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "trap '' TERM; echo armed; while true; do sleep 0.1; done", waitFor: 'armed', waitSeconds: 30 });
  await f.jobs.stop(started.id, { graceMs: 200 });
  await closed(f.jobs, started.id);
  assert.equal((await f.jobs.list())[0].state, 'exited SIGKILL');
  assert.equal(await isGone(started.pid), true, psLine(started.pid));
});

test('filter holds back a partial last line until it completes', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: "printf err; while [ ! -f go ]; do sleep 0.02; done; printf 'or x\\nok\\n'", cwd: f.root });
  await waitUntil(async () => (await fs.readFile(started.logPath, 'utf8')).includes('err'));
  assert.equal((await f.jobs.output(started.id, 'error')).text, '');
  await fs.writeFile(path.join(f.root, 'go'), '');
  let text = '';
  await waitUntil(async () => { text += (await f.jobs.output(started.id, 'error')).text; return text; });
  assert.equal(text, 'error x\n');
});

test('start records a pid file for later reaping', async (t) => {
  const f = await fixture(); t.after(f.close);
  const started = await f.jobs.start({ command: 'sleep 30' });
  const record = JSON.parse(await fs.readFile(path.join(await f.jobs.tempDir, `${started.id}.pid`), 'utf8'));
  assert.deepEqual(record, { pid: started.pid, ownerPid: process.pid, command: 'sleep 30' });
});

// A killed process stays a zombie until its new parent reaps it, and kill(pid, 0) still succeeds on a zombie.
// On Linux CI the reaper can lag, so treat zombies as dead and give the kill a moment to land.
function isAlive(pid) {
  try { process.kill(pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  try {
    const out = require('node:child_process').execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return out !== '' && !out.startsWith('Z');
  } catch { return false; }
}

function psLine(pid) {
  try { return `still running: ${require('node:child_process').execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim()}`; } catch { return 'ps failed'; }
}

async function isGone(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
