import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, gradeAnswer, recomputeKnowledge, DomainError } from "../lib/server/domain.ts";
import { createSeedWorkspace } from "../lib/seed.ts";
import type { WorkspaceState, Paper } from "../lib/types";

const now = "2026-10-26T08:00:00.000Z";
let sequence = 0;
const context = { userId: "account-a", displayName: "学习者", now, newId: () => `test-${++sequence}` };
function seed() { return createSeedWorkspace(context.userId, context.displayName, now); }
function act(state: WorkspaceState, action: string, input: Record<string, unknown> = {}, date = now) { return applyAction(state, { action, ...input }, { ...context, now: date }); }
function create(state = seed(), count = 3) {
  const result = act(state, "paper.create", { count, knowledgeIds: ["division"], difficulty: "不限", kind: "practice" });
  return { state: result.state, paper: result.state.papers.find(p => p.id === result.result?.id)! };
}
function answers(paper: Paper) { return paper.questions.map(q => ({ questionId: q.id, value: q.answer, working: "列式后验算" })); }
function throwsStatus(fn: () => unknown, status: number) { assert.throws(fn, (error: unknown) => error instanceof DomainError && error.status === status); }

test("seed is original, reviewed, multi-knowledge, and demo history cannot inflate stars", () => {
  const state = seed();
  assert.equal(state.questions.length, 31);
  assert.equal(state.questions.filter(q => q.status === "review").length, 1);
  for (const knowledgeId of ["division", "geometry", "multiplication"]) assert.equal(state.questions.filter(q => q.knowledgeId === knowledgeId && q.status === "published").length, 10);
  assert.ok(state.questions.every(q => q.authorId !== q.reviewerId));
  assert.equal(state.attempts.find(a => a.id === "demo-original-attempt")?.correctCount, 7);
  assert.equal(state.attempts.find(a => a.id === "demo-practice-attempt")?.independentCount, 4);
  assert.ok(state.knowledge.every(k => k.stars === null));
  assert.ok(state.evidence.every(e => e.eligible === false));
});

test("knowledge.begin unlocks a catalog knowledge point once, and only unlocked points may enter a paper", () => {
  const start = seed();
  // 未解锁的目录知识点不能进组卷范围。
  throwsStatus(() => act(start, "paper.create", { count: 3, knowledgeIds: ["math-1-place"], difficulty: "不限", kind: "practice" }), 400);
  const unlocked = act(start, "knowledge.begin", { knowledgeId: "math-1-place", name: "亿以内数的读写", description: "理解万级、个级数位与计数单位" });
  const point = unlocked.state.knowledge.find(k => k.id === "math-1-place");
  assert.equal(point?.learningState, "current");
  assert.equal(point?.stars, null);
  assert.equal(point?.evidenceIds.length, 0);
  assert.ok(point?.reason.includes("已加入学习范围"), point?.reason);
  // 重复解锁是幂等的，不会产生第二条记录。
  const again = act(unlocked.state, "knowledge.begin", { knowledgeId: "math-1-place", name: "亿以内数的读写", description: "" });
  assert.equal(again.state.knowledge.filter(k => k.id === "math-1-place").length, 1);
  // 教材范围之外的知识点不能被解锁。
  throwsStatus(() => act(start, "knowledge.begin", { knowledgeId: "not-a-catalog-point", name: "x", description: "" }), 400);
  // 解锁后不再被「未学知识点」拦住（测试环境没有静态内容库，因此改为题库不足）。
  assert.throws(() => act(unlocked.state, "paper.create", { count: 3, knowledgeIds: ["math-1-place"], difficulty: "不限", kind: "practice" }),
    (error: unknown) => error instanceof DomainError && error.message.includes("题库不足"));
});

test("answer normalization accepts expected units and rejects mismatched units or garbage", () => {
  const q = { answer: "40", unit: "厘米" };
  for (const answer of ["40", "４０", "40.0", "答：40 厘米。", "40cm"]) assert.equal(gradeAnswer(answer, q), true, answer);
  for (const answer of ["40米", "40abc", "40.1", "40平方厘米", "", "40+0"]) assert.equal(gradeAnswer(answer, q), false, answer);
  assert.equal(gradeAnswer("90m²", { answer: "90", unit: "平方米" }), true);
  assert.equal(gradeAnswer("90米", { answer: "90", unit: "平方米" }), false);
});

