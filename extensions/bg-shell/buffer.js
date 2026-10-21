'use strict';

const fs = require('node:fs/promises');
const { StringDecoder } = require('node:string_decoder');
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

async function createLog(root, id) {
  const file = `${root}/${id}.log`;
  await fs.writeFile(file, '', { mode: 0o600 });
  let offset = 0;
  let decoder = new StringDecoder('utf8');
  let pending = '';
  const write = async (chunk) => {
    await fs.appendFile(file, chunk);
  };
  const read = async () => {
    const stat = await fs.stat(file);
    const size = Math.max(offset, stat.size);
    const handle = await fs.open(file, 'r');
    try {
      const bytes = Buffer.alloc(size - offset);
      if (bytes.length) await handle.read(bytes, 0, bytes.length, offset);
      offset = size;
      const decoded = decoder.write(bytes);
      const raw = pending + decoded;
      pending = '';
      return raw.replace(ANSI, '');
    } finally { await handle.close(); }
  };
  const flush = () => {
    pending += decoder.end();
    const out = pending.replace(ANSI, '');
    pending = '';
    return out;
  };
  return { file, write, read, flush, get offset() { return offset; } };
}

module.exports = { createLog };
