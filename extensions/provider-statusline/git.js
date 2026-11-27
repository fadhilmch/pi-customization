const { execFile } = require('node:child_process');

function normalizePullRequest(payload) {
  if (!payload || String(payload.state || '').toUpperCase() !== 'OPEN') return null;
  const number = Number(payload.number);
  const title = String(payload.title || '').trim();
  if (!Number.isInteger(number) || !title) return null;
  return {
    number,
    title,
    url: String(payload.url || ''),
  };
}

function formatPullRequestLabel(pullRequest) {
  if (!pullRequest) return '';
  return `↗ PR #${pullRequest.number} ${pullRequest.title}`;
}

// Once `gh` is known to be absent, stop spawning it.
let ghMissing = false;

function loadPullRequest(cwd) {
  if (ghMissing) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', '--json', 'number,title,url,state'],
      { cwd, encoding: 'utf8', timeout: 5000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (error, stdout) => {
        if (error) {
          if (error.code === 'ENOENT') ghMissing = true;
          resolve(null);
          return;
        }
        try {
          resolve(normalizePullRequest(JSON.parse(stdout)));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// Parse `git status --porcelain=v2 --branch`: dirty = changed/untracked entries, ahead/behind from "# branch.ab +A -B".
function parseGitStatus(output) {
  let dirty = 0;
  let ahead = 0;
  let behind = 0;
  for (const line of String(output || '').split('\n')) {
    if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line && !line.startsWith('#')) dirty++;
  }
  return { dirty, ahead, behind };
}

// "*3 ↑2 ↓1"; each part hidden when zero, empty string when clean and in sync.
function formatGitStatus(status) {
  if (!status) return '';
  const parts = [];
  if (status.dirty > 0) parts.push(`*${status.dirty}`);
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  return parts.join(' ');
}

let gitMissing = false;

function loadGitStatus(cwd) {
  if (gitMissing) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'],
      { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => {
        if (error) {
          if (error.code === 'ENOENT') gitMissing = true;
          resolve(null);
          return;
        }
        resolve(parseGitStatus(stdout));
      },
    );
  });
}

module.exports = {
  parseGitStatus,
  formatGitStatus,
  loadGitStatus,
  formatPullRequestLabel,
  loadPullRequest,
  normalizePullRequest,
};
