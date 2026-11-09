/** Bounded UTF-8 reader; the file provider's size is advisory, never trusted. */
export async function readContentBytes(handle: { readBytes(length: number): Promise<Uint8Array>; close(): void }, limit = 500 * 1024): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= limit) {
      const chunk = await handle.readBytes(Math.min(64 * 1024, limit + 1 - size));
      if (!chunk.length) break;
      size += chunk.length;
      if (size > limit) throw new Error('内容包超过 500 KB，请分成较小的批次后再导入。');
      chunks.push(chunk);
    }
  } finally { handle.close(); }
  if (!size) throw new Error('这个文件是空的，请重新选择内容包。');
  // decodeURIComponent rejects malformed UTF-8 instead of silently replacing bytes.
  // This also works in Hermes without depending on a TextDecoder polyfill.
  try { return decodeURIComponent(chunks.map(chunk => Array.from(chunk, byte => `%${byte.toString(16).padStart(2, '0')}`).join('')).join('')).replace(/^\uFEFF/, ''); }
  catch { throw new Error('内容包不是有效的 UTF-8 文本，请重新导出 JSON 内容包。'); }
}
