# 原工作区差异清单（2026-11-19）

本清单只读比较原工作区 `git ls-files --modified --others --exclude-standard` 枚举的普通文件与集成工作树；仅将 CRLF 和 LF 视为相同。它不是完整备份或完整语义审计：被忽略文件、嵌套仓库和工作树内部内容、Git 对象与配置未递归枚举；目录可能作为一个条目出现。文件内容、账号缓存、令牌或密钥不写入本清单。原工作区没有因核对而被覆盖或删除。

## 已识别的功能和兼容性差异

- `OCR模块.zip` 是独立 OCR/PDF 原型，包含 PDF 文本层、EasyOCR 回退、题目和选项提取、裁图及 MinerU 结构处理等代码。集成版浏览器 Tesseract 和移动端 OCR 不能视作这些 PDF 工作流的等价实现；依赖和授权、运行效果尚未验证。原包保留在原工作区。
- `tmp/xiaohe-public-demo` 是独立仓库，旧演示身份为随机访客令牌；集成版改为有有效期的签名 Cookie。旧 Cookie 和旧本地空间数据不会自动迁移，历史数据兼容性需另行设计和验证。
- `tmp/xiaohe-access-proxy` 是独立的旧版代理实现，并未接入新的签名断言协议。集成版正式代理适配、真实身份联调和安全审查仍待完成。
- 原 Mobile `PracticeScreen.tsx` 在全部知识点被取消选择时有单独提示；集成版保留禁用组卷按钮与空学段提示，但没有同一场景的专门解释，属于体验差异。
- `xiaohe-app/components/image-ocr.tsx` 的差异包含集成版的异步清理逻辑；OCR 草稿及图片导入已纳入集成版。文件内容不同不表示功能完全等价，其余不同项仍需逐项语义审查。
- 小学 57 道原创练习是用户后来明确要求恢复的内容；原工作区部分旧修改移除了这些内容，不能直接用旧文件覆盖。

## 未递归的其他工作成果

- 原工作区下 `tmp/cloudflare-demo`、`tmp/ocr-upload`、`tmp/target-publish` 是 Git 工作树；`tmp/formal-repository`、`tmp/xiaohe-public-demo`、`tmp/site-redeploy` 是独立仓库。它们各自的 Git 历史、未跟踪与忽略文件不在以下文件清单的完整性保证内。
- `tmp/cloudflare-demo` 另有未跟踪的合成图片和 `.open-next` 目录；原工作区还存在本地缓存、归档、测试脚本和其他忽略内容。旧 `pr3-workspace-snapshot.zip` 不包含所有忽略文件和嵌套仓库，不能当作完整可恢复备份。
- 将来正式合并前，须在不影响原工作区的前提下备份全部工作树、Git 数据、未提交、未跟踪及必要忽略文件，保护秘密；在独立位置验证还原后的文件内容、Git 状态和分支指向，再拟定操作。

## 相同（30）

- `xiaohe-app/components/camera-workspace.tsx`
- `xiaohe-app/components/companion-chat.tsx`
- `xiaohe-app/components/image-ocr.css`
- `xiaohe-app/data/textbook-source-snapshot.json`
- `xiaohe-app/docs/browser-ocr.md`
- `xiaohe-app/docs/interface-review-2026-11-09.md`
- `xiaohe-app/lib/curriculum-explanations.ts`
- `xiaohe-app/lib/home-work.ts`
- `xiaohe-app/lib/ocr-questions.ts`
- `xiaohe-app/lib/student-navigation.ts`
- `xiaohe-app/package-lock.json`
- `xiaohe-app/package.json`
- `xiaohe-app/public/exercises/circle-12.svg`
- `xiaohe-app/public/exercises/circle-5.svg`
- `xiaohe-app/public/exercises/circle-8.svg`
- `xiaohe-app/scripts/collect-textbook-sources.py`
- `xiaohe-app/scripts/prepare-ocr-assets.mjs`
- `xiaohe-app/tests/history-deletion.test.ts`
- `xiaohe-app/tests/home-work.test.ts`
- `xiaohe-app/tests/ocr-questions.test.ts`
- `xiaohe-app/tests/student-navigation.test.ts`
- `xiaohe-mobile/src/components/ui.tsx`
- `xiaohe-mobile/src/features/recognition-review.ts`
- `xiaohe-mobile/src/local/shared/access-types.ts`
- `xiaohe-mobile/src/local/shared/effective-evidence.ts`
- `xiaohe-mobile/src/local/shared/history-deletion.ts`
- `xiaohe-mobile/src/local/shared/server/domain-error.ts`
- `xiaohe-mobile/src/screens/PhotoRecognitionScreen.tsx`
- `xiaohe-mobile/src/screens/ProfileScreen.tsx`
- `xiaohe-mobile/tests/recognition-groups.test.mjs`

