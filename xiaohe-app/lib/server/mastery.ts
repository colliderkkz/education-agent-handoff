import { mergedQuestions, type ApiResult, type ContentBank, type EffectiveEvidence, type Evidence, type KnowledgeId, type MasteryAssessment, type MasteryRule, type MasteryState, type Paper, type ReviewPlan, type Role, type RuleParameters, type WorkspaceState } from "../types.ts";
import { DomainError } from "./domain-error.ts";
import { historyDeletionEpoch } from "../history-deletion.ts";
import { effectiveEvidence, effectiveReviewSource, evidenceEpoch, originalEvidenceProblem } from "../effective-evidence.ts";

const DAY = 86400000;
export const DEFAULT_RULE_PARAMETERS: RuleParameters = {
  star1Correct: 1, star2Correct: 1, star3BasicCorrect: 3,
  star4ApplicationCorrect: 3, star4Contexts: 2, stableAttempts: 2,
  stableAccuracy: .8, star5TransferCorrect: 2, reviewDelayDays: 3,
  downgradeAfterAttempts: 3, stabilityWindowAttempts: 5,
};
export type MasteryContext = { now: string; newId: () => string; userId: string; role: Role; bank?: ContentBank };
const trialNote = "参数为未经过教学验证的本地试用配置，并非原文规定的数值阈值。";
const ruleLabel = (rule: MasteryRule) => rule.mode === "legacy-pilot" ? "pilot-v2-max3" : `${rule.id}/v${rule.version}`;

/** Mutates only the new optional container; migration never rewrites old scores or evidence. */
/**
 * 当前生效的星级规则标识。
 * 知识点的依据说明、题库导入时新建的知识点条目都用它 —— 规则变了，依据说明要跟着变。
 */
export function activeRuleLabel(state: WorkspaceState): string {
  const active = state.mastery?.rules.find(rule => rule.id === state.mastery?.activeRuleId);
  return active ? (active.mode === "legacy-pilot" ? "pilot-v2-max3" : `${active.id}/v${active.version}`) : "pilot-v2-max3";
}

export function ensureMastery(state: WorkspaceState, options: { now: string; newId: () => string; fresh?: boolean }): MasteryState {
  if (state.mastery) return state.mastery;
  const { now, newId, fresh = false } = options;
  const base = { revision: 1, validation: "unvalidated-trial" as const, authorId: "system-trial", createdAt: now, updatedAt: now, publishedAt: now, status: "published" as const, parameters: { ...DEFAULT_RULE_PARAMETERS } };
  const legacy: MasteryRule = { ...base, id: "legacy-pilot-v2-max3", version: 0, name: "旧版最高三星试点（历史规则）", mode: "legacy-pilot" };
  const trial: MasteryRule = { ...base, id: "local-five-star-trial-v1", version: 1, name: "内置五星试用配置（未人工复核）", mode: "five-star", parameters: { ...DEFAULT_RULE_PARAMETERS } };
  const mastery: MasteryState = { schemaVersion: 1, activeRuleId: trial.id, rules: [trial, legacy], assessments: [], reviewPlans: [], previews: [] };
  state.mastery = mastery;
  if (!fresh) for (const knowledge of state.knowledge) {
    mastery.assessments.push({ id: newId(), knowledgeId: knowledge.id, ruleId: legacy.id, ruleVersion: knowledge.ruleVersion, createdAt: now, trigger: "migration", beforeStars: knowledge.stars, afterStars: knowledge.stars,
      state: knowledge.learningState === "upcoming" ? "unlearned" : knowledge.stars === null ? "insufficient" : "assessed", adoptedEvidenceIds: [...knowledge.evidenceIds], excludedEvidence: [], gaps: ["旧证据缺少的任务类型与情境不补猜；尚未按五星规则重新评定。"], reason: `保留迁移前评定：${knowledge.reason}`, conditions: [], legacy: true });
  }
  if (fresh) for (const knowledge of state.knowledge) {
    knowledge.stars = null; knowledge.evidenceIds = []; knowledge.assessmentState = knowledge.learningState === "upcoming" ? "unlearned" : "insufficient";
    knowledge.ruleVersion = ruleLabel(trial); knowledge.reason = `尚无本机真实作答证据。${trialNote}`;
  }
  return mastery;
}

