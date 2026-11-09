# 本地内容包与版本归档验收 · 2026-10-27

本轮交付本机内容维护：教研 Web 导出 JSON，App 使用系统文件选择器预览和应用，保留题目版本，并按最近有效批次回退。没有注册平台账号、云发布或商店提交。Android 原生验收与 iOS 代码导出分别记录。

## 当前安装包

- 文件：`outputs/xiaohe-local-trial-arm64.apk`，**33,651,196 字节**。
- SHA-256：`bbc0bc120545f4bd92e055c8137e5333045efa52bfc370af1616c62985f36e55`。
- 开发签名、ARM64、包含 JS，不依赖 Metro；不是商店正式包或 iPhone 安装包。
- 新增 SDK 58 对应的 `expo-document-picker`，完整重建原生工程；最后的领域校验及性能修复仅修改 JS，再复用原生工程构建最终包。保留 expo-print 源码补丁和构建守卫。
- apksigner 验证通过；两个 Android API 36 ARM64 模拟器内实际安装的 `base.apk` 哈希均与上述文件一致。

## 功能及限制

内容包限制为 500 KiB、最多 200 个题目/撤回项，严格检查 UTF-8、字段白名单、摘要、课程范围、发布和独立审核元数据。原生读取按块限制实际字节数，不只信任文件选择器提供的大小。任一条不合格则整包拒绝，不写入部分结果。

全部内容包固定为 `unsigned` / `unvalidated-trial`。摘要不证明作者、审核人或发行人身份，独立审核字段检查也不等于人工教研验证。题目自由文本仍须正常教研审查。包不接受结构化学生档案、作答、照片、对话或评定规则。

预览只返回数量、知识点、题号、题族和版本摘要，不显示答案；绑定档案 revision 和文件摘要，应用前重新校验。成功应用通过本机 CAS 整批保存，重复包不写第二批。题号绑定题族，同版本不同正文、同题换题号、仅换数字却另建题族均拒绝；语义改写与近重复仍需人工判断。

首次升级归档当前题库与冻结原卷中实际存在的版本，不补造缺失历史。版本正文不可修改；编辑产生高于历史最高值的新版本。停用只影响新选题，已生成试卷继续使用原快照。回退须填写原因，仅允许最近一个仍生效的批次；保留归档、原卷、草稿、作答、曝光、照片和评定，不恢复整份旧学习档案。相同已回退包不能再次激活。

Web 只导出并查看归档/批次历史，本轮没有 Web 导入或回退入口。手机与 Web 不自动同步。实际 Web 验收见[教研内容包记录](../../xiaohe-app/docs/content-web-validation.md)。

## Android 实际界面验收

使用独立 AVD `Xiaohe_Content_QA_API36`（`emulator-5586`）。通过真实原生界面先生成三题练习，在第一题输入 `123` 并保存草稿；之后完成下表。测试档案没有提交成绩或照片，不冒充用户学习记录。

| 操作 | 设备结果与数据库核对 |
| --- | --- |
| 非法包 | 系统文件选择器选择含额外 `profile` 字段的文件，显示不允许字段错误；完整档案与操作前完全一致，revision 保持 4。 |
| 新增试用题 | 选择 9 题扩充包，预览新增 9、其余 0；确认后 39 道可用、39 条归档、1 个批次，revision 5。 |
| 重复导入 | 冷启动后重新选择同一文件，提示已应用，确认按钮确实禁用；完整档案保持不变。 |
| 真实 Web 文件 | 使用 Chrome 实际下载的 JSON，预览 29 道不变、1 道停用；确认后 38 道可用、1 道停用，revision 6。 |
| 回退停用批次 | 填写 `QA-withdrawal-rollback`，核对影响后确认回退，恢复 39 道可用；原因和回退 revision 7 留存。 |
| 回退新增批次 | 填写 `QA-sample-rollback` 并确认，恢复原有 30 道可用题；39 条归档及两条已回退批次保留，revision 8。 |
| 回退后冷启动 | 再次选择相同扩充包，提示已回退不能重新启用，确认按钮禁用；完整档案仍为 revision 8。 |

