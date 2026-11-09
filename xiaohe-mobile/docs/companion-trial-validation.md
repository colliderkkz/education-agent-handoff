# 本机学伴、学习记忆与摘要验收

后续的证据更正及最新安装包见[证据更正验收记录](evidence-trial-validation.md)。下文保留本次学伴里程碑当时的结果与未完成项。

日期：2026-10-27。范围是原生 App 的固定题目版本会话、明确题库帮助、草稿续接、本人呈现偏好、私聊删除和独立保存的求助摘要。用户要求 Android / iOS、以大陆用户为主，目前只做本地试验；本轮没有注册服务、云部署或商店发布。

## 最终安装包

- 文件：`outputs/xiaohe-local-trial-arm64.apk`
- 大小：**33,723,992 字节**
- SHA-256：`ee7be8d5d8fe5bde25f80bff98a59fa34dc418aad26bfa674365c0b137bb2459`
- 构建时间：`2026-10-27T02:06:04.159Z`。ARM64、开发签名，内含 Hermes JS，不需要 Metro。
- 本机 JDK 下 `apksigner verify --verbose` 通过。不能作为商店正式签名包，也不是 iPhone 包。
- 已覆盖安装到 Android API 36 ARM64 的 `emulator-5586` 独立测试模拟器和 `emulator-5584` 日常试用模拟器；两台设备上的实际 `base.apk` 哈希均与上述文件一致。

`outputs/android-build.json` 和 `outputs/qa/companion-upgrade-verification.json` 保存安装与数据核对结果。未手工修改生成的 Android 工程。

## 原生界面与持久化结果

独立测试复用已有合成内容包档案，升级前 revision 8，包含一份三题原卷、答案草稿 `123`、39 个内容版本及两个已回退批次。本轮先在候选包验证新增主要流程，再在最终包验证覆盖恢复与删除修复。候选包 SHA-256 为 `8a6422aa41f527ecb6dfc2a31cef90d71ef77401158c50b1f5a1f6c3f1208922`；其后只修复多页面删除时的草稿显示/阻写。下表区分实际执行范围，不把旧包操作冒充最终包重复验收。

| 实际流程 | 观察与核对 |
| --- | --- |
| 旧档案升级（候选包） | revision 8 → 9，只新增空的会话结构与迁移事件；题库、冻结原卷、草稿、证据、评定、内容归档和批次完全保留，没有编造对话或偏好。 |
| 练习进入会话（候选包） | 把原答案 `123` 改为 `1234`，点击“保存草稿，带这道题问小禾”；数据库确认新答案已保存，会话绑定原卷 `seed-division-1` v2。 |
| 普通文字（候选包） | 输入 `Do not give the answer. QA-private-note.`，保存两条 note 记录；没有解法曝光，作答仍为 independent。中文“不要给我答案”另由领域回归验证，原生本轮输入为 ASCII。 |
| 明确帮助（候选包） | “给我提示”展示 v2 提示；本人选择简洁偏好后“换一种讲法”展示 v2 另一种解法并注明采用本人设置。数据库恰有两条帮助曝光，原草稿答案仍 `1234`，帮助升级为 explanation。 |
| 摘要预览与保存（候选包） | 手写 `QA-summary-only-check-remainder`，先预览完整题面、v2 来源和摘要，再确认只保存本机。记录为 local-only；未复制完整私聊、会话草稿、内部解法快照或偏好。 |
| 覆盖安装与冷启动（最终包） | 同一会话的六条消息、偏好和另存摘要可继续读取；已保存 `QA-draft-survives-restart` 在输入框恢复。没有 Metro 服务。 |
| 删除本人偏好（最终包） | 先查看影响，再确认删除；后续不再采用该设置，已有回复仍显示当时采用的简洁偏好。 |
| 同一会话开两页后删除（最终包） | 经会话 → 学习记忆 → 管理对话，再次打开同一会话；删除预览显示六条文字、已有草稿、保留两条帮助事实及一份摘要。确认后返回先前页面，已保存草稿为空、输入禁用，没有显示“已保存”或恢复旧内容。 |
| 删除后持久化（最终包） | 强制结束并读取 SQLite 当前档案：消息、旧线程和草稿已移除；请求只留无正文删除凭据。原卷、答案、证据、评定、题库归档、批次与独立摘要不变，帮助曝光仍为两条。 |
| 删除后重新进入原题（最终包） | 冷启动后练习仍显示答案 `1234`、看过讲解；从原题再次进入只创建新 ID 的空白 v2 会话，不恢复旧文字或草稿。最终合成档案 revision 32。 |

