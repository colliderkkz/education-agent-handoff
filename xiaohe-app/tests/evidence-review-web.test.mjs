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
import { effectiveEvidence } from "../lib/effective-evidence.ts";

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
const ui = await import(moduleUrl(path.join(root, "components/evidence-review-workspace.tsx")));
const { default: StudentLearning } = await import(moduleUrl(path.join(root, "components/student-learning.tsx")));
const { default: SharedLearning } = await import(moduleUrl(path.join(root, "components/shared-learning.tsx")));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const now = "2026-10-27T10:00:00.000Z";
function fixture(role = "student", accepted = false) {
  const state = createSeedWorkspace("web-owner", "学习者", now);
  state.actor = { id: role === "student" ? "web-student" : `web-${role}`, name: "测试账号", role };
  state.access = { workspaceId: "evidence-web-test", ownerId: "web-owner", role, workspaces: [] };
  const q = state.questions[0];
  state.papers = [{ id: "evidence-paper", title: "冻结原卷", version: 2, createdAt: now, questionIds: [q.id], questions: [q], status: "completed", kind: "practice", reason: "定向测试", estimatedMinutes: 2 }];
  state.attempts = [{ id: "evidence-attempt", paperId: "evidence-paper", answers: [{ questionId: q.id, value: "ORIGINAL_WRONG", working: "ORIGINAL_WORKING", help: "unknown", correct: false }], status: "submitted", startedAt: now, submittedAt: now, correctCount: 0, independentCount: 0 }];
  state.evidence = [{ id: "evidence-one", questionId: q.id, questionVersion: q.version, familyId: q.familyId, knowledgeId: q.knowledgeId, attemptId: "evidence-attempt", paperId: "evidence-paper", questionText: q.text, answer: "ORIGINAL_WRONG", expected: q.answer, help: "unknown", correct: false, createdAt: now, kind: "practice", provenance: "paper", eligible: false, taskType: q.taskType, contextId: q.contextId }];
  state.mistakes = [{ id: "original-mistake", question: q, originalAnswer: "ORIGINAL_WRONG", evidenceId: "evidence-one" }];
  state.uploads = [{ id: "chosen", name: "主动选择的原稿", url: "/api/files/chosen", createdAt: now, purpose: "homework", status: "confirmed" }, { id: "not-chosen", name: "PRIVATE_UNSELECTED_IMAGE", url: "/api/files/private", createdAt: now, purpose: "homework", status: "pending" }];
  state.messages = [{ id: "private-message", role: "user", text: "PRIVATE_CHAT_BODY", createdAt: now }];
  state.events = []; state.mastery = undefined;
  const proposal = { id: "proposal-one", evidenceId: "evidence-one", sourceDigest: "source-digest", patch: { answer: q.answer, knowledgeId: "geometry", help: "independent" }, reason: "录入答案和知识点有误，请按原稿核对", uploadIds: ["chosen"], requestedBy: "web-student", createdAt: now, createdRevision: 2, delivery: "workspace", requestId: "proposal-request", requestDigest: "request-digest", materials: [{ id: "chosen", name: "主动选择的原稿", url: "/api/evidence/proposal-one/images/chosen" }] };
  state.evidenceReviews = { schemaVersion: 1, proposals: [proposal], decisions: accepted ? [{ id: "decision-one", proposalId: proposal.id, evidenceId: proposal.evidenceId, outcome: "accept", authority: "teacher-verified", actorId: "web-teacher", reason: "已核对所选原稿", createdAt: now, appliedRevision: 4, requestId: "review-request", requestDigest: "review-digest" }] : [] };
  state.revision = accepted ? 4 : 2;
  return { state, proposal, q };
}
const props = state => ({ state, mutate: async () => undefined, navigate() {}, busy: false });
function previewFor(state, proposal, outcome = "accept") {
  const before = effectiveEvidence(state)[0];
  return { proposalId: proposal.id, evidenceId: proposal.evidenceId, sourceRevision: state.revision, digest: "bound-preview-digest", outcome, authority: "teacher-verified", before, after: before, report: { attemptId: before.attemptId, beforeCorrect: 0, afterCorrect: 1, beforeIndependent: 0, afterIndependent: 1, invalidatedCount: 0 }, mistake: { beforeActive: true, afterActive: false }, knowledge: [{ knowledgeId: "geometry", beforeStars: null, afterStars: null, reason: "独立新题资格不会因修改帮助标记恢复" }], reviewPlans: [], warnings: ["原帮助曝光保留"] };
}

