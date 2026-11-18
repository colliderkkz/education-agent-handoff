# 独立 Cloudflare 演示版实施边界

这是隔离工作区中的进行中方案，不代表已经部署。

## 依赖和最小改造

- Web 使用 Vinext 和 Cloudflare Workers；业务记录、成员关系、上传索引保存在 D1。保留现有表和迁移，部署时使用独立资源。
- 原身份由 Sites 网关注入；直接部署时不得信任来自客户端的 `oai-authenticated-*` 头。演示分支只从 `__Host-xiaohe_demo` 随机会话识别临时访客，不使用真实用户身份。
- 演示会话不能验证学生或教师身份，因此禁止邀请/成员更改，不能宣称保留真实教师授权。不得放真实学生信息；正式角色功能需要独立认证。
- 图片当前依赖 R2 的 put/get/delete/list/head，包含私有权限、删除后拒绝访问、失败重试和孤儿清理。新存储必须实现并测试这些行为，不能只实现 put/get。
- 浏览器 OCR 模型及静态资源随构建产物提供；教研 OCR 生成草稿需要 D1，学生图片需要上述对象存储。
- 本地 Sites 插件提供开发预览和模拟身份，生产连接器不可假定存在；直接部署需要独立 Worker 配置和资源绑定，不能将演示 mock 身份用于公开服务。

## KV 结论

KV 的最终一致性可能使写入后立即读取失败，跨地区延迟 60 秒或更久；删除和不存在的结果也可能被缓存。它不能单独满足当前上传后立即显示及跨地点删除/失败恢复要求。D1 作为权威访问检查可阻止已撤权图片发出，但不能消除新图暂时不可见的问题，也不能把 KV list 当作强一致的孤儿清理依据。

## 下一步验证

评估私有 Supabase Storage 替代适配层，验证 10 MiB 对象上传后立即读取、私有访问、元数据与分页、删除、权限撤销、超时及失败回收。要连接真实服务需独立项目和服务端密钥，不能将密钥放入 Git 或浏览器。检查 D1 单行限制对现有工作区 JSON 的影响；不做图片分片入 D1。先完成真实 Worker 环境的自动化和端到端验证，再考虑部署新的演示环境。

## 2026-11-18 independent demo deployment

- Worker: `xiaohe-cloudflare-demo`; D1: `xiaohe-demo-db` (APAC), with existing migrations 0000–0002 applied. Do not use the original production worker or database.
- Supabase project: `xiaohe-demo` (Tokyo), private bucket `student-images`, 10 MB limit, JPEG/PNG/WebP only. The worker requires secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `DEMO_SESSION_SECRET`. Never commit their values.
- Vinext produces `dist/server/wrangler.json`; deploy that generated configuration, after checking the worker name and D1 binding. Some newer Wrangler releases reject its generated `legacy_env` property; remove only that property from the generated file if needed. Do not run automatic OpenNext migration.
- Demonstration sessions are signed and expire after 12 hours. They are not real account authentication, and invite mutations are disabled. Never use real student information.
- Current limitations: OCR can misread math symbols and requires manual correction. Orphan scanning is triggered by history deletion/retry, not a background job, and a scan fails closed if it reaches 1,000 objects. An interrupted PUT whose outcome is unknown needs further end-to-end recovery testing. A new visitor cannot delete an image alone through the history deletion flow without selecting an evidence record. Physical-phone and independent mainland-network tests remain outstanding.
