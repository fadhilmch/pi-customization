'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reapStale, isOurJob } = require('../reap.js');

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bg-reap-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function jobDir(root, name, record) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  if (record) fs.writeFileSync(path.join(dir, 'bg1.pid'), JSON.stringify(record));
  return dir;
}
const record = { pid: 4242, ownerPid: 99999, command: 'npm run dev' };
const ps = (pgid, command) => () => `  ${pgid} ${command}\n`;

test('kills the group of a job whose owner is gone and removes the directory', (t) => {
  const root = tmp(t);
  const dir = jobDir(root, 'pi-bg-shell-abc123', record);
  const kills = [];
  const reaped = reapStale({ root, exec: ps(4242, 'bash -c npm run dev'), kill: (...a) => kills.push(a), isAlive: () => false });
  assert.deepEqual(reaped, [4242]);
  assert.deepEqual(kills, [[-4242, 'SIGTERM']]);
  assert.equal(fs.existsSync(dir), false);
});

test('leaves jobs alone when the owner is alive, the pid was reused, or the dir is not ours', (t) => {
  const root = tmp(t);
  const live = jobDir(root, 'pi-bg-shell-live111', record);
  const reused = jobDir(root, 'pi-bg-shell-reuse2', { ...record, pid: 4343 });
  const noPid = jobDir(root, 'pi-bg-shell-nopid3');
  const foreign = jobDir(root, 'other-dir', record);
  const kills = [];
  const base = { root, kill: (...a) => kills.push(a) };
  reapStale({ ...base, exec: ps(4242, 'bash -c npm run dev'), isAlive: (pid) => pid === 99999 });
  assert.deepEqual(kills, []);
  assert.ok(fs.existsSync(live));
  // Owner dead, but the pid now runs something else (or is not a group leader).
  reapStale({ ...base, exec: ps(4343, 'vim notes.txt'), isAlive: () => false });
  reapStale({ ...base, exec: ps(1, 'bash -c npm run dev'), isAlive: () => false });
  assert.deepEqual(kills, []);
  assert.equal(fs.existsSync(reused), false);
  assert.ok(fs.existsSync(noPid));
  assert.ok(fs.existsSync(foreign));
});

test('really terminates an orphaned bash job but not an unrelated process', async (t) => {
  const root = tmp(t);
  const dead = spawnSync('true').pid;
  const mine = spawn('bash', ['-c', 'sleep 60; true'], { detached: true, stdio: 'ignore' });
  const other = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  t.after(() => { for (const c of [mine, other]) try { process.kill(-c.pid, 'SIGKILL'); } catch {} });
  const exited = new Promise((resolve) => mine.once('exit', resolve));
  // spawn() returns before exec finishes; wait until ps shows the final command line.
  for (let i = 0; i < 500 && !isOurJob(mine.pid, 'sleep 60; true', require('node:child_process').execFileSync); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  jobDir(root, 'pi-bg-shell-real11', { pid: mine.pid, ownerPid: dead, command: 'sleep 60; true' });
  jobDir(root, 'pi-bg-shell-real22', { pid: other.pid, ownerPid: dead, command: 'sleep 60; true' });
  assert.deepEqual(reapStale({ root }), [mine.pid]);
  await exited;
  assert.equal(other.exitCode, null);
  assert.equal(other.signalCode, null);
});
