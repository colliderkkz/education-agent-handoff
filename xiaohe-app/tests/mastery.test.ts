import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "../lib/server/domain.ts";
import { ensureMastery, reviewAvailableAt, validateRule } from "../lib/server/mastery.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";
import { createSeedWorkspace } from "../lib/seed.ts";
import type { MasteryRule, Paper, Role, TaskType, WorkspaceState } from "../lib/types.ts";

const initialTime = "2026-10-26T08:00:00.000Z";
const day = (n: number) => new Date(Date.parse(initialTime) + n * 86400000).toISOString();
let serial = 0;
const newId = () => `mastery-${++serial}`;
const ctx = (now = initialTime, role: Role = "owner", userId = "learner") => ({ now, role, userId, displayName: userId, newId });
const act = (state: WorkspaceState, action: string, input: Record<string, unknown> = {}, now = initialTime, role: Role = "owner", userId = "learner") => applyAction(state, { ...input, action }, ctx(now, role, userId));
function fixture(): WorkspaceState {
  const state = createSeedWorkspace("learner", "真实学习者", initialTime);
  state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = []; state.events = []; state.messages = [];
  const original = state.questions[0];
  state.questions = (["basic", "application", "transfer"] as TaskType[]).flatMap(taskType => Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(original), id: `${taskType}-${i}`, familyId: `${taskType}-family-${i}`, taskType, contextId: `${taskType}-context-${i % 3}`, difficulty: (taskType === "basic" ? "基础" : taskType === "application" ? "巩固" : "挑战") as typeof original.difficulty })));
  ensureMastery(state, { now: initialTime, newId, fresh: true }); return state;
}
function create(state: WorkspaceState, count = 1, type: TaskType = "basic", now = initialTime) {
  const result = act(state, "paper.create", { count, knowledgeIds: ["division"], difficulty: type === "basic" ? "基础" : type === "application" ? "巩固" : "挑战" }, now);
  return { state: result.state, paper: result.state.papers.find(p => p.id === result.result!.id)! };
}
function submit(state: WorkspaceState, paper: Paper, correct = true, now = initialTime, extra = {}) {
  return act(state, "attempt.submit", { paperId: paper.id, submissionKey: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: correct ? q.answer : "wrong", working: "实际在线作答", taskType: "transfer", contextId: "fake", help: "independent" })), ...extra }, now).state;
}
const grade = (state: WorkspaceState) => state.knowledge.find(k => k.id === "division")!.stars;
const latest = (state: WorkspaceState) => state.mastery!.assessments.filter(a => a.knowledgeId === "division").at(-1)!;
function draftRule(state: WorkspaceState) { const result = act(state, "rule.create", { name: "待验证的新配置" }); return { state: result.state, rule: result.state.mastery!.rules.find(r => r.id === result.result!.id)! }; }
function approve(state: WorkspaceState, rule: MasteryRule, now = initialTime) {
  const submitted = act(state, "rule.submit", { id: rule.id, expectedRevision: rule.revision }, now).state;
  const revision = submitted.mastery!.rules.find(r => r.id === rule.id)!.revision;
  return act(submitted, "rule.review", { id: rule.id, expectedRevision: revision, decision: "approve", note: "仅参数与流程校核，尚无外部教学验证" }, now, "reviewer", "independent-reviewer").state;
}
function publishDelay(state: WorkspaceState, delay: number, now: string) {
  const created = act(state, "rule.create", { name: `${delay} 日间隔试用配置` }, now);
  const id = created.result!.id;
  state = act(created.state, "rule.update", { id, expectedRevision: 1, parameters: { reviewDelayDays: delay } }, now).state;
  state = approve(state, state.mastery!.rules.find(r => r.id === id)!, now);
  const preview = act(state, "rule.preview", { id }, now);
  return act(preview.state, "rule.publish", { id, previewId: preview.result!.id }, now).state;
}

