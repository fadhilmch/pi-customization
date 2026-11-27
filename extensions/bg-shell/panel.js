'use strict';

function jobsPanel(jobs, width = 80) {
  const max = Math.max(0, width - 4);
  const clip = (s) => String(s).length > max ? `${String(s).slice(0, Math.max(0, max - 1))}…` : String(s);
  const rows = jobs.length ? jobs.map((j) => `${j.id}  ${j.state.padEnd(16)}  ${j.name}  ${Math.floor(j.runtimeMs / 1000)}s`) : ['No background jobs.'];
  return [`Background jobs (${jobs.length})`, ...rows.map(clip), 'Esc / Enter / q to close'];
}

module.exports = { jobsPanel };
