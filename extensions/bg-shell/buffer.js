'use strict';

const fs = require('node:fs/promises');
const { StringDecoder } = require('node:string_decoder');
// CSI sequences, and OSC sequences ended by BEL or ESC \.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// An escape sequence that has started but not finished.
const INCOMPLETE_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*|\][^\u0007\u001b]*\u001b?)?$/;
const MAX_CARRY = 4096;

async function createLog(root, id) {
  const file = `${root}/${id}.log`;
  await fs.writeFile(file, '', { mode: 0o600 });
  let offset = 0;
  const decoder = new StringDecoder('utf8');
  let carry = '';   // incomplete trailing escape sequence, finished by a later read
  let partial = ''; // trailing line without a newline, held back by { wholeLines: true }

  const write = async (chunk) => {
    await fs.appendFile(file, chunk);
  };
  const strip = (raw) => {
    let text = raw.replace(ANSI, '');
    const tail = INCOMPLETE_ESCAPE.exec(text);
    if (tail && tail[0].length <= MAX_CARRY) { carry = tail[0]; text = text.slice(0, tail.index); }
    return text;
  };
  const read = async ({ wholeLines = false } = {}) => {
    const stat = await fs.stat(file);
    const size = Math.max(offset, stat.size);
    const handle = await fs.open(file, 'r');
    try {
      const bytes = Buffer.alloc(size - offset);
      if (bytes.length) await handle.read(bytes, 0, bytes.length, offset);
      offset = size;
      const raw = carry + decoder.write(bytes);
      carry = '';
      let text = partial + strip(raw);
      partial = '';
      if (wholeLines) {
        const cut = text.lastIndexOf('\n') + 1;
        partial = text.slice(cut);
        text = text.slice(0, cut);
      }
      return text;
    } finally { await handle.close(); }
  };
  // Called once the job has closed: releases held text; an unfinished escape is dropped.
  const flush = () => {
    const text = partial + strip(carry + decoder.end());
    partial = '';
    carry = '';
    return text;
  };
  return { file, write, read, flush, get offset() { return offset; } };
}

module.exports = { createLog };