test("migration freezes old pilot scores without inventing missing metadata; explicit cross-rule reassessment explains the change", () => {
  const state = createSeedWorkspace("learner", "旧档案", initialTime); state.knowledge[0].stars = 3;
  const knowledge = structuredClone(state.knowledge), evidence = structuredClone(state.evidence);
  const mastery = ensureMastery(state, { now: initialTime, newId });
  assert.deepEqual(state.knowledge, knowledge); assert.deepEqual(state.evidence, evidence);
  assert.equal(mastery.assessments[0].afterStars, 3); assert.equal(mastery.assessments[0].legacy, true);
  const before = structuredClone(mastery.assessments);
  assert.equal(ensureMastery(state, { now: day(1), newId }), mastery);
  const next = act(state, "mastery.reevaluate", { knowledgeId: "division" }).state;
  assert.equal(grade(next), null); assert.match(latest(next).reason, /跨规则/);
  assert.deepEqual(next.mastery!.assessments.slice(0, before.length), before);
  assert.ok(next.mastery!.rules.every(r => r.validation === "unvalidated-trial" && !r.reviewerId));
});

test("unlearned and evidence-insufficient remain distinct from one star; an incorrect first answer awards no grade", () => {
  let state = fixture(); state.knowledge.find(k => k.id === "geometry")!.learningState = "upcoming";
  state = act(state, "mastery.reevaluate").state;
  assert.equal(state.knowledge.find(k => k.id === "geometry")!.assessmentState, "unlearned");
  assert.equal(latest(state).state, "insufficient");
  const created = create(state); state = submit(created.state, created.paper, false);
  assert.equal(grade(state), null);
});

test("five distinct levels require actual aided success, basic independence, stable contexts and planned spaced transfer", () => {
  let state = fixture();
  for (const [help, expected] of [["explanation", 1], ["hint", 2]] as const) {
    const made = create(state); state = act(made.state, "attempt.help", { paperId: made.paper.id, questionId: made.paper.questionIds[0], level: help }).state;
    assert.equal(grade(state), expected === 1 ? null : 1, "exposure alone never changes grade");
    state = submit(state, made.paper); assert.equal(grade(state), expected);
  }
  const basic = create(state, 3); state = submit(basic.state, basic.paper); assert.equal(grade(state), 3);
  const application = create(state, 3, "application"); state = submit(application.state, application.paper); assert.equal(grade(state), 4);
  const plan = state.mastery!.reviewPlans.find(p => p.sourcePaperId === application.paper.id)!;
  assert.throws(() => act(state, "review.start", { planId: plan.id }), /尚未到期/);
  const reviewed = act(state, "review.start", { planId: plan.id }, day(3)); state = reviewed.state;
  const paper = state.papers.find(p => p.id === reviewed.result!.id)!;
  state = submit(state, paper, true, day(3)); assert.equal(grade(state), 5);
  assert.equal(state.mastery!.reviewPlans.find(p => p.id === plan.id)!.status, "completed");
  assert.equal(latest(state).conditions.find(c => c.key === "transfer")!.actual, 2);
  assert.ok(latest(state).adoptedEvidenceIds.length >= 8);
});

test("application count alone cannot establish four stars without separately labelled contexts and separate attempts", () => {
  let state = fixture(); state.questions.filter(q => q.taskType === "application").forEach(q => { q.contextId = "same-context"; });
  const basic = create(state, 3); state = submit(basic.state, basic.paper);
  const apps = create(state, 4, "application"); state = submit(apps.state, apps.paper);
  assert.equal(grade(state), 3); assert.ok(latest(state).gaps.some(g => g.includes("不同标注情境")));
  const another = fixture(); const all = act(another, "paper.create", { count: 13, knowledgeIds: ["division"] }).state;
  const single = submit(all, all.papers[0]); assert.equal(grade(single), 3);
  assert.equal(latest(single).conditions.find(c => c.key === "attempts")!.actual, 1);
});

test("unplanned or forged transfer tags cannot grant five stars; evidence uses the immutable paper snapshot", () => {
  let state = fixture(); const basic = create(state, 3); state = submit(basic.state, basic.paper);
  const apps = create(state, 3, "application"); state = submit(apps.state, apps.paper);
  const unplanned = create(state, 2, "transfer", day(5)); state = submit(unplanned.state, unplanned.paper, true, day(5), { reviewPlanId: state.mastery!.reviewPlans[0].id, kind: "review" });
  assert.equal(grade(state), 4); assert.equal(latest(state).conditions.find(c => c.key === "transfer")!.actual, 0);
  assert.ok(state.evidence.filter(e => e.paperId === basic.paper.id).every(e => e.taskType === "basic" && e.contextId !== "fake"));
  assert.throws(() => act(state, "paper.create", { kind: "review", count: 2, knowledgeIds: ["division"] }, day(5)), /已有复查计划/);
});

