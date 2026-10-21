'use strict';
const { decodeEntities } = require('../html.js');

function stripHtml(value) {
  return decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

async function parseResponse(response, provider) {
  if (response.status === 401 || response.status === 403) throw new Error(`${provider} API key rejected`);
  if (response.status === 429) throw new Error('rate limited, try again later');
  if (!response.ok) throw new Error(`${provider} search failed (HTTP ${response.status})`);
  try { return await response.json(); } catch { throw new Error(`${provider} returned invalid JSON`); }
}

module.exports = { stripHtml, parseResponse };