test("student proposal contains only explicit changed fields and chosen workspace uploads", () => {
  const { state, q } = fixture(); const evidence = effectiveEvidence(state)[0];
  const result = ui.evidenceProposalPayload(evidence, { answer: q.answer, knowledgeId: evidence.knowledgeId, help: evidence.help, invalidated: false }, "  原稿录入有误  ", ["chosen", "chosen"], state, "stable-request");
  assert.deepEqual(result.patch, { answer: q.answer }); assert.deepEqual(result.uploadIds, ["chosen"]);
  assert.equal(result.sourceRevision, state.revision); assert.equal(result.requestId, "stable-request"); assert.equal(result.reason, "原稿录入有误");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CHAT|PRIVATE_UNSELECTED|correct|authority/);
  assert.throws(() => ui.evidenceProposalPayload(evidence, { answer: q.answer, knowledgeId: evidence.knowledgeId, help: evidence.help, invalidated: false }, "理由", ["foreign-upload"], state, "req"), /当前工作区/);
  assert.throws(() => ui.evidenceProposalPayload(evidence, { answer: evidence.answer, knowledgeId: evidence.knowledgeId, help: evidence.help, invalidated: false }, "理由", [], state, "req"), /至少修改/);
});

test("sharing preview names the selected evidence and material without carrying private chat or other photos", () => {
  const { state, proposal } = fixture();
  const html = render(ui.EvidenceSharingPreview, { evidence: effectiveEvidence(state)[0], patch: proposal.patch, reason: proposal.reason, uploads: state.uploads.filter(item => proposal.uploadIds.includes(item.id)) });
  assert.match(html, /提交申请不会改变成绩/); assert.match(html, /主动选择的原稿/); assert.match(html, /私人对话、其他照片和未提交作答不会附带/);
  assert.doesNotMatch(html, /PRIVATE_CHAT_BODY|PRIVATE_UNSELECTED_IMAGE|\/api\/files\/private/);
});

test("owner and student never receive a teacher review control; teacher cannot review own proposal", () => {
  for (const role of ["owner", "student", "parent"]) {
    const { state, proposal } = fixture(role); const html = render(ui.EvidenceProposalDetail, { ...props(state), proposal });
    assert.doesNotMatch(html, /预览更正影响|确认接受更正/); assert.match(html, /当前身份不能确认教师核实/);
  }
  const { state, proposal } = fixture("teacher");
  assert.match(render(ui.EvidenceProposalDetail, { ...props(state), proposal }), /预览更正影响/);
  assert.doesNotMatch(render(ui.EvidenceProposalDetail, { ...props(state), proposal: { ...proposal, requestedBy: state.actor.id } }), /预览更正影响/);
});

test("teacher material links are limited to explicit proposal metadata", () => {
  const { state, proposal } = fixture("teacher"); const html = render(ui.EvidenceProposalDetail, { ...props(state), proposal });
  assert.match(html, /\/api\/evidence\/proposal-one\/images\/chosen/);
  assert.doesNotMatch(html, /\/api\/files|PRIVATE_UNSELECTED_IMAGE|PRIVATE_CHAT_BODY/);
  assert.match(html, /不能声称看过未提供的原稿|只陈述实际查阅的材料/);
});

test("review confirmation preserves preview digest, source revision and request id; stale or privileged spoof rejected", () => {
  const { state, proposal } = fixture("teacher"); const preview = previewFor(state, proposal);
  const payload = ui.evidenceReviewPayload(state, proposal, preview, "  按所选原稿核对  ", "stable-review");
  assert.deepEqual(payload, { proposalId: proposal.id, outcome: "accept", sourceRevision: state.revision, digest: preview.digest, reason: "按所选原稿核对", requestId: "stable-review" });
  assert.throws(() => ui.evidenceReviewPayload({ ...state, revision: state.revision + 1 }, proposal, preview, "理由", "req"), /重新预览/);
  assert.throws(() => ui.evidenceReviewPayload(fixture("owner").state, proposal, preview, "理由", "req"), /教师/);
  assert.throws(() => ui.evidenceReviewPayload(state, { ...proposal, requestedBy: state.actor.id }, preview, "理由", "req"), /另一位/);
  assert.throws(() => ui.evidenceReviewPayload(state, proposal, { ...preview, authority: "local-unverified" }, "理由", "req"), /不匹配/);
  assert.equal(ui.evidenceReviewPayload(state, proposal, previewFor(state, proposal, "reject"), "材料不足", "reject-req").outcome, "reject");
});