test("bank edits cannot relabel a previously issued paper or its submission evidence", () => {
  const made = create(fixture(), 1); const q = made.paper.questions[0];
  const changed = act(made.state, "question.update", { id: q.id, question: { taskType: "transfer", contextId: "new-context" } }).state;
  const state = submit(changed, made.paper);
  assert.equal(state.evidence[0].taskType, "basic"); assert.equal(state.evidence[0].contextId, q.contextId);
});

test("assisted learning and paper submissions schedule review without awarding verified independence", () => {
  const made = create(fixture()); let state = act(made.state, "attempt.help", { paperId: made.paper.id, questionId: made.paper.questionIds[0], level: "hint" }).state;
  state = submit(state, made.paper);
  assert.equal(state.mastery!.reviewPlans.length, 1); assert.equal(state.evidence[0].eligible, false); assert.equal(grade(state), 2);
  const before = structuredClone(state.knowledge);
  state.uploads.push({ id: "photo", name: "原作", url: "file:///private/photo.jpg", createdAt: initialTime, status: "pending", purpose: "homework" });
  state = act(state, "homework.confirm", { uploadId: "photo", entries: [{ questionId: state.questions.find(q => q.taskType === "application")!.id, answer: "14" }] }).state;
  assert.deepEqual(state.knowledge, before); assert.equal(state.mastery!.reviewPlans.length, 2);
});

test("review plans and submissions are idempotent; review paper replacement cannot detach the plan", () => {
  const made = create(fixture()); let state = submit(made.state, made.paper);
  const plans = structuredClone(state.mastery!.reviewPlans), assessments = structuredClone(state.mastery!.assessments);
  state = submit(state, made.paper);
  assert.deepEqual(state.mastery!.reviewPlans, plans); assert.deepEqual(state.mastery!.assessments, assessments);
  const started = act(state, "review.start", { planId: plans[0].id }, day(3));
  const again = act(started.state, "paper.create", { kind: "review", planId: plans[0].id }, day(4));
  assert.strictEqual(again.state, started.state); assert.equal(again.result!.id, started.result!.id);
  assert.throws(() => act(started.state, "paper.replace", { paperId: started.result!.id, questionId: started.state.papers[0].questionIds[0] }), /复查卷/);
});

test("extending the active rule from three to six days blocks early review without consuming scarce transfer families", () => {
  let state = fixture(); state.questions = state.questions.filter(q => q.taskType !== "transfer" || ["transfer-0", "transfer-1"].includes(q.id));
  const basic = create(state, 3); state = submit(basic.state, basic.paper);
  const apps = create(state, 3, "application"); state = submit(apps.state, apps.paper); assert.equal(grade(state), 4);
  const original = structuredClone(state.mastery!.reviewPlans.find(p => p.sourcePaperId === apps.paper.id)!);
  state = publishDelay(state, 6, day(1));
  const plan = state.mastery!.reviewPlans.find(p => p.id === original.id)!;
  const before = structuredClone(state);
  assert.equal(reviewAvailableAt(state, plan), day(6)); assert.deepEqual(state, before, "date calculation is pure");
  assert.deepEqual(plan, original, "rule changes never overwrite the original plan snapshot");
  for (const action of ["review.start", "paper.create"]) assert.throws(() => act(state, action, { kind: "review", planId: plan.id, count: 2 }, day(3)), /2026-11-01T08:00:00.000Z/);
  assert.throws(() => act(state, "review.start", { planId: plan.id }, new Date(Date.parse(day(6)) - 1).toISOString()), /尚未到期/);
  assert.deepEqual(state, before, "rejected starts write no paper, exposure, revision, or assessment");
  const started = act(state, "review.start", { planId: plan.id, count: 2 }, day(6));
  const paper = started.state.papers.find(p => p.id === started.result!.id)!;
  assert.deepEqual(paper.questionIds, ["transfer-0", "transfer-1"]);
  state = submit(started.state, paper, true, day(6));
  assert.equal(grade(state), 5); assert.equal(latest(state).conditions.find(c => c.key === "transfer")!.actual, 2);
  const completed = state.mastery!.reviewPlans.find(p => p.id === plan.id)!;
  assert.equal(completed.dueAt, original.dueAt); assert.equal(completed.delayDays, 3); assert.equal(completed.ruleId, original.ruleId);
});

