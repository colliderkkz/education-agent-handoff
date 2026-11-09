# 本机 App 试用验收 · 2026-10-26

本记录保留基础学习闭环的历史验收证据，下面的文件大小和哈希对应当时构建；输出目录中的同名 APK 已由后续构建更新。当前纸面练习与最新安装包验收见[纸面练习验收记录](paper-trial-validation.md)。

## 实际产物

- 独立 Android APK：`outputs/xiaohe-local-trial-arm64.apk`，33,406,144 字节。
- SHA-256：`86b87e4a223ebbf3585acc7459f4f59336e544591fe8666725c2d0596f5c73b0`。
- 包名 `com.xiaohe.studycompanion`，ARM64，开发签名。`apksigner verify` 通过；不是商店正式签名包。
- 验收设备为本机 `Xiaohe_Local_API36` Android 36 / ARM64 模拟器。真实手机与 iOS 安装尚未验收。
- APK 自带 JS，不依赖 Metro。关闭模拟器后，`npm run android:trial` 成功启动模拟器、覆盖安装并打开 App。另在关闭模拟器 Wi-Fi 与移动数据后确认 App 冷启动成功。

## 已观察到的原生行为

| 场景 | 实际结果 |
| --- | --- |
| 组卷与换题 | 生成 3 题；替换首题另存 v2，保留 v1 |
| 草稿持久化 | 输入首题答案 12，覆盖安装新版 APK 后仍恢复为 12 |
| 帮助记录 | 第二题输入 40 并打开提示，记录为使用提示 |
| 提交与报告 | 第三题填写错误答案 0；报告为 2/3，独立答对 1、提示后答对 1、讲解后答对 0 |
| 错题订正 | 将原答案 0 订正为 2000；原答案与订正答案分别展示，重看原报告仍为 2/3 |
| 离开未保存订正 | 返回时提示保留或放弃；选择继续后输入仍在 |
| 讲解曝光 | 打开原卷错题讲解后，另一未完成卷的对应题显示已看过讲解 |
| 切题滚动 | 从页面下方点击下一题，新题回到顶部，可见第 2/3 题和题干 |
| 系统拍照 | 请求相机权限，打开系统相机，拍摄模拟器测试画面并确认 |
| 图片留存 | 确认后显示图片已保存；完整关闭、重启模拟器和覆盖安装后，图片仍可打开 |
| 重启统计 | 已完成 1 份、待订正 0 道、已保存 1 张图片与重启前一致 |

照片是模拟器生成的测试画面，没有访问 Mac 摄像头。上述测试不代表实体摄像头、各手机厂商系统或所有相册格式已通过。

截图与现场日志保存在忽略目录 `outputs/qa/`：`android-restored-draft.png`、`android-hint.png`、`android-report-after-correction.png`、`android-corrected.png`、`android-next-question.png`、`android-photo-saved.png`、`android-photo-restored.png`、`cold-launch.log`。交付前仅清除了本轮新建模拟器内由开发验收产生的测试作答和照片，再冷启动得到空白学习档案，见 `android-ready.png`。日常启动器不会清除数据。

## 代码与构建验证

- TypeScript 与 ESLint 通过。
- 34 项自动化测试通过，涵盖学习引擎、SQLite 持久化失败与恢复、草稿合并冲突、照片恢复及报告曝光。
- 共享领域代码与来源 SHA-256 校验通过。
- Expo Doctor 20/20 检查通过。
- Android / iOS Hermes bundle 导出通过，iOS bundle 不代表 iOS 安装包或运行验收。
- 最终 Android Gradle 构建通过；纯 JS / TS 修改复用原生工程后构建耗时 17 秒。原生配置或依赖变化必须重新 prebuild。

## 尚未验收或接入

Android 实体手机、相册选图完整流程和各种图片格式、iOS 模拟器与 iPhone、正式签名、云端身份与同步、OCR、AI 和语音均需后续工作。当前 24 道数学样题和本机判分用于本地功能试验。
