#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '../xiaohe-app/lib');
const targetRoot = resolve(root, 'src/local/shared');
const files = ['types.ts', 'access-types.ts', 'seed.ts', 'curriculum-catalog.ts', 'curriculum-catalog-shanghai.ts', 'grading.ts', 'choice.ts', 'effective-evidence.ts', 'exam-references.ts', 'mistake-causes.ts', 'history-deletion.ts', 'server/domain.ts', 'server/mastery.ts', 'server/content.ts', 'server/companion.ts', 'server/evidence.ts', 'server/history.ts', 'server/recognition.ts', 'server/access-policy.ts', 'server/domain-error.ts'];
const checking = process.argv.includes('--check');
const manifest = { format: 1, source: 'xiaohe-app/lib', adaptation: 'Only an explicit JSON-data clone import is added for Hermes; all business logic is copied verbatim.', files: {} };
let different = false;
for (const file of files) {
  const source = await readFile(resolve(sourceRoot, file), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  manifest.files[file] = hash;
  const cloneImport = source.includes('structuredClone(') ? `import { cloneData as structuredClone } from '${file.startsWith('server/') ? '../../' : '../'}clone.ts';\n` : '';
  const generated = `// Generated from xiaohe-app/lib/${file}; SHA-256: ${hash}\n// Run node scripts/sync-local-domain.mjs; do not edit the generated body.\n${cloneImport}${source}`;
  const target = resolve(targetRoot, file);
  if (checking) {
    const actual = await readFile(target, 'utf8').catch(() => '');
    if (actual !== generated) { console.error(`Out of sync: ${file}`); different = true; }
  } else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, generated); }
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = resolve(targetRoot, 'source-manifest.json');
if (checking) {
  if (await readFile(manifestPath, 'utf8').catch(() => '') !== manifestText) { console.error('Out of sync: source-manifest.json'); different = true; }
  if (different) process.exitCode = 1;
  else console.log('Local domain sources and SHA-256 provenance match.');
} else { await writeFile(manifestPath, manifestText); console.log(`Synced ${files.length} pure TypeScript sources into mobile; runtime does not import the sibling project.`); }