test("shortening the active rule from six to three days cannot bring an existing six-day plan forward", () => {
  let state = publishDelay(fixture(), 6, initialTime);
  const basic = create(state, 3); state = submit(basic.state, basic.paper);
  const apps = create(state, 3, "application"); state = submit(apps.state, apps.paper);
  const original = structuredClone(state.mastery!.reviewPlans.find(p => p.sourcePaperId === apps.paper.id)!);
  state = publishDelay(state, 3, day(1));
  const plan = state.mastery!.reviewPlans.find(p => p.id === original.id)!;
  assert.equal(reviewAvailableAt(state, plan), day(6)); assert.deepEqual(plan, original);
  assert.throws(() => act(state, "review.start", { planId: plan.id }, day(3)), /尚未到期/);
  const started = act(state, "review.start", { planId: plan.id }, day(6));
  state = submit(started.state, started.state.papers.find(p => p.id === started.result!.id)!, true, day(6));
  assert.equal(grade(state), 5);
  assert.equal(state.mastery!.reviewPlans.find(p => p.id === plan.id)!.dueAt, day(6));
});

test("a started review remains idempotently accessible after a later interval increase", () => {
  const made = create(fixture()); let state = submit(made.state, made.paper);
  const planId = state.mastery!.reviewPlans[0].id;
  const started = act(state, "review.start", { planId }, day(3));
  state = publishDelay(started.state, 6, day(4));
  assert.equal(reviewAvailableAt(state, state.mastery!.reviewPlans.find(p => p.id === planId)!), day(6));
  for (const action of ["review.start", "paper.create"]) {
    const again = act(state, action, { kind: "review", planId }, day(4));
    assert.strictEqual(again.state, state); assert.equal(again.result!.id, started.result!.id);
  }
});

test("review selection excludes every historical seen family even after fourteen days and reports true scarcity", () => {
  let state = fixture(); const seen = create(state, 1, "transfer", day(-60)); state = seen.state;
  const source = create(state); state = submit(source.state, source.paper);
  const plan = state.mastery!.reviewPlans[0];
  assert.throws(() => act(state, "review.start", { planId: plan.id, count: 10 }, day(3)), /只有 9 道/);
  const result = act(state, "review.start", { planId: plan.id, count: 9 }, day(3));
  assert.ok(result.state.papers[0].questions.every(q => q.familyId !== seen.paper.questions[0].familyId));
});

test("missing metadata is excluded without guessing; repeated families cannot improve a grade", () => {
  let state = fixture(); state.questions.filter(q => q.taskType === "basic").forEach(q => { delete q.taskType; delete q.contextId; });
  const made = create(state, 3); state = submit(made.state, made.paper);
  assert.equal(grade(state), null); assert.equal(latest(state).excludedEvidence.filter(e => e.reason.includes("缺少任务")).length, 3);
  let repeated = fixture(); const first = create(repeated); repeated = submit(first.state, first.paper);
  for (let i = 1; i < 5; i++) { const next = create(repeated, 1, "basic", day(i * 20)); repeated = submit(next.state, next.paper, true, day(i * 20)); }
  assert.equal(grade(repeated), null); assert.equal(latest(repeated).adoptedEvidenceIds.length, 1);
});

test("single error keeps a grade; fresh consecutive failures downgrade once, with no re-evaluation farming", () => {
  const made = create(fixture(), 3); let state = submit(made.state, made.paper); assert.equal(grade(state), 3);
  for (let i = 0; i < 3; i++) { const next = create(state, 1, "application", day(i + 1)); state = submit(next.state, next.paper, false, day(i + 1)); assert.equal(grade(state), i < 2 ? 3 : 2); }
  const originalHistory = structuredClone(state.mastery!.assessments);
  for (let i = 0; i < 5; i++) { state = act(state, "mastery.reevaluate", { knowledgeId: "division" }, day(4)).state; assert.equal(grade(state), 2); }
  assert.deepEqual(state.mastery!.assessments.slice(0, originalHistory.length), originalHistory);
  for (let i = 0; i < 3; i++) { const next = create(state, 1, "transfer", day(i + 5)); state = submit(next.state, next.paper, false, day(i + 5)); }
  assert.equal(grade(state), 1);
});