export function validateRule(rule: MasteryRule): string[] {
  const issues: string[] = [];
  if (!rule.parameters || typeof rule.parameters !== "object" || Array.isArray(rule.parameters)) return ["规则参数必须是完整的参数对象。"];
  const expectedKeys = Object.keys(DEFAULT_RULE_PARAMETERS);
  for (const key of Object.keys(rule.parameters)) if (!Object.hasOwn(DEFAULT_RULE_PARAMETERS, key)) issues.push(`未知规则参数：${key}。`);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(rule.parameters, key)) { issues.push(`缺少必要规则参数：${key}。`); continue; }
    const value = rule.parameters[key as keyof RuleParameters];
    if (typeof value !== "number" || !Number.isFinite(value)) { issues.push(`${key}须为有限数值。`); continue; }
    if (key === "stableAccuracy") { if (!Number.isFinite(value) || value < .5 || value > 1) issues.push("稳定正确率须为 0.5—1。 "); }
    else if (!Number.isInteger(value) || value < (key === "downgradeAfterAttempts" || key === "stableAttempts" ? 2 : 1) || value > (key === "reviewDelayDays" ? 365 : 30)) issues.push(`${key}须在允许的正整数范围内（稳定/降级至少两次）。`);
  }
  if (rule.parameters.star4Contexts > rule.parameters.star4ApplicationCorrect) issues.push("不同情境数不能大于应用题数。");
  if (rule.parameters.stabilityWindowAttempts < Math.max(rule.parameters.stableAttempts, rule.parameters.downgradeAfterAttempts)) issues.push("稳定观察窗口不能小于稳定或降级所需的作答次数。");
  return issues;
}

function evidenceProblem(state: WorkspaceState, entry: EffectiveEvidence): string | undefined {
  const sourceProblem = entry.masteryBlockedReason || originalEvidenceProblem(state, entry.original);
  if (sourceProblem) return sourceProblem;
  if (entry.kind === "original" || entry.provenance === "paper") return "纸面自述未核实，不计掌握等级";
  if (entry.provenance !== "online") return "旧证据缺少在线来源快照，不推测或补填";
  return undefined;
}

function reviewAvailableAtForRule(state: WorkspaceState, plan: ReviewPlan, rule: MasteryRule): string {
  const source = state.attempts.find(a => a.id === plan.sourceAttemptId && a.paperId === plan.sourcePaperId && a.status === "submitted");
  if (!source?.submittedAt || source.id.startsWith("demo-")) throw new DomainError("复查计划缺少真实提交来源", 409);
  const available = Math.max(Date.parse(plan.dueAt), Date.parse(source.submittedAt) + Math.max(plan.delayDays, rule.parameters.reviewDelayDays) * DAY);
  if (!Number.isFinite(available)) throw new DomainError("复查计划或规则的间隔时间无效", 409);
  return new Date(available).toISOString();
}

/** Pure: keep the original plan snapshot while honoring a later active-rule interval. */
export function reviewAvailableAt(state: WorkspaceState, plan: ReviewPlan): string {
  const rule = state.mastery?.rules.find(r => r.id === state.mastery?.activeRuleId);
  if (!rule) throw new DomainError("复查缺少当前评定规则", 409);
  return reviewAvailableAtForRule(state, plan, rule);
}