自动化另覆盖：磁盘提交失败时保留原字节、提交后回包丢失的精确认领、重复请求不重复写入、旧删除预览和草稿修订拒绝、另一写入者冲突、损坏快照阻写、旧消息版本未知迁移、原卷 v2 在题库更新至 v3 后仍引用 v2、已提交记录不因后续帮助改写。没有在真实设备上人为制造磁盘满或断电。

## 日常试用档案保留

日常模拟器在安装前另取最新完整备份，使用 `adb install -r` 覆盖安装，没有卸载、清除数据或导入测试内容。升级 revision **2 → 3**，新增空会话结构和一条迁移事件。除这些预期字段外，原档案字段逐项一致。

已有 **1 张照片**的元数据、私有目录相对路径与实际文件 SHA-256 完全一致。升级前后完整快照分别为 `outputs/qa/companion-user-before-upgrade/` 和 `outputs/qa/companion-user-after-upgrade/`；没有把测试消息、偏好或作答写进用户档案。收尾重新打开日常 App，独立测试模拟器关闭，测试档案保留供复验。

删除会话只针对当前应用档案，不承诺擦除 SQLite 底层历史页、系统备份或本轮明确保留的验收备份；页面也解释了这个范围。

## 检查与证据

最终源码：移动端 **152/152**，Web **146/146**，合计 **298/298** 自动化测试通过，无失败或跳过。移动端包括新增 9 项引擎持久化回归和 11 项草稿/页面状态回归；Web 结果详见相邻项目的 `docs/companion-web-validation.md`。

移动端 typecheck、lint、共享 9 份领域源码及 SHA-256 来源校验、Android/iOS Hermes 导出通过。Android 最终构建包含现有 expo-print 源码补丁检查。Web 生产构建、类型检查通过，lint 无错误、三个既有 img 提示。Web 真实 POST 层新增工作区选择、授权和伪造字段回归；浏览器发现的 `workspaceId` 传入严格领域校验问题已经在授权后的传输边界修复。

本机日志和截图位于不提交的 `outputs/qa/`：

- `companion-mobile-all-tests.log`、`companion-local-tests.log`、`companion-export.log`、`companion-android-build.log`、`companion-apk-signature.log`。
- `companion-native-note.png`、`companion-native-hint.png`、`companion-native-compact-reply.png`、`companion-native-summary-preview.png` 为同轮候选包的主要流程。
- `companion-final-draft-restored.png`、`companion-final-preference-delete.png`、`companion-final-delete-preview.png`、`companion-final-deleted-old-page.png`、`companion-final-new-thread.png` 为最终包。
- `companion-qa-before-upgrade/`、`companion-qa-after-upgrade/`、`companion-qa-note/`、`companion-qa-before-final/`、`companion-qa-deleted/`、`companion-qa-new-thread/` 为按阶段读取的完整合成档案。

截图已检查题目引用、摘要范围及删除影响的可读性。Web 实测原卷 v2 / 题库 v3 分离、中文普通留言、显式帮助、刷新恢复、摘要预览和偏好；Mac 锁定后未继续删除确认和窄屏测试，不能算作浏览器验收。

## 仍待完成

- iOS 仅通过代码导出；本机缺少适配的完整 Xcode 与模拟器运行时，尚无 iOS 原生构建、安装或运行证据。没有要求用户注册云构建或开发者会员。
- 本地题库引用不等于理解自由提问或连续追问。真实模型、OCR、语音、竖式与新题会话操作、教学有效性验证仍待完成。
- 手机求助仅本机保存。真人绑定、选择接收者、授权分享、送达/接收/回复和撤权仍未接入；Web 合成工作区收件箱不代表真人教师已经收到。
- 昵称及本人呈现偏好可改，私聊可删；课程更正、历史证据更正/删除及其对报告、错题、评定和复查的统一影响仍待实现。
- 真实 Android 手机、原生中文 IME 的组合输入边界、全量异常场景、iOS、正式身份同步、全学科、家长报告及发布按总计划继续。本轮没有减少原 49 个移动状态与 8 项管理能力范围。

本记录是增量验收，不表示全部产品目标已完成。此前内容包、五星、纸面打印及相机验证仍对应各自历史包记录，未在本轮重新执行全部流程。
