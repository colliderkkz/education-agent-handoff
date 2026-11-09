# Web 本地内容包与归档验收

验收日期：2026-10-27。范围为教研管理端的本地 JSON 内容包导出、不可变题目归档查看及批次历史展示。本轮仅使用现有本地 checkout、独立合成工作区和本轮创建的 Chrome 标签页；没有云发布、注册站点或提交 Git。

## 环境与测试档案

- 开发服务：`http://127.0.0.1:5173/`，由本轮测试自行启动并在结束时停止。
- 合成工作区：`content-ui-qa-1793062314341`。
- 复验 URL：`http://127.0.0.1:5173/?workspaceId=content-ui-qa-1793062314341`（需重新启动本地服务）。
- 本地固定身份 `local_seedy` 在该合成工作区的角色为 `editor`；没有修改其他工作区、成员记录或身份服务。
- 最终保留状态为修订 `4`：48 条归档、1 条已回退批次、29 道已发布候选、1 道已停用题。批次实际应用修订为 `1`、回退修订为 `2`，最终状态通过 `validateContentState`。
- 浏览器为 macOS Chrome 原生 UI，通过 CUA 操作。本轮测试标签页已关闭，原有标签页未操作。

## 实际浏览器结果

| 项目 | 结果 |
| --- | --- |
| 数据版本入口 | 显示 29 道已发布候选及“未签名、仅本地试用”的限制说明。 |
| 选择撤回 | 明确勾选已停用 `seed-division-2`；未选择时不会隐式加入撤回清单。 |
| 下载 | 点击“校验并下载内容包”后，Chrome 实际产生 JSON 文件；界面仅报告已发起下载，不声称导入或云发布成功。 |
| 全量校验失败 | 在该合成档案中临时将 `seed-division-1` 的审核人改为作者后，浏览器显示题号及独立审核/完整字段校验错误，明确未生成部分内容包。发行标识和已选择撤回项仍保留。测试后已恢复独立审核人。 |
| 批次历史 | 展开真实执行过应用及回退的合成批次，看到应用前/后指针、停用状态、回退时间和理由。表格说明保留原应用时变化，不等同于当前状态。 |
| 冻结归档 | 从批次打开 `seed-division-1` 的 v3 归档，可见“【合成修订】”题干；当前题库已回退到 v2，归档保持原文且没有编辑或发布按钮。 |
| 修复后重载 | 重新加载后实际页面显示工作区 r4 和 29 道已发布候选；最终持久状态再次通过完整内容状态校验。此后未再次点击下载。 |

实际下载文件为 `/Users/zhenshuai/Downloads/xiaohe-content-local-3a7f35b8-1b82-410f-8817-8604e18292c3.json`，原样保留一份在 `outputs/qa/content-web/browser-export.json`。

使用最终 canonical `parseContentPackage` 解析该实际下载文件成功：

- 文件大小：32,455 字节。
- 包编号：`local-3a7f35b8-1b82-410f-8817-8604e18292c3`。
- 摘要：`8e4f1cbfde6e05d015bed0c3ea3b42c9b6e659017df35769c1d4a737bc2b7895`。
- 29 道题均为 `published` 且审核人与作者不同。
- 1 条撤回：`seed-division-2` / `family-division-2` / v2。
- `trust` 为 `unsigned`，教学验证状态仍为 `unvalidated-trial`。
- 包中没有 `profile`、`papers`、`attempts`、`evidence`、`messages`、`uploads`、`helpRequests` 学生数据集合。

## 自动化检查

以下检查在最终契约（包含 `appliedRevision` / `rolledBackRevision`）下通过：

```sh
node --experimental-strip-types --test tests/admin-content-workspace.test.mjs
npx tsc --noEmit
npx eslint components/admin-workspace.tsx tests/admin-content-workspace.test.mjs
git diff --check
```

定向测试 7/7：验证全部已发布候选、拒绝单题非法审核、显式撤回、学习角色不能渲染教研归档、冻结快照/HTML 转义、回退记录只读、空状态及未签名边界。测试渲染真实 TSX 和 React，使用 canonical 导出函数；这些 SSR/纯函数断言不被计为浏览器权限或交互验收。

2026-10-27 最终合并复验使用当前源码执行 `node --experimental-strip-types --test --test-reporter=tap tests/*.test.ts tests/admin-content-workspace.test.mjs`，共 **119/119 通过**（领域与权限等 TypeScript 测试 112 项、管理端内容包测试 7 项），失败/取消/跳过均为 0。完整 TAP 日志保存在 `outputs/qa/content-final-tests.log`。该结果不包含手机测试或原生设备验收。

## 未完成的验收与边界

- 本轮没有完成 375px 窄屏浏览器验收。续验时 CUA 出现操作无响应、执行超时与 `noWindowsAvailable`；浏览器连接列表另报告本地浏览器访问未启用。重新绑定后可读到 r4 页面并关闭自己的标签页，但未取得可靠的设备模拟结果。因此不声称已验证窄屏无溢出，也没有提供窄屏截图。
- 桌面页面已实际查看；截图仅在本轮工具记录中展示，没有额外落盘截图文件。
- 浏览器只测试了独立合成工作区的 `editor` 入口。其他角色拒绝通过定向 SSR/纯函数测试覆盖；本轮没有为 owner/reviewer 分别执行浏览器流程。
- Web 页面只查看批次和回退历史，没有新增 Web 导入、回退或跨设备同步入口。合成批次由领域函数产生，不能算作 Web 回退操作实测。
- 该 JSON 是未签名的本地试用包。摘要校验不验证发行人身份，不替代教材授权或真实教学效度验证；不包含学生资料是指结构化学习数据集合，题目作者填写的题干、来源等自由文本仍需要正常教研审查。
- 题目先修条件 `prerequisites` 仅为文字说明；本轮未实现可执行的前置知识图谱，也未完成人工教学效度验证。
