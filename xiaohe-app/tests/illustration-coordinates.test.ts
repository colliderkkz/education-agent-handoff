import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function svgFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? svgFiles(join(path, entry.name)) : entry.name.endsWith('.svg') ? [join(path, entry.name)] : []))).flat();
}
test('question illustrations contain finite SVG coordinates', async () => {
  const files = await svgFiles(fileURLToPath(new URL('../public/illustrations/', import.meta.url)));
  assert.ok(files.length >= 384);
  for (const file of files) assert.doesNotMatch(await readFile(file, 'utf8'), /\b(?:NaN|Infinity)\b/, file);
});
