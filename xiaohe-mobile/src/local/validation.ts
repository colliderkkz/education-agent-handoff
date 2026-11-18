import { LocalStorageError, type MasteryRule, type StoredLocalRecord, type WorkspaceState } from './types.ts';
import { allKnowledgeIds } from './shared/types.ts';
import { DEFAULT_RULE_PARAMETERS, validateRule } from './shared/server/mastery.ts';
import { validateContentState } from './shared/server/content.ts';
import { validateCompanionState } from './shared/server/companion.ts';
import { validateEvidenceReviews } from './shared/server/evidence.ts';
import { validateHistoryDeletion } from './shared/server/history.ts';
import { validateRecognition } from './shared/server/recognition.ts';
import { effectiveEvidence, evidenceEpoch } from './shared/effective-evidence.ts';

function check(ok: unknown): asserts ok {
  if (!ok) throw new LocalStorageError('本机学习数据不完整或已损坏，已保留原数据，未自动重置。请先备份本机数据再处理。', 'corrupt');
}
function object(v: unknown): Record<string, unknown> { check(v && typeof v === 'object' && !Array.isArray(v)); return v as Record<string, unknown>; }
function text(v: unknown): v is string { return typeof v === 'string'; }
function nonempty(v: unknown): v is string { return text(v) && v.length > 0; }
function integer(v: unknown): v is number { return Number.isSafeInteger(v) && Number(v) >= 0; }
function date(v: unknown): v is string { return nonempty(v) && Number.isFinite(Date.parse(v)); }
function list(v: unknown): unknown[] { check(Array.isArray(v)); return v; }
function strings(v: unknown): string[] { const a = list(v); check(a.every(text)); return a as string[]; }
function records(v: unknown): Record<string, unknown>[] {
  const rows = list(v).map(object);
  check(rows.every(r => nonempty(r.id)) && new Set(rows.map(r => r.id)).size === rows.length);
  return rows;
}
const knowledge: readonly string[] = allKnowledgeIds;
const help = ['independent', 'hint', 'explanation', 'unknown'];
function question(v: unknown): Record<string, unknown> {
  const q = object(v);
  check(nonempty(q.id) && nonempty(q.familyId) && integer(q.version) && q.version > 0);
  check(nonempty(q.text) && nonempty(q.answer) && text(q.unit) && knowledge.includes(String(q.knowledgeId)));
  check(['基础', '巩固', '挑战'].includes(String(q.difficulty)) && ['draft', 'review', 'approved', 'published', 'disabled'].includes(String(q.status)));
  check(nonempty(q.authorId) && text(q.hint) && text(q.alternative) && text(q.source) && text(q.sourceScope) && date(q.createdAt));
  strings(q.steps); strings(q.prerequisites);
  check(q.taskType === undefined && q.contextId === undefined || ['basic', 'application', 'transfer'].includes(String(q.taskType)) && nonempty(q.contextId));
  return q;
}

