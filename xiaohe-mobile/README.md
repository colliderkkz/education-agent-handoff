# 小禾学伴手机端

基于 Expo、React Native 和 SQLite 的本机试用应用。支持题库练习、作答和报告、错题订正、纸面回传，以及图片文字识别后的逐题人工核对。数据保存在本机，不自动与 Web 同步。支持小学、上海初中和高中学段，以及错因标签、按错因组卷和考情出处索引。

## 开发

需要 Node.js 22.13 或更新版本，安装依赖后启动：

```sh
npm ci
npm start
```

相机和 OCR 使用自定义原生模块，完整功能需要自定义原生构建；Expo Go 不包含该模块。Android 使用随包中文 ML Kit，iOS 使用系统 Vision 适配层，iOS 尚未完成原生运行验收。文字、数字、公式和单位都应对照原图核对。

## Android 试用包

配置 Android SDK 和 Java 工具链后：

```sh
npm run android:apk
```

构建结果位于 `outputs/xiaohe-local-trial-arm64.apk`，是 ARM64 开发签名试用包，不是商店发布包。仅修改 JS / TS 且已有匹配的原生工程时，可用 `npm run android:apk -- --reuse-native`。原生配置或依赖变化时须完整构建。Android / iOS 生成目录不手工维护。

安装依赖时会校验并应用 `expo-print` 补丁，详情见 [补丁说明](patches/expo-print/README.md)。[OCR 模块说明](modules/xiaohe-ocr/README.md)列出输入限制和引擎边界；[历史设备验收](docs/ocr-trial-validation.md)仅适用于记录中的版本和设备。

## 检查

```sh
npm test
npm run typecheck
npm run lint
node scripts/sync-local-domain.mjs --check
```

`src/local/shared` 由相邻的 `xiaohe-app/lib` 生成；修改共享领域后在手机目录执行 `node scripts/sync-local-domain.mjs`，不要手工改生成文件。

当前仍是试用项目。iOS 原生编译与设备验收、跨设备同步、正式账号与商店发布尚未完成。
