import assert from "node:assert/strict";
import test from "node:test";
import { createSeedWorkspace } from "../lib/seed.ts";
import { applyAction, DomainError } from "../lib/server/domain.ts";
import { ensureMastery, evaluateMastery } from "../lib/server/mastery.ts";
import { validateEvidenceReviews } from "../lib/server/evidence.ts";
import { effectiveAttempt, effectiveEvidence, effectiveMistakes, effectiveReviewSource, evidenceEpoch } from "../lib/effective-evidence.ts";
import { projectWorkspace } from "../lib/server/access-policy.ts";
import { exportContentPackage } from "../lib/server/content.ts";
import type { EvidencePatch, EvidencePreview, Role, TaskType, WorkspaceState } from "../lib/types.ts";

const NOW = "2026-10-27T10:00:00.000Z";
const LATER = "2026-11-02T10:00:00.000Z";
let serial = 0;
const newId = () => `evidence-${++serial}`;
const act = (state: WorkspaceState, action: string, input: Record<string, unknown> = {}, local = true, role: Role = "student", userId = role === "teacher" ? "teacher-a" : "learner", now = NOW) => applyAction(state, { action, ...input }, { now, newId, role, userId, displayName: userId, ...(local ? { channel: "local" as const } : {}) });
function base() {
  const state = createSeedWorkspace("learner", "本机学习者", NOW);
  state.actor.role = "student"; state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = []; state.events = []; state.messages = [];
  const original = state.questions[0];
  state.questions = (["basic", "application", "transfer"] as TaskType[]).flatMap(taskType => Array.from({ length: 8 }, (_, i) => ({ ...original,
    id: `e-q-${taskType}-${i}`, familyId: `e-f-${taskType}-${i}`, text: `本地试验${taskType}${i}：${original.text}`, taskType, contextId: `${taskType}-${i % 3}`, difficulty: (taskType === "basic" ? "基础" : taskType === "application" ? "巩固" : "挑战") as typeof original.difficulty })));
  state.uploads = [{ id: "chosen-photo", name: "主动选中的原稿.jpg", url: "file:///private/chosen.jpg", purpose: "homework", status: "pending", createdAt: NOW }, { id: "private-photo", name: "未共享的照片.jpg", url: "file:///private/other.jpg", purpose: "homework", status: "pending", createdAt: NOW }];
  ensureMastery(state, { now: NOW, newId, fresh: true }); return state;
}
function submitted(state = base(), count = 1, correct = true, type: TaskType = "basic", now = NOW) {
  const made = act(state, "paper.create", { knowledgeIds: ["division"], count, difficulty: type === "basic" ? "基础" : type === "application" ? "巩固" : "挑战" }, true, "student", "learner", now);
  const paper = made.state.papers.find(p => p.id === made.result!.id)!;
  return act(made.state, "attempt.submit", { paperId: paper.id, submissionKey: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: correct ? q.answer : "wrong", working: "原始思考过程" })) }, true, "student", "learner", now).state;
}
function propose(state: WorkspaceState, patch: EvidencePatch, local = true, evidenceId = state.evidence[0].id, extra = {}) {
  return act(state, "evidence.propose", { evidenceId, patch, reason: "对照原稿后发现录入或标注需要更正", uploadIds: ["chosen-photo"], sourceRevision: state.revision, requestId: newId(), ...extra }, local);
}
function preview(state: WorkspaceState, proposalId: string, local = true, outcome: "accept" | "reject" = "accept") {
  return act(state, "evidence.preview", { proposalId, outcome }, local, local ? "student" : "teacher").result!.preview as EvidencePreview;
}
function decide(state: WorkspaceState, proposalId: string, local = true, outcome: "accept" | "reject" = "accept") {
  const p = preview(state, proposalId, local, outcome);
  const payload = { proposalId, outcome, sourceRevision: p.sourceRevision, digest: p.digest, reason: "对照主动共享的原稿核对本次列出的字段", requestId: newId() };
  return { ...act(state, local ? "local.evidence.confirm" : "evidence.review", payload, local, local ? "student" : "teacher"), payload };
}
const stars = (state: WorkspaceState, id = "division") => state.knowledge.find(k => k.id === id)!.stars;
const status = (fn: () => unknown, expected: number) => assert.throws(fn, (error: unknown) => error instanceof DomainError && error.status === expected);

