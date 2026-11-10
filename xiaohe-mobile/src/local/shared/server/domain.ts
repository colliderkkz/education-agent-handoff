// Generated from xiaohe-app/lib/server/domain.ts; SHA-256: f11375a8809237558d3cdcbc7864464973de70067fe825af37300e436e90e912
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import { cloneData as structuredClone } from '../../clone.ts';
import { allKnowledgeIds, mergedQuestions, stageOfKnowledge, subjectIds, subjectNames, subjectOfKnowledge, type ApiResult, type Attempt, type ContentBank, type Evidence, type HelpLevel, type KnowledgeId, type Paper, type PaperReturn, type PaperReturnEntry, type Question, type Role, type StageId, type SubjectId, type WorkspaceState } from "../types.ts";

import { DomainError } from "./domain-error.ts";
import { assertActionAllowed } from "./access-policy.ts";
import { activeRuleLabel, ensureMastery, finishMasterySubmission, masteryAction, startReview } from "./mastery.ts";
import { paperTemplates, templateMix } from "../exam-references.ts";
import { mistakeCauseIds, type MistakeCause } from "../mistake-causes.ts";
import { ensureContent, exportContentPackage, recordQuestionVersion, rollbackContentBatch } from "./content.ts";
import { companionAction, createCompanionHelpRequest } from "./companion.ts";
import { assertHistoryWriteAllowed, historyAction } from "./history.ts";
import { evidenceAction } from "./evidence.ts";
import { effectiveMistakes } from "../effective-evidence.ts";
import { gradeAnswer } from "../grading.ts";
import { recognitionAction } from "./recognition.ts";
import { historyFileIdentity } from "../history-deletion.ts";
export { DomainError } from "./domain-error.ts";
export { gradeAnswer } from "../grading.ts";
type Input = Record<string, unknown>;
type Context = { userId: string; displayName: string; role?: Role; now?: string; newId?: () => string; channel?: "local"; bank?: ContentBank };
/** 知识点白名单：57 个教材目录知识点 + 3 个 legacy 演示知识点。 */
const knowledgeIds: readonly string[] = allKnowledgeIds;
const helpRank: Record<HelpLevel, number> = { independent: 0, hint: 1, explanation: 2, unknown: 3 };
const DAY = 86400000;
const RULE = "pilot-v2-max3";

function object(value: unknown, label = "数据"): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError(`${label}格式不正确`);
  return value as Input;
}
function string(value: unknown, label: string, max = 2000, optional = false): string {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) throw new DomainError(`${label}不能为空且不能超过 ${max} 个字符`);
  return value.trim();
}
function id(value: unknown): string { return string(value, "记录 ID", 150); }
function findPaper(state: WorkspaceState, value: unknown): Paper {
  const paper = state.papers.find(p => p.id === id(value));
  if (!paper) throw new DomainError("试卷不存在或不属于当前账号", 404);
  return paper;
}
function findQuestion(state: WorkspaceState, value: unknown): Question {
  const q = state.questions.find(q => q.id === id(value));
  if (!q) throw new DomainError("题目不存在或不属于当前工作区", 404);
  return q;
}

export function recomputeKnowledge(state: WorkspaceState, affectedKnowledgeIds?: Set<KnowledgeId>): void {
  for (const knowledge of state.knowledge) {
    if (affectedKnowledgeIds && !affectedKnowledgeIds.has(knowledge.id)) continue;
    // A later replay, copied record or new version from an old family cannot
    // make repeated practice count as more independent demonstrations.
    const firstByFamily = new Map<string, Evidence>();
    for (const entry of state.evidence.filter(e => e.knowledgeId === knowledge.id && e.eligible === true).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
      const family = entry.familyId || entry.questionId;
      if (!firstByFamily.has(family)) firstByFamily.set(family, entry);
    }
    const evidence = [...firstByFamily.values()];
    knowledge.evidenceIds = evidence.map(e => e.id);
    knowledge.ruleVersion = RULE;
    if (!evidence.length) { knowledge.stars = null; knowledge.reason = "尚无真实独立新题证据。演示、提示、讲解和订正不增加星级。首版试点最高评为 3 星，4—5 星暂不评定。"; continue; }
    const correct = evidence.filter(e => e.correct).length;
    const ratio = correct / evidence.length;
    const days = new Set(evidence.map(e => new Date(Date.parse(e.createdAt) + 8 * 3600000).toISOString().slice(0, 10))).size;
    const reviewed = evidence.some(e => e.kind === "review" && e.correct);
    knowledge.stars = ratio < .6 ? 1 : evidence.length < 3 || ratio < .75 ? 2 : 3;
    knowledge.reason = `${evidence.length} 道不同题族的独立新题，答对 ${correct} 道；覆盖 ${days} 个北京时间自然日${reviewed ? "，包含间隔复查" : "，待间隔复查"}。首版试点最高评为 3 星，4—5 星暂不评定；同一题族只计首次独立新题，提示、讲解与订正不加星。规则 ${RULE}，教学有效性待教研验证。`;
  }
}