test("help is server-monotonic and client cannot forge scores, help or actor roles", () => {
  const start = create(seed(), 3);
  let state = act(start.state, "attempt.help", { paperId: start.paper.id, questionId: start.paper.questionIds[0], level: "explanation" }).state;
  state = act(state, "attempt.help", { paperId: start.paper.id, questionId: start.paper.questionIds[0], level: "hint" }).state;
  state = act(state, "attempt.submit", { paperId: start.paper.id, answers: answers(start.paper).map(a => ({ ...a, help: "independent", correct: false })), correctCount: 999, stars: 5, actor: { role: "admin" }, submissionKey: "one-submit" }).state;
  const attempt = state.attempts.find(a => a.paperId === start.paper.id)!;
  assert.equal(attempt.correctCount, 3);
  assert.equal(attempt.independentCount, 2);
  assert.equal(attempt.answers[0].help, "explanation");
  assert.equal(state.actor.role, "owner");
  assert.equal(state.evidence.filter(e => e.paperId === start.paper.id && e.eligible).length, 2);
});

test("submission is immutable and repeat submissions cannot create duplicate evidence", () => {
  const { state, paper } = create();
  const submitted = act(state, "attempt.submit", { paperId: paper.id, answers: answers(paper), submissionKey: "immutable" });
  const repeated = act(submitted.state, "attempt.submit", { paperId: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: "0" })), submissionKey: "different-key" });
  assert.strictEqual(repeated.state, submitted.state);
  assert.equal(repeated.state.attempts.find(a => a.paperId === paper.id)?.correctCount, 3);
  assert.equal(repeated.state.evidence.filter(e => e.paperId === paper.id).length, 3);
  throwsStatus(() => act(submitted.state, "attempt.save", { paperId: paper.id, answers: [] }), 409);
});

test("question changes and replacements cannot overwrite existing paper snapshots", () => {
  const first = create(seed(), 1);
  const updated = act(first.state, "question.update", { id: first.paper.questionIds[0], question: { text: "修改后的题干" } });
  assert.equal(updated.state.questions.find(q => q.id === first.paper.questionIds[0])?.status, "draft");
  assert.equal(updated.state.papers.find(p => p.id === first.paper.id)?.questions[0].text, first.paper.questions[0].text);
  const replaced = act(first.state, "paper.replace", { paperId: first.paper.id, questionId: first.paper.questionIds[0] });
  assert.equal(replaced.state.papers.find(p => p.id === first.paper.id)?.questions[0].id, first.paper.questions[0].id);
  const newPaper = replaced.state.papers.find(p => p.id === replaced.result?.id)!;
  assert.equal(newPaper.parentId, first.paper.id);
  assert.equal(newPaper.version, 2);
  assert.notEqual(newPaper.questions[0].id, first.paper.questions[0].id);
});

test("authors cannot self-review and publication requires independent approval", () => {
  const initial = seed();
  const created = act(initial, "question.create", { question: initial.questions[0] });
  const questionId = created.result!.id;
  const pending = act(created.state, "question.submit", { id: questionId });
  throwsStatus(() => act(pending.state, "question.review", { id: questionId, decision: "approve" }), 403);
  throwsStatus(() => act(pending.state, "question.publish", { id: questionId }), 403);
  const foreign = seed(); foreign.questions[0].status = "review"; foreign.questions[0].reviewerId = undefined;
  const approved = act(foreign, "question.review", { id: foreign.questions[0].id, decision: "approve", note: "已核对题意与两种解法" });
  assert.equal(approved.state.questions[0].status, "approved");
  const published = act(approved.state, "question.publish", { id: foreign.questions[0].id });
  assert.equal(published.state.questions[0].status, "published");
});

test("correction changes neither original evidence nor stars", () => {
  const first = create();
  const wrong = act(first.state, "attempt.submit", { paperId: first.paper.id, answers: first.paper.questions.map(q => ({ questionId: q.id, value: "0" })) });
  const mistake = wrong.state.mistakes.find(m => m.question.id === first.paper.questionIds[0])!;
  const after = act(wrong.state, "mistake.correct", { id: mistake.id, answer: mistake.question.answer });
  assert.deepEqual(after.state.evidence, wrong.state.evidence);
  assert.deepEqual(after.state.knowledge, wrong.state.knowledge);
  assert.equal(after.state.attempts.find(a => a.paperId === first.paper.id)?.correctCount, 0);
  assert.ok(after.state.mistakes.find(m => m.id === mistake.id)?.correctedAt);
});