test("pending/rejected applications preserve original evidence, scores and assessments; preview is read-only", () => {
  const initial = submitted(base(), 1, false), original = structuredClone(initial);
  const requested = propose(initial, { answer: initial.evidence[0].expected }).state, proposal = requested.evidenceReviews!.proposals[0];
  assert.deepEqual(requested.evidence, original.evidence); assert.deepEqual(requested.attempts, original.attempts); assert.deepEqual(requested.knowledge, original.knowledge);
  assert.equal(effectiveAttempt(requested, original.attempts[0].id)!.correctCount, 0);
  const before = structuredClone(requested), p = preview(requested, proposal.id); assert.deepEqual(requested, before);
  assert.equal(p.report.beforeCorrect, 0); assert.equal(p.report.afterCorrect, 1); assert.equal(p.after.authority, "local-unverified");
  const rejected = decide(requested, proposal.id, true, "reject").state;
  assert.equal(effectiveAttempt(rejected, original.attempts[0].id)!.correctCount, 0);
  assert.deepEqual(rejected.mastery, original.mastery); assert.deepEqual(rejected.mistakes, original.mistakes);
  validateEvidenceReviews(rejected);
});

test("local recognition correction updates reports and mistakes but never creates mastery evidence", () => {
  const initial = submitted(base(), 1, false), source = initial.evidence[0], original = structuredClone({ evidence: initial.evidence, attempts: initial.attempts, papers: initial.papers, mistakes: initial.mistakes, assessments: initial.mastery!.assessments });
  const request = propose(initial, { answer: source.expected });
  const changed = decide(request.state, request.result!.id!).state;
  assert.equal(effectiveAttempt(changed, source.attemptId)!.correctCount, 1);
  assert.equal(effectiveAttempt(changed, source.attemptId)!.independentCorrect, 1);
  assert.equal(effectiveMistakes(changed).length, 0); assert.equal(effectiveMistakes(changed, { includeInactive: true })[0].active, false);
  const entry = effectiveEvidence(changed)[0]; assert.equal(entry.eligible, false); assert.match(entry.masteryBlockedReason!, /未经|尚未/); assert.equal(stars(changed), null);
  assert.deepEqual(changed.evidence, original.evidence); assert.deepEqual(changed.attempts, original.attempts); assert.deepEqual(changed.papers, original.papers); assert.deepEqual(changed.mistakes, original.mistakes);
  assert.deepEqual(changed.mastery!.assessments.slice(0, original.assessments.length), original.assessments);
  assert.equal(effectiveEvidence(changed, 0)[0].answer, "wrong"); validateEvidenceReviews(JSON.parse(JSON.stringify(changed)));
});

test("teacher-reviewed correction can use verified original new-family eligibility, with explicit photos and preserved history", () => {
  const initial = submitted(base(), 3, false), old = structuredClone(initial.mastery!.assessments);
  let state = initial;
  for (const entry of initial.evidence) { const p = propose(state, { answer: entry.expected }, false, entry.id); state = decide(p.state, p.result!.id!, false).state; }
  assert.equal(stars(state), 3); assert.equal(effectiveAttempt(state, initial.attempts[0].id)!.correctCount, 3);
  assert.equal(effectiveEvidence(state).every(e => e.authority === "teacher-verified" && e.eligible), true);
  assert.deepEqual(state.mastery!.assessments.slice(0, old.length), old);
  const teacher = projectWorkspace(state, "teacher"); assert.deepEqual(teacher.uploads, []);
  assert.equal(teacher.evidenceReviews!.proposals[0].materials!.length, 1);
  assert.match(teacher.evidenceReviews!.proposals[0].materials![0].url!, /\/api\/evidence\/.*\/images\/chosen-photo\?workspaceId=/);
  assert.ok(!JSON.stringify(teacher).includes("file:///private/other.jpg"));
  assert.equal(effectiveAttempt(teacher, initial.attempts[0].id)!.correctCount, 3);
});

test("invalidated evidence bypasses held stars and does not regain new-family status on reevaluation", () => {
  const initial = submitted(base(), 3), source = initial.evidence[0], oldPlan = structuredClone(initial.mastery!.reviewPlans[0]);
  assert.equal(stars(initial), 3);
  const p = propose(initial, { invalidated: true }), accepted = decide(p.state, p.result!.id!).state;
  assert.equal(stars(accepted), null); assert.equal(effectiveEvidence(accepted).find(e => e.id === source.id)!.valid, false);
  assert.equal(accepted.evidence.length, initial.evidence.length); assert.deepEqual(accepted.mastery!.reviewPlans[0], oldPlan);
  assert.ok(accepted.mastery!.assessments.at(-3)!.reason.includes("证据更正"));
  const again = act(accepted, "mastery.reevaluate").state; assert.equal(stars(again), null);
  const made = act(again, "paper.create", { knowledgeIds: ["division"], count: 1, difficulty: "基础" });
  assert.ok(!made.state.papers[0].questions.some(q => q.familyId === source.familyId));
  assert.ok(evidenceEpoch(accepted, "division") > 0);
});

