'use strict';

function parseNotebook(text) {
  const nb = JSON.parse(String(text));
  if (!nb || !Array.isArray(nb.cells) || Number(nb.nbformat) !== 4) throw new Error('Invalid notebook: expected nbformat 4 with a cells array');
  return nb;
}

function serializeNotebook(nb) {
  return `${JSON.stringify(nb, null, 1)}\n`;
}

module.exports = { parseNotebook, serializeNotebook };