test("new paper excludes recent items, shortage is explicit, and papers cannot mix stages or subjects", () => {
  const first = create(seed(), 6);
  throwsStatus(() => create(first.state, 5), 409);
  const future = seed(); future.knowledge[0].learningState = "upcoming";
  throwsStatus(() => create(future), 400);
  // 小学与初中的知识点不能混在一张卷子里 —— 考查深度不同。
  const mixed = seed();
  act(mixed, "knowledge.begin", { knowledgeId: "math-1-place", name: "亿以内数的读写", description: "理解万级、个级数位与计数单位" });
  act(mixed, "knowledge.begin", { knowledgeId: "math-j-2-function", name: "函数", description: "理解函数概念与表示" });
  throwsStatus(() => act(mixed, "paper.create", { count: 3, knowledgeIds: ["math-1-place", "math-j-2-function"], difficulty: "不限", kind: "practice" }), 400);
  // 初中知识点要先在课程地图里解锁。
  const locked = seed();
  act(locked, "knowledge.begin", { knowledgeId: "math-1-place", name: "亿以内数的读写", description: "理解万级、个级数位与计数单位" });
  throwsStatus(() => act(locked, "paper.create", { count: 3, knowledgeIds: ["math-j-2-function"], difficulty: "不限", kind: "practice" }), 400);
});

test("review requires a real source plan followed by at least three days", () => {
  throwsStatus(() => act(seed(), "paper.create", { count: 1, knowledgeIds: ["division"], kind: "review" }), 404);
  const first = create(seed(), 3);
  const submitted = act(first.state, "attempt.submit", { paperId: first.paper.id, answers: answers(first.paper) });
  const planId = submitted.state.mastery!.reviewPlans.find(p => p.sourcePaperId === first.paper.id)!.id;
  throwsStatus(() => act(submitted.state, "paper.create", { count: 1, planId, kind: "review" }, "2026-10-29T07:59:59.000Z"), 409);
  const due = act(submitted.state, "paper.create", { count: 1, planId, kind: "review" }, "2026-10-29T08:00:00.000Z");
  assert.equal(due.state.papers[0].kind, "review");
});

test("photo homework keeps manual provenance and cannot gain independent stars", () => {
  const state = seed();
  state.uploads.push({ id: "file-a", name: "原作业.png", url: "/api/files/file-a", createdAt: now, status: "pending", purpose: "homework" });
  const result = act(state, "homework.confirm", { uploadId: "file-a", entries: [{ questionId: state.questions[0].id, answer: state.questions[0].answer, help: "independent" }] });
  const attempt = result.state.attempts.find(a => a.paperId === result.result?.id)!;
  assert.equal(attempt.correctCount, 1); assert.equal(attempt.independentCount, 0); assert.equal(attempt.answers[0].help, "unknown");
  assert.equal(result.state.evidence.find(e => e.attemptId === attempt.id)?.eligible, false);
  throwsStatus(() => act(result.state, "homework.confirm", { uploadId: "file-a", entries: [] }), 409);
});

test("chat retrieval records help before an active exercise can be submitted", () => {
  const first = create();
  const opened = act(first.state, "chat.open", { context: { source: "paper", paperId: first.paper.id, questionId: first.paper.questionIds[0], questionVersion: first.paper.questions[0].version } });
  const chatted = act(opened.state, "chat.send", { text: "请给我完整答案和讲解", threadId: opened.result!.id, intent: "explanation", requestId: "test-explicit-explanation" });
  assert.match(chatted.state.messages.at(-1)!.text, /非大模型生成/);
  const submitted = act(chatted.state, "attempt.submit", { paperId: first.paper.id, answers: answers(first.paper) });
  assert.equal(submitted.state.attempts.find(a => a.paperId === first.paper.id)?.independentCount, 2);
});

