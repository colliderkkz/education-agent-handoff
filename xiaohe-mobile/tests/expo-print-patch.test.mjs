import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyExpoPrintPatch, assertExpoPrintSourceConfig } from '../scripts/patch-expo-print.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'xiaohe-expo-print-patch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dependency = join(root, 'node_modules', 'expo-print');
  const patches = join(root, 'patches', 'expo-print');
  await mkdir(dependency, { recursive: true });
  await mkdir(patches, { recursive: true });
  const manifest = { package: 'expo-print', version: '58.0.7', files: [] };
  await writeFile(join(root, 'package.json'), JSON.stringify({ expo: { autolinking: { android: { buildFromSource: ['expo-print'] } } } }));
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'expo-print', version: '58.0.7' }));
  for (const name of ['Module.kt', 'Task.kt']) {
    const original = `// upstream ${name}\n`;
    const patched = `// repaired ${name}\n`;
    const target = `android/${name}`;
    await mkdir(dirname(join(dependency, target)), { recursive: true });
    await writeFile(join(dependency, target), original);
    await writeFile(join(patches, name), patched);
    manifest.files.push({ target, patchFile: name, upstreamSha256: digest(original), patchedSha256: digest(patched) });
  }
  const saveManifest = () => writeFile(join(patches, 'manifest.json'), JSON.stringify(manifest));
  await saveManifest();
  return { root, dependency, patches, manifest, saveManifest };
}

test('print patch applies exact upstream inputs and is idempotent', async t => {
  const f = await fixture(t);
  assert.equal((await applyExpoPrintPatch({ projectRoot: f.root })).changed, 2);
  for (const entry of f.manifest.files) {
    assert.equal(digest(await readFile(join(f.dependency, entry.target))), entry.patchedSha256);
  }
  assert.equal((await applyExpoPrintPatch({ projectRoot: f.root })).changed, 0);
  assert.equal((await applyExpoPrintPatch({ projectRoot: f.root, checkOnly: true })).checked, 2);
});

test('print patch refuses a different installed version without modifying files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dependency, 'package.json'), JSON.stringify({ name: 'expo-print', version: '58.0.8' }));
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root }), /只适用于/);
  assert.equal(digest(await readFile(join(f.dependency, f.manifest.files[0].target))), f.manifest.files[0].upstreamSha256);
});

test('print patch preflights every upstream hash before writing any file', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dependency, f.manifest.files[1].target), '// unrelated local change\n');
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root }), /原文件 SHA-256 不匹配/);
  assert.equal(digest(await readFile(join(f.dependency, f.manifest.files[0].target))), f.manifest.files[0].upstreamSha256);
});

test('print patch refuses an altered checked-in payload', async t => {
  const f = await fixture(t);
  await writeFile(join(f.patches, f.manifest.files[1].patchFile), '// corrupted patch\n');
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root }), /补丁 SHA-256 不匹配/);
  assert.equal(digest(await readFile(join(f.dependency, f.manifest.files[0].target))), f.manifest.files[0].upstreamSha256);
});

test('print patch can recover from a previously interrupted application', async t => {
  const f = await fixture(t);
  const first = f.manifest.files[0];
  await writeFile(join(f.dependency, first.target), await readFile(join(f.patches, first.patchFile)));
  assert.equal((await applyExpoPrintPatch({ projectRoot: f.root })).changed, 1);
});

test('print patch check mode never changes unapplied sources', async t => {
  const f = await fixture(t);
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root, checkOnly: true }), /尚未应用/);
  assert.equal(digest(await readFile(join(f.dependency, f.manifest.files[0].target))), f.manifest.files[0].upstreamSha256);
});

test('print patch rejects manifest paths outside the dependency directory', async t => {
  const f = await fixture(t);
  f.manifest.files[0].target = '../outside.kt';
  await f.saveManifest();
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root }), /超出目录/);
});

test('print patch refuses missing source-build config before modifying native files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'package.json'), JSON.stringify({}));
  await assert.rejects(applyExpoPrintPatch({ projectRoot: f.root }), /预编译 AAR/);
  assert.equal(digest(await readFile(join(f.dependency, f.manifest.files[0].target))), f.manifest.files[0].upstreamSha256);
});

test('print source-build guard requires the Android entry and rejects wrong or implicit settings', () => {
  for (const value of [
    { expo: { autolinking: { ios: { buildFromSource: ['expo-print'] } } } },
    { expo: { autolinking: { android: { buildFromSource: ['expo-sharing'] } } } },
    { expo: { autolinking: { android: { buildFromSource: 'expo-print' } } } },
  ]) assert.throws(() => assertExpoPrintSourceConfig(value), /预编译 AAR/);
  assert.doesNotThrow(() => assertExpoPrintSourceConfig({ expo: { autolinking: { android: { buildFromSource: ['expo-print', 'expo-sharing'] } } } }));
});