逐阶段对原有 `profile/papers/attempts/evidence/knowledge/mistakes/uploads/helpRequests/messages/mastery` 等字段作深比较，均未改变，答案草稿始终为 `123`。最后当前题库与导入前完全一致，归档和批次保留。原有冻结试卷不包含此次停用的 `seed-division-2`；“已有试卷包含被停用题目”的分支由领域测试覆盖，本轮没有另做该分支的设备作答。

Web 实际文件 32,455 字节，包编号 `local-3a7f35b8-1b82-410f-8817-8604e18292c3`，摘要 `8e4f1cbfde6e05d015bed0c3ea3b42c9b6e659017df35769c1d4a737bc2b7895`。该包的 29 道题保持原版本，仅撤回 `seed-division-2` v2。

## 日常试用档案保留

日常 AVD `Xiaohe_Local_API36`（`emulator-5584`）与验收 AVD 分开。安装前重新备份日常档案，使用 `adb install -r` 覆盖安装，没有卸载或清除数据。升级 revision 1 → 2，仅增加内容归档与升级事件；原有字段保持一致，30 道题、1 张照片、0 个内容批次。照片实际文件前后字节与 SHA-256 相同。

可选 `xiaohe-basic-trial-v1.json` 已复制到日常模拟器 Downloads，未自动导入。用户可以从“我的 → 管理本机题库内容包”选择。日常 App 留在可继续试用的状态；验收模拟器已关闭，验收档案和备份保留，不把测试记录写入日常档案。

## 可选扩充包

`content-packs/xiaohe-basic-trial-v1.json` 为 9 道基础试用题，摘要 `146c0266823cbe0e57c4d3d1bd331638ac449c465cb5909c1376edc3ff80fecd`。包含 8 个新结构候选及 1 个旧题族子任务，不等于 9 个新题族，不保证任一旧档案足以继续升星。选项辨认题不等于完整计算能力。

题目由 AI 起草，算术和结构清单经过独立脚本检查，尚未人工教研审核；作者/审核标识为机器流程标识。先修条件仅为文字说明，没有可执行的前置知识图谱。完整范围见[题包说明](../content-packs/README.md)和相邻教研工程 `content-trial-notes.md`。

## 自动化与构建

- Canonical **119/119** 通过（112 项 TypeScript 领域/权限等测试 + 7 项管理端 TSX/SSR 测试）。
- 移动端 **132/132** 通过，包括内容迁移、文件字节限制、UTF-8、幂等、冲突、回退、CAS、写入失败和回复丢失恢复。
- TypeScript、受影响 Web ESLint、移动端全量 ESLint、8 个共享源码来源校验通过；Expo Doctor **20/20**。
- Web 生产构建通过，Android / iOS Hermes 代码导出通过。iOS 没有原生构建、模拟器或 iPhone 运行证据。
- 修复合法大包的反复哈希问题，使用每次操作内缓存和索引。独立内存测试中，连续导入两个各 200 题、约 403 KB 的包，第二包预览约 35 ms、应用约 46 ms；这是 Mac/Node 测量，不能当作手机耗时保证。
- 预览提前拒绝用外来审核标识重新激活未经审核的同正文归档，避免预览可应用而提交必然失败。

主要证据位于忽略目录 `outputs/qa/`：`content-integration-tests.log`、`content-expo-doctor.log`、`content-bundles-final.log`、`content-android-build.log`、`content-android-final-build.log`、`content-apk-signature.log`、`content-native-final-checks.json`、`content-qa-*`、`content-user-before-install`、`content-user-after-install`，以及 `content-*.png` 截图。Canonical 合并测试日志为相邻工程 `outputs/qa/content-final-tests.log`。截图包括预览、非法包、重复禁用、Web 文件应用、回退及日常页面。

## 后续验收

真实 Android 手机、更多系统文件提供方、实体打印机、iOS 原生构建及权限、云同步和正式身份仍待完成。本轮没有重做上一版本 PDF 连续冷启动与逐页验收；历史证据见[纸面练习记录](paper-trial-validation.md)。完整配对原卷与答案导入、人工校对/语义重复处理、教学有效性、全部学科和商店发布仍按总计划推进。