test("invalid or foreign references fail without changing source state", () => {
  const state = seed(); const before = JSON.stringify(state);
  throwsStatus(() => act(state, "attempt.submit", { paperId: "other-account-paper", answers: [] }), 404);
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => act(state, "question.create", { question: { text: "missing answer and steps" } }));
});

test("printing an answer key exposes all unsubmitted items but cannot rewrite submitted history", () => {
  const first = create();
  const exposed = act(first.state, "paper.expose", { paperId: first.paper.id });
  const submitted = act(exposed.state, "attempt.submit", { paperId: first.paper.id, answers: answers(first.paper) });
  assert.equal(submitted.state.attempts.find(a => a.paperId === first.paper.id)?.independentCount, 0);
  assert.ok(submitted.state.evidence.filter(e => e.paperId === first.paper.id).every(e => !e.eligible));
  const afterPrint = act(submitted.state, "paper.expose", { paperId: first.paper.id });
  assert.deepEqual(afterPrint.state.attempts, submitted.state.attempts);
  assert.deepEqual(afterPrint.state.evidence, submitted.state.evidence);
});

test("single-question solutions exclude that family from future papers and replacements", () => {
  const initial = seed();
  const exposed = act(initial, "single.explain", { id: initial.questions[0].id });
  const first = create(exposed.state, 1);
  assert.notEqual(first.paper.questions[0].familyId, initial.questions[0].familyId);
  const replaced = act(first.state, "paper.replace", { paperId: first.paper.id, questionId: first.paper.questionIds[0] });
  assert.notEqual(replaced.state.papers[0].questions[0].familyId, initial.questions[0].familyId);
});

test("recent family variants with different IDs cannot sneak into new papers", () => {
  const first = create(seed(), 1);
  first.state.questions.unshift({ ...first.paper.questions[0], id: "variant-new-id", version: 2 });
  const next = create(first.state, 1);
  assert.notEqual(next.paper.questions[0].familyId, first.paper.questions[0].familyId);
});

test("printed solution families remain excluded after the recent-question window", () => {
  const first = create(seed(), 1);
  const exposed = act(first.state, "paper.expose", { paperId: first.paper.id });
  const later = act(exposed.state, "paper.create", { count: 1, knowledgeIds: ["division"] }, "2026-11-26T08:00:00.000Z");
  assert.notEqual(later.state.papers[0].questions[0].familyId, first.paper.questions[0].familyId);
});

test("answer exposure propagates to every unfinished copy of the same family", () => {
  const first = create(seed(), 2);
  const replacement = act(first.state, "paper.replace", { paperId: first.paper.id, questionId: first.paper.questionIds[0] });
  const second = replacement.state.papers[0];
  const shared = first.paper.questions[1];
  const exposed = act(replacement.state, "attempt.help", { paperId: first.paper.id, questionId: shared.id, level: "explanation" });
  const secondAttempt = exposed.state.attempts.find(a => a.paperId === second.id)!;
  assert.equal(secondAttempt.answers.find(a => a.questionId === shared.id)?.help, "explanation");
});

test("independently authored seed review example can complete the real approval sequence", () => {
  const initial = seed();
  const pending = initial.questions.find(q => q.status === "review")!;
  const approved = act(initial, "question.review", { id: pending.id, decision: "approve", note: "核对 14×26=364，无歧义" });
  assert.equal(approved.state.questions.find(q => q.id === pending.id)?.status, "approved");
  const published = act(approved.state, "question.publish", { id: pending.id });
  assert.equal(published.state.questions.find(q => q.id === pending.id)?.status, "published");
});

test("every arithmetic seed directly practices the stated operand range with a checked result", () => {
  for (const question of seed().questions.filter(q => q.taskType !== "transfer")) {
    if (question.knowledgeId === "division") {
      const expression = question.steps[0].match(/^(\d+)\s*÷\s*(\d+)\s*=\s*(\d+)/);
      assert.ok(expression, question.id);
      const [, dividend, divisor, quotient] = expression.map(Number);
      assert.ok(divisor >= 10 && divisor <= 99, `${question.id}: divisor must have two digits`);
      assert.equal(dividend / divisor, quotient, question.id);
      assert.equal(Number(question.answer), quotient, question.id);
    } else if (question.knowledgeId === "multiplication") {
      const expression = question.steps[0].match(/^(\d+)\s*×\s*(\d+)\s*=\s*(\d+)/);
      assert.ok(expression, question.id);
      const [, multiplicand, multiplier, product] = expression.map(Number);
      assert.ok(multiplicand >= 100 && multiplicand <= 999, `${question.id}: multiplicand must have three digits`);
      assert.ok(multiplier >= 10 && multiplier <= 99, `${question.id}: multiplier must have two digits`);
      assert.equal(multiplicand * multiplier, product, question.id);
      assert.equal(Number(question.answer), product, question.id);
    }
  }
});