function planQualifies(state: WorkspaceState, entry: Evidence, rule: MasteryRule): boolean {
  if (entry.kind !== "review" || entry.taskType !== "transfer" || !entry.reviewPlanId) return false;
  const plan = state.mastery?.reviewPlans.find(p => p.id === entry.reviewPlanId);
  const paper = state.papers.find(p => p.id === entry.paperId);
  const source = state.attempts.find(a => a.id === plan?.sourceAttemptId && a.paperId === plan.sourcePaperId && a.status === "submitted");
  return Boolean(plan && source?.submittedAt && !source.id.startsWith("demo-") && effectiveReviewSource(state, plan).valid && plan.knowledgeId === entry.knowledgeId && plan.status === "completed" && plan.paperId === entry.paperId && plan.attemptId === entry.attemptId && paper?.reviewPlanId === plan.id &&
    Date.parse(paper.createdAt) >= Date.parse(reviewAvailableAtForRule(state, plan, rule)));
}

/** Pure evaluation. No source evidence, prior assessment, or question metadata is changed. */
export function evaluateMastery(state: WorkspaceState, knowledgeId: KnowledgeId, rule: MasteryRule, now: string): Omit<MasteryAssessment, "id" | "trigger" | "attemptId"> {
  const knowledge = state.knowledge.find(k => k.id === knowledgeId)!;
  const beforeStars = knowledge.stars;
  const all = effectiveEvidence(state).filter(e => e.knowledgeId === knowledgeId).slice().reverse().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const epoch = evidenceEpoch(state, knowledgeId);
  const excludedEvidence: MasteryAssessment["excludedEvidence"] = [];
  const accepted: Evidence[] = [];
  const families = new Set<string>();
  for (const entry of all) {
    let reason = entry.masteryBlockedReason || (rule.mode === "legacy-pilot" ? (entry.id.startsWith("demo-") || entry.kind === "original" || entry.eligible !== true ? "不满足旧版独立新题试点条件" : undefined) : evidenceProblem(state, entry));
    const family = entry.familyId || entry.questionId;
    if (!reason && families.has(family)) reason = "相同题族已有证据，仅计第一次真实作答";
    if (!entry.id.startsWith("demo-") && !entry.attemptId.startsWith("demo-") && entry.provenance !== "demo") families.add(family);
    if (!reason && rule.mode !== "legacy-pilot") {
      if (entry.help === "unknown") reason = "帮助情况未知";
      else if (entry.help === "independent" && entry.eligible !== true) reason = entry.reason || "不满足独立新题资格";
      else if (entry.help === "independent" && (!entry.taskType || !entry.contextId)) reason = "缺少任务类型或情境快照，不能推断基础、应用或迁移等级";
    }
    if (reason) excludedEvidence.push({ evidenceId: entry.id, reason }); else accepted.push(entry);
  }
  const p = rule.parameters;
  const independent = accepted.filter(e => e.help === "independent" && e.eligible);
  const attempts = [...new Set(independent.map(e => e.attemptId))];
  const windowAttempts = attempts.slice(-p.stabilityWindowAttempts);
  const recent = independent.filter(e => windowAttempts.includes(e.attemptId));
  const accuracy = recent.length ? recent.filter(e => e.correct).length / recent.length : 0;
  const correct = independent.filter(e => e.correct);
  const applications = correct.filter(e => e.taskType === "application");
  const conditions: MasteryAssessment["conditions"] = [];
  const condition = (key: string, label: string, actual: number, required: number) => { const result = { key, label, actual, required, met: actual >= required }; conditions.push(result); return result.met; };
  let candidate: number | null = null;
  if (rule.mode === "legacy-pilot") {
    if (accepted.length) { const ratio = accepted.filter(e => e.correct).length / accepted.length; candidate = ratio < .6 ? 1 : accepted.length < 3 || ratio < .75 ? 2 : 3; }
    condition("legacy", "旧版独立新题数量", accepted.length, 1);
  } else {
    const one = condition("explanation", "讲解后真正答对的不同题族", accepted.filter(e => e.correct && e.help === "explanation").length, p.star1Correct);
    const two = condition("hint", "提示后真正答对的不同题族", accepted.filter(e => e.correct && e.help === "hint").length, p.star2Correct);
    const three = condition("basic", "基础任务独立新题答对数", correct.filter(e => e.taskType === "basic").length, p.star3BasicCorrect);
    const application = condition("application", "应用任务独立新题答对数", applications.length, p.star4ApplicationCorrect);
    const contexts = condition("contexts", "答对应用任务的不同标注情境", new Set(applications.map(e => e.contextId)).size, p.star4Contexts);
    const stable = condition("attempts", "独立新题的不同作答次数", windowAttempts.length, p.stableAttempts);
    const rate = condition("accuracy", "最近观察窗口的独立正确率", accuracy, p.stableAccuracy);
    const transfer = condition("transfer", "来自到期计划的独立迁移新题答对数", correct.filter(e => planQualifies(state, e, rule)).length, p.star5TransferCorrect);
    candidate = three && application && contexts && stable && rate && transfer ? 5 : three && application && contexts && stable && rate ? 4 : three ? 3 : two ? 2 : one ? 1 : null;
  }
  let held = false;
  const previousAssessment = state.mastery?.assessments.filter(a => a.knowledgeId === knowledgeId).at(-1);
  const sameRuleAssessment = previousAssessment?.ruleId === rule.id && !previousAssessment.legacy && previousAssessment.trigger !== "migration";
  const sameEvidenceEpoch = (previousAssessment?.evidenceEpoch ?? 0) === epoch;
  // A drop consumes fresh failed attempts after the last actual level change. Re-evaluation
  // cannot repeatedly use the same failures to lower a learner several times.
  if (rule.mode === "five-star" && beforeStars !== null && sameRuleAssessment && sameEvidenceEpoch) {
    const changes = state.mastery?.assessments.filter(a => a.knowledgeId === knowledgeId && a.ruleId === rule.id && (a.evidenceEpoch ?? 0) === epoch && (a.beforeStars !== a.afterStars || (a.trigger === "evidence-correction" || a.trigger === "history-deletion"))) || [];
    const lastChange = changes[changes.length - 1];
    const consumed = new Set(lastChange?.adoptedEvidenceIds || []);
    const fresh = independent.filter(e => !consumed.has(e.id));
    const ids = [...new Set(fresh.map(e => e.attemptId))];
    let failed = 0;
    for (const attemptId of ids.slice().reverse()) {
      const answers = fresh.filter(e => e.attemptId === attemptId);
      if (!answers.length || answers.filter(e => e.correct).length / answers.length >= p.stableAccuracy) break;
      failed++;
    }
    if (failed >= p.downgradeAfterAttempts) candidate = Math.max(1, beforeStars - 1);
    else if ((candidate ?? 0) < beforeStars) { candidate = beforeStars; held = true; }
    // Historical successes that preceded a downgrade cannot immediately restore the
    // old level on a second click. A new stable independent run must support recovery.
    const lastWasDrop = lastChange && lastChange.trigger !== "evidence-correction" && lastChange.trigger !== "history-deletion" && lastChange.beforeStars !== null && (lastChange.afterStars ?? 0) < lastChange.beforeStars;
    const freshAccuracy = fresh.length ? fresh.filter(e => e.correct).length / fresh.length : 0;
    if (lastWasDrop && (candidate ?? 0) > beforeStars && (ids.length < p.stableAttempts || freshAccuracy < p.stableAccuracy)) { candidate = beforeStars; held = true; }
    condition("downgrade", "降级所需的新增连续不稳定作答（重复重评不重复消费）", failed, p.downgradeAfterAttempts);
  }
  const unlearned = knowledge.learningState === "upcoming";
  const afterStars = unlearned ? null : candidate;
  const gaps = conditions.filter(c => !c.met && c.key !== "downgrade" && !(c.key === "explanation" && (afterStars ?? 0) > 1) && !(c.key === "hint" && (afterStars ?? 0) > 2)).map(c => `${c.label}：${c.actual} / ${c.required}`);
  const reason = `${unlearned ? "尚未学习，暂不评定" : afterStars === null ? "证据尚不足以确认任何等级" : `本次评为 ${afterStars} 星`}${held ? "；新增稳定性证据不足，保留已有等级，不因单次错误骤降" : ""}${previousAssessment && !sameRuleAssessment ? "；这是跨规则重新评定，按新条件评估，旧版结果保留在历史中" : ""}${!sameEvidenceEpoch ? historyDeletionEpoch(state, knowledgeId) === epoch ? "；学习历史删除后重建依据，不用单次错误保护保留已失去依据的等级" : "；证据更正后重建依据，不用单次错误保护保留已失去依据的等级" : ""}。采用 ${accepted.length} 条、排除 ${excludedEvidence.length} 条证据。${trialNote}`;
  return { knowledgeId, ruleId: rule.id, ruleVersion: ruleLabel(rule), createdAt: now, beforeStars, afterStars, state: unlearned ? "unlearned" : afterStars === null ? "insufficient" : "assessed", adoptedEvidenceIds: accepted.map(e => e.id), excludedEvidence, gaps, conditions, reason, legacy: rule.mode === "legacy-pilot", evidenceEpoch: epoch, evidenceAsOfRevision: state.revision };
}

