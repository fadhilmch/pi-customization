'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLog } = require('./buffer.js');
const { createMatcher } = require('./regex.js');

const WAIT_TAIL = 20000;

function createJobs({ root, spawnProcess = spawn, fsApi = fs, now = Date.now, maxJobs = 5, pollMs = 40 } = {}) {
  let dirPromise;
  let nextId = 1;
  let reservations = 0;
  const jobs = new Map();
  const rootDir = root || os.tmpdir();
  const ensureDir = () => dirPromise ||= fsApi.mkdtemp(path.join(rootDir, 'pi-bg-shell-'));

  function state(job) {
    if (job.failed) return `failed: ${job.failed}`;
    if (job.exitCode !== null) return `exited ${job.exitCode}${job.runtimeMs ? ` after ${Math.round(job.runtimeMs / 1000)}s` : ''}`;
    if (job.signal) return `exited ${job.signal}`;
    return 'running';
  }

  function info(job) {
    return { id: job.id, name: job.name, closed: Boolean(job.closed), state: state(job), runtimeMs: job.runtimeMs || (now() - job.startedAt), command: job.command, pid: job.child.pid, logPath: job.log.file };
  }

  async function start({ command, cwd, name, waitFor, waitSeconds = 30, signal } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required');
    const running = [...jobs.values()].filter((job) => !job.closed);
    if (running.length + reservations >= maxJobs) throw new Error(`maxJobs (${maxJobs}) reached. Running: ${running.map((j) => `${j.id} ${j.name}`).join(', ')}`);
    const matcher = waitFor ? createMatcher(waitFor, 'waitFor') : undefined;
    if (cwd) {
      const stat = await fsApi.stat(cwd).catch(() => null);
      if (!stat?.isDirectory()) throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    reservations++;
    let dir;
    const id = `bg${nextId++}`;
    let log;
    let child;
    try {
      dir = await ensureDir();
      log = await createLog(dir, id);
      child = process.platform === 'win32'
        ? spawnProcess(command, { cwd: cwd || process.cwd(), shell: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        : spawnProcess('bash', ['-c', command], {
        cwd: cwd || process.cwd(), detached: true,
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      // Lets a later Pi process reap this job if Pi is killed without a clean shutdown.
      if (child.pid && process.platform !== 'win32') {
        await fsApi.writeFile(path.join(dir, `${id}.pid`), JSON.stringify({ pid: child.pid, ownerPid: process.pid, command }), { mode: 0o600 }).catch(() => {});
      }
    } catch (error) { reservations--; throw error; }
    const job = { id, name: String(name || command).slice(0, 100), command, child, log, startedAt: now(), exitCode: null, signal: null, runtimeMs: 0, exitedSinceLook: false, stopPromise: null };
    jobs.set(id, job);
    reservations--;
    let outputChain = Promise.resolve();
    job.outputChain = outputChain;
    const append = (chunk) => { outputChain = outputChain.then(() => log.write(chunk)).catch((error) => { job.logError = error; }); job.outputChain = outputChain; };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (error) => {
      job.failed = String(error?.message || error);
      job.exitedSinceLook = true;
      if (child.pid === undefined) job.closed = true;
    });
    child.once('exit', (code, sig) => {
      job.exitCode = code;
      job.signal = sig;
      job.runtimeMs = now() - job.startedAt;
      job.exitedSinceLook = true;
    });
    child.once('close', () => {
      outputChain.finally(() => { job.closed = true; });
    });
    if (child.pid === undefined) {
      // spawn() reports ENOENT and similar failures asynchronously.
      await new Promise((resolve) => setImmediate(resolve));
      job.exitedSinceLook = false;
      throw new Error(`failed to start: ${job.failed || 'process did not start'}`);
    }
    if (!matcher) return info(job);
    let accumulated = '';
    let matched = false;
    let waitTruncated = false;
    let waitError;
    if (signal?.aborted) return { ...info(job), text: '', waitTimedOut: false, waitAborted: true };
    const deadline = now() + Math.max(0.01, Math.min(120, Number(waitSeconds) || 30)) * 1000;
    let timedOut = false;
    let aborted = false;
    const abort = () => { aborted = true; };
    signal?.addEventListener?.('abort', abort, { once: true });
    // A match may span reads, so test the accumulated tail rather than each new chunk.
    const check = async () => {
      accumulated += await log.read();
      if (accumulated.length > WAIT_TAIL) { accumulated = accumulated.slice(-WAIT_TAIL); waitTruncated = true; }
      if (matcher.test(accumulated)) matched = true;
    };
    try {
      while (now() < deadline && job.exitCode === null && !job.signal && !job.failed) {
        if (aborted) break;
        await outputChain;
        await check();
        if (matched) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      await outputChain;
      if (!matched) await check();
      if (!matched && !job.closed && !aborted && now() >= deadline) timedOut = true;
      return { ...info(job), text: accumulated, waitTimedOut: timedOut, waitAborted: aborted, waitTruncated };
    } catch (error) {
      if (!/regex/.test(String(error?.message))) throw error;
      return { ...info(job), text: accumulated, waitTimedOut: false, waitAborted: false, waitTruncated, waitError: error.message };
    } finally { signal?.removeEventListener?.('abort', abort); }
  }

  async function output(id, filter) {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown background job: ${id}`);
    const matcher = filter ? createMatcher(filter, 'filter') : undefined;
    await job.outputChain;
    // With a filter, hold back a trailing partial line until it completes or the job closes.
    let text = await job.log.read({ wholeLines: Boolean(matcher) });
    if (job.closed) text += job.log.flush();
    if (matcher) text = matcher.filterLines(text);
    // The model has now seen everything the job wrote, so the exit notice would repeat it.
    if (job.closed) job.exitedSinceLook = false;
    return { ...info(job), text, logPath: job.log.file };
  }

  async function stop(id, { graceMs = 5000 } = {}) {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown background job: ${id}`);
    if (job.stopPromise) return job.stopPromise;
    job.stopPromise = (async () => {
      try { return await terminate(job, graceMs); } finally { job.exitedSinceLook = false; }
    })();
    return job.stopPromise;
  }

  async function terminate(job, graceMs) {
    const pid = job.child.pid;
    if (pid) {
      const exited = new Promise((resolve) => {
        if (job.closed) resolve();
        else job.child.once('close', resolve);
      });
      if (process.platform === 'win32') {
        try { spawnProcess('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
        let timer;
        await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer);
      } else {
        let groupExists = true;
        try { process.kill(-pid, 0); } catch (e) { if (e.code === 'ESRCH') groupExists = false; else throw e; }
        if (!groupExists) return info(job);
        try { process.kill(-pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
        let timer;
        await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, graceMs); })]);
        clearTimeout(timer);
        // Kill the entire group even when its leader exited; grandchildren may still hold pipes open.
        try { process.kill(-pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
        let killTimer;
        await Promise.race([exited, new Promise((resolve) => { killTimer = setTimeout(resolve, 1000); })]);
        clearTimeout(killTimer);
      }
    }
    return info(job);
  }

  async function list() { return [...jobs.values()].map(info); }
  async function stopAll() { await Promise.all([...jobs.values()].map((j) => stop(j.id))); }
  async function cleanup() {
    await stopAll();
    const dir = await dirPromise;
    if (dir) { await fsApi.rm(dir, { recursive: true, force: true }); dirPromise = undefined; }
  }
  function takeExitedNotices() {
    const notices = [];
    for (const job of jobs.values()) if (job.exitedSinceLook) {
      job.exitedSinceLook = false;
      const what = job.failed ? `failed: ${job.failed}` : job.exitCode !== null ? `exited with code ${job.exitCode}` : `was stopped by ${job.signal}`;
      notices.push(`Background job ${job.id} (${job.name}) ${what}. Read it with bash_bg output.`);
    }
    return notices;
  }
  return { start, output, stop, list, stopAll, cleanup, takeExitedNotices, get tempDir() { return dirPromise; } };
}

module.exports = { createJobs };
