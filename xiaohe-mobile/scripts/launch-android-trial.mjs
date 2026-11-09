import { existsSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, 'outputs', 'toolchain');
const sdk = process.env.ANDROID_HOME || join(tools, 'android-sdk');
const adb = join(sdk, 'platform-tools', 'adb');
const apk = join(root, 'outputs', 'xiaohe-local-trial-arm64.apk');
const avdName = 'Xiaohe_Local_API36';
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_AVD_HOME: join(tools, 'avd'), ANDROID_USER_HOME: join(tools, 'android-user') };
const pause = ms => new Promise(done => setTimeout(done, ms));
function command(args, optional = false) {
  const result = spawnSync(adb, args, { env, encoding: 'utf8', timeout: 60000 });
  if (!optional && result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Android 命令未完成');
  return result.stdout?.trim() || '';
}
function findEmulator() {
  const devices = command(['devices']).split('\n').map(line => line.split(/\s+/)[0]).filter(id => id.startsWith('emulator-'));
  return devices.find(id => command(['-s', id, 'emu', 'avd', 'name'], true).replaceAll('\\r\\n', '\n').split(/\r?\n/).some(line => line.trim() === avdName));
}

try {
  if (!existsSync(apk)) throw new Error('尚无本地试用 APK，请先运行 npm run android:apk。');
  if (!existsSync(adb)) throw new Error('尚未配置 Android SDK，请先查看 README.md。');
  let launchFailure;
  let reportLaunchFailure;
  const launchStopped = new Promise(resolve => { reportLaunchFailure = resolve; });
  const failLaunch = error => {
    launchFailure ??= error;
    reportLaunchFailure();
  };
  const waitForLaunch = async () => {
    await Promise.race([pause(1000), launchStopped]);
    if (launchFailure) throw launchFailure;
  };
  let serial = findEmulator();
  if (!serial) {
    if (!existsSync(join(tools, 'avd', `${avdName}.ini`))) throw new Error('未找到小禾专用模拟器配置。');
    if (command(['devices']).includes('emulator-5584')) throw new Error('模拟器端口 5584 已占用，请关闭占用该端口的模拟器后重试。');
    const log = openSync(join(root, 'outputs', 'emulator.log'), 'a');
    const child = spawn(join(sdk, 'emulator', 'emulator'), ['-avd', avdName, '-port', '5584', '-no-boot-anim', '-no-metrics', '-crash-report-mode', 'disabled', '-no-snapshot', '-gpu', 'swiftshader', '-feature', '-Vulkan', '-memory', '2048', '-cores', '2', '-no-audio', '-camera-back', 'emulated', '-camera-front', 'none'], { env, detached: true, stdio: ['ignore', log, log] });
    child.once('error', error => failLaunch(new Error(`模拟器启动失败：${error.message}。请查看 outputs/emulator.log。`)));
    child.once('exit', (code, signal) => failLaunch(new Error(`模拟器进程提前退出（${signal ? `信号 ${signal}` : `退出码 ${code}`}），请查看 outputs/emulator.log。`)));
    child.unref();
    console.log('正在启动小禾 Android 模拟器…');
    for (let i = 0; i < 90 && !serial; i++) { await waitForLaunch(); serial = findEmulator(); }
    if (!serial) throw new Error('模拟器未启动，请查看 outputs/emulator.log。');
  }
  let booted = false;
  for (let i = 0; i < 90; i++) {
    if (command(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], true) === '1') { booted = true; break; }
    await waitForLaunch();
  }
  if (!booted) throw new Error('模拟器尚未完成启动，请稍后重试。');
  console.log('正在安装本地试用版（保留已有学习数据）…');
  command(['-s', serial, 'install', '-r', apk]);
  command(['-s', serial, 'shell', 'am', 'start', '-n', 'com.xiaohe.studycompanion/.MainActivity']);
  console.log('小禾学伴已打开。学习记录保存在这个模拟器中。');
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