export function assessKnowledge(state: WorkspaceState, context: MasteryContext, trigger: MasteryAssessment["trigger"], knowledgeIds?: Set<KnowledgeId>, attemptId?: string): string[] {
  const mastery = ensureMastery(state, context);
  const rule = mastery.rules.find(r => r.id === mastery.activeRuleId)!;
  const ids: string[] = [];
  for (const knowledge of state.knowledge) {
    if (knowledgeIds && !knowledgeIds.has(knowledge.id)) continue;
    const assessment: MasteryAssessment = { ...evaluateMastery(state, knowledge.id, rule, context.now), evidenceAsOfRevision: state.revision + ((trigger === "evidence-correction" || trigger === "history-deletion") ? 0 : 1), id: context.newId(), trigger, ...(attemptId ? { attemptId } : {}) };
    mastery.assessments.push(assessment); ids.push(assessment.id);
    knowledge.stars = assessment.afterStars; knowledge.ruleVersion = assessment.ruleVersion; knowledge.reason = assessment.reason;
    knowledge.evidenceIds = [...assessment.adoptedEvidenceIds]; knowledge.assessmentId = assessment.id; knowledge.assessmentState = assessment.state;
  }
  return ids;
}

/** Append newly needed plans; existing plans and issued review papers remain frozen. */
export function reconcileEvidenceReviewPlans(state: WorkspaceState, context: MasteryContext): void {
  const mastery = ensureMastery(state, context), rule = mastery.rules.find(r => r.id === mastery.activeRuleId)!;
  const entries = effectiveEvidence(state);
  for (const attempt of state.attempts.filter(a => a.status === "submitted")) {
    const paper = state.papers.find(p => p.id === attempt.paperId);
    if (!paper || paper.kind === "review" || !attempt.submittedAt || attempt.id.startsWith("demo-")) continue;
    const knowledgeIds = new Set(entries.filter(e => e.attemptId === attempt.id && e.valid && !originalEvidenceProblem(state, e.original)).map(e => e.knowledgeId));
    for (const knowledgeId of knowledgeIds) {
      if (mastery.reviewPlans.some(p => p.sourceAttemptId === attempt.id && p.knowledgeId === knowledgeId)) continue;
      mastery.reviewPlans.push({ id: context.newId(), sourceAttemptId: attempt.id, sourcePaperId: paper.id, knowledgeId, sourceRevision: state.revision, createdAt: context.now,
        dueAt: new Date(Date.parse(attempt.submittedAt) + rule.parameters.reviewDelayDays * DAY).toISOString(), delayDays: rule.parameters.reviewDelayDays, ruleId: rule.id, status: "scheduled", reason: "证据更正后按有效知识点补充复查计划；间隔仍从原提交时间计算，计划本身不表示教师已核实或具备升星资格。" });
    }
  }
}

