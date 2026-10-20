'use strict';
const { COLORS, fg } = require('./ansi.js');

const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽'];
const VERBS = [
  'Thinking', 'Pondering', 'Brewing', 'Noodling', 'Cogitating', 'Mulling',
  'Percolating', 'Ruminating', 'Simmering', 'Tinkering', 'Musing', 'Conjuring',
];

// Ping-pong order: · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢
function pingPong(list) {
  return [...list, ...list.slice(1, -1).reverse()];
}

function spinnerFrames(color = COLORS.orange) {
  return pingPong(GLYPHS).map((g) => fg(color, g));
}

function workingIndicator() {
  return { frames: spinnerFrames(), intervalMs: 120 };
}

function pickVerb(random = Math.random) {
  return `${VERBS[Math.floor(random() * VERBS.length) % VERBS.length]}…`;
}

module.exports = { GLYPHS, VERBS, pingPong, spinnerFrames, workingIndicator, pickVerb };
