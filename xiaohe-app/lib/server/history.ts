import type { ApiResult, HistoryDeletionOperation, HistoryDeletionPreview, HistoryDeletionSelection, HistoryDeletionState, KnowledgeId, Role, WorkspaceState } from '../types.ts';
import { historyFileIdentity } from '../history-deletion.ts';
import { effectiveAttempt, effectiveEvidence, effectiveReviewSource } from '../effective-evidence.ts';
import { canonicalStringify, sha256 } from './content.ts';
import { DomainError } from './domain-error.ts';
import { assessKnowledge, ensureMastery } from './mastery.ts';
import { recognitionDeletionScope, recognitionPhotoReferences, redactRecognitionHistory, validateRecognitionState } from './recognition.ts';

type Input = Record<string, unknown>;
type Context = { now: string; newId: () => string; userId: string; role: Role };
const hash = (value: unknown) => sha256(canonicalStringify(value));
function check(value: unknown, message: string, status = 400): asserts value { if (!value) throw new DomainError(message, status); }
function object(value: unknown): Input { check(value && typeof value === 'object' && !Array.isArray(value), '删除记录格式无效'); return value as Input; }
function keys(value: Input, allowed: string[]) { check(Object.keys(value).every(k => allowed.includes(k)), '删除记录含未支持字段'); }
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const isDigest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const isRevision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const knowledgeIds: KnowledgeId[] = ['division', 'geometry', 'multiplication'];
const rank = (help: string) => help === 'explanation' ? 3 : help === 'hint' ? 2 : help === 'unknown' ? 1 : 0;
function ids(value: unknown, empty = true): string[] { check(Array.isArray(value) && value.every(isId) && (empty || value.length > 0) && new Set(value).size === value.length, '请选择不重复的有效记录'); return value.slice().sort(); }
export function ensureHistoryDeletion(state: WorkspaceState): HistoryDeletionState {
  return state.historyDeletion ?? (state.historyDeletion = { schemaVersion: 1, operations: [], evidence: [], qualificationFacts: [], requests: [], assessments: [], fileTasks: [] });
}
function selection(input: Input): HistoryDeletionSelection { return { evidenceIds: ids(input.evidenceIds, false), uploadIds: ids(input.uploadIds ?? []) }; }
function pair(paperId: string, questionId: string) { return JSON.stringify([paperId, questionId]); }
function closure(state: WorkspaceState, selected: HistoryDeletionSelection, actorId: string) {
  const wanted = new Set(selected.evidenceIds);
  const entries = selected.evidenceIds.map(id => {
    const e = state.evidence.find(e => e.id === id);
    check(e && state.attempts.some(a => a.id === e.attemptId && a.paperId === e.paperId && a.status === 'submitted'), '所选证据不存在、已删除或尚未正式提交', 409); return e;
  });
  const pairs = new Set(entries.map(e => pair(e.paperId, e.questionId)));
  const proposals = (state.evidenceReviews?.proposals ?? []).filter(p => wanted.has(p.evidenceId));
  const decisions = (state.evidenceReviews?.decisions ?? []).filter(d => wanted.has(d.evidenceId));
  const knowledge = new Set<KnowledgeId>(entries.map(e => e.knowledgeId));
  for (const p of proposals) if (p.patch.knowledgeId && decisions.some(d => d.proposalId === p.id && d.outcome === "accept")) knowledge.add(p.patch.knowledgeId);
  const effective = effectiveEvidence(state);
  for (const e of effective) if (wanted.has(e.id)) knowledge.add(e.knowledgeId);
  const linked = (c: { source: string; paperId?: string; questionId?: string } | undefined) => c?.source === 'paper' && Boolean(c.paperId && c.questionId && pairs.has(pair(c.paperId, c.questionId)));
  const allThreads = (state.companion?.threads ?? []).filter(t => linked(t.context));
  const threads = allThreads.filter(t => t.ownerId === actorId), threadIds = new Set(threads.map(t => t.id));
  const helps = state.helpRequests.filter(h => h.ownerId === actorId && (linked(h.context) || h.sourceThreadId && threadIds.has(h.sourceThreadId)));
  const removedDecisionIds = new Set(decisions.map(d => d.id));
  const assessments = (state.mastery?.assessments ?? []).filter(a => knowledge.has(a.knowledgeId) || Boolean(a.evidenceRevisionId && removedDecisionIds.has(a.evidenceRevisionId)) || a.adoptedEvidenceIds.some(id => wanted.has(id)) || a.excludedEvidence.some(e => wanted.has(e.evidenceId)));
  const decisionRevisions = new Set(decisions.filter(d => d.outcome === 'accept').map(d => d.appliedRevision));
  const plans = (state.mastery?.reviewPlans ?? []).filter(p => entries.some(e => e.attemptId === p.sourceAttemptId && knowledge.has(p.knowledgeId)) || p.sourceRevision !== undefined && decisionRevisions.has(p.sourceRevision));
  const photos = state.uploads.map(upload => {
    const picked = selected.uploadIds.includes(upload.id);
    const identity = historyFileIdentity(upload.url);
    const aliases = state.uploads.filter(u => historyFileIdentity(u.url) === identity);
    const aliasIds = new Set(aliases.map(u => u.id));
    let retainedReferenceCount = aliases.filter(u => !selected.uploadIds.includes(u.id)).length;
    retainedReferenceCount += (state.evidenceReviews?.proposals ?? []).filter(p => !wanted.has(p.evidenceId) && p.uploadIds.some(id => aliasIds.has(id))).length;
    retainedReferenceCount += (state.paperReturns ?? []).filter(r => r.uploadIds.some(id => aliasIds.has(id)) && r.entries.some(e => !pairs.has(pair(r.paperId, e.questionId)))).length;
    retainedReferenceCount += recognitionPhotoReferences(state, aliasIds, selected.evidenceIds);
    return { uploadId: upload.id, name: upload.name, selected: picked, willDelete: picked && retainedReferenceCount === 0, retainedReferenceCount,
      reason: !picked ? '未选择删除；保留原照片，不推测旧说明文字中的关联。' : retainedReferenceCount ? '仍有未删除作答、更正申请或同文件登记引用，保留照片。' : '删除这份已明确选择的登记与本应用管理的文件；不会删除系统相册原图。' };
  });
  check(selected.uploadIds.every(id => state.uploads.some(u => u.id === id)), '所选照片不存在或已删除', 409);
  return { entries, pairs, proposals, decisions, knowledge, threads, threadIds, helps, assessments, plans, photos, otherThreadCount: allThreads.length - threads.length };
}
function addRequest(history: HistoryDeletionState, actorId: string, requestId: string | undefined, action: string, operationId: string) {
  if (!requestId || history.requests.some(r => r.actorId === actorId && r.requestId === requestId && r.action === action)) return;
  history.requests.push({ actorId, requestId, action, operationId });
}
function mutate(current: WorkspaceState, selected: HistoryDeletionSelection, ctx: Context, requestId: string, digest: string): WorkspaceState {
  const c = closure(current, selected, ctx.userId), state = structuredClone(current), history = ensureHistoryDeletion(state);
  if (!state.mastery) {
    for (const k of state.knowledge) if (c.knowledge.has(k.id)) { k.stars = null; k.evidenceIds = []; k.reason = "相关历史已明确删除，等待以剩余证据重新评定。"; delete k.assessmentId; delete k.assessmentState; }
    ensureMastery(state, ctx);
  }
  const id = ctx.newId(), wanted = new Set(selected.evidenceIds), deletedUploads = new Set(c.photos.filter(p => p.willDelete).map(p => p.uploadId));
  const operation: HistoryDeletionOperation = { id, actorId: ctx.userId, requestId, digest, createdAt: ctx.now, appliedRevision: current.revision + 1,
    evidenceIds: selected.evidenceIds, knowledgeIds: [...c.knowledge].sort(), deletedThreadIds: c.threads.map(t => t.id), deletedHelpRequestIds: c.helps.map(h => h.id),
    removedProposalIds: c.proposals.map(p => p.id), removedDecisionIds: c.decisions.map(d => d.id), deletedUploadIds: [...deletedUploads],
    redactedAssessmentIds: c.assessments.map(a => a.id), affectedReviewPlanIds: c.plans.map(p => p.id),
    reviewPlanSources: c.plans.map(p => ({ planId: p.id, ...(p.sourceRevision !== undefined ? { sourceRevision: p.sourceRevision } : {}), createdAt: p.createdAt })) };
  history.operations.push(operation);
  redactRecognitionHistory(state, selected.evidenceIds, deletedUploads, id, ctx.now);
  const effectiveById = new Map(effectiveEvidence(current).map(e => [e.id, e]));
  for (const entry of c.entries) {
    const effectiveHelp = effectiveById.get(entry.id)?.help ?? entry.help;
    const retainedHelp = rank(effectiveHelp) > rank(entry.help) ? effectiveHelp : entry.help;
    history.evidence.push({ id: ctx.newId(), operationId: id, evidenceId: entry.id, attemptId: entry.attemptId, paperId: entry.paperId, questionId: entry.questionId,
      familyId: entry.familyId || entry.questionId, knowledgeId: entry.knowledgeId, createdAt: entry.createdAt, deletedAt: ctx.now });
    const fact = history.qualificationFacts.find(f => f.familyId === (entry.familyId || entry.questionId));
    if (fact) { if (rank(retainedHelp) > rank(fact.help)) fact.help = retainedHelp; }
    else history.qualificationFacts.push({ familyId: entry.familyId || entry.questionId, seen: true, help: retainedHelp });
  }
  state.evidence = state.evidence.filter(e => !wanted.has(e.id));
  for (const attempt of state.attempts) if (c.entries.some(e => e.attemptId === attempt.id)) {
    attempt.answers = attempt.answers.filter(a => !c.pairs.has(pair(attempt.paperId, a.questionId)));
    attempt.correctCount = attempt.answers.filter(a => a.correct).length; attempt.independentCount = attempt.answers.filter(a => a.help === 'independent').length;
  }
  state.mistakes = state.mistakes.filter(m => !wanted.has(m.evidenceId));
  for (const p of c.proposals) addRequest(history, p.requestedBy, p.requestId, 'evidence.propose', id);
  for (const d of c.decisions) addRequest(history, d.actorId, d.requestId, d.authority === 'local-unverified' ? 'local.evidence.confirm' : 'evidence.review', id);
  if (state.evidenceReviews) { state.evidenceReviews.proposals = state.evidenceReviews.proposals.filter(p => !wanted.has(p.evidenceId)); state.evidenceReviews.decisions = state.evidenceReviews.decisions.filter(d => !wanted.has(d.evidenceId)); }
  for (const record of state.paperReturns ?? []) {
    record.entries = record.entries.filter(e => !c.pairs.has(pair(record.paperId, e.questionId)));
    if (record.onlineDraftSnapshot) record.onlineDraftSnapshot.answers = record.onlineDraftSnapshot.answers.filter(a => !c.pairs.has(pair(record.paperId, a.questionId)));
    record.uploadIds = record.uploadIds.filter(id => !deletedUploads.has(id));
  }
  if (state.companion) {
    for (const r of state.companion.requests.filter(r => c.threadIds.has(r.threadId))) addRequest(history, r.ownerId, r.requestId, r.action, id);
    state.companion.requests = state.companion.requests.filter(r => !c.threadIds.has(r.threadId));
    state.companion.threads = state.companion.threads.filter(t => !c.threadIds.has(t.id));
  }
  state.messages = state.messages.filter(m => !m.threadId || !c.threadIds.has(m.threadId));
  const helps = new Set(c.helps.map(h => h.id));
  for (const h of c.helps) addRequest(history, h.ownerId!, h.requestId, 'help.create', id);
  state.helpRequests = state.helpRequests.filter(h => !helps.has(h.id));
  for (const upload of state.uploads.filter(u => deletedUploads.has(u.id))) history.fileTasks.push({ id: ctx.newId(), operationId: id, uploadId: upload.id, uploadUrl: upload.url, status: 'pending', createdAt: ctx.now });
  state.uploads = state.uploads.filter(u => !deletedUploads.has(u.id));
  const removedAssessments = new Set(c.assessments.map(a => a.id));
  for (const a of c.assessments) history.assessments.push({ id: a.id, knowledgeId: a.knowledgeId, createdAt: a.createdAt, operationId: id });
  state.mastery!.assessments = state.mastery!.assessments.filter(a => !removedAssessments.has(a.id));
  state.mastery!.previews = []; // Rule previews contain old derived grade summaries; no longer reproducible.
  for (const plan of state.mastery!.reviewPlans) if (operation.affectedReviewPlanIds.includes(plan.id)) plan.sourceHistoryDeletionId = id;
  // Old free-form audit details cannot prove their own absence of deleted work. Keep
  // only public editorial actions and structured exposure facts; never copy them to a receipt.
  state.events = state.events.flatMap(e => {
    if (e.action === 'learning.exposure') {
      try { const d = JSON.parse(e.detail); if (!d || !Array.isArray(d.familyIds) || !d.familyIds.every(isId) || !['hint','explanation'].includes(d.level) || typeof d.ruleVersion !== 'string') return [];
        return [{ ...e, detail: JSON.stringify({ familyIds: [...new Set(d.familyIds)], level: d.level, ruleVersion: d.ruleVersion }) }];
      } catch { return []; }
    }
    return e.action.startsWith('question.') || e.action.startsWith('rule.') || e.action.startsWith('content.') || e.action === 'history.delete.confirm' ? [e] : [];
  });
  state.revision = operation.appliedRevision;
  for (const k of state.knowledge) if (c.knowledge.has(k.id)) { k.stars = null; k.evidenceIds = []; delete k.assessmentId; delete k.assessmentState; }
  const assessmentIds = assessKnowledge(state, ctx, 'history-deletion');
  for (const a of state.mastery!.assessments) if (assessmentIds.includes(a.id)) a.historyDeletionId = id;
  state.events.unshift({ id: ctx.newId(), action: 'history.delete.confirm', label: '删除已选学习历史', actorId: ctx.userId, createdAt: ctx.now, detail: JSON.stringify({ operationId: id, evidenceCount: c.entries.length }) });
  return state;
}
export function previewHistoryDeletion(state: WorkspaceState, selected: HistoryDeletionSelection, ctx: Context): HistoryDeletionPreview {
  const c = closure(state, selected, ctx.userId); let serial = 0;
  const recognition = recognitionDeletionScope(state, selected.evidenceIds, c.photos.filter(p => p.willDelete).map(p => p.uploadId));
  const after = mutate(state, selected, { ...ctx, newId: () => `history-preview-${++serial}` }, 'preview', '0'.repeat(64));
  return { sourceRevision: state.revision, digest: hash({ actorId: ctx.userId, sourceRevision: state.revision, selection: selected }), selection: selected,
    recognition, evidenceCount: c.entries.length, mistakeCount: state.mistakes.filter(m => selected.evidenceIds.includes(m.evidenceId)).length,
    proposalCount: c.proposals.length, decisionCount: c.decisions.length, threadCount: c.threads.length, messageCount: state.messages.filter(m => m.threadId && c.threadIds.has(m.threadId)).length,
    draftCount: c.threads.filter(t => t.draft.text).length, helpRequestCount: c.helps.length, sharedHelpRequestCount: c.helps.filter(h => h.delivery === 'workspace').length,
    assessmentCount: c.assessments.length, auditEventCount: state.events.filter(e => e.action !== "learning.exposure" && !e.action.startsWith("question.") && !e.action.startsWith("rule.") && !e.action.startsWith("content.") && e.action !== "history.delete.confirm").length, rulePreviewCount: state.mastery?.previews.length ?? 0,
    reports: [...new Set(c.entries.map(e => e.attemptId))].map(attemptId => { const before = effectiveAttempt(state, attemptId)!, changed = effectiveAttempt(after, attemptId)!; return { attemptId, paperId: before.paperId, selectedCount: c.entries.filter(e => e.attemptId === attemptId).length, remainingCount: changed.answers.length, beforeCorrect: before.correctCount, afterCorrect: changed.correctCount }; }),
    knowledge: state.knowledge.map(k => { const changed = after.knowledge.find(v => v.id === k.id)!; return { knowledgeId: k.id, beforeStars: k.stars, afterStars: changed.stars, reason: changed.reason }; }),
    reviewPlans: c.plans.map(p => ({ planId: p.id, knowledgeId: p.knowledgeId, sourceWillBeUnavailable: !effectiveReviewSource(after, after.mastery!.reviewPlans.find(v => v.id === p.id)!).valid })), photos: c.photos, retainedOtherThreadCount: c.otherThreadCount,
    warnings: [...(recognition.captureIds.length ? [`本次同时清除 ${recognition.captureIds.length} 张关联原图的全部 ${recognition.runCount} 次机器识别文字（含旧识别与未分配行），以及 ${recognition.draftIds.length} 条未提交核对草稿；该图以后不能重扫或恢复草稿，未选中的已提交人工答案保留。`] : []), '为避免旧汇总或自由文本继续保存已删除内容，本次同时清理现存学习操作日志与全部规则影响预览；保留结构化曝光和教学内容管理日志。', '本次真正移除选中作答、过程、错题、更正记录及本人关联原卷对话和求助摘要；教学题目与空白原卷保留。', '其他人的私人会话、无明确原卷关联的普通或题库对话不自动删除。', '保留不含作答正文的已见题族、帮助资格及删除凭据，删除不会恢复独立新题资格。', '受影响旧评定正文移除，当前报告与星级按剩余证据重算；后续已完成的复查作答不连带删除。', '未选或仍有其他引用的照片保留；已导出到系统相册、其他应用或系统备份的副本不由本次删除控制。'] };
}
export function historyAction(current: WorkspaceState, action: string, input: Input, ctx: Context): ApiResult {
  check(ctx.role === 'student' || ctx.role === 'owner', '当前身份不能删除学习历史', 403);
  validateHistoryDeletion(current);
  check(action === 'history.delete.preview' || action === 'history.delete.confirm', '不支持的历史删除操作');
  keys(input, action === 'history.delete.preview' ? ['action', 'evidenceIds', 'uploadIds'] : ['action', 'evidenceIds', 'uploadIds', 'sourceRevision', 'digest', 'requestId']);
  const selected = selection(input);
  if (action === 'history.delete.preview') return { state: current, result: { preview: previewHistoryDeletion(current, selected, ctx) } };
  check(isId(input.requestId) && isRevision(input.sourceRevision) && isDigest(input.digest), '删除确认标识无效');
  const payloadDigest = hash({ selection: selected, sourceRevision: input.sourceRevision, digest: input.digest });
  const prior = current.historyDeletion?.operations.find(o => o.actorId === ctx.userId && o.requestId === input.requestId);
  if (prior) { check(prior.digest === payloadDigest, '同一删除请求 ID 对应不同内容', 409); return { state: current, result: { id: prior.id, deleted: true } }; }
  check(input.sourceRevision === current.revision, '删除预览已过期，请重新核对影响', 409);
  const preview = previewHistoryDeletion(current, selected, ctx);
  check(input.digest === preview.digest, '删除范围或预览已变化，请重新核对', 409);
  const state = mutate(current, selected, ctx, input.requestId, payloadDigest);
  validateHistoryDeletion(state);
  return { state, result: { id: state.historyDeletion!.operations.at(-1)!.id, deleted: true, message: '选中学习记录已移除；照片清理状态单独记录。' } };
}
/** Central guard also covers late callbacks from the old chat/evidence/help workflows. */
export function assertHistoryWriteAllowed(state: WorkspaceState, action: string, input: Input, actorId: string): void {
  if (!state.historyDeletion) return;
  if (typeof input.requestId === 'string') check(!state.historyDeletion.requests.some(r => r.actorId === actorId && r.requestId === input.requestId), '该请求涉及已删除学习记录，不能重放恢复', 410);
  if (action === 'chat.open') {
    const c = object(input.context);
    if (c.source === 'paper') check(!state.historyDeletion.evidence.some(e => e.paperId === c.paperId && e.questionId === c.questionId), '该题作答历史已删除，请从题库另开新的学习对话', 410);
  }
}
export function completeHistoryFileTasks(current: WorkspaceState, taskIds: string[], options: { now: string }): ApiResult {
  validateHistoryDeletion(current); const wanted = new Set(ids(taskIds));
  check([...wanted].every(id => current.historyDeletion?.fileTasks.some(t => t.id === id)), '文件清理任务不存在', 404);
  if (!current.historyDeletion?.fileTasks.some(t => wanted.has(t.id) && t.status === 'pending')) return { state: current, result: { completed: true } };
  check(isDate(options.now), '文件清理完成时间无效');
  const state = structuredClone(current);
  for (const task of state.historyDeletion!.fileTasks) if (wanted.has(task.id) && task.status === 'pending') { task.status = 'complete'; task.completedAt = options.now; }
  state.revision++; validateHistoryDeletion(state); return { state, result: { completed: true } };
}
export function completeHistoryFileTask(state: WorkspaceState, taskId: string, now: string): ApiResult { return completeHistoryFileTasks(state, [taskId], { now }); }
/** Strict raw validation: deletion holes are legal only with a complete, body-free receipt. */
export function validateHistoryDeletion(state: WorkspaceState): void {
  validateRecognitionState(state);
  if (!state.historyDeletion) return;
  const h = object(state.historyDeletion); keys(h, ['schemaVersion', 'operations', 'evidence', 'qualificationFacts', 'requests', 'assessments', 'fileTasks']);
  check(h.schemaVersion === 1, '删除档案版本无效');
  const rows = (v: unknown): Input[] => { check(Array.isArray(v), '删除档案列表无效'); return v.map(object); };
  const operations = new Map<string, HistoryDeletionOperation>(), requests = new Set<string>(), revisions = new Set<number>();
  for (const value of rows(h.operations)) {
    keys(value, ['id','actorId','requestId','digest','createdAt','appliedRevision','evidenceIds','knowledgeIds','deletedThreadIds','deletedHelpRequestIds','removedProposalIds','removedDecisionIds','deletedUploadIds','redactedAssessmentIds','affectedReviewPlanIds','reviewPlanSources']);
    check(isId(value.id) && isId(value.actorId) && isId(value.requestId) && isDigest(value.digest) && isDate(value.createdAt) && isRevision(value.appliedRevision) && value.appliedRevision > 0 && value.appliedRevision <= state.revision && !operations.has(value.id) && !revisions.has(value.appliedRevision), '删除操作身份或版本无效');
    const key = JSON.stringify([value.actorId, value.requestId]); check(!requests.has(key), '删除请求 ID 重复'); requests.add(key); revisions.add(value.appliedRevision);
    ids(value.evidenceIds, false); const ks = ids(value.knowledgeIds, false); check(ks.every(k => knowledgeIds.includes(k as KnowledgeId)), '删除知识点无效');
    for (const key of ['deletedThreadIds','deletedHelpRequestIds','removedProposalIds','removedDecisionIds','deletedUploadIds','redactedAssessmentIds','affectedReviewPlanIds']) ids(value[key]);
    const planSources = rows(value.reviewPlanSources), planSourceIds = new Set<string>();
    for (const snapshot of planSources) {
      keys(snapshot, ['planId','sourceRevision','createdAt']);
      check(isId(snapshot.planId) && !planSourceIds.has(snapshot.planId) && (value.affectedReviewPlanIds as string[]).includes(snapshot.planId) && isDate(snapshot.createdAt), '删除复查来源快照无效');
      check(snapshot.sourceRevision === undefined || isRevision(snapshot.sourceRevision) && snapshot.sourceRevision < value.appliedRevision, '复查历史来源不能晚于删除操作');
      planSourceIds.add(snapshot.planId);
    }
    check(planSourceIds.size === (value.affectedReviewPlanIds as string[]).length, '删除操作遗漏复查来源快照');
    operations.set(value.id, value as unknown as HistoryDeletionOperation);
  }
  const descriptors = new Set<string>(), descriptorIds = new Set<string>(), slots = new Set<string>();
  for (const e of rows(h.evidence)) {
    keys(e, ['id','operationId','evidenceId','attemptId','paperId','questionId','familyId','knowledgeId','createdAt','deletedAt']);
    const op = operations.get(String(e.operationId));
    check(['id','evidenceId','attemptId','paperId','questionId','familyId'].every(k => isId(e[k])) && isDate(e.createdAt) && isDate(e.deletedAt) && op && op.evidenceIds.includes(String(e.evidenceId)) && e.deletedAt === op.createdAt && knowledgeIds.includes(e.knowledgeId as KnowledgeId) && op.knowledgeIds.includes(e.knowledgeId as KnowledgeId), '删除证据凭据无效');
    const slot = pair(String(e.attemptId), String(e.questionId)); check(!descriptors.has(String(e.evidenceId)) && !descriptorIds.has(String(e.id)) && !slots.has(slot), '删除证据凭据重复'); descriptors.add(String(e.evidenceId)); descriptorIds.add(String(e.id)); slots.add(slot);
    const a = state.attempts.find(a => a.id === e.attemptId && a.paperId === e.paperId && a.status === 'submitted');
    const q = state.papers.find(p => p.id === e.paperId)?.questions.find(q => q.id === e.questionId);
    check(a && q && q.familyId === e.familyId && q.knowledgeId === e.knowledgeId && !a.answers.some(a => a.questionId === e.questionId) && !state.evidence.some(v => v.id === e.evidenceId || v.attemptId === e.attemptId && v.questionId === e.questionId), '删除凭据与原卷或剩余答案不一致');
    check(!state.mistakes.some(m => m.evidenceId === e.evidenceId) && !state.evidenceReviews?.proposals.some(p => p.evidenceId === e.evidenceId) && !state.evidenceReviews?.decisions.some(d => d.evidenceId === e.evidenceId), '已删除证据仍有正文副本');
    for (const r of state.paperReturns ?? []) if (r.paperId === e.paperId) check(!r.entries.some(a => a.questionId === e.questionId) && !r.onlineDraftSnapshot?.answers.some(a => a.questionId === e.questionId), '纸面回传仍含已删除答案');
  }
  for (const attempt of state.attempts) if (attempt.status === 'submitted') {
    const paper = state.papers.find(p => p.id === attempt.paperId); check(paper, '作答缺少原卷');
    const live = new Set(attempt.answers.map(a => a.questionId));
    check(live.size === attempt.answers.length && paper.questionIds.every(id => live.has(id) !== slots.has(pair(attempt.id, id))) && [...live].every(id => paper.questionIds.includes(id)), '作答缺失项与删除凭据不一致');
    if (state.historyDeletion.evidence.some(e => e.attemptId === attempt.id)) check(attempt.correctCount === attempt.answers.filter(a => a.correct).length && attempt.independentCount === attempt.answers.filter(a => a.help === 'independent').length, '删除后的剩余原始统计不一致');
  }
  for (const record of state.paperReturns ?? []) if (record.status === 'submitted') {
    const live = new Set(record.entries.map(e => e.questionId));
    check(live.size === record.entries.length && record.questionIds.every(id => live.has(id) !== slots.has(pair(record.attemptId!, id))), '纸面回传缺失项与删除凭据不一致');
  }
  for (const op of operations.values()) {
    check(op.evidenceIds.every(id => descriptors.has(id)), '删除操作缺少证据凭据');
    check(!state.companion?.threads.some(t => op.deletedThreadIds.includes(t.id)) && !state.messages.some(m => m.threadId && op.deletedThreadIds.includes(m.threadId)) && !state.helpRequests.some(h => op.deletedHelpRequestIds.includes(h.id)), '已删除对话或摘要仍有正文');
    check(!state.evidenceReviews?.proposals.some(p => op.removedProposalIds.includes(p.id)) && !state.evidenceReviews?.decisions.some(d => op.removedDecisionIds.includes(d.id)) && !state.mastery?.assessments.some(a => op.redactedAssessmentIds.includes(a.id)) && !state.uploads.some(u => op.deletedUploadIds.includes(u.id)), '删除操作仍含待移除记录');
    check(op.affectedReviewPlanIds.every(id => state.mastery?.reviewPlans.some(p => p.id === id)), '删除操作引用未知复查计划');
  }
  const facts = new Set<string>();
  for (const f of rows(h.qualificationFacts)) { keys(f, ['familyId','seen','help']); check(isId(f.familyId) && !facts.has(f.familyId) && f.seen === true && ['independent','unknown','hint','explanation'].includes(String(f.help)), '已见资格事实无效'); facts.add(f.familyId); }
  check(rows(h.evidence).every(e => facts.has(String(e.familyId))), '删除遗漏已见题族事实');
  const blocked = new Set<string>();
  for (const r of rows(h.requests)) { keys(r, ['actorId','requestId','action','operationId']); check(isId(r.actorId) && isId(r.requestId) && ['chat.send','chat.delete','help.create','evidence.propose','evidence.review','local.evidence.confirm'].includes(String(r.action)) && operations.has(String(r.operationId)), '已删除请求凭据无效'); const key = JSON.stringify([r.actorId,r.requestId,r.action]); check(!blocked.has(key), '已删除请求凭据重复'); blocked.add(key); }
  const assessmentIds = new Set<string>();
  for (const a of rows(h.assessments)) { keys(a, ['id','knowledgeId','createdAt','operationId']); const op = operations.get(String(a.operationId)); check(isId(a.id) && !assessmentIds.has(a.id) && knowledgeIds.includes(a.knowledgeId as KnowledgeId) && isDate(a.createdAt) && op?.redactedAssessmentIds.includes(a.id), '已删除评定凭据无效'); assessmentIds.add(a.id); }
  const taskIds = new Set<string>(), uploadIds = new Set<string>();
  for (const t of rows(h.fileTasks)) {
    keys(t, ['id','operationId','uploadId','uploadUrl','status','createdAt','completedAt']); const op = operations.get(String(t.operationId));
    check(isId(t.id) && !taskIds.has(t.id) && isId(t.uploadId) && !uploadIds.has(t.uploadId) && typeof t.uploadUrl === 'string' && t.uploadUrl.length > 0 && t.uploadUrl.length <= 3000 && op?.deletedUploadIds.includes(t.uploadId) && t.createdAt === op.createdAt && ['pending','complete'].includes(String(t.status)), '文件清理任务无效');
    check(t.status === 'pending' ? t.completedAt === undefined : isDate(t.completedAt), '文件清理完成状态无效'); taskIds.add(t.id); uploadIds.add(t.uploadId);
    check(!state.uploads.some(u => historyFileIdentity(u.url) === historyFileIdentity(String(t.uploadUrl))), '已删除文件仍有登记别名');
  }
  for (const op of operations.values()) check(op.deletedUploadIds.every(id => uploadIds.has(id)) && op.redactedAssessmentIds.every(id => assessmentIds.has(id)), '删除操作缺少文件或评定凭据');
  for (const plan of state.mastery?.reviewPlans ?? []) if (plan.sourceHistoryDeletionId) {
    const op = operations.get(plan.sourceHistoryDeletionId), snapshot = op?.reviewPlanSources.find(s => s.planId === plan.id);
    check(op?.affectedReviewPlanIds.includes(plan.id) && snapshot && snapshot.sourceRevision === plan.sourceRevision && snapshot.createdAt === plan.createdAt, '复查来源与删除时的历史快照不一致');
  }
  for (const a of state.mastery?.assessments ?? []) if (a.trigger === 'history-deletion' || a.historyDeletionId) { const op = operations.get(a.historyDeletionId || ''); check(a.trigger === 'history-deletion' && op && a.evidenceAsOfRevision === op.appliedRevision && a.createdAt === op.createdAt, '删除后重评凭据无效'); }
}
export const validateHistoryDeletionState = validateHistoryDeletion;