function reviewedBank(state: WorkspaceState, bank?: ContentBank): Question[] {
  return mergedQuestions(state, bank).filter(q => q.status === "published" && q.reviewerId && q.reviewerId !== q.authorId);
}
function exposedFamilies(state: WorkspaceState): Set<string> {
  const families = new Set<string>((state.historyDeletion?.qualificationFacts ?? []).filter(f => f.help === "hint" || f.help === "explanation").map(f => f.familyId));
  for (const event of state.events.filter(e => e.action === "learning.exposure")) {
    try {
      const record = JSON.parse(event.detail) as { familyIds?: string[] };
      for (const family of record.familyIds || []) families.add(family);
    } catch { /* Old human-readable audit events do not establish exposure. */ }
  }
  return families;
}
function recordExposure(state: WorkspaceState, familyIds: string[], level: "hint" | "explanation", userId: string, now: string, newId: () => string): void {
  const activeRule = state.mastery?.rules.find(rule => rule.id === state.mastery?.activeRuleId);
  const ruleVersion = activeRule?.mode === "five-star" ? `${activeRule.id}/v${activeRule.version}` : RULE;
  state.events.unshift({ id: newId(), action: "learning.exposure", label: level === "hint" ? "记录题族提示曝光" : "记录题族答案曝光", actorId: userId, createdAt: now, detail: JSON.stringify({ familyIds: [...new Set(familyIds)], level, ruleVersion }) });
}
function unavailableFamilies(state: WorkspaceState, now: string): Set<string> {
  // A different database ID or edited version does not make an exposed/recent family new.
  const unavailable = exposedFamilies(state);
  for (const paper of state.papers.filter(p => Date.parse(now) - Date.parse(p.createdAt) < 14 * DAY)) {
    for (const question of paper.questions) unavailable.add(question.familyId);
  }
  return unavailable;
}
function markActiveFamilyHelp(state: WorkspaceState, familyIds: string[], level: "hint" | "explanation", now: string, newId: () => string): void {
  const families = new Set(familyIds);
  for (const paper of state.papers.filter(p => p.status !== "completed" && p.questions.some(q => families.has(q.familyId)))) {
    const attempt = ensureAttempt(state, paper, now, newId);
    if (attempt.status === "submitted") continue;
    for (const answer of attempt.answers) {
      if (paper.questions.some(q => q.id === answer.questionId && families.has(q.familyId)) && helpRank[answer.help] < helpRank[level]) answer.help = level;
    }
  }
}
/**
 * 已解锁学科。
 * 优先用显式声明的 subjects；否则按「已解锁知识点的学科」推导 —— 而不是档案主科字符串，
 * 否则在课程地图里解锁了语文单元后，组语文卷仍会被学科门禁拦下。
 * 存量档案（只有 legacy 数学知识点）推导结果仍是数学，行为不变。
 */
function unlockedSubjects(state: WorkspaceState): SubjectId[] {
  const declared = state.profile.subjects;
  if (Array.isArray(declared) && declared.length) return declared.filter(id => subjectIds.includes(id as SubjectId)) as SubjectId[];
  const unlocked = new Set<SubjectId>();
  for (const knowledge of state.knowledge) {
    if (knowledge.learningState !== "current") continue;
    const subject = subjectOfKnowledge(knowledge.id);
    if (subject) unlocked.add(subject);
  }
  return unlocked.size ? [...unlocked] : ["math"];
}
/**
 * 组卷门禁：按知识点所属学科与学段校验，而不是按档案主科字符串。
 * 一张试卷只能包含同一学科、同一学段的知识点 —— 单位语义、报告分组与判分表都是学科内的，
 * 小学与初高中的考查深度也不能混在一张卷子里。
 */
function validateCourse(state: WorkspaceState, selected: readonly KnowledgeId[]): void {
  const unlocked = unlockedSubjects(state);
  const subjects = new Set<SubjectId>();
  const stages = new Set<StageId>();
  for (const id of selected) {
    const subject = subjectOfKnowledge(id);
    if (!subject) throw new DomainError("知识点不在当前课程范围内");
    if (!unlocked.includes(subject)) throw new DomainError(`${subjectNames[subject]}尚未加入当前学习范围，请在课程地图中开始学习后再组卷。`);
    subjects.add(subject);
    stages.add(stageOfKnowledge(id));
  }
  if (subjects.size > 1) throw new DomainError("一张试卷只能包含同一学科的知识点，请按学科分别组卷。");
  if (stages.size > 1) throw new DomainError("一张试卷只能包含同一学段的知识点，请按学段分别组卷。");
}
function ensureAttempt(state: WorkspaceState, paper: Paper, now: string, newId: () => string): Attempt {
  const existing = state.attempts.find(a => a.paperId === paper.id);
  if (existing) return existing;
  const attempt: Attempt = { id: newId(), paperId: paper.id, status: "draft", startedAt: now, independentCount: 0, correctCount: 0, answers: paper.questions.map(q => ({ questionId: q.id, value: "", working: "", help: "independent", correct: null })) };
  state.attempts.unshift(attempt);
  paper.status = "in_progress";
  return attempt;
}
function mergeAnswers(attempt: Attempt, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 30) throw new DomainError("作答列表格式不正确");
  const seen = new Set<string>();
  for (const raw of value) {
    const incoming = object(raw, "作答");
    const questionId = id(incoming.questionId);
    if (seen.has(questionId)) throw new DomainError("同一道题不能重复提交");
    seen.add(questionId);
    const answer = attempt.answers.find(a => a.questionId === questionId);
    if (!answer) throw new DomainError("作答包含不属于本试卷的题目");
    answer.value = string(incoming.value ?? incoming.answer, "答案", 300, true);
    answer.working = string(incoming.working, "解题过程", 3000, true);
    // Incoming help, correct, totals, stars and timestamps are never trusted.
  }
}
function submitAttempt(state: WorkspaceState, paper: Paper, attempt: Attempt, now: string, newId: () => string, original = false): void {
  const priorFamilies = new Set(state.evidence.filter(e => !e.id.startsWith("demo-")).map(e => e.familyId || e.questionId));
  for (const fact of state.historyDeletion?.qualificationFacts ?? []) priorFamilies.add(fact.familyId);
  // Issued older papers have already shown these prompts, even if never submitted.
  // New versions and a long pause cannot turn their repeated families into new evidence.
  const paperIndex = state.papers.findIndex(p => p.id === paper.id);
  for (const older of state.papers.slice(paperIndex + 1)) if (!older.id.startsWith("demo-")) for (const question of older.questions) priorFamilies.add(question.familyId);
  const exposed = exposedFamilies(state);
  const evidence: Evidence[] = [];
  for (const answer of attempt.answers) {
    const q = paper.questions.find(q => q.id === answer.questionId)!;
    answer.correct = gradeAnswer(answer.value, q);
    const eligible = !original && answer.help === "independent" && !priorFamilies.has(q.familyId) && !exposed.has(q.familyId) && state.knowledge.some(k => k.id === q.knowledgeId && k.learningState === "current");
    const reason = original ? "纸面录入的独立完成程度无法由系统验证，不计星级" : answer.help !== "independent" ? "使用过帮助，不计独立证据" : exposed.has(q.familyId) ? "此前看过该题族提示或讲解，仅作巩固记录" : priorFamilies.has(q.familyId) ? "已出现的题族，仅作巩固记录" : "当前课程范围内的独立新题证据";
    const entry: Evidence = { id: newId(), knowledgeId: q.knowledgeId, questionId: q.id, questionVersion: q.version, attemptId: attempt.id, paperId: paper.id, questionText: q.text, answer: answer.value, expected: q.answer, help: answer.help, correct: answer.correct, createdAt: now, kind: original ? "original" : paper.kind === "review" ? "review" : "practice", familyId: q.familyId, eligible, reason,
      provenance: original ? "paper" : "online", ...(q.taskType ? { taskType: q.taskType } : {}), ...(q.contextId ? { contextId: q.contextId } : {}), ...(paper.reviewPlanId ? { reviewPlanId: paper.reviewPlanId } : {}) };
    evidence.push(entry);
    priorFamilies.add(q.familyId);
    if (!answer.correct) state.mistakes.unshift({ id: newId(), question: structuredClone(q), originalAnswer: answer.value, evidenceId: entry.id });
  }
  state.evidence.unshift(...evidence);
  attempt.status = "submitted"; attempt.submittedAt = now;
  attempt.correctCount = attempt.answers.filter(a => a.correct).length;
  attempt.independentCount = attempt.answers.filter(a => a.help === "independent").length;
  paper.status = "completed";
  finishMasterySubmission(state, paper, attempt.id, { now, newId, userId: state.actor.id, role: state.actor.role });
}

