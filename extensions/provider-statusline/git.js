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

module.exports = {
  formatPullRequestLabel,
  loadPullRequest,
  normalizePullRequest,
};
