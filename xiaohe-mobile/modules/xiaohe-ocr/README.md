# 小禾本机文字识别模块

本模块将本应用已保存的静态图片转换为**待人工核对的文字行**，不做题库匹配、数学求解、答案确认或判分，不调用远程 OCR。中文、数字与数学符号可能识别错误；分式、竖式、图形和手写过程不保证被正确表示。

## 接口

应用只通过 `src/features/native-ocr.ts` 调用：

- `getOcrAvailability(): Promise<OcrAvailability>`：实际原生模块存在、iOS 当前 Vision 支持简体中文时才可用。旧安装包/网页返回不可用，可继续原有手工路径。
- `recognizePhoto(uri): Promise<NativeOcrResult>`：URI 必须由本机引擎从当前登记照片取得，不能让业务请求自由指定路径。

结果包含 `engine`、`engineVersion`、原始文件字节的 `imageDigest`（SHA256）、已校正 EXIF 旋转/镜像并降采样后的 `width/height`，以及 `lines`。每行仅含 `id/text/confidence/box`；不再返回或存储重复的全文字符串。

`box` 使用识别图的归一化坐标：左上为 `(0,0)`，右下为 `(1,1)`。保留引擎观察结果的行顺序，不假装已恢复题目阅读顺序。行 ID 仅在一次结果内标识行。Android 中文置信度为 `null`；Vision 置信度是识别引擎原值，不是“题目正确率”，不能与 Android 比较。

## 安全边界与资源

- 原生二次校验 `file://`、应用私有 `document/xiaohe-images/` 目录、UUID 文件名和真实普通文件。拒绝网络 URI、其他应用路径、指向其他文件的符号链接。
- 原图最多 15 MiB、48,000,000 像素、单边 16,000 像素；先读取尺寸，再有界解码。识别图最长边不超过 2048 像素，原文件不改写。过大/不支持/空文件均明确失败。
- SHA256 按 64 KiB 分块计算；解码使用同一份最多 15 MiB 的字节快照，避免摘要和像素来自不同读取结果。无 base64 传输，无新增文件副本。
- 一次只处理一张图片。45 秒超时或模块销毁只结算一次 Promise；晚到结果不会二次成功。Android ML Kit 没有可靠的 Task 中断接口，超时后仍等底层任务结束才释放输入图和允许下一次任务，避免并发内存累积；此时会明确返回忙状态。
- 最多 300 行、每行 2000 UTF-16 单元、合计 30000 单元；超限拒绝而非静默截断。空识别结果允许 `lines: []`，由界面提示重新拍摄/手工输入。
- 引擎仍须检查照片是否已经删除、请求是否过期以及状态 revision；原生存在性检查不能替代历史删除标记。切换图片或晚到结果不得覆盖用户已经修改的文字。

## 依赖与许可

Android 固定 `com.google.mlkit:text-recognition-chinese:16.0.1`（bundled），无需 Google Play 首次下载模型；模型按官方说明约每文字体系、每架构增加 4 MB，最终 APK 增量以实际构建为准。当前应用 minSdk 24 满足 API 文档正文要求的 23。EXIF 使用现有 Expo ImagePicker 同版 `androidx.exifinterface:exifinterface:1.4.1`。ML Kit 16.0.1 已加入 Android 16 KB 内存页支持。

iOS 使用系统 `Vision / VNRecognizeTextRequest` 的 `.accurate`，运行时确认 `zh-Hans` 支持并记录 request revision 和系统版本，中文优先，可兼容同模型支持的繁体中文/英文；不启用语言自动纠错。`ImageIO` 校正方向及生成有界图，`CryptoKit` 计算摘要；无需额外下载识别模型或云端密钥。

ML Kit SDK/模型遵循 Google ML Kit 及 Google APIs 条款；不能把文档示例的 Apache 2.0 当作模型许可。官方说明图片、识别文字和结果在设备处理、不发送给 Google，但 SDK 会收集性能/使用指标并可能联系 Google 获取维护信息，因此不能宣传“SDK 完全不联网”。iOS 使用 Apple SDK/系统框架许可。本目录保留 Expo 模板的 MIT 许可；它不替代第三方条款。

官方依据（2026-10-27 核对）：

- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)、[本地模块与重新构建](https://docs.expo.dev/modules/get-started/)、[AsyncFunction 与生命周期](https://docs.expo.dev/modules/module-api/)
- [ML Kit Android API、版本与 bundled 体积](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)、[语言](https://developers.google.com/ml-kit/vision/text-recognition/v2/languages)、[发布说明](https://developers.google.com/ml-kit/release-notes)
- [ML Kit 条款](https://developers.google.com/ml-kit/terms)、[Android 数据披露](https://developers.google.com/ml-kit/android-data-disclosure)
- [Android 有界 Bitmap 解码](https://developer.android.com/topic/performance/graphics/load-bitmap)、[AndroidX EXIF](https://developer.android.com/jetpack/androidx/releases/exifinterface)
- [Apple Vision 识别文字](https://developer.apple.com/documentation/vision/recognizing-text-in-images)、[支持语言查询](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/supportedrecognitionlanguages())、[ImageIO 方向变换](https://developer.apple.com/documentation/imageio/kcgimagesourcecreatethumbnailwithtransform)

## 原生验收

这是自定义原生模块，Expo Go/仅 Metro export/TypeScript 通过均不能证明 OCR 可运行。模块由 `modules/` 自动链接；不要手改生成的 Android/iOS 工程。

当前 Android 发布包已完成离线打印样图和空白图验证，详细包摘要、真实结果及未测范围见[设备验收记录](../../docs/ocr-trial-validation.md)。首次实测发现 R8 移除了 ML Kit 反射注册器的无参构造；现以 `android/consumer-rules.pro` 精确保留三个注册器，并由 `scripts/assert-ocr-release.mjs` 校验实际清单和 R8 mapping。构建脚本还检查本地模块和 R8 参与当前 APK 任务图，失败时不复制新包。未关闭压缩。

Android 首次加入模块必须走正常 `npm run android:apk` 重新 prebuild/build，不能只用 `--reuse-native`。装入完整 APK 后，在无 Google Play 模型下载、离线状态下第一次识别明确打印样图；至少测试两张不同、题库外的中文数学题，核对实际识别行/数字/单位、90°及镜像方向、空白图、模糊图、超大图、重复点击、后台与取消、删除照片后的晚到回包。记录设备/系统/依赖版本、原始样图 SHA256、输出和耗时。不可用固定样例文本代替原生结果。

iOS 需完整 Xcode 与 iOS SDK，先编译到 iOS 模拟器用静态测试图，再在 iPhone 验证拍照和离线识别。仅当前 Mac 的 Command Line Tools、Swift 语法检查或 macOS Vision 运行不算 iOS 编译/设备验证。完成之前必须保留“iOS 待原生验证”的状态。