test("geometry seed stays within rectangle/square perimeter and area with dimensionally correct units", () => {
  const questions = seed().questions.filter(q => q.knowledgeId === "geometry" && q.taskType !== "transfer");
  const expected = [
    [(12 + 8) * 2, "厘米"], [15 * 6, "平方米"], [9 * 4, "厘米"], [7 * 7, "平方分米"],
    [50 / 2 - 16, "厘米"], [(64 / 4) ** 2, "平方厘米"], [(18 + 5) * 12 - 18 * 12, "平方厘米"], [96 / 12, "厘米"],
  ];
  questions.forEach((q, i) => {
    assert.match(q.text, /长方形|正方形/, q.id);
    assert.match(q.text, /周长|面积/, q.id);
    assert.doesNotMatch(q.text, /角|°/, q.id);
    assert.equal(Number(q.answer), expected[i][0], q.id);
    assert.equal(q.unit, expected[i][1], q.id);
  });
});

test("repeating the same family in new papers across many days cannot farm stars", () => {
  let state = seed();
  let questionId = "";
  for (let iteration = 0; iteration < 12; iteration++) {
    const date = new Date(Date.parse(now) + iteration * 16 * 86400000).toISOString();
    const created = act(state, "paper.create", { count: 1, knowledgeIds: ["division"] }, date);
    const paper = created.state.papers[0];
    if (!questionId) questionId = paper.questions[0].id;
    assert.equal(paper.questions[0].id, questionId);
    state = act(created.state, "attempt.submit", { paperId: paper.id, answers: answers(paper) }, date).state;
  }
  const knowledge = state.knowledge.find(k => k.id === "division")!;
  assert.equal(knowledge.evidenceIds.length, 1);
  assert.equal(knowledge.stars, null);
  assert.match(knowledge.reason, /证据尚不足/);
  assert.ok(state.mastery!.assessments.at(-1)!.excludedEvidence.some(e => e.reason.includes("相同题族")));
});

test("even strong independent evidence stays under the explicitly labelled pilot three-star cap", () => {
  const state = seed();
  const template = state.evidence.find(e => e.knowledgeId === "division")!;
  state.evidence = Array.from({ length: 20 }, (_, i) => ({ ...template, id: `verified-${i}`, familyId: `verified-family-${i}`, questionId: `verified-question-${i}`, help: "independent", eligible: true, correct: true, kind: i < 10 ? "practice" : "review", createdAt: new Date(Date.parse(now) + i * 86400000).toISOString() }));
  recomputeKnowledge(state);
  const knowledge = state.knowledge.find(k => k.id === "division")!;
  assert.equal(knowledge.stars, 3);
  assert.equal(knowledge.evidenceIds.length, 20);
  assert.equal(knowledge.ruleVersion, "pilot-v2-max3");
  assert.match(knowledge.reason, /4—5 星暂不评定/);
});

test("legacy duplicate eligible records cannot inflate family coverage and unrelated knowledge remains unchanged", () => {
  const state = seed();
  const template = state.evidence.find(e => e.knowledgeId === "division")!;
  state.evidence = Array.from({ length: 20 }, (_, i) => ({ ...template, id: `legacy-copy-${i}`, familyId: "same-family", eligible: true, help: "independent", correct: true }));
  const untouched = structuredClone(state.knowledge.find(k => k.id === "geometry"));
  recomputeKnowledge(state, new Set(["division"]));
  assert.equal(state.knowledge.find(k => k.id === "division")?.evidenceIds.length, 1);
  assert.equal(state.knowledge.find(k => k.id === "division")?.stars, 2);
  assert.deepEqual(state.knowledge.find(k => k.id === "geometry"), untouched);
});
