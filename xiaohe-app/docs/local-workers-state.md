# 本地 Workers 状态隔离

本地开发服务支持通过 `XIAOHE_LOCAL_STATE_DIR` 显式选择独立持久化目录。默认目录仍保持原样；不要删除、覆盖或直接迁移现有 D1 文件。

本机观察到：旧目录及使用另一版本 `cf` 初始化的目录中，D1 的 `_cf_ALARM` 表包含 `actor_name` 列；项目锁定的 Wrangler/workerd 在读取这些目录时启动失败。使用项目本地 Wrangler 初始化的新目录没有该列，应用可启动。这是对当前机器的复现结果，并不证明所有版本组合都相同，也不代表旧数据已迁移。

在隔离工作树的 `xiaohe-app` 目录中，先按项目文档配置仅供本地使用的演示密钥并运行 `npm run build`，然后选择一个**尚不存在、仅供测试**的目录，使用项目锁定的 Wrangler 创建数据库：

```powershell
$env:XIAOHE_LOCAL_STATE_DIR = '.wrangler/my-isolated-test'
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to $env:XIAOHE_LOCAL_STATE_DIR --file drizzle/0000_great_wallop.sql --yes
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to $env:XIAOHE_LOCAL_STATE_DIR --file drizzle/0001_melodic_alex_power.sql --yes
node node_modules/wrangler/bin/wrangler.js d1 execute DB --config dist/server/wrangler.json --local --persist-to $env:XIAOHE_LOCAL_STATE_DIR --file drizzle/0002_history_upload_fence.sql --yes
npm run dev -- --hostname 127.0.0.1 --port 5173
```

不要对已有数据库重复执行这些初始化 SQL。新目录是空测试数据，不包含旧演示用户及历史。`XIAOHE_LOCAL_STATE_DIR` 仅影响 Vite 开发服务，原有 `npm start` 命令不读取该变量。旧目录兼容性与数据恢复、迁移尚未完成；处理前须完整备份并验证恢复，不应借清空状态掩盖问题。
