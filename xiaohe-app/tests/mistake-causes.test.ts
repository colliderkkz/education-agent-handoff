import assert from "node:assert/strict";
import test from "node:test";
import { applyAction, DomainError } from "../lib/server/domain.ts";
import { createSeedWorkspace } from "../lib/seed.ts";
import { mistakeCauses, mistakeCauseIds, practiceScopeForCause, unitKeyOf } from "../lib/mistake-causes.ts";
import { effectiveMistakes } from "../lib/effective-evidence.ts";
import type { WorkspaceState, Paper } from "../lib/types";

const now = "2026-10-26T08:00:00.000Z";
let sequence = 0;
const context = { userId: "account-a", displayName: "学习者", now, newId: () => `cause-${++sequence}` };
function seed() { return createSeedWorkspace(context.userId, context.displayName, now); }
function act(state: WorkspaceState, action: string, input: Record<string, unknown> = {}) { return applyAction(state, { action, ...input }, { ...context, now }); }
function create(state = seed(), count = 3, knowledgeIds: string[] = ["division"]) {
  const result = act(state, "paper.create", { count, knowledgeIds, difficulty: "不限", kind: "practice" });
  return { state: result.state, paper: result.state.papers.find(p => p.id === result.result?.id)! };
}
function wrongAnswers(paper: Paper) { return paper.questions.map(q => ({ questionId: q.id, value: "0" })); }

test("错因只有五种，全部有可解释的说明", () => {
  assert.deepEqual(mistakeCauses.map(item => item.id), ["concept", "calculation", "reading", "step", "formula"]);
  assert.deepEqual(mistakeCauseIds, mistakeCauses.map(item => item.id));
  for (const cause of mistakeCauses) assert.ok(cause.label.length > 0 && cause.hint.length > 0, cause.id);
});

test("标错因只接受已知标签，并写进错题记录", () => {
  const first = create();
  const wrong = act(first.state, "attempt.submit", { paperId: first.paper.id, answers: wrongAnswers(first.paper) });
  const mistake = wrong.state.mistakes.find(m => m.question.id === first.paper.questionIds[0])!;
  const tagged = act(wrong.state, "mistake.tag", { id: mistake.id, cause: "concept", note: "半径的定义记混了" });
  const record = tagged.state.mistakes.find(m => m.id === mistake.id)!;
  assert.equal(record.cause, "concept");
  assert.equal(record.causeNote, "半径的定义记混了");
  // 有效错题视图里也能读到错因。
  assert.equal(effectiveMistakes(tagged.state).find(m => m.id === mistake.id)?.cause, "concept");
  // 未知标签被拒。
  assert.throws(() => act(wrong.state, "mistake.tag", { id: mistake.id, cause: "unknown-reason" }),
    (error: unknown) => error instanceof DomainError && error.message.includes("错因标签无效"));
  // 不存在的错题被拒。
  assert.throws(() => act(wrong.state, "mistake.tag", { id: "not-a-mistake", cause: "concept" }),
    (error: unknown) => error instanceof DomainError && error.status === 404);
});

test("按错因组卷的范围会带上同单元的知识点 —— 否则 14 天内换不到新题", () => {
  const knowledge = [
    { id: "math-j-3-circle", learningState: "current" },
    { id: "math-j-3-triangle", learningState: "current" },
    { id: "math-j-3-parallel", learningState: "upcoming" },
    { id: "math-j-1-real", learningState: "current" },
  ] as never;
  const mistakes = [
    { knowledgeId: "math-j-3-circle", cause: "concept" as const },
    { knowledgeId: "math-j-3-circle", cause: "concept" as const },
  ] as never;
  const scope = practiceScopeForCause(mistakes, knowledge, "concept");
  // 同单元已解锁的知识点一起带上；未解锁的不带；其他单元不带。
  assert.deepEqual(scope.knowledgeIds, ["math-j-3-circle", "math-j-3-triangle"]);
  assert.equal(scope.count, 3);
  assert.deepEqual(unitKeyOf("math-j-3-circle"), "math-j-3");
  // 没有这一类错题时不组卷。
  assert.deepEqual(practiceScopeForCause(mistakes, knowledge, "calculation"), { knowledgeIds: [], count: 0 });
});

test("学生本人可以标错因（不是只有工作区主人能标）", () => {
  const first = create();
  const wrong = act(first.state, "attempt.submit", { paperId: first.paper.id, answers: wrongAnswers(first.paper) });
  const mistake = wrong.state.mistakes.find(m => m.question.id === first.paper.questionIds[0])!;
  const asStudent = { ...wrong.state, actor: { ...wrong.state.actor, role: "student" as const } };
  const tagged = applyAction(asStudent, { action: "mistake.tag", id: mistake.id, cause: "step" }, { ...context, now, role: "student" });
  assert.equal(tagged.state.mistakes.find(m => m.id === mistake.id)?.cause, "step");
});

test("只拿错题本身的知识点组卷会遇到「题库不足」—— 这正是要带上同单元知识点的原因", () => {
  // 把这个知识点的题族先用完（同一题族 14 天内不重复出题）。
  let state = seed();
  let exhausted = false;
  for (let round = 0; round < 8 && !exhausted; round++) {
    try { state = act(state, "paper.create", { count: 3, knowledgeIds: ["division"], difficulty: "不限", kind: "practice" }).state; }
    catch (error) { exhausted = error instanceof DomainError && error.message.includes("题库不足"); }
  }
  assert.ok(exhausted, "题族用完后应当明确报题库不足");
  // 错因组卷的范围只含这个知识点 —— 所以它出不来卷，界面要给出原因而不是空白。
  const scope = practiceScopeForCause([{ knowledgeId: "division" as never, cause: "calculation" }], state.knowledge, "calculation");
  assert.deepEqual(scope.knowledgeIds, ["division"]);
  assert.throws(() => act(state, "paper.create", { count: scope.count, knowledgeIds: scope.knowledgeIds, difficulty: "不限", kind: "practice" }),
    (error: unknown) => error instanceof DomainError && error.message.includes("题库不足"));
});