function fixedPaperReturnPaper(state: WorkspaceState, input: Input): Paper {
  const paper = findPaper(state, input.paperId);
  if (input.paperVersion !== paper.version) throw new DomainError("纸面回传的试卷版本不一致，请重新核对原卷。", 409);
  if (!Array.isArray(input.questionIds) || input.questionIds.length !== paper.questionIds.length || input.questionIds.some((value, index) => value !== paper.questionIds[index])) throw new DomainError("纸面回传的题号与顺序必须和原卷完全一致");
  return paper;
}
function paperReturnEntries(value: unknown, paper: Paper): PaperReturnEntry[] {
  if (!Array.isArray(value) || value.length !== paper.questionIds.length) throw new DomainError("请保留原卷的全部题号，不能漏题或重复题目");
  return value.map((raw, index) => {
    const entry = object(raw, "纸面作答");
    if (entry.questionId !== paper.questionIds[index]) throw new DomainError("纸面作答的题号与顺序必须和原卷完全一致");
    const claimedHelp = entry.claimedHelp ?? "unknown";
    if (typeof claimedHelp !== "string" || !["independent", "hint", "explanation", "unknown"].includes(claimedHelp)) throw new DomainError("请选择有效的帮助情况自述");
    if (entry.confirmed !== undefined && typeof entry.confirmed !== "boolean" || entry.unitConfirmed !== undefined && typeof entry.unitConfirmed !== "boolean") throw new DomainError("请逐题确认原答案与单位");
    return { questionId: paper.questionIds[index], value: string(entry.value, "纸面原答案", 300, true), working: string(entry.working, "纸面原过程", 3000, true), claimedHelp: claimedHelp as HelpLevel, confirmed: entry.confirmed === true, unitConfirmed: entry.unitConfirmed === true };
  });
}
function returnPhotos(state: WorkspaceState, value: unknown, returnId?: string): string[] {
  if (!Array.isArray(value) || value.length > 10) throw new DomainError("每份纸面回传最多关联 10 张照片");
  const ids = value.map(id);
  for (const uploadId of ids) {
    const upload = state.uploads.find(u => u.id === uploadId);
    if (upload && state.recognition?.captures.some(c => state.uploads.some(u => u.id === c.uploadId && historyFileIdentity(u.url) === historyFileIdentity(upload.url)))) throw new DomainError("这张照片已绑定识别核对档案，请从照片核对继续。", 409);
  }
  if (new Set(ids).size !== ids.length) throw new DomainError("纸面回传不能重复关联同一张照片");
  const urls = new Set<string>();
  for (const uploadId of ids) {
    const photo = state.uploads.find(u => u.id === uploadId);
    if (!photo || !photo.url.startsWith("file:///")) throw new DomainError("请先保存照片到本机，再选择已登记的照片");
    if (urls.has(photo.url)) throw new DomainError("纸面回传不能用不同编号重复关联同一个照片文件");
    urls.add(photo.url);
    if (photo.status !== "pending" || state.uploads.some(u => u.url === photo.url && u.status === "confirmed") || state.paperReturns?.some(r => r.id !== returnId && r.uploadIds.some(id => state.uploads.some(u => u.id === id && u.url === photo.url)))) throw new DomainError("这张照片已用于其他作业或纸面回传，不能重复绑定。", 409);
  }
  return ids;
}
function observedPaperHelp(state: WorkspaceState, question: Question, existing: HelpLevel, claimed: HelpLevel): HelpLevel {
  const known = new Set<HelpLevel>([existing, claimed]);
  for (const event of state.events) if (event.action === "learning.exposure") {
    try {
      const exposure = JSON.parse(event.detail) as { familyIds?: unknown; level?: unknown };
      if (Array.isArray(exposure.familyIds) && exposure.familyIds.includes(question.familyId) && (exposure.level === "hint" || exposure.level === "explanation")) known.add(exposure.level);
    } catch { /* Unstructured legacy audit text cannot establish an exposure level. */ }
  }
  return known.has("explanation") ? "explanation" : known.has("hint") ? "hint" : "unknown";
}

function questionFields(raw: unknown, existing?: Question): Partial<Question> {
  const value = object(raw, "题目");
  const result: Partial<Question> = {};
  if (value.taskType !== undefined) {
    if (!["basic", "application", "transfer"].includes(value.taskType as string)) throw new DomainError("任务类型应为基础、应用或迁移");
    result.taskType = value.taskType as Question["taskType"];
  }
  if (value.contextId !== undefined) result.contextId = string(value.contextId, "任务情境编号", 100);
  // 配图路径是可选字段；空串归一为未设置，避免产生「有键但无值」的题目对象。
  if (value.image !== undefined) {
    const image = string(value.image, "题目配图", 300, true).trim();
    result.image = image === "" ? undefined : image;
  }
  const limits = { text: 2000, answer: 300, unit: 30, source: 300, sourceScope: 300, hint: 1000, alternative: 2000 } as const;
  for (const [key, limit] of Object.entries(limits)) {
    if (value[key] !== undefined || !existing) (result as Input)[key] = string(value[key], key, limit, ["unit", "alternative", "sourceScope"].includes(key));
  }
  if (value.knowledgeId !== undefined || !existing) {
    if (!knowledgeIds.includes(value.knowledgeId as KnowledgeId)) throw new DomainError("知识点不在当前课程范围内");
    result.knowledgeId = value.knowledgeId as KnowledgeId;
  }
  if (value.difficulty !== undefined || !existing) {
    if (!["基础", "巩固", "挑战"].includes(value.difficulty as string)) throw new DomainError("请选择基础、巩固或挑战难度");
    result.difficulty = value.difficulty as Question["difficulty"];
  }
  for (const key of ["steps", "prerequisites"] as const) {
    if (value[key] === undefined && existing) continue;
    const list = value[key] ?? [];
    if (!Array.isArray(list) || list.length > 20) throw new DomainError(`${key}格式不正确`);
    result[key] = list.map(item => string(item, key, 1500));
  }
  if (result.steps && !result.steps.length) throw new DomainError("至少填写一条解题步骤");
  const taskType = result.taskType ?? existing?.taskType;
  const contextId = result.contextId ?? existing?.contextId;
  if (Boolean(taskType) !== Boolean(contextId)) throw new DomainError("任务类型与情境编号必须同时填写，或同时保持未标注。");
  return result;
}

