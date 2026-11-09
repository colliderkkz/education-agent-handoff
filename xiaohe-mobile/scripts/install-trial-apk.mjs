#!/usr/bin/env node
// Portable handoff helper; no Expo or npm dependencies required.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [join(root, 'outputs', 'xiaohe-local-trial-arm64.apk'), join(root, '..', '构建备份-20261028', 'xiaohe-local-trial-arm64.apk')];
const apk = candidates.find(existsSync);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const adb = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：node scripts/install-trial-apk.mjs [设备序列号]\n先启动自己的 ARM64 模拟器或连接开启 USB 调试的 ARM64 安卓手机。需要 adb 可用；脚本覆盖安装，不卸载或清空数据。');
  process.exit(0);
}
function run(argv) {
  const result = spawnSync(adb, argv, { encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || 'adb 执行失败');
  return result.stdout.trim();
}
try {
  if (args.length > 1) throw new Error('仅接受一个可选设备序列号。使用 --help 查看说明。');
  if (!apk) throw new Error('未找到试用 APK。请保留上级 构建备份-20261028 目录，或先构建 outputs 中的新包。');
  const devices = run(['devices']).split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === 'device').map(parts => parts[0]);
  const serial = args[0] || (devices.length === 1 ? devices[0] : undefined);
  if (!serial || !devices.includes(serial)) throw new Error(`请连接并授权一个设备，或显式填写序列号。已就绪设备：${devices.join(', ') || '无'}`);
  const abi = run(['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abilist']);
  if (!abi.includes('arm64-v8a')) throw new Error('现有试用包只支持 ARM64，请使用 ARM64 安卓设备或模拟器。');
  console.log(run(['-s', serial, 'install', '-r', apk]));
  console.log(run(['-s', serial, 'shell', 'am', 'start', '-n', 'com.xiaohe.studycompanion/.MainActivity']));
  console.log('小禾学伴已安装并打开；已有数据由覆盖安装保留。若遇签名冲突，请先备份数据，不要直接卸载。');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
