import test from 'node:test';
import assert from 'node:assert/strict';
import { readContentBytes } from '../src/local/content-file-reader.ts';

function handle(bytes, chunkSize = 20) {
  let offset = 0, closed = 0;
  return { readBytes: async count => { const part = bytes.subarray(offset, offset + Math.min(count, chunkSize)); offset += part.length; return part; }, close: () => closed++, get closed() { return closed; } };
}
test('reads Chinese UTF-8 across short reads and strips only the optional BOM', async () => {
  const h = handle(Buffer.from('\uFEFF{"内容":"本机数学🟢"}'), 2);
  assert.equal(await readContentBytes(h), '{"内容":"本机数学🟢"}'); assert.equal(h.closed, 1);
});
test('rejects oversized input at bounded read, closes handle without reading entire file', async () => {
  let read = 0, closed = false;
  const h = { readBytes: async count => { read += count; return new Uint8Array(count); }, close: () => { closed = true; } };
  await assert.rejects(readContentBytes(h, 100), /超过/); assert.equal(read, 101); assert.equal(closed, true);
});
test('rejects malformed UTF-8 and empty files, and closes on provider failure', async () => {
  for (const bytes of [Buffer.from([0xc0, 0xaf]), Buffer.alloc(0)]) {
    const h = handle(bytes); await assert.rejects(readContentBytes(h)); assert.equal(h.closed, 1);
  }
  let closed = false;
  await assert.rejects(readContentBytes({ readBytes: async () => { throw new Error('provider lost'); }, close: () => { closed = true; } }), /provider lost/);
  assert.equal(closed, true);
});