/** Pure, transactional domain mutation. Caller persists the whole result with revision CAS. */
export function applyAction(current: WorkspaceState, raw: unknown, context: Context): ApiResult {
  const input = object(raw);
  const action = string(input.action, "操作", 80);
  const role = context.role ?? current.actor.role;
  assertActionAllowed(role, action);
  assertHistoryWriteAllowed(current, action, input, context.userId);
  const state = structuredClone(current);
  const now = context.now || new Date().toISOString();
  const newId = context.newId || (() => crypto.randomUUID());
  state.actor = { id: context.userId, name: context.displayName, role };
  if (action.startsWith("recognition.")) return recognitionAction(current, action, input, { now, newId, userId: context.userId, displayName: context.displayName, role, channel: context.channel, bank: context.bank }, (changed, paper, entries) => {
    ensureMastery(changed, { now, newId });
    const attempt = ensureAttempt(changed, paper, now, newId);
    attempt.answers = entries.map(e => ({ questionId: e.candidate!.questionId, value: e.answer, working: e.working, help: "unknown", correct: null }));
    submitAttempt(changed, paper, attempt, now, newId, true);
    return attempt.id;
  });
  if (action.startsWith("history.delete.")) return historyAction(current, action, input, { now, newId, userId: context.userId, role });
  if (action.startsWith("evidence.") || action === "local.evidence.confirm") return evidenceAction(current, action, input, { now, newId, userId: context.userId, displayName: context.displayName, role, channel: context.channel });
  if (action === "help.create") return createCompanionHelpRequest(current, input, { now, newId, userId: context.userId, displayName: context.displayName, role, channel: context.channel });
  if (action.startsWith("chat.") || action.startsWith("memory.preference.")) {
    return companionAction(current, action, input, { now, newId, userId: context.userId, displayName: context.displayName, role, bank: context.bank }, (changed, familyId, level) => {
      recordExposure(changed, [familyId], level, context.userId, now, newId);
      markActiveFamilyHelp(changed, [familyId], level, now, newId);
    });
  }
  if (action === "content.export") {
    const pack = exportContentPackage(current, { packageId: id(input.packageId), publisherId: id(input.publisherId), createdAt: now, bank: context.bank,
      ...(input.questionIds !== undefined ? { questionIds: input.questionIds as string[] } : {}), ...(input.withdrawals !== undefined ? { withdrawals: input.withdrawals as string[] } : {}) });
    return { state: current, result: { id: pack.packageId, package: pack, message: "已准备本地未签名试用内容包；未发布到云端。" } };
  }
  if (action === "content.rollback") return rollbackContentBatch(current, id(input.batchId), input.sourceRevision as number, { now, newId, userId: context.userId, reason: string(input.reason, "回退原因", 1000) });
  ensureContent(state);
  const masteryContext = { now, newId, userId: context.userId, role, bank: context.bank };
  ensureMastery(state, masteryContext);
  const result: NonNullable<ApiResult["result"]> = {};
  let label = action;
  if (action.startsWith("rule.") || action === "mastery.reevaluate") {
    const outcome = masteryAction(state, action, input, masteryContext);
    state.revision = current.revision + 1;
    state.events.unshift({ id: newId(), action, label: action, actorId: context.userId, createdAt: now, detail: String(outcome.message || outcome.id || action) });
    return { state, result: outcome };
  }
  switch (action) {
    case "review.start": {
      const plan = state.mastery!.reviewPlans.find(p => p.id === input.planId);
      validateCourse(state, plan ? [plan.knowledgeId] : []);
      const paper = startReview(state, input.planId, input.count, masteryContext);
      if (plan?.paperId && current.mastery?.reviewPlans.some(p => p.id === plan.id && p.paperId === paper.id)) return { state: current, result: { id: paper.id, message: "此计划已开始，继续同一份复查卷。" } };
      result.id = paper.id; result.message = "已按到期计划生成未见迁移新题，原卷与复查来源已绑定。"; break;
    }
    case "profile.update": {
      const profile = object(input.profile, "学习资料");
      for (const key of ["name", "grade", "semester", "course", "textbook", "school"] as const) {
        if (profile[key] !== undefined) state.profile[key] = string(profile[key], "学习资料", 100, key === "school");
      }
      label = "更新学习资料"; result.message = "学习资料已保存"; break;
    }
    case "knowledge.begin": {
      // 把一个教材目录知识点加入本学习者的学习范围。
      // 组卷只允许已学（learningState === "current"）的知识点，所以要进入新知识点必须先解锁。
      const knowledgeId = id(input.knowledgeId);
      if (!knowledgeIds.includes(knowledgeId)) throw new DomainError("知识点不在当前教材范围内");
      const ruleLabel = activeRuleLabel(state);
      const ruleVersion = ruleLabel;
      const existing = state.knowledge.find(knowledge => knowledge.id === knowledgeId);
      if (existing) {
        if (existing.learningState === "current") { result.id = knowledgeId; result.message = "该知识点已在学习范围内。"; break; }
        existing.learningState = "current";
        existing.reason = `已加入学习范围，尚无本规则下的独立新题证据。${ruleLabel}`;
      } else {
        state.knowledge.push({
          id: knowledgeId as KnowledgeId, name: string(input.name, "知识点名称", 100), description: string(input.description, "知识点说明", 300, true),
          learningState: "current", stars: null, evidenceIds: [], reason: `已加入学习范围，尚无本规则下的独立新题证据。${ruleLabel}`,
          ruleVersion, assessmentState: "insufficient",
        });
      }
      label = "开始学习本单元"; result.id = knowledgeId; result.message = "已加入学习范围，可以在「我的练习」里组卷。"; break;
    }
    case "paper.create": {
      const count = input.count === undefined ? 6 : Number(input.count);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new DomainError("题量应为 1—20 题");
      const kind = input.kind || "practice";
      if (!["practice", "review", "whole"].includes(kind as string)) throw new DomainError("试卷类型无效");
      if (kind === "review") {
        const paper = startReview(state, input.planId, input.count, masteryContext);
        if (current.mastery?.reviewPlans.some(p => p.id === input.planId && p.paperId === paper.id)) return { state: current, result: { id: paper.id, message: "此计划已开始，继续同一份复查卷。" } };
        result.id = paper.id; result.message = "已通过真实到期计划生成迁移复查卷。"; break;
      }
      const ids = input.knowledgeIds === undefined ? state.knowledge.filter(k => k.learningState === "current").map(k => k.id) : input.knowledgeIds;
      if (!Array.isArray(ids) || !ids.length || ids.some(v => !knowledgeIds.includes(v as KnowledgeId))) throw new DomainError("请选择有效知识点");
      validateCourse(state, ids as KnowledgeId[]);
      if (ids.some(v => state.knowledge.find(k => k.id === v)?.learningState !== "current")) throw new DomainError("暂不组入未学知识点");
      const unavailable = unavailableFamilies(state, now);
      const difficulty = input.difficulty;
      const bank = reviewedBank(state, context.bank).filter(q => ids.includes(q.knowledgeId) && !unavailable.has(q.familyId) && (!difficulty || ["不限", "综合", "混合", "全部"].includes(String(difficulty)) || q.difficulty === difficulty));
      const families = new Set<string>();
      const selected: Question[] = [];
      // 题目按题型分池：选择题（答案是一个字母）、填空题（有单位）、解答题（无单位）。
      // 库里的排序把选择题放在每个知识点的末尾，按顺序取题就永远取不到它们 ——
      // 所以按题型配额取卷，卷面比例接近真实考卷。
      const isChoiceQuestion = (question: Question) => /^[A-D]$/.test(String(question.answer ?? "").trim());
      const kindOf = (question: Question): "choice" | "fill" | "solve" =>
        isChoiceQuestion(question) ? "choice" : String(question.unit ?? "").trim() ? "fill" : "solve";
      const pools = new Map<"choice" | "fill" | "solve", Map<string, Question[]>>();
      for (const kind of ["choice", "fill", "solve"] as const) pools.set(kind, new Map());
      for (const question of bank) {
        const perKind = pools.get(kindOf(question))!;
        const list = perKind.get(question.knowledgeId) ?? [];
        list.push(question);
        perKind.set(question.knowledgeId, list);
      }
      /**
       * 卷面配额。不指定模板时用「选择题约四分之一」，其余按题库现状分配；
       * 指定模板时按官方卷面结构（选/填/解的比例）。
       */
      const template = input.template ? paperTemplates.find(item => item.id === String(input.template)) : undefined;
      if (input.template && !template) throw new DomainError("未知的卷面结构模板。");
      const quotaTemplate = template ? templateMix(template) : null;
      const quota = quotaTemplate
        ? { choice: quotaTemplate.choice, fill: quotaTemplate.fill, solve: quotaTemplate.solve }
        : { choice: 25, fill: 35, solve: 40 };
      const taken = { choice: 0, fill: 0, solve: 0 };
      const usedOf = (kind: "choice" | "fill" | "solve", knowledgeId: string) =>
        pools.get(kind)!.get(knowledgeId)?.find(item => !families.has(item.familyId));
      // Round-robin knowledge coverage, then prefer lower-star knowledge within each pass.
      const orderedIds = [...new Set(ids)].sort((a, b) => (state.knowledge.find(k => k.id === a)?.stars ?? 0) - (state.knowledge.find(k => k.id === b)?.stars ?? 0));
      for (let pass = 0; selected.length < count && pass < count; pass++) {
        let added = false;
        for (const knowledgeId of orderedIds) {
          // 挑「离配额缺口最大」的那个题型，避免卷面比例失衡。
          const kinds = (["choice", "fill", "solve"] as const)
            .map(kind => ({ kind, gap: quota[kind] * (selected.length + 1) / 100 - taken[kind] }))
            .sort((a, b) => b.gap - a.gap);
          const q = kinds.map(item => usedOf(item.kind, knowledgeId)).find(Boolean);
          if (q && selected.length < count) {
            selected.push(q); families.add(q.familyId); taken[kindOf(q)] += 1; added = true;
          }
        }
        if (!added) break;
      }
      if (selected.length < count) throw new DomainError(`题库不足：排除已看提示或解析的题族、近 14 天试卷题族后，符合课程与难度的题目只有 ${selected.length} 道，当前需要 ${count} 道。请减少题量或扩充审核题库。`, 409);
      const estimatedMinutes = template
        ? Math.max(5, Math.round(template.minutes * count / Math.max(1, template.structure.choice + template.structure.fill + template.structure.solve)))
        : count * 2;
      const paper: Paper = { id: newId(), title: kind === "review" ? "三日新题复查" : kind === "whole" ? "课程综合练习" : template ? template.label : "我的针对练习", version: 1, createdAt: now, questionIds: selected.map(q => q.id), questions: structuredClone(selected), status: "ready", kind: kind as Paper["kind"], reason: template ? `按${template.label}组卷：${template.officialFacts.join("；")}。` : "按已学范围与薄弱知识点组卷，使用已审核题目，避开已看帮助和近 14 天试卷中的题族。", estimatedMinutes };
      state.papers.unshift(paper); result.id = paper.id; label = "生成练习卷"; result.message = `已生成 ${count} 题，题目版本已保存`; break;
    }
    case "paper.replace": {
      const old = findPaper(state, input.paperId);
      validateCourse(state, old.questions.map(q => q.knowledgeId));
      if (old.kind === "review") throw new DomainError("复查卷已绑定计划和固定新题，不能另换版本；请保留此卷继续作答。", 409);
      const replaced = old.questions.find(q => q.id === id(input.questionId));
      if (!replaced) throw new DomainError("待换题不属于本卷");
      const unavailable = unavailableFamilies(state, now);
      const candidate = reviewedBank(state, context.bank).find(q => q.knowledgeId === replaced.knowledgeId && q.difficulty === replaced.difficulty && !unavailable.has(q.familyId) && !old.questions.some(oldQ => oldQ.familyId === q.familyId));
      if (!candidate) throw new DomainError("暂无同知识点、同难度的新题可替换，请扩充题库。", 409);
      const paper: Paper = { ...structuredClone(old), id: newId(), parentId: old.id, version: old.version + 1, createdAt: now, status: "ready", questions: old.questions.map(q => structuredClone(q.id === replaced.id ? candidate : q)), reason: `从第 ${old.version} 版换题生成；旧卷及成绩保留。` };
      paper.questionIds = paper.questions.map(q => q.id);
      state.papers.unshift(paper); result.id = paper.id; label = "换题并保存新版本"; result.message = `已保存第 ${paper.version} 版，旧卷记录完整保留`; break;
    }
    case "paper.return.save": {
      const paper = fixedPaperReturnPaper(state, input);
      const existing = state.paperReturns?.find(r => r.paperId === paper.id);
      if (existing?.status === "submitted" || state.attempts.some(a => a.paperId === paper.id && a.status === "submitted")) throw new DomainError("原卷已有提交记录，不能覆盖。请查看报告或另建练习。", 409);
      if (input.expectedRevision !== (existing?.revision ?? 0)) throw new DomainError("纸面回传草稿已变化，请重新读取并核对本页输入。", 409);
      const uploadIds = returnPhotos(state, input.uploadIds, existing?.id);
      const entries = paperReturnEntries(input.entries, paper);
      const record: PaperReturn = {
        id: existing?.id || newId(), paperId: paper.id, paperVersion: paper.version, questionIds: [...paper.questionIds],
        revision: (existing?.revision ?? 0) + 1, uploadIds, entries, status: "draft", createdAt: existing?.createdAt || now, updatedAt: now,
      };
      state.paperReturns ??= [];
      if (existing) state.paperReturns[state.paperReturns.findIndex(r => r.id === existing.id)] = record;
      else state.paperReturns.unshift(record);
      result.id = record.id; result.returnId = record.id; result.message = "纸面核对草稿已保存，尚未生成报告；原有在线草稿保持不变。"; label = "保存纸面回传草稿";
      break;
    }
    case "paper.return.submit": {
      const record = state.paperReturns?.find(r => r.id === id(input.id));
      if (!record) throw new DomainError("纸面回传草稿不存在，请先保存核对内容。", 404);
      const paper = fixedPaperReturnPaper(state, { paperId: record.paperId, paperVersion: record.paperVersion, questionIds: record.questionIds });
      const submissionKey = string(input.submissionKey, "提交标识", 150);
      if (record.status === "submitted") {
        if (record.submissionKey !== submissionKey || !state.attempts.some(a => a.id === record.attemptId && a.paperId === paper.id && a.status === "submitted" && a.submissionKey === submissionKey)) throw new DomainError("该纸面回传已提交，请查看原报告。", 409);
        return { state: current, result: { id: paper.id, returnId: record.id, attemptId: record.attemptId, message: "纸面回传已提交，原报告保持不变。" } };
      }
      if (input.expectedRevision !== record.revision) throw new DomainError("纸面回传草稿已变化，请重新读取并核对后再确认。", 409);
      const prior = state.attempts.find(a => a.paperId === paper.id);
      if (prior?.status === "submitted") throw new DomainError("原卷已有提交记录，纸面回传不能覆盖原报告。", 409);
      if (state.attempts.some(a => a.submissionKey === submissionKey)) throw new DomainError("该提交标识已用于其他作答。", 409);
      if (!record.uploadIds.length) throw new DomainError("请至少保存并关联一张纸面作答照片");
      returnPhotos(state, record.uploadIds, record.id);
      const entries = paperReturnEntries(record.entries, paper);
      if (entries.some(entry => !entry.confirmed || !entry.unitConfirmed)) throw new DomainError("请逐题核对题号、原答案、帮助自述与原卷单位，并完成确认");
      if (prior?.answers.some(answer => answer.value.trim() || answer.working.trim()) && input.replaceOnlineDraft !== true) throw new DomainError("此卷已有在线输入。请明确确认使用纸面原答案生成报告；原在线草稿将完整归档保留。", 409);
      if (prior) record.onlineDraftSnapshot = structuredClone(prior);
      const attempt = ensureAttempt(state, paper, now, newId);
      for (const level of ["hint", "explanation"] as const) {
        const families = entries.filter(entry => entry.claimedHelp === level).map(entry => paper.questions.find(q => q.id === entry.questionId)!.familyId);
        if (families.length) { recordExposure(state, families, level, context.userId, now, newId); markActiveFamilyHelp(state, families, level, now, newId); }
      }
      attempt.answers = entries.map(entry => ({ questionId: entry.questionId, value: entry.value, working: entry.working, help: observedPaperHelp(state, paper.questions.find(q => q.id === entry.questionId)!, attempt.answers.find(a => a.questionId === entry.questionId)?.help || "unknown", entry.claimedHelp), correct: null }));
      attempt.submissionKey = submissionKey;
      submitAttempt(state, paper, attempt, now, newId, true);
      record.status = "submitted"; record.entries = entries; record.attemptId = attempt.id; record.submissionKey = submissionKey; record.submittedAt = now; record.updatedAt = now; record.revision++;
      for (const uploadId of record.uploadIds) state.uploads.find(u => u.id === uploadId)!.status = "confirmed";
      result.id = paper.id; result.returnId = record.id; result.attemptId = attempt.id;
      result.message = `纸面回传已确认：${attempt.correctCount}/${paper.questions.length} 题正确。帮助自述单独保留，纸面记录不计独立星级。`; label = "确认纸面回传并生成原卷报告";
      break;
    }
    case "paper.resume":
    case "attempt.save":
    case "attempt.help":
    case "attempt.submit": {
      const paper = findPaper(state, input.paperId);
      const attempt = ensureAttempt(state, paper, now, newId);
      if (attempt.status === "submitted") {
        if (action === "attempt.submit" || action === "paper.resume") return { state: current, result: { id: paper.id, attemptId: attempt.id, message: "该试卷已提交，原始作答记录保持不变" } };
        throw new DomainError("已提交的作答不可覆盖，请在错题集订正或生成新卷。", 409);
      }
      if (action === "attempt.help") {
        const answer = attempt.answers.find(a => a.questionId === id(input.questionId));
        if (!answer) throw new DomainError("题目不属于本试卷");
        const level = input.level;
        if (level !== "hint" && level !== "explanation") throw new DomainError("帮助级别无效");
        if (helpRank[level] > helpRank[answer.help]) answer.help = level;
        const question = paper.questions.find(q => q.id === answer.questionId)!;
        recordExposure(state, [question.familyId], level, context.userId, now, newId);
        markActiveFamilyHelp(state, [question.familyId], level, now, newId);
        result.help = level === "hint" ? question.hint : question.steps.join("\n");
        result.alternative = level === "explanation" ? question.alternative : undefined;
        label = level === "hint" ? "查看分层提示" : "查看完整讲解";
      } else {
        mergeAnswers(attempt, input.answers);
        if (action === "attempt.submit") {
          const submissionKey = string(input.submissionKey || paper.id, "提交标识", 150);
          if (state.attempts.some(a => a.id !== attempt.id && a.submissionKey === submissionKey)) throw new DomainError("该提交标识已用于另一份试卷", 409);
          if (attempt.answers.some(a => !a.value.trim())) throw new DomainError("还有题目未填写答案，请完成后提交");
          attempt.submissionKey = submissionKey;
          submitAttempt(state, paper, attempt, now, newId);
          label = "提交练习并生成证据"; result.message = `${attempt.correctCount}/${paper.questions.length} 题答对，${attempt.independentCount} 题独立完成`;
        } else { label = "保存作答草稿"; result.message = "草稿已保存，可继续作答"; }
      }
      result.id = paper.id; result.attemptId = attempt.id; break;
    }
    case "paper.question.expose": {
      const paper = findPaper(state, input.paperId);
      const question = paper.questions.find(q => q.id === id(input.questionId));
      if (!question) throw new DomainError("题目不属于此原卷", 404);
      recordExposure(state, [question.familyId], "explanation", context.userId, now, newId);
      markActiveFamilyHelp(state, [question.familyId], "explanation", now, newId);
      result.id = paper.id; result.questionId = question.id; result.message = "仅此题族的解析曝光已记录，原始成绩与评定保持不变。";
      label = "展开单题解析"; break;
    }
    case "paper.expose": {
      const paper = findPaper(state, input.paperId);
      recordExposure(state, paper.questions.map(q => q.familyId), "explanation", context.userId, now, newId);
      markActiveFamilyHelp(state, paper.questions.map(q => q.familyId), "explanation", now, newId);
      result.id = paper.id; result.message = paper.status === "completed" ? "解析曝光已记录，已提交成绩保持不变" : "已记录解析曝光，本卷后续作答不再作为独立新题证据";
      label = "查看或打印解析卷"; break;
    }
    case "single.explain": {
      const q = reviewedBank(state).find(q => q.id === id(input.id));
      if (!q) throw new DomainError("没有找到可引用的已审核题目", 404);
      recordExposure(state, [q.familyId], "explanation", context.userId, now, newId);
      markActiveFamilyHelp(state, [q.familyId], "explanation", now, newId);
      result.id = q.id; result.help = q.steps.join("\n"); result.alternative = q.alternative; result.message = "已引用审核解法并记录题族曝光"; label = "单题查看完整讲解"; break;
    }
    case "mistake.tag": {
      // 错因由学生自己选：系统不知道他为什么错，替他猜会污染判断。
      const effective = effectiveMistakes(state).find(m => m.id === id(input.id));
      if (!effective) throw new DomainError("当前有效结果不再属于待订正错题，或错题不存在", 404);
      const cause = string(input.cause, "错因", 30);
      if (!mistakeCauseIds.includes(cause)) throw new DomainError("错因标签无效。");
      let mistake = state.mistakes.find(m => m.id === effective.id);
      if (!mistake) {
        const source = state.papers.find(p => p.id === effective.effectiveEvidence.paperId)!.questions.find(q => q.id === effective.effectiveEvidence.questionId)!;
        mistake = { id: effective.id, question: structuredClone(source), originalAnswer: effective.effectiveEvidence.original.answer, evidenceId: effective.evidenceId };
        state.mistakes.unshift(mistake);
      }
      mistake.cause = cause as MistakeCause;
      mistake.causeNote = string(input.note, "错因备注", 200, true);
      result.id = mistake.id; result.message = "错因已记下，可以按这组错因再练几道"; label = "标记错因"; break;
    }
    case "mistake.correct": {
      const effective = effectiveMistakes(state).find(m => m.id === id(input.id));
      if (!effective) throw new DomainError("当前有效结果不再属于待订正错题，或错题不存在", 404);
      let mistake = state.mistakes.find(m => m.id === effective.id);
      if (!mistake) {
        const source = state.papers.find(p => p.id === effective.effectiveEvidence.paperId)!.questions.find(q => q.id === effective.effectiveEvidence.questionId)!;
        mistake = { id: effective.id, question: structuredClone(source), originalAnswer: effective.effectiveEvidence.original.answer, evidenceId: effective.evidenceId };
        state.mistakes.unshift(mistake);
      }
      const answer = string(input.answer, "订正答案", 300);
      if (!gradeAnswer(answer, mistake.question)) throw new DomainError("这次订正还不正确，可以先看看提示再试一次。");
      mistake.correctedAnswer = answer; mistake.correctedAt = now;
      result.id = mistake.id; result.message = "订正已保存，原始作答和星级保持不变"; label = "完成错题订正"; break;
    }
    case "question.create": {
      const fields = questionFields(input.question);
      const question = { ...fields, id: newId(), familyId: newId(), version: 1, authorId: context.userId, createdAt: now, status: "draft" } as Question;
      state.questions.unshift(question); result.id = question.id; label = "新建题目草稿"; result.message = "草稿已保存，需另一位审核人审核后才能发布"; break;
    }
    case "question.update": {
      const q = findQuestion(state, input.id);
      if (q.status === "review") throw new DomainError("审核中的题目不能直接修改，请先退回草稿。", 409);
      const fields = questionFields(input.question, q);
      const nextVersion = Math.max(q.version, ...state.content!.versions.filter(v => v.questionId === q.id).map(v => v.version)) + 1;
      Object.assign(q, fields, { version: nextVersion, status: "draft", authorId: context.userId, reviewerId: undefined, reviewNote: undefined });
      result.id = q.id; label = "更新题目版本"; result.message = "修改后已回到草稿，需重新审核；历史试卷快照不变"; break;
    }
    case "question.submit": {
      const q = findQuestion(state, input.id);
      if (q.status !== "draft") throw new DomainError("只有草稿可以提交审核", 409);
      questionFields(q);
      q.status = "review"; q.reviewerId = undefined; q.reviewNote = undefined;
      result.id = q.id; label = "提交内容审核"; result.message = "已进入待审核，作者不能审核自己的内容"; break;
    }
    case "question.review": {
      const q = findQuestion(state, input.id);
      if (q.status !== "review") throw new DomainError("题目当前不在审核队列", 409);
      if (q.authorId === context.userId) throw new DomainError("作者不能审核自己的题目。请由工作区内另一位具有审核权限的真实账号独立复核。", 403);
      if (input.decision !== "approve" && input.decision !== "reject") throw new DomainError("审核结论无效");
      q.reviewerId = context.userId; q.reviewNote = string(input.note, "审核意见", 1500, input.decision === "approve");
      q.status = input.decision === "approve" ? "approved" : "draft";
      result.id = q.id; label = input.decision === "approve" ? "审核通过" : "退回题目"; result.message = input.decision === "approve" ? "已审核通过，可发布" : "已退回草稿"; break;
    }
    case "question.publish": {
      const q = findQuestion(state, input.id);
      if (q.status !== "approved" || !q.reviewerId || q.reviewerId === q.authorId) throw new DomainError("题目必须经非作者审核通过后才能发布", 403);
      q.status = "published"; result.id = q.id; label = "发布题目"; result.message = "已发布，可用于新试卷"; break;
    }
    case "question.disable": {
      const q = findQuestion(state, input.id);
      q.status = "disabled"; result.id = q.id; label = "停用题目"; result.message = "新试卷将不再使用本题，历史快照保留"; break;
    }
    case "help.receive":
    case "help.reply": {
      const request = state.helpRequests.find(r => r.id === id(input.id));
      if (!request) throw new DomainError("求助请求不存在", 404);
      if (request.delivery === "local-only") throw new DomainError("该摘要仅保存在本机，尚未共享到教师收件箱。", 403);
      if (action === "help.reply") { request.reply = string(input.reply, "回复", 3000); request.status = "replied"; label = "记录工作区回复"; }
      else { request.status = "received"; label = "标记已接收"; }
      result.id = request.id; result.message = "工作区处理状态已保存"; break;
    }
    case "single.match": {
      const query = string(input.text, "题目文字", 2000);
      const terms = query.match(/\d+|[\u4e00-\u9fff]{2,}/g) || [query];
      const matches = reviewedBank(state, context.bank).map(q => ({ q, score: terms.reduce((sum, term) => sum + (q.text.includes(term) ? term.length : 0), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.q.id);
      return { state: current, result: { questionIds: matches, message: matches.length ? "这些是文字检索候选，请逐题核对，系统不会自动判定为同题" : "未找到题库候选，请核对文字或补充经过审核的题目" } };
    }
    case "homework.confirm": {
      const upload = state.uploads.find(u => u.id === id(input.uploadId));
      if (!upload) throw new DomainError("上传记录不存在或不属于当前账号", 404);
      if (state.recognition?.captures.some(c => state.uploads.some(u => u.id === c.uploadId && historyFileIdentity(u.url) === historyFileIdentity(upload.url)))) throw new DomainError("这张照片已绑定识别核对档案，请继续逐题核对，不能通过旧入口覆盖。", 409);
      if (state.paperReturns?.some(r => r.uploadIds.some(id => state.uploads.some(u => u.id === id && u.url === upload.url)))) throw new DomainError("这张照片已绑定原卷纸面回传，请从该回传继续核对。", 409);
      if (upload.status === "confirmed") throw new DomainError("这份作业已经核对入档，原始记录不能重复覆盖", 409);
      if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 20) throw new DomainError("请核对 1—20 道题后提交");
      const seen = new Set<string>();
      const entries = input.entries.map(raw => {
        const entry = object(raw, "作业条目");
        const q = reviewedBank(state).find(q => q.id === id(entry.questionId));
        if (!q || seen.has(q.id)) throw new DomainError("每道作业题必须选择一条不同的已发布题库记录");
        seen.add(q.id);
        return { q, answer: string(entry.answer, "原始答案", 300), working: string(entry.working, "原始过程", 3000, true) };
      });
      const paper: Paper = { id: newId(), title: `照片作业 · ${upload.name}`, version: 1, createdAt: now, questionIds: entries.map(e => e.q.id), questions: entries.map(e => structuredClone(e.q)), status: "ready", kind: "whole", reason: `由本人对照图片逐题选择题库并核对原始答案。文件 ${upload.id}；未使用 OCR，独立程度未验证。`, estimatedMinutes: entries.length * 2 };
      state.papers.unshift(paper);
      const attempt = ensureAttempt(state, paper, now, newId);
      attempt.answers = entries.map(e => ({ questionId: e.q.id, value: e.answer, working: e.working, help: "unknown", correct: null }));
      submitAttempt(state, paper, attempt, now, newId, true); upload.status = "confirmed";
      result.id = paper.id; result.message = `已保存人工核对记录：${attempt.correctCount}/${entries.length} 题正确。原始记录与订正分开保存。`; label = "人工核对照片作业"; break;
    }
    default: throw new DomainError("不支持的操作", 400);
  }
  if (action.startsWith("question.") && result.id) {
    const question = state.questions.find(q => q.id === result.id);
    if (question) recordQuestionVersion(state, question);
    if (action === "question.disable") result.message = `新试卷将不再使用本题，历史快照保留。停用原因：${input.reason === undefined ? "本地教研手动停用，具体内容待复核" : string(input.reason, "停用原因", 1000)}`;
  }
  state.revision = current.revision + 1;
  state.events.unshift({ id: newId(), action, label, actorId: context.userId, createdAt: now, detail: String(result.message || result.id || label) });
  return { state, result };
}
