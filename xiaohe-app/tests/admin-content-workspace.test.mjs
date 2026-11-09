import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createSeedWorkspace } from "../lib/seed.ts";

// Render the real TSX with React; remove CSS imports only. No browser behavior is
// inferred from these tests, and no production module is stubbed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const compiled = new Map();
function tsxModule(file) {
  if (compiled.has(file)) return compiled.get(file);
  let code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  code = code.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+(["'])([^"']+)\1/g, (_, quote, name) => {
    let resolved;
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      resolved = [base, `${base}.ts`, `${base}.tsx`].find(item => existsSync(item));
      assert.ok(resolved, `Module exists: ${name}`);
    } else resolved = require.resolve(name);
    const url = /\.tsx?$/.test(resolved) ? tsxModule(resolved) : pathToFileURL(resolved).href;
    return `from ${JSON.stringify(url)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  compiled.set(file, url);
  return url;
}
const { buildAdminContentPackage, ContentPackagePanel, ContentArchivePanel, ContentVersionDetail, ContentBatchHistory } = await import(tsxModule(path.join(root, "components/admin-workspace.tsx")));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const metadata = { packageId: "admin-test-package", publisherId: "xiaohe-local-trial", createdAt: "2026-10-26T14:00:00.000Z", withdrawals: [] };
function fixture() {
  const state = createSeedWorkspace("admin-test-user", "测试人员");
  state.actor.role = "owner";
  state.profile.name = "PRIVATE_LEARNER_NAME";
  state.profile.school = "PRIVATE_SCHOOL";
  state.messages.push({ id: "private-chat", role: "user", text: "PRIVATE_CHAT", createdAt: metadata.createdAt });
  return state;
}
function archiveFixture() {
  const state = fixture();
  state.revision = 2;
  const question = structuredClone(state.questions.find(item => item.status === "published"));
  question.text = "<script>ARCHIVE_TEXT</script>";
  question.answer = "ARCHIVE_ANSWER";
  const version = { id: "archive-1", questionId: question.id, version: question.version, digest: "a".repeat(64), question, source: "package", sourceBatchId: "batch-1" };
  state.content = { schemaVersion: 1, versions: [version], batches: [{ id: "batch-1", packageId: "test-package-1", digest: "b".repeat(64), publisherId: "local-publisher", appliedAt: metadata.createdAt, appliedRevision: 1, status: "rolled-back", rolledBackAt: "2026-10-26T15:00:00.000Z", rolledBackRevision: 2, reason: "ROLLBACK_REASON", changes: [{ questionId: question.id, before: { versionId: version.id, status: "published" }, after: { versionId: version.id, status: "disabled" } }] }] };
  return { state, version };
}

test("admin export validates all published candidates and excludes learner data without mutating state", () => {
  const state = fixture(), before = structuredClone(state);
  const content = buildAdminContentPackage(state, { ...metadata, questionIds: [state.questions[0].id] });
  assert.equal(content.items.length, state.questions.filter(item => item.status === "published").length);
  assert.ok(content.items.every(item => item.status === "published" && item.reviewerId && item.reviewerId !== item.authorId));
  assert.equal(content.trust, "unsigned");
  assert.equal(content.kind, "xiaohe-content");
  assert.deepEqual(content.withdrawals, []);
  assert.doesNotMatch(JSON.stringify(content), /PRIVATE_LEARNER_NAME|PRIVATE_SCHOOL|PRIVATE_CHAT/);
  assert.deepEqual(state, before);
});

test("one invalid published candidate blocks the entire admin export", () => {
  const state = fixture();
  const bad = state.questions.find(item => item.status === "published");
  bad.reviewerId = bad.authorId;
  assert.throws(() => buildAdminContentPackage(state, metadata), /审核/);
});

test("withdrawals are explicit and retain the selected disabled question identity", () => {
  const state = fixture();
  const disabled = state.questions.find(item => item.status === "published");
  disabled.status = "disabled";
  assert.deepEqual(buildAdminContentPackage(state, metadata).withdrawals, []);
  const content = buildAdminContentPackage(state, { ...metadata, withdrawals: [disabled.id] });
  assert.deepEqual(content.withdrawals, [{ questionId: disabled.id, familyId: disabled.familyId, version: disabled.version }]);
  assert.ok(!content.items.some(item => item.id === disabled.id));
});

test("learner and family roles cannot render or export teaching archives even when passed full state", () => {
  const { state, version } = archiveFixture();
  for (const role of ["student", "parent", "teacher"]) {
    state.actor.role = role;
    assert.throws(() => buildAdminContentPackage(state, metadata), /无权/);
    assert.equal(render(ContentPackagePanel, { state, busy: false }), "");
    assert.equal(render(ContentArchivePanel, { state, onSelect() {} }), "");
    assert.equal(render(ContentVersionDetail, { state, version }), "");
    assert.equal(render(ContentBatchHistory, { state, onSelect() {} }), "");
  }
});

test("archive details render the saved snapshot read-only and escape user content", () => {
  const { state, version } = archiveFixture(), before = structuredClone(state);
  state.questions.find(item => item.id === version.questionId).answer = "CURRENT_CHANGED_ANSWER";
  const html = render(ContentVersionDetail, { state, version });
  assert.match(html, /只读归档/);
  assert.match(html, /ARCHIVE_ANSWER/);
  assert.doesNotMatch(html, /CURRENT_CHANGED_ANSWER|<script>|编辑草稿|发布题目/);
  assert.match(html, /&lt;script&gt;ARCHIVE_TEXT&lt;\/script&gt;/);
  assert.deepEqual(state.content, before.content);
});

test("batch history distinguishes original changes from current state and shows rollback reason", () => {
  const { state } = archiveFixture();
  const html = render(ContentBatchHistory, { state, onSelect() {} });
  assert.match(html, /已回退/);
  assert.match(html, /ROLLBACK_REASON/);
  assert.match(html, /应用前/);
  assert.match(html, /应用后/);
  assert.match(html, /已停用/);
  assert.match(html, /下表保留原应用时的变化/);
  assert.match(html, /手机端本地导入的记录不会自动同步/);
  assert.doesNotMatch(html, /<button[^>]*>回退/);
});

test("empty archive is reported honestly and package panel states unsigned download boundaries", () => {
  const state = fixture(); delete state.content;
  const before = structuredClone(state);
  assert.match(render(ContentArchivePanel, { state, onSelect() {} }), /暂无符合条件的归档/);
  assert.match(render(ContentBatchHistory, { state, onSelect() {} }), /导出文件不会生成导入批次/);
  const html = render(ContentPackagePanel, { state, busy: false });
  assert.match(html, /未签名/);
  assert.match(html, /不能验证发行人身份/);
  assert.match(html, /不包含学生档案/);
  assert.deepEqual(state, before);
});
