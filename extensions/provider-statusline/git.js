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

function loadPullRequest(cwd) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', '--json', 'number,title,url,state'],
      { cwd, encoding: 'utf8', timeout: 5000 },
      (error, stdout) => {
        if (error) {
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