test("effective and original values are distinct and local-unverified never claimed as teacher verification", () => {
  const { state, q } = fixture("student", true); const current = effectiveEvidence(state)[0];
  const html = render(ui.EvidenceComparison, { state, evidence: current });
  assert.match(html, /首次保存/); assert.match(html, /当前有效/); assert.match(html, /ORIGINAL_WRONG/); assert.match(html, new RegExp(q.answer)); assert.match(html, /授权教师已复核/);
  const unverified = render(ui.EvidenceComparison, { state, evidence: { ...current, authority: "local-unverified" } });
  assert.match(unverified, /未经教师核实/); assert.doesNotMatch(unverified, /授权教师已复核/);
});

test("student and shared reports use current effective counts but historical revision shows original result", () => {
  const { state } = fixture("student", true);
  const current = render(StudentLearning, { ...props(state), view: "report", selectedId: "evidence-attempt" });
  assert.match(current, /首次保存：0 题答对。当前展示：1 题有效答对/);
  const historical = render(StudentLearning, { ...props(state), view: "report", selectedId: "evidence-attempt", evidenceRevision: 0 });
  assert.match(historical, /旧评定未记录修订号/); assert.match(historical, /首次保存：0 题答对。当前展示：0 题有效答对/); assert.match(historical, /ORIGINAL_WRONG/);
  const teacher = fixture("teacher", true).state;
  const shared = render(SharedLearning, { ...props(teacher), view: "report", selectedId: "evidence-attempt" });
  assert.match(shared, /首次保存：0 题答对；当前展示：1 题有效答对/);
});

test("knowledge uses corrected grouping and original mistake leaves pending list while history remains", () => {
  const { state } = fixture("student", true);
  const knowledge = render(StudentLearning, { ...props(state), view: "knowledge", selectedId: "geometry" });
  assert.match(knowledge, /授权教师已复核/);
  const pending = render(StudentLearning, { ...props(state), view: "mistakes" });
  assert.doesNotMatch(pending, /ORIGINAL_WRONG/);
  const history = render(StudentLearning, { ...props(state), view: "mistakes", selectedId: "original-mistake" });
  assert.match(history, /已更正，不在当前错题/); assert.match(history, /ORIGINAL_WRONG/); assert.doesNotMatch(history, />保存订正</);
});

test("unknown or unauthorized evidence routes do not expose unrelated records or controls", () => {
  const { state } = fixture("editor"); const denied = render(ui.default, { ...props(state), selectedId: "evidence-one" });
  assert.match(denied, /不能查看/); assert.doesNotMatch(denied, /ORIGINAL_WRONG|预览共享范围|预览更正影响/);
  const missing = render(ui.default, { ...props(fixture().state), selectedId: "unavailable-evidence" });
  assert.match(missing, /暂不可查看/); assert.doesNotMatch(missing, /预览共享范围/);
});

test("impact preview separates evidence correction from historical grades, exposure and teaching validity", () => {
  const { state, proposal } = fixture("teacher"); const html = render(ui.EvidenceImpactPreview, { preview: previewFor(state, proposal), state });
  assert.match(html, /原稿、历史评定和已查看的帮助记录仍保留/); assert.match(html, /不是对试用星级规则教学有效性的验证/); assert.match(html, /原帮助曝光保留/);
});


