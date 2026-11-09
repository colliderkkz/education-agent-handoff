import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertExpoPrintSourceConfig(packageJson) {
  const modules = packageJson.expo?.autolinking?.android?.buildFromSource;
  if (!Array.isArray(modules) || !modules.includes('expo-print')) {
    throw new Error('expo-print 补丁需要 package.json 的 expo.autolinking.android.buildFromSource 显式包含 "expo-print"；否则 Gradle 可能静默使用未修复的预编译 AAR。');
  }
}

function within(base, relative) {
  const path = resolve(base, relative);
  if (!path.startsWith(`${resolve(base)}${sep}`)) {
    throw new Error(`补丁文件路径超出目录：${relative}`);
  }
  return path;
}

// Full-file payloads keep this repair independent of system patch/git utilities.
// Check every input before changing anything; unknown dependency changes fail closed.
export async function applyExpoPrintPatch({ projectRoot = defaultRoot, checkOnly = false } = {}) {
  assertExpoPrintSourceConfig(JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')));
  const patchRoot = join(projectRoot, 'patches', 'expo-print');
  const packageRoot = join(projectRoot, 'node_modules', 'expo-print');
  const manifest = JSON.parse(await readFile(join(patchRoot, 'manifest.json'), 'utf8'));
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.package !== 'expo-print' || installed.name !== manifest.package || installed.version !== manifest.version) {
    throw new Error(`expo-print 补丁只适用于 ${manifest.version}，已安装 ${installed.version}；请先审查新版本再更新补丁。`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('expo-print 补丁清单为空。');
  }
  const planned = [];
  const targets = new Set();
  for (const entry of manifest.files) {
    const target = within(packageRoot, entry.target);
    if (targets.has(target)) throw new Error(`补丁目标重复：${entry.target}`);
    targets.add(target);
    const payload = await readFile(within(patchRoot, entry.patchFile));
    if (sha256(payload) !== entry.patchedSha256) {
      throw new Error(`已提交的 expo-print 补丁 SHA-256 不匹配：${entry.patchFile}`);
    }
    const current = sha256(await readFile(target));
    if (current !== entry.upstreamSha256 && current !== entry.patchedSha256) {
      throw new Error(`expo-print 原文件 SHA-256 不匹配：${entry.target}；不会覆盖未知修改。`);
    }
    planned.push({ target, payload, needsWrite: current !== entry.patchedSha256 });
  }
  const pending = planned.filter(file => file.needsWrite);
  if (checkOnly && pending.length > 0) {
    throw new Error('expo-print Android 生命周期补丁尚未应用。');
  }
  for (const file of pending) {
    const temporary = `${file.target}.xiaohe-patch-${process.pid}`;
    await writeFile(temporary, file.payload);
    await rename(temporary, file.target);
  }
  return { version: installed.version, changed: pending.length, checked: planned.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('只支持 --check 参数。');
    const result = await applyExpoPrintPatch({ checkOnly: process.argv.includes('--check') });
    console.log(`expo-print ${result.version} Android 生命周期补丁：${result.changed ? '已应用' : '已验证'}（${result.checked} 个原生文件，已要求从源码构建）。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
