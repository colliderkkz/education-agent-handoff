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
import { applyAction } from "../lib/server/domain.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";

// Actual TSX rendered by React. CSS alone is omitted; production selectors and
// grading are real. These are SSR/payload tests, not browser interaction claims.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const compiled = new Map();
function moduleUrl(file) {
  if (compiled.has(file)) return compiled.get(file);
  let code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file,
  }).outputText.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, "");
  code = code.replace(/from\s+(["'])([^"']+)\1/g, (_, quote, name) => {
    let resolved;
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      resolved = [base, `${base}.ts`, `${base}.tsx`].find(item => existsSync(item));
      assert.ok(resolved, `Module exists: ${name}`);
    } else resolved = require.resolve(name);
    return `from ${JSON.stringify(/\.tsx?$/.test(resolved) ? moduleUrl(resolved) : pathToFileURL(resolved).href)}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  compiled.set(file, url); return url;
}
const ui = await import(moduleUrl(path.join(root, "components/history-deletion-workspace.tsx")));
const { default: StudentLearning } = await import(moduleUrl(path.join(root, "components/student-learning.tsx")));
const { default: SharedLearning } = await import(moduleUrl(path.join(root, "components/shared-learning.tsx")));
const cache = await import(moduleUrl(path.join(root, "lib/learning-cache-cleanup.ts")));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const now = "2026-10-27T10:00:00.000Z";
let serial = 0;
function fixture() {
  const ctx = { userId: `history-web-${++serial}`, displayName: "试用学生", role: "student", now, newId: () => `history-web-record-${++serial}` };
  let state = createSeedWorkspace(ctx.userId, ctx.displayName, now);
  state.actor = { id: ctx.userId, name: ctx.displayName, role: "student" };
  state.access = { workspaceId: `history-workspace-${serial}`, ownerId: "profile-owner", role: "student", workspaces: [] };
  const made = applyAction(state, { action: "paper.create", count: 3, knowledgeIds: ["division"], difficulty: "基础", kind: "practice" }, ctx);
  state = made.state; const paper = state.papers.find(item => item.id === made.result.id);
  const result = applyAction(state, { action: "attempt.submit", paperId: paper.id, submissionKey: `submit-${serial}`, answers: paper.questions.map((question, index) => ({ questionId: question.id, value: index === 0 ? "DELETED_ANSWER_BODY" : `KEPT_ANSWER_${index}`, working: index === 0 ? "DELETED_WORKING_BODY" : "保留过程" })) }, ctx);
  state = result.state; const attempt = state.attempts.find(item => item.paperId === paper.id);
  const evidence = state.evidence.find(item => item.attemptId === attempt.id && item.questionId === paper.questionIds[0]);
  state.uploads = [{ id: "history-photo", name: "选择的原稿 <script>bad()</script>", url: "/api/files/history-photo", createdAt: now, status: "pending", purpose: "homework" }];
  const selected = { evidenceIds: [evidence.id], uploadIds: ["history-photo"] };
  const preview = applyAction(state, { action: "history.delete.preview", ...selected }, ctx).result.preview;
  return { state, ctx, paper, attempt, evidence, selected, preview };
}
const props = state => ({ state, busy: false, mutate: async () => undefined, navigate() {} });

test("history deletion entry is limited to owner/student even if full private state is accidentally passed", () => {
  const { state } = fixture();
  for (const role of ["parent", "teacher", "editor", "reviewer"]) {
    const denied = structuredClone(state); denied.actor.role = role; denied.access.role = role;
    const html = render(ui.default, props(denied)); assert.match(html, /当前角色不能删除学习历史/); assert.doesNotMatch(html, /DELETED_ANSWER_BODY|history-photo|预览删除影响/);
  }
  assert.match(render(ui.default, props(state)), /预览删除影响/);
});

test("deletion selection is explicit, escapes text and never treats unrelated photo names as associations", () => {
  const { state, evidence } = fixture(); const html = render(ui.default, { ...props(state), selectedId: evidence.id });
  assert.match(html, /当前已选 1 条/); assert.match(html, /不从试卷说明或求助文字猜测关联/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /已下载的 PDF/); assert.match(html, /删除不可恢复/);
});

test("impact includes reports, stars, related chat/summary, photo retention and broader audit cleanup", () => {
  const { state, preview } = fixture(); preview.photos[0] = { ...preview.photos[0], willDelete: false, retainedReferenceCount: 1, reason: "尚有未删除作答引用，保留" };
  const html = render(ui.HistoryDeletionImpact, { state, preview });
  for (const label of ["哪些报告会改变", "已删除记录不再计入报告分母", "知识点与复查计划", "本人关联会话", "求助摘要（含已共享）", "还有 1 处保留引用", "现存学习操作日志", "规则试算"]) assert.ok(html.includes(label), label);
});

test("confirmation copies only the exact preview selection and stable request identity", () => {
  const { preview } = fixture(); const payload = ui.historyDeletionPayload(preview, "stable-delete-request");
  assert.deepEqual(Object.keys(payload).sort(), ["evidenceIds", "uploadIds", "sourceRevision", "digest", "requestId"].sort());
  assert.deepEqual(payload.evidenceIds, preview.selection.evidenceIds); assert.equal(payload.sourceRevision, preview.sourceRevision); assert.equal(payload.digest, preview.digest);
  preview.selection.evidenceIds.push("later-change"); assert.equal(payload.evidenceIds.length, 1); assert.equal(payload.requestId, "stable-delete-request");
  assert.doesNotMatch(JSON.stringify(payload), /objectKey|DELETED_ANSWER|WORKING|filename/);
});

test("photo retention conclusions expire when either explicit selection or workspace revision changes", () => {
  const { state, preview } = fixture();
  assert.equal(ui.currentHistoryPreview(preview, state, preview.selection.evidenceIds, preview.selection.uploadIds), true);
  assert.equal(ui.currentHistoryPreview(preview, state, preview.selection.evidenceIds, []), false);
  assert.equal(ui.currentHistoryPreview(preview, state, [], preview.selection.uploadIds), false);
  assert.equal(ui.currentHistoryPreview(preview, { ...state, revision: state.revision + 1 }, preview.selection.evidenceIds, preview.selection.uploadIds), false);
});

test("real delete removes answer bodies from current, historical and parent reports and excludes the deleted denominator", () => {
  const { state, ctx, paper, attempt, preview } = fixture();
  const removed = applyAction(state, { action: "history.delete.confirm", ...ui.historyDeletionPayload(preview, `delete-${serial}`) }, ctx).state;
  const student = projectWorkspace(removed, "student");
  for (const evidenceRevision of [undefined, 0, state.revision]) {
    const html = render(StudentLearning, { ...props(student), view: "report", selectedId: attempt.id, evidenceRevision });
    assert.doesNotMatch(html, /DELETED_ANSWER_BODY|DELETED_WORKING_BODY/);
    assert.match(html, /第 1 题 · 学习记录已删除/); assert.match(html, /已删除 1 条作答，剩余 2 条/); assert.match(html, /首次总分不再展示/); assert.match(html, /<small>\/2<\/small>/);
  }
  const parent = projectWorkspace(removed, "parent"); const shared = render(SharedLearning, { ...props(parent), view: "report", selectedId: paper.id });
  assert.doesNotMatch(shared, /DELETED_ANSWER_BODY|DELETED_WORKING_BODY/); assert.match(shared, /已删除 1 条，剩余 2 条/); assert.match(shared, /shared-question-number">2</);
});

test("confirmed history deletion clears only this viewer's affected caches and closes delayed draft writes", () => {
  const f = fixture();
  const opened = applyAction(f.state, { action: "chat.open", context: { source: "paper", paperId: f.paper.id, questionId: f.paper.questionIds[0], questionVersion: f.paper.questions[0].version } }, f.ctx);
  const threadId = opened.result.id;
  const preview = applyAction(opened.state, { action: "history.delete.preview", ...f.selected }, f.ctx).result.preview;
  const removed = applyAction(opened.state, { action: "history.delete.confirm", ...ui.historyDeletionPayload(preview, `delete-cache-${serial}`) }, f.ctx).state;
  const workspace = removed.access.workspaceId, actor = removed.actor.id;
  const ownThread = `xiaohe-chat-draft:${JSON.stringify([workspace, actor, threadId])}`;
  const ownPaper = `xiaohe-draft-${workspace}-${actor}-${f.paper.id}`;
  const other = `xiaohe-chat-draft:${JSON.stringify(["another-workspace", actor, threadId])}`;
  const otherActor = `xiaohe-draft-${workspace}-someone-else-${f.paper.id}`;
  assert.deepEqual(new Set(cache.learningCacheKeysToPrune(removed, [ownThread, ownPaper, other, otherActor])), new Set([ownThread, ownPaper]));
  cache.rememberLearningVisibility(opened.state); assert.equal(cache.learningDraftStillAvailable(opened.state, "thread", threadId), true);
  cache.rememberLearningVisibility(removed); assert.equal(cache.learningDraftStillAvailable(opened.state, "thread", threadId), false); assert.equal(cache.learningDraftStillAvailable(opened.state, "paper", f.paper.id), false);
  cache.rememberLearningVisibility(opened.state); assert.equal(cache.learningDraftStillAvailable(opened.state, "thread", threadId), false, "late old snapshots cannot revive cached visibility");
});

test("deleted receipt shows pending physical cleanup honestly without exposing removed text", () => {
  const { state, ctx, preview } = fixture(); const removed = applyAction(state, { action: "history.delete.confirm", ...ui.historyDeletionPayload(preview, `receipt-${serial}`) }, ctx).state;
  const html = render(ui.default, props(projectWorkspace(removed, "student")));
  assert.match(html, /1 个图片文件等待回收/); assert.match(html, /已确认的删除记录/); assert.match(html, /核对并重试文件回收/); assert.doesNotMatch(html, /DELETED_ANSWER_BODY|DELETED_WORKING_BODY/);
});

test("all deleted report renders no zero score, performance claim or zero-valued grading cards", () => {
  const { state, ctx, attempt } = fixture();
  const selection = { evidenceIds: state.evidence.filter(item => item.attemptId === attempt.id).map(item => item.id), uploadIds: [] };
  const preview = applyAction(state, { action: "history.delete.preview", ...selection }, ctx).result.preview;
  const removed = applyAction(state, { action: "history.delete.confirm", ...ui.historyDeletionPayload(preview, `delete-all-${serial}`) }, ctx).state;
  for (const [Component, role] of [[StudentLearning, "student"], [SharedLearning, "parent"]]) {
    const html = render(Component, { ...props(projectWorkspace(removed, role)), view: "report", selectedId: attempt.id });
    assert.match(html, /作答已全部删除，当前无可统计作答/); assert.doesNotMatch(html, /learn-report-circle|learn-report-stats|shared-stats|0 题有效答对|看见困难|值得好好记住|DELETED_ANSWER_BODY|KEPT_ANSWER/);
  }
});

test("all invalidated but retained report shows no effective statistics instead of a zero denominator", () => {
  const f = fixture(); let state = f.state;
  for (const evidence of f.state.evidence.filter(item => item.attemptId === f.attempt.id)) {
    const proposed = applyAction(state, { action: "evidence.propose", evidenceId: evidence.id, patch: { invalidated: true }, reason: "录入材料不对应本次作答", uploadIds: [], sourceRevision: state.revision, requestId: `invalid-proposal-${++serial}` }, f.ctx);
    const teacher = { ...f.ctx, userId: "independent-teacher", role: "teacher" };
    const preview = applyAction(proposed.state, { action: "evidence.preview", proposalId: proposed.result.id, outcome: "accept" }, teacher).result.preview;
    state = applyAction(proposed.state, { action: "evidence.review", proposalId: proposed.result.id, outcome: "accept", sourceRevision: preview.sourceRevision, digest: preview.digest, reason: "已检查，排除该条证据", requestId: `invalid-review-${++serial}` }, teacher).state;
  }
  for (const [Component, role] of [[StudentLearning, "student"], [SharedLearning, "parent"]]) {
    const html = render(Component, { ...props(projectWorkspace(state, role)), view: "report", selectedId: f.attempt.id });
    assert.match(html, /当前无有效作答，暂无有效统计/); assert.doesNotMatch(html, /learn-report-circle|learn-report-stats|shared-stats|看见困难|值得好好记住/);
  }
});
