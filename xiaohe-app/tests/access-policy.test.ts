import assert from "node:assert/strict";
import test from "node:test";
import { assertActionAllowed, projectWorkspace } from "../lib/server/access-policy.ts";
import { applyAction, DomainError } from "../lib/server/domain.ts";
import { createSeedWorkspace } from "../lib/seed.ts";
import type { AuditEvent, Paper, Question, Role, WorkspaceState } from "../lib/types";

const now = "2026-10-26T08:00:00.000Z";
const knownActions = [
  "profile.update", "paper.create", "paper.replace", "paper.resume", "paper.expose",
  "attempt.save", "attempt.help", "attempt.submit", "mistake.correct", "help.create", "chat.send",
  "single.match", "single.explain", "homework.confirm", "question.create", "question.update", "question.submit",
  "question.review", "question.publish", "question.disable", "help.receive", "help.reply",
];
function deny(fn: () => unknown) { assert.throws(fn, (error: unknown) => error instanceof DomainError && error.status === 403); }
function seed() { return createSeedWorkspace("learner-account", "孩子的真实姓名", now); }
function paper(id: string, question: Question, status: Paper["status"] = "ready"): Paper {
  return { id, title: id, version: 1, questionIds: [question.id], questions: [structuredClone(question)], createdAt: now, status, kind: "practice", reason: "当前课程", estimatedMinutes: 2 };
}
function fixture(): WorkspaceState {
  const state = seed();
  state.actor = { id: "learner-account", name: "已认证学生", role: "student" };
  state.questions = state.questions.slice(0, 4).map((q, index) => ({ ...q, id: `policy-q-${index}`, familyId: `policy-family-${index}`, text: `需要独立思考的第${index}题`, answer: `SECRET_ANSWER_${index}`, hint: `ONLY_HINT_${index}`, steps: [`SECRET_STEP_${index}`], alternative: `SECRET_ALTERNATIVE_${index}`, sourceScope: `PRIVATE_LICENSE_${index}`, authorId: `PRIVATE_AUTHOR_${index}`, reviewerId: `PRIVATE_REVIEWER_${index}`, reviewNote: `SECRET_REVIEW_NOTE_${index}` }));
  state.papers = [paper("draft-paper", state.questions[0], "in_progress"), paper("submitted-paper", state.questions[1], "completed")];
  state.attempts = [
    { id: "draft-attempt", paperId: "draft-paper", status: "draft", startedAt: now, independentCount: 99, correctCount: 99, answers: [{ questionId: state.questions[0].id, value: "我的草稿", working: "未提交过程", help: "independent", correct: true }] },
    { id: "submitted-attempt", paperId: "submitted-paper", status: "submitted", startedAt: now, submittedAt: now, independentCount: 1, correctCount: 0, answers: [{ questionId: state.questions[1].id, value: "我的原始回答", working: "已提交过程", help: "independent", correct: false }] },
  ];
  state.evidence = [{ id: "submitted-evidence", knowledgeId: "division", questionId: state.questions[1].id, questionVersion: 1, attemptId: "submitted-attempt", paperId: "submitted-paper", questionText: state.questions[1].text, answer: "我的原始回答", expected: state.questions[1].answer, help: "independent", correct: false, createdAt: now, kind: "practice" }];
  state.mistakes = [{ id: "my-mistake", question: structuredClone(state.questions[1]), originalAnswer: "我的原始回答", evidenceId: "submitted-evidence" }];
  state.knowledge[0] = { ...state.knowledge[0], stars: 2, evidenceIds: ["submitted-evidence"], reason: "来自已提交练习的学习表现" };
  state.messages = [{ id: "private-message", role: "user", text: "PRIVATE_CHAT_TEXT", createdAt: now }];
  state.uploads = [{ id: "private-photo", name: "PRIVATE_PHOTO_NAME", url: "/api/files/private-photo", status: "pending", purpose: "homework", createdAt: now }];
  state.helpRequests = [{ id: "teacher-help", topic: "明确分享的求助", summary: "学生主动发送给教师的摘要", status: "waiting", createdAt: now }];
  state.events = [
    { id: "internal-event", action: "question.review", label: "审核", detail: "PRIVATE_ADMIN_NOTE", actorId: "other-reviewer", createdAt: now },
    { id: "learning-event", action: "attempt.submit", label: "提交练习", detail: "答题完成", actorId: "learner-account", createdAt: now },
  ];
  return state;
}
function exposure(familyIds: string[], level: string, detail?: string): AuditEvent {
  return { id: `exposure-${level}`, action: "learning.exposure", label: "帮助曝光", actorId: "learner-account", createdAt: now, detail: detail ?? JSON.stringify({ familyIds, level }) };
}