test("single-question exposure changes only that family and cannot rewrite old reports or grades", () => {
  const made = create(fixture(), 3); const before = structuredClone(made.state.knowledge);
  const exposed = act(made.state, "paper.question.expose", { paperId: made.paper.id, questionId: made.paper.questionIds[1] }).state;
  assert.equal(JSON.parse(exposed.events.find(e => e.action === "learning.exposure")!.detail).ruleVersion, "local-five-star-trial-v1/v1");
  assert.deepEqual(exposed.attempts[0].answers.map(a => a.help), ["independent", "explanation", "independent"]);
  assert.deepEqual(exposed.knowledge, before);
  const submitted = submit(exposed, made.paper); const reports = structuredClone(submitted.attempts), history = structuredClone(submitted.mastery!.assessments);
  const after = act(submitted, "paper.question.expose", { paperId: made.paper.id, questionId: made.paper.questionIds[0] }).state;
  assert.deepEqual(after.attempts, reports); assert.deepEqual(after.mastery!.assessments, history);
});

test("rule drafts, validation and previews cannot change grades; unsafe parameters block submission", () => {
  const made = create(fixture(), 3); const initial = submit(made.state, made.paper);
  const { state, rule } = draftRule(initial); const before = structuredClone(state.knowledge);
  const invalid = act(state, "rule.update", { id: rule.id, expectedRevision: rule.revision, parameters: { downgradeAfterAttempts: 1 }, validation: "validated" }).state;
  assert.deepEqual(invalid.knowledge, before); assert.equal(invalid.mastery!.rules.find(r => r.id === rule.id)!.validation, "unvalidated-trial");
  const preview = act(invalid, "rule.preview", { id: rule.id }); assert.ok((preview.result!.preview as { issues: string[] }).issues.length);
  assert.deepEqual(preview.state.knowledge, before);
  assert.throws(() => act(preview.state, "rule.submit", { id: rule.id, expectedRevision: 2 }), /至少两次/);
  assert.throws(() => act(state, "rule.update", { id: rule.id, expectedRevision: 1, parameters: { fakeParameter: 3 } }), /参数名称/);
});

test("rule publication requires independent review and a fresh owner preview; drafts and published versions stay separate", () => {
  const { state, rule } = draftRule(fixture());
  const pending = act(state, "rule.submit", { id: rule.id, expectedRevision: rule.revision }).state;
  assert.throws(() => act(pending, "rule.review", { id: rule.id, expectedRevision: 2, decision: "approve", note: "self" }), /非作者/);
  let approved = approve(state, rule);
  assert.throws(() => act(approved, "rule.publish", { id: rule.id }), /重新试算/);
  const preview = act(approved, "rule.preview", { id: rule.id });
  const changed = act(preview.state, "profile.update", { profile: { name: "更新资料" } });
  assert.throws(() => act(changed.state, "rule.publish", { id: rule.id, previewId: preview.result!.id }), /重新试算/);
  const fresh = act(changed.state, "rule.preview", { id: rule.id }); approved = act(fresh.state, "rule.publish", { id: rule.id, previewId: fresh.result!.id }).state;
  assert.equal(approved.mastery!.activeRuleId, rule.id);
  assert.throws(() => act(approved, "rule.update", { id: rule.id, expectedRevision: 3, parameters: { star3BasicCorrect: 1 } }), /仅草稿/);
  assert.throws(() => act(approved, "rule.disable", { id: rule.id }), /先切换/);
});

test("switching rule versions previews actual changed thresholds and retains previous assessments and original answers", () => {
  const made = create(fixture(), 3); let state = submit(made.state, made.paper); assert.equal(grade(state), 3);
  const original = structuredClone({ evidence: state.evidence, attempts: state.attempts, assessments: state.mastery!.assessments });
  const draft = draftRule(state);
  state = act(draft.state, "rule.update", { id: draft.rule.id, expectedRevision: 1, parameters: { star3BasicCorrect: 4 } }).state;
  state = approve(state, state.mastery!.rules.find(r => r.id === draft.rule.id)!);
  let preview = act(state, "rule.preview", { id: draft.rule.id });
  assert.equal((preview.result!.preview as { changes: { afterStars: number | null }[] }).changes[0].afterStars, null);
  state = act(preview.state, "rule.publish", { id: draft.rule.id, previewId: preview.result!.id }).state;
  assert.equal(grade(state), null); assert.deepEqual(state.evidence, original.evidence); assert.deepEqual(state.attempts, original.attempts);
  assert.deepEqual(state.mastery!.assessments.slice(0, original.assessments.length), original.assessments);
  preview = act(state, "rule.preview", { id: "local-five-star-trial-v1" });
  state = act(preview.state, "rule.activate", { id: "local-five-star-trial-v1", previewId: preview.result!.id }).state;
  assert.equal(grade(state), 3); state = act(state, "rule.disable", { id: draft.rule.id }).state;
  assert.equal(state.mastery!.rules.find(r => r.id === draft.rule.id)!.status, "disabled");
});