export function finishMasterySubmission(state: WorkspaceState, paper: Paper, attemptId: string, context: MasteryContext): void {
  const mastery = ensureMastery(state, context);
  const rule = mastery.rules.find(r => r.id === mastery.activeRuleId)!;
  if (paper.kind === "review") {
    const plan = mastery.reviewPlans.find(p => p.id === paper.reviewPlanId && p.paperId === paper.id);
    if (!plan && paper.reviewPlanId) throw new DomainError("复查卷来源计划关系不一致，不能提交", 409);
    // Old persisted review drafts remain finishable, but without a plan snapshot they
    // cannot satisfy the new spaced-transfer requirement and no plan is invented.
    if (plan) { plan.status = "completed"; plan.attemptId = attemptId; plan.completedAt = context.now; }
  } else for (const knowledgeId of new Set(paper.questions.map(q => q.knowledgeId))) {
    if (mastery.reviewPlans.some(p => p.sourceAttemptId === attemptId && p.knowledgeId === knowledgeId)) continue;
    mastery.reviewPlans.push({ id: context.newId(), sourceAttemptId: attemptId, sourcePaperId: paper.id, knowledgeId, createdAt: context.now, dueAt: new Date(Date.parse(context.now) + rule.parameters.reviewDelayDays * DAY).toISOString(), delayDays: rule.parameters.reviewDelayDays, ruleId: rule.id, status: "scheduled", reason: "来自一次真实学习提交（可包含帮助或纸面核对）；到期安排新题复查不等于已有升星资格。" });
  }
  // A paper claim is never allowed to change the current verified level.
  if (state.evidence.some(e => e.attemptId === attemptId && e.provenance === "paper")) return;
  assessKnowledge(state, context, "submission", new Set(paper.questions.map(q => q.knowledgeId)), attemptId);
}