test("knowledge correction re-evaluates both sides and adds a source-revision plan without changing old plans", () => {
  const initial = submitted(), source = initial.evidence[0], oldPlan = structuredClone(initial.mastery!.reviewPlans[0]);
  const request = propose(initial, { knowledgeId: "geometry" }), changed = decide(request.state, request.result!.id!).state;
  assert.equal(effectiveEvidence(changed)[0].knowledgeId, "geometry"); assert.equal(initial.evidence[0].knowledgeId, "division");
  assert.equal(effectiveReviewSource(changed, oldPlan).valid, false);
  const added = changed.mastery!.reviewPlans.find(p => p.knowledgeId === "geometry")!;
  assert.equal(added.sourceRevision, changed.revision); assert.equal(added.dueAt, oldPlan.dueAt);
  assert.equal(effectiveReviewSource(changed, added).valid, true); assert.deepEqual(changed.mastery!.reviewPlans.find(p => p.id === oldPlan.id), oldPlan);
  status(() => act(changed, "review.start", { planId: oldPlan.id }, true, "student", "learner", LATER), 409);
  assert.equal(effectiveEvidence(changed, changed.revision - 1).find(e => e.id === source.id)!.knowledgeId, "division");
  for (const a of changed.mastery!.assessments.filter(a => a.trigger === "evidence-correction")) {
    assert.equal(a.evidenceAsOfRevision, changed.revision);
    const at = effectiveEvidence(changed, a.evidenceAsOfRevision);
    assert.ok([...a.adoptedEvidenceIds, ...a.excludedEvidence.map(e => e.evidenceId)].every(id => at.some(e => e.id === id && e.knowledgeId === a.knowledgeId)));
  }
});

test("loss of a completed review's source withdraws its transfer qualification and keeps its frozen work", () => {
  let state = submitted(base(), 3); state = submitted(state, 3, true, "application");
  const sourceAttempt = state.attempts[0], plan = state.mastery!.reviewPlans.find(p => p.sourceAttemptId === sourceAttempt.id)!;
  const started = act(state, "review.start", { planId: plan.id, count: 2 }, true, "student", "learner", LATER);
  const paper = started.state.papers.find(p => p.id === started.result!.id)!;
  state = act(started.state, "attempt.submit", { paperId: paper.id, submissionKey: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: q.answer })) }, true, "student", "learner", LATER).state;
  assert.equal(stars(state), 5);
  const frozen = structuredClone({ paper: state.papers.find(p => p.id === paper.id), attempt: state.attempts.find(a => a.paperId === paper.id), plan: state.mastery!.reviewPlans.find(p => p.id === plan.id) });
  for (const source of state.evidence.filter(e => e.attemptId === sourceAttempt.id)) {
    const p = propose(state, { invalidated: true }, false, source.id);
    state = decide(p.state, p.result!.id!, false).state;
  }
  assert.equal(effectiveReviewSource(state, plan).valid, false); assert.notEqual(stars(state), 5);
  const rule = state.mastery!.rules.find(r => r.id === state.mastery!.activeRuleId)!;
  assert.equal(evaluateMastery(state, "division", rule, LATER).conditions.find(c => c.key === "transfer")!.actual, 0);
  assert.deepEqual({ paper: state.papers.find(p => p.id === paper.id), attempt: state.attempts.find(a => a.paperId === paper.id), plan: state.mastery!.reviewPlans.find(p => p.id === plan.id) }, frozen);
});

test("a new effective mistake is correctable through a stable ID without overwriting the original answer", () => {
  const original = submitted(), e = original.evidence[0], p = propose(original, { answer: "wrong" });
  const changed = decide(p.state, p.result!.id!).state, mistake = effectiveMistakes(changed)[0];
  assert.ok(mistake.id.startsWith("effective-mistake-")); assert.equal(changed.mistakes.length, 0);
  const corrected = act(changed, "mistake.correct", { id: mistake.id, answer: e.expected }).state;
  assert.equal(effectiveMistakes(corrected)[0].correctedAnswer, e.expected); assert.equal(corrected.evidence[0].answer, e.answer);
  assert.equal(effectiveAttempt(corrected, e.attemptId)!.correctCount, 0, "learning correction never changes first effective answer");
  assert.deepEqual(corrected.knowledge, changed.knowledge);
});