test("student cannot mutate rules; editorial previews and projections never reveal learner assessments or differences", () => {
  const made = create(fixture(), 3); const state = submit(made.state, made.paper);
  assert.throws(() => act(state, "rule.create", { name: "forged" }, initialTime, "student"), /权限/);
  assert.throws(() => act(state, "question.update", { id: state.questions[0].id, question: { taskType: "transfer" } }, initialTime, "student"), /权限/);
  for (const role of ["editor", "reviewer"] as const) {
    const preview = act(state, "rule.preview", { id: state.mastery!.activeRuleId }, initialTime, role, role);
    assert.deepEqual((preview.result!.preview as { changes: unknown[] }).changes, []);
    const projected = projectWorkspace(preview.state, role);
    assert.deepEqual(projected.mastery!.assessments, []); assert.deepEqual(projected.mastery!.reviewPlans, []);
    assert.ok(projected.mastery!.previews.every(p => !p.changes.length));
  }
});

test("rule validation requires exactly the full eleven finite numeric parameters", () => {
  const rule = fixture().mastery!.rules[0];
  assert.deepEqual(validateRule(rule), []);
  const missing = structuredClone(rule); delete (missing.parameters as Partial<typeof missing.parameters>).star5TransferCorrect;
  assert.ok(validateRule(missing).some(issue => issue.includes("缺少必要")));
  const extra = structuredClone(rule); Object.assign(extra.parameters, { forged: 1 });
  assert.ok(validateRule(extra).some(issue => issue.includes("未知规则")));
  for (const value of [NaN, Infinity, "3", null]) {
    const malformed = structuredClone(rule); Object.assign(malformed.parameters, { star3BasicCorrect: value });
    assert.ok(validateRule(malformed).some(issue => issue.includes("有限数值")));
  }
});

test("an old issued but unsubmitted paper cannot be reused as independent new-family evidence", () => {
  const old = create(fixture(), 3);
  const replay = create(old.state, 3, "basic", day(20));
  assert.deepEqual(replay.paper.questionIds, old.paper.questionIds);
  const state = submit(replay.state, replay.paper, true, day(20));
  assert.equal(grade(state), null); assert.ok(state.evidence.every(e => e.eligible === false));
});

test("legacy no-op actions remain genuinely unchanged; migration is an explicit persistable loader step", () => {
  const legacy = createSeedWorkspace("learner", "旧档案", initialTime);
  const noOp = act(legacy, "attempt.submit", { paperId: legacy.papers[0].id });
  assert.strictEqual(noOp.state, legacy); assert.equal(noOp.state.mastery, undefined);
  const copy = structuredClone(legacy); ensureMastery(copy, { now: initialTime, newId });
  assert.ok(copy.mastery); assert.deepEqual(copy.knowledge, legacy.knowledge); assert.equal(copy.revision, legacy.revision);
});

test("student mastery projection survives JSON persistence without adding undefined review fields", () => {
  const made = create(fixture(), 3); const state = submit(made.state, made.paper);
  const view = projectWorkspace(state, "student");
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  assert.ok(view.mastery!.rules.every(r => !Object.hasOwn(r, "reviewerId") && !Object.hasOwn(r, "reviewNote")));
});

test("teaching metadata must be a complete pair on creation and after merging updates", () => {
  const state = fixture(); const q = structuredClone(state.questions[0]); delete q.taskType; delete q.contextId;
  assert.throws(() => act(state, "question.create", { question: { ...q, taskType: "transfer" } }), /同时填写/);
  assert.throws(() => act(state, "question.create", { question: { ...q, contextId: "solo" } }), /同时填写/);
  const created = act(state, "question.create", { question: { ...q, taskType: "transfer", contextId: "full" } }).state;
  const id = created.questions[0].id;
  assert.equal(act(created, "question.update", { id, question: { taskType: "application" } }).state.questions[0].contextId, "full");
  const old = act(state, "question.create", { question: q }).state;
  assert.throws(() => act(old, "question.update", { id: old.questions[0].id, question: { taskType: "transfer" } }), /同时填写/);
});
