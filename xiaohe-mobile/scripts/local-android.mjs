import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { assertOcrRelease, ocrGradleGuard } from './assert-ocr-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = join(root, 'outputs', 'toolchain');
const reuseNative = process.argv.includes('--reuse-native');
const java = process.env.JAVA_HOME || join(toolchain, 'jdk', 'Contents', 'Home');
const sdk = process.env.ANDROID_HOME || join(toolchain, 'android-sdk');
const env = { ...process.env, CI: '1', JAVA_HOME: java, ANDROID_HOME: sdk,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || join(toolchain, 'gradle'),
  PATH: `${join(java, 'bin')}:${join(sdk, 'platform-tools')}:${process.env.PATH || ''}` };

async function run(command, args, cwd = root) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(`${command} exited with ${code}`)));
  });
}

try {
  await run(process.execPath, ['scripts/patch-expo-print.mjs']);
  await access(join(java, 'bin', 'java'));
  await access(join(sdk, 'platform-tools', 'adb'));
  if (reuseNative) {
    await access(join(root, 'android', 'gradlew'));
    console.log('复用已生成的 Android 工程；此选项仅适用于 JS / TS 修改。');
  } else {
    await run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  }
  const guardDirectory = await mkdtemp(join(tmpdir(), 'xiaohe-ocr-build-'));
  try {
    const guardPath = join(guardDirectory, 'assert-ocr-source.gradle');
    await writeFile(guardPath, ocrGradleGuard);
    await run('./gradlew', [':app:assembleRelease', '--init-script', join(root, 'scripts', 'assert-expo-print-source.gradle'), '--init-script', guardPath, '-PreactNativeArchitectures=arm64-v8a', '--no-daemon', '--max-workers=4', '--console=plain'], join(root, 'android'));
  } finally { await rm(guardDirectory, { recursive: true, force: true }); }
  await assertOcrRelease(root);
  const source = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const output = join(root, 'outputs', 'xiaohe-local-trial-arm64.apk');
  await mkdir(dirname(output), { recursive: true });
  await copyFile(source, output);
  const bytes = await readFile(output);
  await writeFile(join(root, 'outputs', 'android-build.json'), JSON.stringify({
    createdAt: new Date().toISOString(), file: output, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    architecture: 'arm64-v8a', purpose: 'local-trial',
    signing: 'Expo generated development debug key; not a store release',
    requiresMetro: false, deviceInstallationVerified: false,
  }, null, 2) + '\n');
  console.log(`本地试用 APK：${output}`);
  console.log('仅 ARM64 Android 本机试验；开发签名，不用于商店发布。');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('需要 JDK 17、Android SDK（本机配置或 outputs/toolchain/ 下的工具链）。参见 README.md。');
  process.exitCode = 1;
}
