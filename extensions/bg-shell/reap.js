'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// True only when pid leads its own process group and runs `bash -c <command>`, so a reused pid is never killed.
function isOurJob(pid, command, exec) {
  try {
    const out = String(exec('ps', ['-ww', '-o', 'pgid=,command=', '-p', String(pid)], { encoding: 'utf8' })).trim();
    const match = /^(\d+)\s+(.*)$/s.exec(out);
    if (!match || Number(match[1]) !== pid) return false;
    const firstLine = String(command).split('\n')[0].slice(0, 200);
    return /(^|\/)bash\s+-c\s/.test(match[2]) && match[2].includes(firstLine);
  } catch { return false; }
}

// Reaps jobs left behind by a Pi process of this user that died without session_shutdown.
function reapStale({ root = os.tmpdir(), exec = execFileSync, kill = process.kill.bind(process), isAlive = alive, uid = process.getuid?.() } = {}) {
  const reaped = [];
  if (process.platform === 'win32') return reaped;
  let names;
  try { names = fs.readdirSync(root); } catch { return reaped; }
  for (const name of names) {
    if (!/^pi-bg-shell-[A-Za-z0-9]{6}$/.test(name)) continue;
    const dir = path.join(root, name);
    try {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)) continue;
      const records = [];
      for (const file of fs.readdirSync(dir).filter((f) => /^bg\d+\.pid$/.test(f))) {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (Number.isInteger(record.pid) && record.pid > 1 && Number.isInteger(record.ownerPid) && typeof record.command === 'string') records.push(record);
        } catch {}
      }
      // No records: not ours to touch. A live owner means another Pi is still using the directory.
      if (!records.length || records.some((r) => isAlive(r.ownerPid))) continue;
      for (const record of records) {
        if (isOurJob(record.pid, record.command, exec)) {
          try { kill(-record.pid, 'SIGTERM'); reaped.push(record.pid); } catch {}
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  return reaped;
}

module.exports = { reapStale, isOurJob };