test("requests are idempotent before CAS; stale preview, competing acceptance and conflicting payloads reject", () => {
  const original = submitted(), e = original.evidence[0];
  const payload = { evidenceId: e.id, patch: { answer: "wrong" }, reason: "核对原稿", uploadIds: [], sourceRevision: original.revision, requestId: "stable-proposal" };
  const p = act(original, "evidence.propose", payload); assert.strictEqual(act(p.state, "evidence.propose", payload).state, p.state);
  status(() => act(p.state, "evidence.propose", { ...payload, reason: "不同原因" }), 409);
  const old = preview(p.state, p.result!.id!), other = propose(p.state, { invalidated: true }).state;
  status(() => act(other, "local.evidence.confirm", { proposalId: p.result!.id, outcome: "accept", sourceRevision: old.sourceRevision, digest: old.digest, reason: "核对原稿", requestId: "stale" }), 409);
  const completed = decide(other, p.result!.id!);
  assert.strictEqual(act(completed.state, "local.evidence.confirm", completed.payload).state, completed.state);
  status(() => act(completed.state, "local.evidence.confirm", { ...completed.payload, outcome: "reject" }), 409);
  const competing = other.evidenceReviews!.proposals.at(-1)!;
  status(() => preview(completed.state, competing.id), 409);
  assert.equal(decide(completed.state, competing.id, true, "reject").state.evidenceReviews!.decisions.at(-1)!.outcome, "reject");
});

test("role claims, unshared files, unsupported fields and a genuine exposure downgrade fail closed", () => {
  let initial = base(); const made = act(initial, "paper.create", { knowledgeIds: ["division"], count: 1 });
  const paper = made.state.papers[0]; initial = act(made.state, "attempt.help", { paperId: paper.id, questionId: paper.questions[0].id, level: "hint" }).state;
  initial = act(initial, "attempt.submit", { paperId: paper.id, submissionKey: paper.id, answers: [{ questionId: paper.questions[0].id, value: paper.questions[0].answer }] }).state;
  status(() => propose(initial, { help: "independent" }), 409);
  status(() => propose(initial, { help: "unknown" }), 409);
  status(() => propose(initial, { invalidated: true }, true, initial.evidence[0].id, { uploadIds: ["other-space-photo"] }), 404);
  status(() => propose(initial, { correct: true } as EvidencePatch), 400);
  const p = propose(initial, { invalidated: true });
  for (const role of ["owner", "student", "parent", "editor", "reviewer"] as Role[]) status(() => act(p.state, "evidence.review", {}, false, role), 403);
  status(() => act(p.state, "evidence.review", {}, true, "teacher"), 403);
  status(() => act(p.state, "evidence.propose", { role: "teacher", channel: "local", evidenceId: initial.evidence[0].id, patch: { invalidated: true }, reason: "伪造", uploadIds: [], requestId: "forged", sourceRevision: p.state.revision }), 400);
  const workspace = propose(submitted(), { invalidated: true }, false);
  status(() => act(workspace.state, "evidence.preview", { proposalId: workspace.result!.id, outcome: "accept" }, false, "teacher", "learner"), 403);
});

test("partial teacher review cannot certify inherited local changes to unrelated fields", () => {
  const original = submitted(base(), 1, false), local = propose(original, { answer: original.evidence[0].expected });
  let state = decide(local.state, local.result!.id!).state;
  const unrelated = propose(state, { knowledgeId: "geometry" }, false), p = preview(unrelated.state, unrelated.result!.id!, false);
  assert.equal(p.authority, "teacher-verified"); assert.equal(p.after.authority, "local-unverified"); assert.match(p.warnings.join(" "), /仍有未/);
  state = decide(unrelated.state, unrelated.result!.id!, false).state;
  assert.equal(effectiveEvidence(state)[0].eligible, false); assert.deepEqual(effectiveEvidence(state)[0].unverifiedFields, ["answer"]);
  const explicit = propose(state, { answer: original.evidence[0].expected }, false);
  state = decide(explicit.state, explicit.result!.id!, false).state;
  assert.equal(effectiveEvidence(state)[0].authority, "teacher-verified"); assert.equal(effectiveEvidence(state)[0].eligible, true);
});

