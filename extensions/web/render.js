'use strict';
const { URL } = require('node:url');

function hostPath(value) {
  try { const u = new URL(value); return `${u.hostname}${u.pathname}`; } catch { return String(value || ''); }
}

function callLine(url) { return `⏺ WebFetch(${hostPath(url)})`; }
function resultLine(details) {
  if (details?.sectionMissing) return `  ⎿ section not found · ${details.chars} chars`;
  const section = details?.section ? `section "${details.section}" · ` : '';
  return `  ⎿ ${section}${details?.chars ?? 0} chars · ${((details?.elapsedMs ?? 0) / 1000).toFixed(1)}s`;
}

module.exports = { hostPath, callLine, resultLine };