for (const role of ["owner", "student", "parent", "teacher", "editor", "reviewer"] as Role[]) {
  test(`${role} action permissions match the explicit role matrix`, () => {
    const allowed = role === "owner" ? knownActions : role === "student" ? knownActions.filter(action => !action.startsWith("question.") && action !== "help.receive" && action !== "help.reply") : role === "editor" ? ["question.create", "question.update", "question.submit"] : role === "reviewer" ? ["question.review", "question.publish", "question.disable"] : role === "teacher" ? ["help.receive", "help.reply"] : [];
    for (const action of knownActions) {
      if (allowed.includes(action)) assert.doesNotThrow(() => assertActionAllowed(role, action), action);
      else deny(() => assertActionAllowed(role, action));
    }
  });
}

test("unknown roles fail closed and unknown owner actions still fail at the domain dispatcher", () => {
  for (const role of ["admin", "", undefined, null]) {
    deny(() => assertActionAllowed(role as Role, "profile.update"));
    deny(() => projectWorkspace(fixture(), role as Role));
  }
  assert.throws(() => applyAction(seed(), { action: "unsupported.action" }, { userId: "learner-account", displayName: "owner" }), (error: unknown) => error instanceof DomainError && error.status === 400);
});

test("domain trusts only server context or the current actor role, never payload role claims", () => {
  const state = seed(); state.actor.role = "student";
  const before = JSON.stringify(state);
  deny(() => applyAction(state, { action: "question.create", role: "owner", actor: { role: "owner" }, question: state.questions[0] }, { userId: "learner-account", displayName: "学生" }));
  assert.equal(JSON.stringify(state), before);
  const saved = applyAction(state, { action: "profile.update", role: "owner", profile: { name: "修改后的昵称" } }, { userId: "learner-account", displayName: "学生" });
  assert.equal(saved.state.actor.role, "student");
  const owner = seed();
  deny(() => applyAction(owner, { action: "profile.update", profile: { name: "越权" } }, { userId: "reviewer-account", displayName: "审核人", role: "reviewer" }));
  const reviewed = applyAction(owner, { action: "question.review", id: owner.questions.find(q => q.status === "review")!.id, decision: "approve" }, { userId: "reviewer-account", displayName: "审核人", role: "reviewer" });
  assert.equal(reviewed.state.actor.role, "reviewer");
  assert.equal(reviewed.state.actor.id, "reviewer-account");
});

test("owner receives a complete independent copy and every projection leaves source unchanged", () => {
  const source = fixture(); const before = structuredClone(source);
  const owner = projectWorkspace(source, "owner");
  assert.deepEqual(owner, source); assert.notStrictEqual(owner, source);
  for (const role of ["student", "parent", "teacher", "editor", "reviewer"] as Role[]) projectWorkspace(source, role);
  assert.deepEqual(source, before);
  owner.messages[0].text = "changed"; owner.questions[0].steps.push("changed");
  assert.deepEqual(source, before);
});

for (const role of ["editor", "reviewer"] as const) {
  test(`${role} receives teaching content but no learner identity, evidence, private chat, or media`, () => {
    const source = fixture(); const result = projectWorkspace(source, role);
    assert.equal(result.questions.length, source.questions.length);
    assert.equal(result.questions[0].answer, source.questions[0].answer);
    assert.notEqual(result.profile.name, source.profile.name);
    assert.equal(result.profile.school, "");
    assert.equal(result.profile.course, source.profile.course);
    for (const field of ["papers", "attempts", "evidence", "mistakes", "uploads", "helpRequests", "messages"] as const) assert.deepEqual(result[field], [], field);
    assert.ok(result.knowledge.every(k => k.stars === null && !k.evidenceIds.length && !k.reason));
    assert.ok(result.events.every(event => event.action.startsWith("question.")));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CHAT_TEXT|PRIVATE_PHOTO_NAME|我的草稿|我的原始回答/);
  });
}