## 内容不同（32）

- `xiaohe-app/.gitignore`
- `xiaohe-app/README.md`
- `xiaohe-app/app/page.tsx`
- `xiaohe-app/components/admin-workspace.css`
- `xiaohe-app/components/admin-workspace.tsx`
- `xiaohe-app/components/image-ocr.tsx`
- `xiaohe-app/components/interface-refresh.css`
- `xiaohe-app/components/student-learning.css`
- `xiaohe-app/components/student-learning.tsx`
- `xiaohe-app/docs/curriculum-and-paper-sources.md`
- `xiaohe-app/lib/curriculum-catalog.ts`
- `xiaohe-app/lib/curriculum-practice.ts`
- `xiaohe-app/lib/server/access-policy.ts`
- `xiaohe-app/lib/server/content.ts`
- `xiaohe-app/lib/server/domain.ts`
- `xiaohe-app/lib/server/history.ts`
- `xiaohe-app/lib/ui-types.ts`
- `xiaohe-app/tests/curriculum-catalog.test.ts`
- `xiaohe-app/tests/ocr-import.test.ts`
- `xiaohe-mobile/src/local/shared/grading.ts`
- `xiaohe-mobile/src/local/shared/seed.ts`
- `xiaohe-mobile/src/local/shared/server/access-policy.ts`
- `xiaohe-mobile/src/local/shared/server/companion.ts`
- `xiaohe-mobile/src/local/shared/server/content.ts`
- `xiaohe-mobile/src/local/shared/server/domain.ts`
- `xiaohe-mobile/src/local/shared/server/evidence.ts`
- `xiaohe-mobile/src/local/shared/server/history.ts`
- `xiaohe-mobile/src/local/shared/server/mastery.ts`
- `xiaohe-mobile/src/local/shared/server/recognition.ts`
- `xiaohe-mobile/src/local/shared/source-manifest.json`
- `xiaohe-mobile/src/local/shared/types.ts`
- `xiaohe-mobile/src/screens/PracticeScreen.tsx`

## 集成工作树缺少（33）

- `.cloudflare/cache/cloudflare-account.json`
- `OCR模块.zip`
- `tmp/check-proxy-assets.mjs`
- `tmp/check-proxy.mjs`
- `tmp/cloudflare-demo/（目录或其他非普通文件，未递归）`
- `tmp/demo-flow-check.mjs`
- `tmp/demo-flow-proxy.mjs`
- `tmp/formal-repository/（目录或其他非普通文件，未递归）`
- `tmp/ocr-browser-test.png`
- `tmp/ocr-upload/（目录或其他非普通文件，未递归）`
- `tmp/prepare_release.py`
- `tmp/repo-upload.json`
- `tmp/site-check.mjs`
- `tmp/site-redeploy-artifact.tar.gz`
- `tmp/site-redeploy/（目录或其他非普通文件，未递归）`
- `tmp/target-publish/（目录或其他非普通文件，未递归）`
- `tmp/verify-demo-isolation.mjs`
- `tmp/verify-demo-new.mjs`
- `tmp/verify-demo-worker.mjs`
- `tmp/verify-demo.mjs`
- `tmp/xiaohe-access-proxy/.cloudflare/output/v0/config.json`
- `tmp/xiaohe-access-proxy/.cloudflare/output/v0/workers/default/bundle/index.js`
- `tmp/xiaohe-access-proxy/.cloudflare/output/v0/workers/default/bundle/index.js.map`
- `tmp/xiaohe-access-proxy/.cloudflare/output/v0/workers/default/worker.config.json`
- `tmp/xiaohe-access-proxy/.cloudflare/types/index.d.ts`
- `tmp/xiaohe-access-proxy/cloudflare.config.ts`
- `tmp/xiaohe-access-proxy/package-lock.json`
- `tmp/xiaohe-access-proxy/package.json`
- `tmp/xiaohe-access-proxy/src/index.ts`
- `tmp/xiaohe-access-proxy/vite.config.ts`
- `tmp/xiaohe-demo-guest.tar.gz`
- `tmp/xiaohe-public-demo-build.tar.gz`
- `tmp/xiaohe-public-demo/（目录或其他非普通文件，未递归）`
