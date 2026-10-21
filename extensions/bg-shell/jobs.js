'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLog } = require('./buffer.js');

function createJobs({ root, spawnProcess = spawn, fsApi = fs, now = Date.now, maxJobs = 5 } = {}) {
  let dirPromise;
  let nextId = 1;
  let reservations = 0;
  const jobs = new Map();
  const rootDir = root || os.tmpdir();
  const ensureDir = () => dirPromise ||= fsApi.mkdtemp(path.join(rootDir, 'pi-bg-shell-'));

  function state(job) {
    if (job.exitCode !== null) return `exited ${job.exitCode}${job.runtimeMs ? ` after ${Math.round(job.runtimeMs / 1000)}s` : ''}`;
    if (job.signal) return `exited ${job.signal}`;
    return 'running';
  }

  function info(job) {
    return { id: job.id, name: job.name, state: state(job), runtimeMs: job.runtimeMs || (now() - job.startedAt), command: job.command, pid: job.child.pid, logPath: job.log.file };
  }

  async function start({ command, cwd, name, waitFor, waitSeconds = 30, signal } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required');
    const running = [...jobs.values()].filter((job) => !job.closed);
    if (running.length + reservations >= maxJobs) throw new Error(`maxJobs (${maxJobs}) reached. Running: ${running.map((j) => `${j.id} ${j.name}`).join(', ')}`);
    const matcher = waitFor ? safeRegex(waitFor, 'waitFor') : undefined;
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
    } catch (error) { reservations--; throw error; }
    const job = { id, name: String(name || command).slice(0, 100), command, child, log, startedAt: now(), exitCode: null, signal: null, runtimeMs: 0, exitedSinceLook: false, stopPromise: null };
    jobs.set(id, job);
    reservations--;
    let outputChain = Promise.resolve();
    job.outputChain = outputChain;
    const append = (chunk) => { outputChain = outputChain.then(() => log.write(chunk)).catch((error) => { job.logError = error; }); job.outputChain = outputChain; };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (error) => { job.spawnError = error; });
    child.once('exit', (code, sig) => {
      job.exitCode = code;
      job.signal = sig;
      job.runtimeMs = now() - job.startedAt;
      job.exitedSinceLook = true;
    });
    child.once('close', () => {
      outputChain.finally(() => { job.closed = true; });
    });
    if (!matcher) return info(job);
    let accumulated = '';
    let matched = false;
    let waitTruncated = false;
    if (signal?.aborted) return { ...info(job), text: '', waitTimedOut: false, waitAborted: true };
    const deadline = now() + Math.max(0.01, Math.min(120, Number(waitSeconds) || 30)) * 1000;
    let timedOut = false;
    let aborted = false;
    const abort = () => { aborted = true; };
    signal?.addEventListener?.('abort', abort, { once: true });
    try {
      while (now() < deadline && job.exitCode === null && !job.signal) {
        if (aborted) break;
        await outputChain;
        const next = await log.read();
        if (matcher.test(next)) matched = true;
        accumulated += next;
        if (accumulated.length > 20000) { accumulated = accumulated.slice(-20000); waitTruncated = true; }
        if (matched) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await outputChain;
      const finalChunk = await log.read();
      if (matcher.test(finalChunk)) matched = true;
      accumulated += finalChunk;
      if (accumulated.length > 20000) { accumulated = accumulated.slice(-20000); waitTruncated = true; }
      if (!matched && !job.closed && !aborted && now() >= deadline) timedOut = true;
      return { ...info(job), text: accumulated, waitTimedOut: timedOut, waitAborted: aborted, waitTruncated };
    } finally { signal?.removeEventListener?.('abort', abort); }
  }

  async function output(id, filter) {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown background job: ${id}`);
    if (filter) {
      safeRegex(filter, 'filter');
    }
    await job.outputChain;
    let text = await job.log.read();
    if (job.closed) text += job.log.flush();
    if (filter) {
      const re = safeRegex(filter, 'filter');
      text = text.split(/(?<=\n)/).filter((line) => re.test(line)).join('');
    }
    return { ...info(job), text, logPath: job.log.file };
  }

  async function stop(id, { graceMs = 5000 } = {}) {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown background job: ${id}`);
    if (job.stopPromise) return job.stopPromise;
    job.stopPromise = (async () => {
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
    })();
    return job.stopPromise;
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
      notices.push(`Background job ${job.id} (${job.name}) exited with code ${job.exitCode ?? job.signal}. Read it with bash_bg output.`);
    }
    return notices;
  }
  return { start, output, stop, list, stopAll, cleanup, takeExitedNotices, get tempDir() { return dirPromise; } };
}

function safeRegex(pattern, label) {
  const source = String(pattern);
  if (source.length > 200) throw new Error(`${label} regex is limited to 200 characters`);
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source) || /(?:\.\*|\.\+){2}/.test(source)) throw new Error(`${label} regex has nested repetition`);
  try { return new RegExp(source, 'i'); } catch { throw new Error(`${label} must be a valid regular expression`); }
}

module.exports = { createJobs };