test("student bank includes only independently reviewed published content without hidden answers or review metadata", () => {
  const source = fixture();
  source.questions[2].status = "review";
  source.questions[3].reviewerId = source.questions[3].authorId;
  source.questions.push({ ...source.questions[0], id: "unreviewed-published", familyId: "bad-family", reviewerId: undefined });
  const result = projectWorkspace(source, "student");
  assert.deepEqual(result.questions.map(q => q.id), ["policy-q-0", "policy-q-1"]);
  for (const q of result.questions) {
    assert.equal(q.answer, ""); assert.equal(q.hint, ""); assert.deepEqual(q.steps, []); assert.equal(q.alternative, "");
    assert.equal(q.sourceScope, ""); assert.equal(q.authorId, ""); assert.equal(q.reviewerId, undefined); assert.equal(q.reviewNote, undefined);
  }
  assert.doesNotMatch(JSON.stringify(result.questions), /SECRET_|PRIVATE_/);
  assert.equal(result.questions[0].source, source.questions[0].source);
  assert.deepEqual(result.questions[0].prerequisites, source.questions[0].prerequisites);
  assert.ok(result.events.every(event => !event.action.startsWith("question.")));
  assert.equal(result.messages[0].text, "PRIVATE_CHAT_TEXT");
});

test("explicit family hint exposure unlocks hints across versions but never answer, steps, or alternative", () => {
  const source = fixture();
  const variant = { ...source.questions[0], id: "family-variant", version: 2, hint: "VARIANT_HINT", answer: "VARIANT_SECRET_ANSWER" };
  source.questions.push(variant);
  source.events.push(exposure([source.questions[0].familyId], "hint"));
  const result = projectWorkspace(source, "student");
  for (const q of result.questions.filter(q => q.familyId === source.questions[0].familyId)) {
    assert.ok(q.hint); assert.equal(q.answer, ""); assert.deepEqual(q.steps, []); assert.equal(q.alternative, "");
  }
  assert.equal(result.questions.find(q => q.id === source.questions[1].id)!.hint, "");
  assert.equal(result.papers.find(p => p.id === "draft-paper")!.questions[0].hint, "ONLY_HINT_0");
  assert.equal(result.papers.find(p => p.id === "draft-paper")!.questions[0].answer, "");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_ANSWER_0|SECRET_STEP_0|SECRET_ALTERNATIVE_0|VARIANT_SECRET_ANSWER/);
});

test("explanation exposure is monotonic within its family and leaves unrelated families hidden", () => {
  const source = fixture();
  source.events.push(exposure([source.questions[0].familyId], "explanation"), exposure([source.questions[0].familyId], "hint"));
  const result = projectWorkspace(source, "student");
  const unlocked = result.questions.find(q => q.id === source.questions[0].id)!;
  assert.equal(unlocked.answer, "SECRET_ANSWER_0"); assert.deepEqual(unlocked.steps, ["SECRET_STEP_0"]); assert.equal(unlocked.alternative, "SECRET_ALTERNATIVE_0");
  assert.equal(result.questions.find(q => q.id === source.questions[2].id)!.answer, "");
  assert.equal(result.papers.find(p => p.id === "draft-paper")!.questions[0].answer, unlocked.answer);
});

test("unstructured, invalid-level and malformed exposure logs never unlock answers", () => {
  const source = fixture();
  for (const detail of ["看过答案", "{broken", "null", JSON.stringify({ familyIds: [source.questions[0].familyId], level: "owner" }), JSON.stringify({ familyIds: source.questions[0].familyId, level: "explanation" }), JSON.stringify({ familyIds: [null, 12], level: "explanation" }), JSON.stringify({ familyIds: [source.questions[0].familyId] })]) source.events.push(exposure([], "", detail));
  const result = projectWorkspace(source, "student");
  assert.ok(result.questions.every(q => !q.answer && !q.hint && !q.steps.length && !q.alternative));
});

test("paper snapshots use per-question help and submissions without disclosing draft grading", () => {
  const source = fixture();
  const draft = source.attempts[0];
  for (const help of ["independent", "unknown", "hint", "explanation"] as const) {
    draft.answers[0].help = help;
    const result = projectWorkspace(source, "student");
    const q = result.papers.find(p => p.id === "draft-paper")!.questions[0];
    assert.equal(q.answer, help === "explanation" ? "SECRET_ANSWER_0" : "");
    assert.equal(q.hint, help === "explanation" || help === "hint" ? "ONLY_HINT_0" : "");
    assert.equal(q.steps.length, help === "explanation" ? 1 : 0);
    const attempt = result.attempts.find(a => a.id === "draft-attempt")!;
    assert.equal(attempt.answers[0].correct, null); assert.equal(attempt.correctCount, 0); assert.equal(attempt.independentCount, 0);
    assert.equal(attempt.answers[0].value, "我的草稿");
    assert.equal(result.papers.find(p => p.id === "submitted-paper")!.questions[0].answer, "SECRET_ANSWER_1");
    assert.equal(result.questions.find(q => q.id === "policy-q-0")!.answer, "", "bank remains gated by explicit family exposure");
  }
});

