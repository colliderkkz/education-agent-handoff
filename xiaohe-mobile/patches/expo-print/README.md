# expo-print Android 文件导出补丁

本补丁仅适用于 `expo-print 58.0.7`，修改 `PrintModule.kt` 与 `PrintPDFRenderTask.kt` 的 PDF 文件导出生命周期。这里保存完整 Kotlin 替换文件；`manifest.json` 记录依赖版本、原文件及替换文件的 SHA-256。

Kotlin 文件基于 Expo 源码修改，原 MIT 许可与版权声明保留在 [LICENSE](LICENSE)。

## 修复依据与边界

源码存在两处生命周期问题：

- `printToFile` 只用局部变量持有异步渲染任务，没有明确的活动任务所有者。任务内部持有 WebView 并不保证整个对象图持续可达。Android 官方要求保留打印 WebView 引用；提前 GC 是首次导出挂起的合理推断，尚未被证明是本次故障根因。
- `onLayout` 尚未通过回调确认成功，就立即调用 `onWrite`；布局失败或取消也未传回调用方。这不符合 Android 打印适配器的异步生命周期要求。

补丁由模块强持有正在导出的任务，等待 `onLayoutFinished` 后写入，并统一处理完成、失败、取消和 renderer 退出。终态标记先于清理，迟到或重复回调不会再次结算；文件描述符与 WebView 会释放，失败时尽力删除未完成文件。打印机/URI 打印入口保持原有行为。

原生期限为进入 `printToFile` 后 25 秒，超时会终止渲染并清理资源；开始渲染及返回结果前也检查期限。主线程阻塞或跨 JS/native 派发延迟仍可能推迟处理，因此必须保留业务层 **JS 30 秒超时及迟到结果清理、防止误发布的保护**。不能用一次重试成功认定缺陷已修复；原生构建及冷启动首次导出仍需设备验收。

## 应用与升级

Expo 在 Android 默认使用包内的预编译 AAR；只修改 Kotlin 文件可能完全不进入 APK。项目在 `package.json` 中设置 `expo.autolinking.android.buildFromSource: ["expo-print"]`，仅将这个模块切换为源码构建。构建日志中 Expo 模块前的 `📦` 表示仍在使用预编译产物，不能作为补丁验收通过的结果。

`npm postinstall` 和 `scripts/local-android.mjs` 构建前都会运行 `scripts/patch-expo-print.mjs`。脚本先确认上述 Android 源码构建配置，再核对版本及所有文件哈希，最后应用补丁；支持重复运行，发现未知修改或版本变化时停止，不覆盖来源不明的内容。Android 构建额外通过 `--init-script` 加载 `scripts/assert-expo-print-source.gradle`，确认实际存在正确目录的 `:expo-print` 源码项目，且 APK 构建任务图包含 `:expo-print:compileReleaseKotlin`；不满足则停止，避免静默打包未修复的 AAR。无需手改生成的 `android/` 工程。只检查当前配置和补丁状态可运行：

```sh
node scripts/patch-expo-print.mjs --check
```

升级依赖时，先对照新版源码和上游修复记录审查上述问题。不要仅修改版本号或哈希绕过检查。若仍需补丁，应基于新版原文件重新生成替换文件及哈希，运行专用测试、原生构建和设备导出验收；若上游已解决，应一并移除补丁载荷、脚本、专用测试、`buildFromSource` 中的 `expo-print`、`postinstall` 和构建前接入，以及 Gradle 源码构建检查。原生源码变化需要重新构建 APK，不能仅导出 JS。

参考：[Android HTML 打印与 WebView 引用保留](https://developer.android.com/training/printing/html-docs)、[PrintDocumentAdapter 生命周期](https://developer.android.com/reference/android/print/PrintDocumentAdapter)、[WebView renderer 退出处理](https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone(android.webkit.WebView,%20android.webkit.RenderProcessGoneDetail))、[Expo 预编译模块与源码构建配置](https://docs.expo.dev/guides/prebuilt-expo-modules/)。