/** All historical paper families count as seen; a fourteen-day window is not used here. */
export function allSeenFamilies(state: WorkspaceState): Set<string> {
  const seen = new Set(state.papers.flatMap(p => p.questions.map(q => q.familyId)));
  for (const e of state.evidence) seen.add(e.familyId || e.questionId);
  for (const fact of state.historyDeletion?.qualificationFacts ?? []) seen.add(fact.familyId);
  for (const event of state.events) if (event.action === "learning.exposure") {
    try { const detail = JSON.parse(event.detail); if (Array.isArray(detail.familyIds)) for (const family of detail.familyIds) if (typeof family === "string") seen.add(family); } catch { /* legacy text has no machine-readable identity */ }
  }
  return seen;
}

export function startReview(state: WorkspaceState, planId: unknown, countValue: unknown, context: MasteryContext): Paper {
  const mastery = ensureMastery(state, context);
  const plan = mastery.reviewPlans.find(p => p.id === planId);
  if (!plan) throw new DomainError("请选择已有复查计划；演示历史不能伪造复查来源。", 404);
  if (plan.paperId) { const paper = state.papers.find(p => p.id === plan.paperId && p.reviewPlanId === plan.id); if (!paper) throw new DomainError("复查计划与原卷关系损坏", 409); return paper; }
  const source = effectiveReviewSource(state, plan);
  if (!source.valid) throw new DomainError(source.reason, 409);
  const availableAt = reviewAvailableAt(state, plan);
  if (Date.parse(context.now) < Date.parse(availableAt)) throw new DomainError(`复查尚未到期，请在 ${availableAt} 后进行。`, 409);
  if (state.knowledge.find(k => k.id === plan.knowledgeId)?.learningState !== "current") throw new DomainError("该知识点尚未学习，暂不开始复查");
  const count = countValue === undefined ? 2 : countValue;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 20) throw new DomainError("复查题量须为 1—20 题");
  const seen = allSeenFamilies(state), families = new Set<string>();
  const questions = mergedQuestions(state, context.bank).filter(q => q.knowledgeId === plan.knowledgeId && q.status === "published" && q.reviewerId && q.reviewerId !== q.authorId && q.taskType === "transfer" && q.contextId && !seen.has(q.familyId)).filter(q => { if (families.has(q.familyId)) return false; families.add(q.familyId); return true; });
  if (questions.length < count) throw new DomainError(`迁移新题不足：排除全部历史已见、已做和曝光题族后，只有 ${questions.length} 道，当前需要 ${count} 道。请减少题量或扩充已审核迁移题库。`, 409);
  const selected = structuredClone(questions.slice(0, count));
  const paper: Paper = { id: context.newId(), title: "间隔迁移新题复查", version: 1, createdAt: context.now, questionIds: selected.map(q => q.id), questions: selected, status: "ready", kind: "review", reviewPlanId: plan.id, reason: `源自 ${plan.sourcePaperId}，按原计划与当前规则，最早可于 ${availableAt} 开始；仅选全历史未见的已标注迁移新题。`, estimatedMinutes: count * 3 };
  state.papers.unshift(paper); plan.paperId = paper.id; plan.status = "started";
  return paper;
}