test("real propose → teacher preview/review → student and parent projections render one consistent corrected result", () => {
  const initial = fixture().state; initial.evidenceReviews = undefined;
  const rawBefore = structuredClone({ attempts: initial.attempts, evidence: initial.evidence, papers: initial.papers });
  let serial = 0;
  const context = (role, userId) => ({ userId, role, displayName: "定向测试", now, newId: () => `real-web-${++serial}` });
  const asActor = (state, role, actorId) => ({ ...structuredClone(state), actor: { id: actorId, name: "定向测试", role }, access: { ...state.access, role } });
  const studentBefore = projectWorkspace(initial, "student");
  const original = effectiveEvidence(studentBefore)[0];
  const proposalPayload = ui.evidenceProposalPayload(original, { answer: initial.questions[0].answer, knowledgeId: "geometry", help: "unknown", invalidated: false }, "按原稿更正录入文字和知识点", ["chosen"], studentBefore, "real-proposal-request");
  const proposed = applyAction(initial, { action: "evidence.propose", ...proposalPayload }, context("student", "web-student"));
  assert.equal(effectiveEvidence(proposed.state)[0].correct, false, "pending never changes report");
  const teacherRaw = asActor(proposed.state, "teacher", "web-teacher");
  const teacher = projectWorkspace(teacherRaw, "teacher");
  const proposal = teacher.evidenceReviews.proposals[0];
  assert.equal(teacher.uploads.length, 0); assert.equal(teacher.messages.length, 0);
  const detail = render(ui.default, { ...props(teacher), selectedId: proposal.id });
  assert.match(detail, /预览更正影响/); assert.match(detail, /api\/evidence/); assert.doesNotMatch(detail, /PRIVATE_CHAT_BODY|PRIVATE_UNSELECTED_IMAGE/);
  const previewResult = applyAction(teacherRaw, { action: "evidence.preview", proposalId: proposal.id, outcome: "accept" }, context("teacher", "web-teacher"));
  assert.equal(previewResult.state, teacherRaw, "preview is read only");
  const preview = previewResult.result.preview;
  const reviewPayload = ui.evidenceReviewPayload(teacher, proposal, preview, "按明确共享的原稿核对录入", "real-review-request");
  const reviewed = applyAction(teacherRaw, { action: "evidence.review", ...reviewPayload }, context("teacher", "web-teacher"));
  const retry = applyAction(reviewed.state, { action: "evidence.review", ...reviewPayload }, context("teacher", "web-teacher"));
  assert.equal(retry.state, reviewed.state); assert.equal(retry.result.id, reviewed.result.id);
  assert.deepEqual({ attempts: reviewed.state.attempts, evidence: reviewed.state.evidence, papers: reviewed.state.papers }, rawBefore);
  for (const role of ["student", "parent", "teacher"]) {
    const projected = projectWorkspace(asActor(reviewed.state, role, `web-${role}`), role);
    const current = effectiveEvidence(projected)[0];
    assert.equal(current.correct, true); assert.equal(current.knowledgeId, "geometry"); assert.equal(current.authority, "teacher-verified");
    const report = render(role === "student" ? StudentLearning : SharedLearning, { ...props(projected), view: "report", selectedId: "evidence-attempt" });
    assert.match(report, /当前展示：1 题有效答对/);
    const history = render(role === "student" ? StudentLearning : SharedLearning, { ...props(projected), view: "report", selectedId: "evidence-attempt", evidenceRevision: proposed.state.revision });
    assert.match(history, /当前展示：0 题有效答对/);
  }
  const otherStudent = projectWorkspace(asActor(reviewed.state, "student", "other-student"), "student");
  const summaryQueue = render(ui.default, props(otherStudent));
  assert.doesNotMatch(summaryQueue, /按原稿更正录入文字和知识点|主动选择的原稿/);
  assert.equal(effectiveEvidence(otherStudent)[0].correct, true, "effective accepted chain remains usable without request details");
});

test("unverified local fields stay visible and can be explicitly proposed unchanged for teacher verification", () => {
  const { state } = fixture("student", true);
  const evidence = { ...effectiveEvidence(state)[0], authority: "local-unverified", unverifiedFields: ["answer", "help"], masteryBlockedReason: "本人更正尚未由教师核实，不计掌握证据" };
  const fields = { answer: evidence.answer, knowledgeId: evidence.knowledgeId, help: evidence.help, invalidated: !evidence.valid };
  assert.throws(() => ui.evidenceProposalPayload(evidence, fields, "请核对现有原稿答案", [], state, "verify-request"), /至少修改/);
  const payload = ui.evidenceProposalPayload(evidence, fields, "请核对现有原稿答案", [], state, "verify-request", ["answer"]);
  assert.deepEqual(payload.patch, { answer: evidence.answer });
  const html = render(ui.EvidenceComparison, { state, evidence });
  assert.match(html, /仍待教师核实的字段：答案文字、帮助情况/);
  assert.match(html, /其他字段的复核不会一并核实/); assert.doesNotMatch(html, /授权教师已复核/);
  const teacher = fixture("teacher");
  const local = { ...teacher.proposal, delivery: "local-only" };
  assert.doesNotMatch(render(ui.EvidenceProposalDetail, { ...props(teacher.state), proposal: local }), /预览更正影响/);
});

test("review reasons and submitted question text are rendered as text, not executable HTML", () => {
  const { state, proposal } = fixture("teacher");
  const evidence = { ...effectiveEvidence(state)[0], questionText: '<script>QUESTION_SCRIPT</script>' };
  const html = render(ui.EvidenceSharingPreview, { evidence, patch: proposal.patch, reason: '<img src=x onerror="REASON_SCRIPT">', uploads: [{ id: "chosen", name: '<svg onload="IMAGE_NAME_SCRIPT">' }] });
  assert.doesNotMatch(html, /<script>|<img|<svg onload/); assert.match(html, /&lt;script&gt;QUESTION_SCRIPT/);
  assert.match(html, /REASON_SCRIPT/); assert.match(html, /IMAGE_NAME_SCRIPT/);
});