/** Validate before accepting disk data or committing; never silently repair a damaged dossier. */
export function validateWorkspace(value: unknown): asserts value is WorkspaceState {
  const s = object(value); const actor = object(s.actor); const profile = object(s.profile);
  check(integer(s.revision) && nonempty(actor.id) && actor.id.startsWith('local-') && actor.role === 'student' && text(actor.name));
  check(s.access === undefined);
  for (const key of ['name', 'grade', 'semester', 'course', 'textbook', 'school']) check(text(profile[key]));
  records(s.questions).forEach(question);
  const papers = records(s.papers); const attempts = records(s.attempts); const evidence = records(s.evidence);
  const state = value as WorkspaceState;
  if (s.recognition !== undefined) {
    try { validateRecognition(state); check(state.recognition!.captures.every(item => item.ownerId === actor.id)); }
    catch { check(false); }
  }
  if (s.historyDeletion !== undefined) {
    try {
      validateHistoryDeletion(state);
      check(state.historyDeletion!.operations.every(operation => operation.actorId === actor.id));
      check(state.historyDeletion!.fileTasks.every(task => task.uploadUrl.startsWith('file:///')));
    } catch { check(false); }
  }
  const deletedQuestionIds = (attemptId: unknown) => state.historyDeletion?.evidence.filter(entry => entry.attemptId === attemptId).map(entry => entry.questionId) ?? [];
  for (const p of papers) {
    check(nonempty(p.title) && integer(p.version) && p.version > 0 && date(p.createdAt) && text(p.reason) && integer(p.estimatedMinutes));
    check(['ready', 'in_progress', 'completed'].includes(String(p.status)) && ['practice', 'review', 'whole'].includes(String(p.kind)));
    const qs = records(p.questions).map(question); const ids = strings(p.questionIds);
    check(ids.length > 0 && ids.length === qs.length && ids.every((id, i) => id === qs[i].id));
  }
  check(new Set(attempts.map(a => a.paperId)).size === attempts.length);
  for (const a of attempts) {
    const p = papers.find(p => p.id === a.paperId);
    check(p && ['draft', 'submitted'].includes(String(a.status)) && date(a.startedAt) && integer(a.correctCount) && integer(a.independentCount));
    const answers = list(a.answers).map(object); const removedIds = deletedQuestionIds(a.id);
    check(removedIds.length === 0 || a.status === 'submitted');
    const ids = strings(p.questionIds).filter(id => !removedIds.includes(id));
    check(answers.length === ids.length && new Set(answers.map(a => a.questionId)).size === ids.length);
    for (const answer of answers) check(ids.includes(String(answer.questionId)) && text(answer.value) && text(answer.working) && help.includes(String(answer.help)) && (answer.correct === null || typeof answer.correct === 'boolean'));
    check(a.status === 'submitted' ? date(a.submittedAt) && p.status === 'completed' && answers.every(a => typeof a.correct === 'boolean') : p.status !== 'completed' && answers.every(a => a.correct === null));
    check(a.correctCount <= answers.length && a.independentCount <= answers.length);
  }
  for (const p of papers) if (p.status === 'completed') check(attempts.some(a => a.paperId === p.id && a.status === 'submitted'));
  for (const e of evidence) {
    const a = attempts.find(a => a.id === e.attemptId && a.status === 'submitted' && a.paperId === e.paperId);
    const p = papers.find(p => p.id === e.paperId);
    check(a && p && strings(p.questionIds).includes(String(e.questionId)) && knowledge.includes(String(e.knowledgeId)));
    check(text(e.questionText) && text(e.answer) && nonempty(e.expected) && help.includes(String(e.help)) && typeof e.correct === 'boolean' && date(e.createdAt) && integer(e.questionVersion));
    check(['original', 'practice', 'review'].includes(String(e.kind)) && (e.eligible === undefined || typeof e.eligible === 'boolean'));
  }
  const ks = records(s.knowledge);
  // 知识点数量随教材目录扩充而变化：存量档案只有 3 个 legacy 知识点，新档案可以更多。
  // 这里用区间而不是固定数量，否则扩充目录会让老档案被判为损坏而拒绝加载。
  check(ks.length >= 1 && ks.length <= allKnowledgeIds.length);
  check(new Set(ks.map(k => String(k.id))).size === ks.length);
  for (const k of ks) {
    check(knowledge.includes(String(k.id)) && text(k.name) && text(k.description) && text(k.reason) && nonempty(k.ruleVersion));
    check(['current', 'upcoming'].includes(String(k.learningState)) && stars(k.stars, s.mastery === undefined ? 3 : 5));
    if (s.mastery === undefined) check(k.ruleVersion === 'pilot-v2-max3' && k.assessmentId === undefined && k.assessmentState === undefined);
    check(strings(k.evidenceIds).every(id => evidence.some(e => e.id === id)));
  }
  for (const m of records(s.mistakes)) { question(m.question); check(evidence.some(e => e.id === m.evidenceId) && text(m.originalAnswer) && (m.correctedAnswer === undefined || text(m.correctedAnswer))); }
  for (const e of records(s.events)) check(nonempty(e.action) && text(e.label) && nonempty(e.actorId) && date(e.createdAt) && text(e.detail));
  for (const u of records(s.uploads)) check(text(u.name) && nonempty(u.url) && u.url.startsWith('file://') && date(u.createdAt) && ['pending', 'confirmed'].includes(String(u.status)) && ['single', 'homework'].includes(String(u.purpose)));
  if (s.paperReturns !== undefined) {
    const returns = records(s.paperReturns); const uploads = records(s.uploads); const boundPhotos = new Set<string>(); const boundFiles = new Set<string>();
    check(new Set(returns.map(r => r.paperId)).size === returns.length);
    for (const r of returns) {
      const p = papers.find(p => p.id === r.paperId);
      check(p && r.paperVersion === p.version && integer(r.revision) && r.revision > 0 && date(r.createdAt) && date(r.updatedAt));
      const ids = strings(r.questionIds); const paperIds = strings(p.questionIds);
      check(ids.length === paperIds.length && ids.every((id, i) => id === paperIds[i]) && ['draft', 'submitted'].includes(String(r.status)));
      const photoIds = strings(r.uploadIds);
      check(photoIds.length <= 10 && new Set(photoIds).size === photoIds.length);
      for (const id of photoIds) {
        const photo = uploads.find(u => u.id === id);
        check(photo && nonempty(photo.url) && photo.url.startsWith('file:///') && !boundPhotos.has(id) && !boundFiles.has(photo.url));
        check(r.status === 'submitted' ? photo.status === 'confirmed' : photo.status === 'pending');
        boundPhotos.add(id); boundFiles.add(photo.url);
      }
      const entries = list(r.entries).map(object);
      const removedIds = r.status === 'submitted' ? deletedQuestionIds(r.attemptId) : [];
      const retainedIds = ids.filter(id => !removedIds.includes(id));
      check(entries.length === retainedIds.length);
      for (const [index, entry] of entries.entries()) check(entry.questionId === retainedIds[index] && text(entry.value) && text(entry.working) && text(entry.claimedHelp) && help.includes(entry.claimedHelp) && typeof entry.confirmed === 'boolean' && typeof entry.unitConfirmed === 'boolean');
      if (r.status === 'submitted') {
        const attempt = attempts.find(a => a.id === r.attemptId && a.paperId === r.paperId && a.status === 'submitted');
        check(attempt && nonempty(r.submissionKey) && attempt.submissionKey === r.submissionKey && date(r.submittedAt) && (photoIds.length > 0 || removedIds.length > 0 && entries.length === 0) && entries.every(e => e.confirmed === true && e.unitConfirmed === true));
        const answers = list(attempt.answers).map(object);
        check(entries.every(entry => answers.some(a => a.questionId === entry.questionId && a.value === entry.value && a.working === entry.working && a.help !== 'independent')));
      } else check(r.submittedAt === undefined && r.submissionKey === undefined && r.attemptId === undefined && r.onlineDraftSnapshot === undefined);
      if (r.onlineDraftSnapshot !== undefined) {
        const prior = object(r.onlineDraftSnapshot); const answers = list(prior.answers).map(object);
        check(prior.paperId === r.paperId && prior.id === r.attemptId && prior.status === 'draft' && date(prior.startedAt) && prior.correctCount === 0 && prior.independentCount === 0);
        check(answers.length === retainedIds.length && new Set(answers.map(a => a.questionId)).size === retainedIds.length);
        for (const answer of answers) check(retainedIds.includes(String(answer.questionId)) && text(answer.value) && text(answer.working) && help.includes(String(answer.help)) && answer.correct === null);
      }
    }
  }
  for (const h of records(s.helpRequests)) check(text(h.topic) && text(h.summary) && date(h.createdAt) && ['waiting', 'received', 'replied'].includes(String(h.status)) && (h.reply === undefined || text(h.reply)));
  for (const m of records(s.messages)) check(['user', 'assistant'].includes(String(m.role)) && text(m.text) && date(m.createdAt));
  const c = object(s.capabilities); check(c.ai === false && c.ocr === false && c.speech === false && c.storage === true);
  if (s.mastery !== undefined) validateMastery(s, papers, attempts, evidence, ks);
  if (s.content !== undefined) {
    try { validateContentState(value as WorkspaceState); }
    catch { check(false); }
  }
  if (s.companion !== undefined) {
    try { validateCompanionState(value as WorkspaceState); }
    catch { check(false); }
  }
  if (s.evidenceReviews !== undefined) {
    try {
      const state = value as WorkspaceState;
      validateEvidenceReviews(state);
      check(state.evidenceReviews!.proposals.every(p => p.delivery === 'local-only' && p.requestedBy === actor.id));
      check(state.evidenceReviews!.decisions.every(d => d.authority === 'local-unverified' && d.actorId === actor.id));
    } catch { check(false); }
  }
}