const text = (value: unknown, label: string, max = 300) => { if (typeof value !== "string" || !value.trim() || value.length > max) throw new DomainError(`${label}格式不正确`); return value.trim(); };
/** Rule drafts never alter knowledge. Publication/switch requires a latest owner preview. */
export function masteryAction(state: WorkspaceState, action: string, input: Record<string, unknown>, context: MasteryContext): NonNullable<ApiResult["result"]> {
  const m = ensureMastery(state, context);
  if (action === "mastery.reevaluate") {
    if (input.knowledgeId !== undefined && !state.knowledge.some(k => k.id === input.knowledgeId)) throw new DomainError("知识点不存在");
    return { assessmentIds: assessKnowledge(state, context, "reevaluate", input.knowledgeId ? new Set([input.knowledgeId as KnowledgeId]) : undefined), message: "已按当前规则记录新评定，原始作答与历次评定保持不变。" };
  }
  if (action === "rule.create") {
    const base = input.baseRuleId ? m.rules.find(r => r.id === input.baseRuleId) : m.rules.find(r => r.id === m.activeRuleId);
    if (!base) throw new DomainError("来源规则不存在", 404);
    const rule: MasteryRule = { id: context.newId(), version: Math.max(...m.rules.map(r => r.version)) + 1, revision: 1, name: text(input.name, "规则名称", 100), mode: "five-star", status: "draft", validation: "unvalidated-trial", authorId: context.userId, createdAt: context.now, updatedAt: context.now, parameters: { ...base.parameters } };
    m.rules.push(rule); return { id: rule.id, message: "已建立规则草稿，当前评定未改变。" };
  }
  const rule = m.rules.find(r => r.id === input.id);
  if (!rule) throw new DomainError("规则版本不存在", 404);
  const expected = () => { if (input.expectedRevision !== rule.revision) throw new DomainError("规则已变化，请重读后核对，当前输入不应被覆盖。", 409); };
  const valid = () => { const issues = validateRule(rule); if (issues.length) throw new DomainError(issues.join(" ")); };
  if (action === "rule.update") {
    expected(); if (rule.status !== "draft") throw new DomainError("仅草稿可以修改；请从旧版新建版本。", 409);
    if (context.role !== "owner" && rule.authorId !== context.userId) throw new DomainError("只能编辑自己建立的规则草稿", 403);
    if (input.name !== undefined) rule.name = text(input.name, "规则名称", 100);
    if (!input.parameters || typeof input.parameters !== "object" || Array.isArray(input.parameters)) throw new DomainError("请提供规则参数");
    for (const [key, value] of Object.entries(input.parameters)) {
      if (!Object.hasOwn(DEFAULT_RULE_PARAMETERS, key) || typeof value !== "number" || !Number.isFinite(value)) throw new DomainError("规则参数名称或数值无效");
      rule.parameters[key as keyof RuleParameters] = value;
    }
    rule.authorId = context.userId; delete rule.reviewerId; delete rule.reviewNote;
    rule.revision++; rule.updatedAt = context.now; return { id: rule.id, issues: validateRule(rule), message: "规则草稿已保存，尚未影响成绩。" };
  }
  if (action === "rule.preview") {
    const learnerVisible = context.role === "owner";
    const preview = { id: context.newId(), ruleId: rule.id, ruleRevision: rule.revision, sourceRevision: state.revision + 1, createdAt: context.now, actorId: context.userId, learnerVisible, issues: validateRule(rule), changes: learnerVisible ? state.knowledge.map(k => { const a = evaluateMastery(state, k.id, rule, context.now); return { knowledgeId: k.id, beforeStars: a.beforeStars, afterStars: a.afterStars, reason: a.reason }; }) : [] };
    m.previews.push(preview); return { id: preview.id, preview, message: learnerVisible ? "试算完成；发布或切换前请核对差异，当前评定尚未改变。" : "仅返回规则校验，不包含学生成绩或差异。" };
  }
  if (action === "rule.submit") {
    expected(); valid(); if (rule.status !== "draft") throw new DomainError("仅草稿可送审", 409);
    if (context.role !== "owner" && rule.authorId !== context.userId) throw new DomainError("只能提交自己的规则", 403);
    rule.status = "review";
  } else if (action === "rule.review") {
    expected(); valid(); if (rule.status !== "review" || rule.authorId === context.userId) throw new DomainError("需由非作者独立审核待审规则", 409);
    if (input.decision !== "approve" && input.decision !== "reject") throw new DomainError("审核结论无效");
    rule.reviewNote = text(input.note, "审核意见", 2000); rule.reviewerId = context.userId; rule.status = input.decision === "approve" ? "approved" : "draft";
  } else if (action === "rule.publish" || action === "rule.activate") {
    valid(); if (context.role !== "owner") throw new DomainError("只有档案所有者可以应用规则", 403);
    if (action === "rule.publish" && (rule.status !== "approved" || !rule.reviewerId || rule.reviewerId === rule.authorId)) throw new DomainError("发布前需要独立审核通过", 409);
    if (action === "rule.activate" && rule.status !== "published") throw new DomainError("只能切换到已发布版本", 409);
    const preview = m.previews.find(p => p.id === input.previewId && p.ruleId === rule.id && p.ruleRevision === rule.revision && p.learnerVisible && p.actorId === context.userId && p.sourceRevision === state.revision);
    if (!preview || preview.issues.length) throw new DomainError("请重新试算当前版本，核对最新差异后再应用。", 409);
    rule.status = "published"; rule.publishedAt ??= context.now; m.activeRuleId = rule.id;
    const assessmentIds = assessKnowledge(state, context, "rule-switch");
    // Activating a published version does not mutate its immutable parameter revision.
    return { id: rule.id, assessmentIds, message: "规则版本已应用并记录新的评定历史；旧评定与原始作答未改写。教学有效性仍未验证。" };
  } else if (action === "rule.disable") {
    if (context.role !== "owner" || rule.id === m.activeRuleId) throw new DomainError("请先切换到其他已发布版本，再停用此规则。", 409);
    if (rule.status !== "published") throw new DomainError("只能停用已发布规则", 409);
    rule.status = "disabled";
  } else throw new DomainError("不支持的规则操作");
  rule.revision++; rule.updatedAt = context.now;
  return { id: rule.id, message: `规则状态已更新为 ${rule.status}；${trialNote}` };
}