for (const role of ["parent", "teacher"] as const) {
  test(`${role} receives submitted reports only, never drafts, bank, private chat or originals`, () => {
    const result = projectWorkspace(fixture(), role);
    assert.deepEqual(result.questions, []);
    assert.deepEqual(result.papers.map(p => p.id), ["submitted-paper"]);
    assert.deepEqual(result.attempts.map(a => a.id), ["submitted-attempt"]);
    assert.equal(result.papers[0].questions[0].answer, "SECRET_ANSWER_1");
    assert.equal(result.papers[0].questions[0].reviewNote, undefined);
    assert.equal(result.evidence.length, 1); assert.equal(result.mistakes.length, 1);
    assert.equal(result.knowledge[0].stars, 2);
    assert.deepEqual(result.messages, []); assert.deepEqual(result.uploads, []); assert.deepEqual(result.events, []);
    assert.equal(result.helpRequests.length, role === "teacher" ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CHAT_TEXT|PRIVATE_PHOTO_NAME|我的草稿|未提交过程|SECRET_ANSWER_0|PRIVATE_ADMIN_NOTE/);
  });
}

test("draft, orphan and mismatched evidence cannot expose answer keys through report shortcuts", () => {
  const source = fixture();
  for (const [id, attemptId, paperId] of [["draft-leak", "draft-attempt", "draft-paper"], ["orphan-leak", "missing-attempt", "submitted-paper"], ["mismatch-leak", "submitted-attempt", "draft-paper"]]) {
    source.evidence.push({ ...source.evidence[0], id, attemptId, paperId, expected: "SECRET_LEAK" });
    source.mistakes.push({ ...source.mistakes[0], id: `mistake-${id}`, evidenceId: id, question: source.questions[0] });
    source.knowledge[0].evidenceIds.push(id);
  }
  for (const role of ["student", "parent", "teacher"] as const) {
    const result = projectWorkspace(source, role);
    assert.deepEqual(result.evidence.map(e => e.id), ["submitted-evidence"]);
    assert.deepEqual(result.knowledge[0].evidenceIds, ["submitted-evidence"]);
    assert.equal(result.mistakes.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_LEAK/);
  }
});

test("a real editor-to-reviewer handoff preserves independent authorship checks", () => {
  const initial = seed();
  let sequence = 0;
  const created = applyAction(initial, { action: "question.create", question: initial.questions[0] }, { userId: "editor-account", displayName: "标注人", role: "editor", now, newId: () => `handoff-${++sequence}` });
  const submitted = applyAction(created.state, { action: "question.submit", id: created.result!.id }, { userId: "editor-account", displayName: "标注人", role: "editor", now });
  deny(() => applyAction(submitted.state, { action: "question.review", id: created.result!.id, decision: "approve" }, { userId: "editor-account", displayName: "同一个账号", role: "reviewer", now }));
  const reviewed = applyAction(submitted.state, { action: "question.review", id: created.result!.id, decision: "approve", note: "独立核对来源与解法" }, { userId: "different-reviewer", displayName: "独立审核人", role: "reviewer", now });
  const published = applyAction(reviewed.state, { action: "question.publish", id: created.result!.id }, { userId: "different-reviewer", displayName: "独立审核人", role: "reviewer", now });
  const question = published.state.questions.find(q => q.id === created.result!.id)!;
  assert.equal(question.status, "published");
  assert.equal(question.authorId, "editor-account"); assert.equal(question.reviewerId, "different-reviewer");
});

test("teacher can receive and reply to the shared summary without gaining private chat access", () => {
  const initial = fixture();
  const received = applyAction(initial, { action: "help.receive", id: "teacher-help" }, { userId: "teacher-account", displayName: "教师", role: "teacher", now });
  assert.equal(received.state.helpRequests[0].status, "received");
  const replied = applyAction(received.state, { action: "help.reply", id: "teacher-help", reply: "先圈出题目中的总数，再判断要平均分成几份。" }, { userId: "teacher-account", displayName: "教师", role: "teacher", now });
  const teacherView = projectWorkspace(replied.state, "teacher");
  assert.equal(teacherView.helpRequests[0].status, "replied");
  assert.deepEqual(teacherView.messages, []);
  const studentView = projectWorkspace(replied.state, "student");
  assert.match(studentView.helpRequests[0].reply!, /先圈出/);
  deny(() => applyAction(replied.state, { action: "help.reply", id: "teacher-help", reply: "越权回复" }, { userId: "parent-account", displayName: "家长", role: "parent", now }));
});