function stars(value: unknown, maximum = 5): boolean { return value === null || integer(value) && value >= 1 && value <= maximum; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
const ruleLabel = (r: Record<string, unknown>) => r.mode === 'legacy-pilot' ? 'pilot-v2-max3' : `${r.id}/v${r.version}`;

/** The optional container allows old dossiers to be read before an atomic migration. */
function validateMastery(s: Record<string, unknown>, papers: Record<string, unknown>[], attempts: Record<string, unknown>[], evidence: Record<string, unknown>[], ks: Record<string, unknown>[]) {
  const m = object(s.mastery); check(m.schemaVersion === 1);
  const rules = records(m.rules), assessments = records(m.assessments), plans = records(m.reviewPlans), previews = records(m.previews);
  check(rules.length > 0 && rules.some(r => r.id === m.activeRuleId && r.status === 'published'));
  for (const r of rules) {
    check(integer(r.version) && integer(r.revision) && r.revision > 0 && nonempty(r.name) && nonempty(r.authorId));
    check(['five-star', 'legacy-pilot'].includes(String(r.mode)) && ['draft', 'review', 'approved', 'published', 'disabled'].includes(String(r.status)) && r.validation === 'unvalidated-trial');
    check(date(r.createdAt) && date(r.updatedAt) && (r.publishedAt === undefined || date(r.publishedAt)));
    check((r.reviewerId === undefined || nonempty(r.reviewerId)) && (r.reviewNote === undefined || text(r.reviewNote)));
    const parameters = object(r.parameters); const keys = Object.keys(DEFAULT_RULE_PARAMETERS);
    check(Object.keys(parameters).length === keys.length && keys.every(key => finite(parameters[key])));
    // Drafts intentionally retain finite but invalid settings so authors can fix them.
    if (r.status !== 'draft') check(validateRule(r as unknown as MasteryRule).length === 0);
  }
  for (const a of assessments) {
    const rule = rules.find(r => r.id === a.ruleId);
    check(rule && knowledge.includes(String(a.knowledgeId)) && a.ruleVersion === ruleLabel(rule) && date(a.createdAt));
    check(['migration', 'submission', 'reevaluate', 'rule-switch', 'evidence-correction', 'history-deletion'].includes(String(a.trigger)) && typeof a.legacy === 'boolean');
    check(a.legacy === (rule.mode === 'legacy-pilot') && stars(a.beforeStars) && stars(a.afterStars, a.legacy ? 3 : 5));
    check(['unlearned', 'insufficient', 'assessed'].includes(String(a.state)) && (a.state === 'assessed' ? a.afterStars !== null : a.afterStars === null));
    check(text(a.reason)); strings(a.gaps);
    const used = strings(a.adoptedEvidenceIds); const excluded = list(a.excludedEvidence).map(object);
    const all = [...used, ...excluded.map(e => { check(nonempty(e.evidenceId) && text(e.reason)); return e.evidenceId; })];
    check(a.evidenceAsOfRevision === undefined || integer(a.evidenceAsOfRevision) && a.evidenceAsOfRevision <= Number(s.revision));
    const state = s as unknown as WorkspaceState;
    const asOf = Number(a.evidenceAsOfRevision ?? 0);
    const historicalEvidence = effectiveEvidence(state, asOf);
    check(new Set(all).size === all.length && all.every(id => historicalEvidence.some(e => e.id === id && e.knowledgeId === a.knowledgeId)));
    check(a.evidenceEpoch === undefined || integer(a.evidenceEpoch) && a.evidenceEpoch === evidenceEpoch(state, a.knowledgeId as WorkspaceState['knowledge'][number]['id'], asOf));
    if (a.attemptId !== undefined) check(attempts.some(attempt => attempt.id === a.attemptId && attempt.status === 'submitted'));
    if (a.evidenceRevisionId !== undefined) check(nonempty(a.evidenceRevisionId) && a.trigger === 'evidence-correction' && state.evidenceReviews?.decisions.some(d => d.id === a.evidenceRevisionId && d.outcome === 'accept' && d.appliedRevision === asOf));
    if (a.trigger === 'evidence-correction') check(nonempty(a.evidenceRevisionId) && integer(a.evidenceAsOfRevision) && integer(a.evidenceEpoch));
    if (a.historyDeletionId !== undefined) check(a.trigger === 'history-deletion' && state.historyDeletion?.operations.some(operation => operation.id === a.historyDeletionId && operation.appliedRevision === asOf && operation.createdAt === a.createdAt));
    if (a.trigger === 'history-deletion') check(nonempty(a.historyDeletionId) && integer(a.evidenceAsOfRevision) && integer(a.evidenceEpoch));
    const conditions = list(a.conditions).map(object);
    check(new Set(conditions.map(c => c.key)).size === conditions.length);
    for (const c of conditions) check(nonempty(c.key) && text(c.label) && typeof c.met === 'boolean' && finite(c.actual) && finite(c.required) && c.met === (c.actual >= c.required));
  }
  for (const k of ks) {
    check(rules.some(r => ruleLabel(r) === k.ruleVersion));
    if (k.assessmentState !== undefined) check(['unlearned', 'insufficient', 'assessed'].includes(String(k.assessmentState)));
    if (k.assessmentId !== undefined) {
      const assessment = assessments.filter(a => a.knowledgeId === k.id).at(-1);
      check(assessment && assessment.id === k.assessmentId && assessment.afterStars === k.stars && assessment.ruleVersion === k.ruleVersion && assessment.state === k.assessmentState && assessment.reason === k.reason);
      check(JSON.stringify(assessment.adoptedEvidenceIds) === JSON.stringify(k.evidenceIds));
    } else check(k.ruleVersion === 'pilot-v2-max3' || k.stars === null && strings(k.evidenceIds).length === 0);
  }
  check(new Set(plans.map(p => `${p.sourceAttemptId}:${p.knowledgeId}`)).size === plans.length);
  for (const p of plans) {
    const source = attempts.find(a => a.id === p.sourceAttemptId && a.paperId === p.sourcePaperId && a.status === 'submitted');
    const sourcePaper = papers.find(paper => paper.id === p.sourcePaperId);
    check(source && nonempty(source.id) && !source.id.startsWith('demo-') && sourcePaper && sourcePaper.kind !== 'review' && date(source.submittedAt));
    check(p.sourceRevision === undefined || integer(p.sourceRevision) && p.sourceRevision <= Number(s.revision));
    const removedSource = p.sourceHistoryDeletionId !== undefined;
    if (removedSource) check((s as unknown as WorkspaceState).historyDeletion?.operations.some(operation => operation.id === p.sourceHistoryDeletionId && operation.affectedReviewPlanIds.includes(String(p.id))));
    if (p.sourceRevision !== undefined && !removedSource) check((s as unknown as WorkspaceState).evidenceReviews?.decisions.some(d => d.outcome === 'accept' && d.appliedRevision === p.sourceRevision && d.createdAt === p.createdAt));
    const sourceMapped = p.sourceRevision === undefined
      ? list(sourcePaper.questions).map(object).some(q => q.knowledgeId === p.knowledgeId)
      : effectiveEvidence(s as unknown as WorkspaceState, Number(p.sourceRevision)).some(e => e.attemptId === p.sourceAttemptId && e.knowledgeId === p.knowledgeId && e.valid);
    check((sourceMapped || removedSource) && rules.some(r => r.id === p.ruleId));
    check(integer(p.delayDays) && p.delayDays >= 1 && p.delayDays <= 365 && date(p.createdAt) && date(p.dueAt) && text(p.reason));
    check(Date.parse(p.dueAt) >= Date.parse(source.submittedAt) + p.delayDays * 86400000);
    check(['scheduled', 'started', 'completed'].includes(String(p.status)));
    if (p.status === 'scheduled') check(p.paperId === undefined && p.attemptId === undefined && p.completedAt === undefined);
    else {
      const paper = papers.find(paper => paper.id === p.paperId && paper.reviewPlanId === p.id && paper.kind === 'review');
      check(paper && date(paper.createdAt) && Date.parse(paper.createdAt) >= Date.parse(p.dueAt) && list(paper.questions).map(object).every(q => q.knowledgeId === p.knowledgeId));
      if (p.status === 'completed') {
        const attempt = attempts.find(a => a.id === p.attemptId && a.paperId === p.paperId && a.status === 'submitted');
        check(attempt && p.completedAt === attempt.submittedAt && date(p.completedAt));
      } else check(p.attemptId === undefined && p.completedAt === undefined && paper.status !== 'completed');
    }
  }
  for (const p of papers) if (p.reviewPlanId !== undefined) check(plans.some(plan => plan.id === p.reviewPlanId && plan.paperId === p.id));
  for (const e of evidence) {
    check(e.taskType === undefined && e.contextId === undefined || ['basic', 'application', 'transfer'].includes(String(e.taskType)) && nonempty(e.contextId));
    check(e.provenance === undefined || ['online', 'paper', 'demo'].includes(String(e.provenance)));
    if (e.reviewPlanId !== undefined) check(plans.some(p => p.id === e.reviewPlanId && p.paperId === e.paperId && p.attemptId === e.attemptId && p.knowledgeId === e.knowledgeId));
  }
  for (const p of previews) {
    const rule = rules.find(r => r.id === p.ruleId);
    check(rule && integer(p.ruleRevision) && p.ruleRevision > 0 && p.ruleRevision <= Number(rule.revision));
    check(integer(p.sourceRevision) && p.sourceRevision <= Number(s.revision) && date(p.createdAt) && nonempty(p.actorId) && typeof p.learnerVisible === 'boolean');
    strings(p.issues); const changes = list(p.changes).map(object);
    check(p.learnerVisible || changes.length === 0);
    for (const c of changes) check(knowledge.includes(String(c.knowledgeId)) && stars(c.beforeStars) && stars(c.afterStars) && text(c.reason));
  }
}

export function encodeWorkspace(workspace: WorkspaceState): StoredLocalRecord {
  validateWorkspace(workspace);
  return { revision: workspace.revision, payload: JSON.stringify({ schemaVersion: 1, workspace }) };
}
export function decodeWorkspace(record: StoredLocalRecord): WorkspaceState {
  try {
    check(integer(record.revision) && text(record.payload));
    const envelope = object(JSON.parse(record.payload));
    check(envelope.schemaVersion === 1);
    validateWorkspace(envelope.workspace);
    check(envelope.workspace.revision === record.revision);
    return envelope.workspace;
  } catch (error) {
    if (error instanceof LocalStorageError) throw error;
    throw new LocalStorageError('无法读取本机学习数据，已保留原数据，未自动重置。请先备份本机数据再处理。', 'corrupt');
  }
}