test("all learning readers retain accepted local patch chains without exposing local request bodies or materials", () => {
  const original = submitted(base(), 1, false);
  const local = propose(original, { answer: original.evidence[0].expected }, true, original.evidence[0].id, { reason: "LOCAL_PRIVATE_REASON" });
  let state = decide(local.state, local.result!.id!).state;
  const pending = propose(state, { invalidated: true }, true, original.evidence[0].id, { reason: "LOCAL_PENDING_PRIVATE_REASON" }); state = pending.state;
  const partial = propose(state, { knowledgeId: "geometry" }, false, original.evidence[0].id, { uploadIds: [] });
  state = decide(partial.state, partial.result!.id!, false).state;
  for (const role of ["student", "owner", "parent", "teacher"] as const) {
    const raw = structuredClone(state); raw.actor = { id: role === "student" ? "learner" : "other-reader", name: "授权读取者", role };
    const view = projectWorkspace(raw, role), entry = effectiveEvidence(view)[0];
    assert.equal(effectiveAttempt(view, original.attempts[0].id)!.correctCount, 1);
    assert.equal(entry.knowledgeId, "geometry"); assert.equal(entry.authority, "local-unverified"); assert.equal(entry.eligible, false); assert.deepEqual(entry.unverifiedFields, ["answer"]);
    if (role !== "student") {
      const localProjection = view.evidenceReviews!.proposals.find(p => p.id === local.result!.id)!;
      assert.deepEqual(localProjection.uploadIds, []); assert.deepEqual(localProjection.materials, []); assert.equal(localProjection.reason, "");
      assert.ok(!JSON.stringify(view.evidenceReviews).includes("LOCAL_PRIVATE_REASON")); assert.ok(!view.evidenceReviews!.proposals.some(p => p.id === pending.result!.id));
    }
  }
});

test("safe projections keep accepted results consistent while hiding other requests, reasons and photos", () => {
  const original = submitted(base(), 1, false), p = propose(original, { answer: original.evidence[0].expected }, false, original.evidence[0].id, { reason: "PRIVATE_REVIEW_REASON" });
  let state = decide(p.state, p.result!.id!, false).state;
  state = propose(state, { invalidated: true }, false, state.evidence[0].id, { reason: "PRIVATE_PENDING_REASON" }).state;
  state.access = { ownerId: "owner-a", workspaceId: "owner-a", role: "student", workspaces: [] };
  for (const role of ["student", "owner", "parent"] as const) {
    const raw = structuredClone(state); raw.actor = { id: "other-reader", name: "其他授权读取者", role };
    const view = projectWorkspace(raw, role);
    assert.equal(effectiveAttempt(view, original.attempts[0].id)!.correctCount, 1);
    assert.equal(view.evidenceReviews!.proposals.length, 1); assert.equal(view.evidenceReviews!.proposals[0].reason, ""); assert.deepEqual(view.evidenceReviews!.proposals[0].uploadIds, []);
    assert.ok(!JSON.stringify(view.evidenceReviews).includes("PRIVATE_"));
  }
  for (const role of ["editor", "reviewer"] as const) assert.equal(projectWorkspace(state, role).evidenceReviews, undefined);
  const pack = exportContentPackage(state, { packageId: "teaching-package", publisherId: "local-trial", createdAt: NOW, questionIds: [state.questions[0].id] });
  assert.ok(!JSON.stringify(pack).includes("PRIVATE_")); assert.ok(!JSON.stringify(pack).includes("evidenceReviews"));
});

test("strict persisted revision chains reject changed source, broken pointers, forged authority and projection fields", () => {
  const p = propose(submitted(), { answer: "wrong" }), accepted = decide(p.state, p.result!.id!).state;
  validateEvidenceReviews(accepted);
  const corruptions: ((s: WorkspaceState) => void)[] = [
    s => { s.evidence[0].answer = "overwritten raw"; },
    s => { s.evidenceReviews!.proposals[0].sourceDigest = "0".repeat(64); },
    s => { s.evidenceReviews!.proposals[0].baseDecisionId = "unknown"; },
    s => { s.evidenceReviews!.proposals[0].materials = []; },
    s => { s.evidenceReviews!.decisions[0].priorDecisionId = "unknown"; },
    s => { s.evidenceReviews!.decisions[0].authority = "teacher-verified"; },
    s => { s.evidenceReviews!.decisions[0].appliedRevision = s.revision + 1; },
    s => { s.evidenceReviews!.decisions.push(structuredClone(s.evidenceReviews!.decisions[0])); },
  ];
  for (const mutate of corruptions) { const s = structuredClone(accepted); mutate(s); assert.throws(() => validateEvidenceReviews(s), DomainError); }
});
