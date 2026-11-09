// Generated from xiaohe-app/lib/effective-evidence.ts; SHA-256: 5f8d813c4905cd7c79cd5605c286dd055f25a95e1b00d72f69ec5970306ce93a
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import type { EffectiveAttempt, EffectiveEvidence, EffectiveMistake, EffectiveReviewSource, Evidence, EvidenceDecision, EvidencePatch, KnowledgeId, ReviewPlan, WorkspaceState } from "./types.ts";
import { deletedEvidenceForAttempt, historyDeletionEpoch } from "./history-deletion.ts";
import { gradeAnswer } from "./grading.ts";
import { sha256 } from "./server/content.ts";

/** Validate the immutable source first. Overrides never have to match the old answer. */
export function originalEvidenceProblem(state: WorkspaceState, entry: Evidence): string | undefined {
  if (entry.id.startsWith("demo-") || entry.attemptId.startsWith("demo-") || entry.paperId.startsWith("demo-") || entry.provenance === "demo") return "演示历史不计真实评定";
  const attempt = state.attempts.find(a => a.id === entry.attemptId && a.paperId === entry.paperId && a.status === "submitted");
  const paper = state.papers.find(p => p.id === entry.paperId);
  const q = paper?.questions.find(q => q.id === entry.questionId && q.version === entry.questionVersion);
  const answer = attempt?.answers.find(a => a.questionId === entry.questionId);
  if (!q || !answer || answer.value !== entry.answer || answer.correct !== entry.correct || answer.help !== entry.help || q.knowledgeId !== entry.knowledgeId || q.familyId !== entry.familyId || q.answer !== entry.expected || q.text !== entry.questionText) return "缺少匹配的不可变原卷与正式作答";
  if (entry.taskType !== q.taskType || entry.contextId !== q.contextId) return "证据任务标签与原卷快照不一致";
  return undefined;
}

export function acceptedEvidenceDecisions(state: WorkspaceState, asOfRevision = state.revision): EvidenceDecision[] {
  return (state.evidenceReviews?.decisions ?? []).filter(d => d.outcome === "accept" && d.appliedRevision <= asOfRevision).slice().sort((a, b) => a.appliedRevision - b.appliedRevision);
}

/** Shared by raw evaluation and submitted-record projections; never mutates originals. */
export function effectiveEvidence(state: WorkspaceState, asOfRevision = state.revision): EffectiveEvidence[] {
  const proposals = new Map((state.evidenceReviews?.proposals ?? []).map(p => [p.id, p]));
  const changes = new Map<string, EvidenceDecision[]>();
  for (const decision of acceptedEvidenceDecisions(state, asOfRevision)) {
    const group = changes.get(decision.evidenceId) ?? []; group.push(decision); changes.set(decision.evidenceId, group);
  }
  return state.evidence.map(original => {
    const entry: EffectiveEvidence = { ...original, original: { ...original }, valid: true, authority: "original" };
    const unverified = new Set<keyof EvidencePatch>();
    for (const decision of changes.get(original.id) ?? []) {
      const proposal = proposals.get(decision.proposalId);
      if (!proposal) continue; // A role projection may intentionally omit a private request.
      const patch = proposal.patch;
      if (patch.answer !== undefined) entry.answer = patch.answer;
      if (patch.knowledgeId !== undefined) entry.knowledgeId = patch.knowledgeId;
      if (patch.help !== undefined) entry.help = patch.help;
      if (patch.invalidated !== undefined) entry.valid = !patch.invalidated;
      for (const key of Object.keys(patch) as (keyof EvidencePatch)[]) {
        if (decision.authority === "local-unverified") unverified.add(key); else unverified.delete(key);
      }
      entry.authority = unverified.size ? "local-unverified" : decision.authority; entry.decisionId = decision.id;
    }
    const q = state.papers.find(p => p.id === entry.paperId)?.questions.find(q => q.id === entry.questionId && q.version === entry.questionVersion);
    if (entry.decisionId && q) entry.correct = gradeAnswer(entry.answer, q);
    if (unverified.size) entry.unverifiedFields = [...unverified].sort();
    const sourceProblem = originalEvidenceProblem(state, original);
    entry.masteryBlockedReason = !entry.valid ? "该证据已被排除，原始记录仍保留（不是删除）" : sourceProblem || (entry.authority === "local-unverified" ? "本人更正尚未由教师核实，不计掌握证据" : undefined);
    entry.eligible = original.eligible === true && entry.valid && !entry.masteryBlockedReason && entry.help === "independent";
    if (entry.decisionId) entry.reason = entry.masteryBlockedReason || (entry.help === "independent" && !entry.eligible ? "帮助标记已更正；原始新题独立资格未因此恢复" : "按已保存的教师更正结果核对；原始记录保留");
    if (!entry.masteryBlockedReason) delete entry.masteryBlockedReason;
    return entry;
  });
}

export function effectiveAttempt(state: WorkspaceState, attemptId: string, asOfRevision = state.revision): EffectiveAttempt | undefined {
  const original = state.attempts.find(a => a.id === attemptId);
  const paper = state.papers.find(p => p.id === original?.paperId);
  if (!original || !paper) return undefined;
  const entries = new Map(effectiveEvidence(state, asOfRevision).filter(e => e.attemptId === attemptId).map(e => [e.questionId, e]));
  const deleted = deletedEvidenceForAttempt(state, attemptId);
  const answers = original.answers.filter(a => !deleted.some(d => d.questionId === a.questionId)).map(answer => {
    const entry = entries.get(answer.questionId), q = paper.questions.find(q => q.id === answer.questionId)!;
    return { ...answer, original: { ...answer }, knowledgeId: entry?.knowledgeId ?? q.knowledgeId, valid: entry?.valid ?? true, authority: entry?.authority ?? "original" as const,
      ...(entry ? { evidenceId: entry.id, value: entry.answer, correct: entry.correct, help: entry.help, ...(entry.decisionId ? { decisionId: entry.decisionId } : {}) } : {}) };
  });
  return { ...original, answers, originalCorrectCount: deleted.length ? null : original.correctCount, originalIndependentCount: deleted.length ? null : original.independentCount, deletedCount: deleted.length, retainedCount: answers.length,
    correctCount: answers.filter(a => a.valid && a.correct === true).length,
    independentCount: answers.filter(a => a.valid && a.help === "independent").length,
    independentCorrect: answers.filter(a => a.valid && a.correct === true && a.help === "independent").length,
    invalidatedCount: answers.filter(a => !a.valid).length };
}

export function effectiveMistakes(state: WorkspaceState, options: { includeInactive?: boolean; asOfRevision?: number } = {}): EffectiveMistake[] {
  const result: EffectiveMistake[] = [];
  for (const entry of effectiveEvidence(state, options.asOfRevision ?? state.revision)) {
    const original = state.mistakes.find(m => m.evidenceId === entry.id);
    const active = entry.valid && !entry.correct;
    if (!active && (!options.includeInactive || !original)) continue;
    const q = state.papers.find(p => p.id === entry.paperId)?.questions.find(q => q.id === entry.questionId && q.version === entry.questionVersion);
    if (!q) continue;
    const base = original ?? { id: `effective-mistake-${sha256(entry.id).slice(0, 24)}`, question: q, originalAnswer: entry.original.answer, evidenceId: entry.id };
    result.push({ ...base, question: { ...base.question, knowledgeId: entry.knowledgeId }, currentAnswer: entry.answer, knowledgeId: entry.knowledgeId, active, effectiveEvidence: entry });
  }
  return result;
}

export function effectiveReviewSource(state: WorkspaceState, plan: ReviewPlan, asOfRevision = state.revision): EffectiveReviewSource {
  const source = state.attempts.find(a => a.id === plan.sourceAttemptId && a.paperId === plan.sourcePaperId && a.status === "submitted");
  if (!source || source.id.startsWith("demo-")) return { valid: false, reason: "复查计划缺少真实提交来源", evidenceIds: [] };
  // Paper and local-unverified learning may still justify practice, never verified stars.
  const entries = effectiveEvidence(state, asOfRevision).filter(e => e.attemptId === source.id && e.knowledgeId === plan.knowledgeId && e.valid && !originalEvidenceProblem(state, e.original));
  return { valid: entries.length > 0, reason: entries.length ? "来源仍有该知识点的有效学习记录；计划本身不代表升星资格" : (plan.sourceHistoryDeletionId ? "来源学习记录已删除，无法再证明本次间隔复查来源；已发试卷与后续作答保留" : "来源证据已排除或移到其他知识点；原计划与已发试卷保留"), evidenceIds: entries.map(e => e.id) };
}

/** Only accepted integrity changes advance the epoch, not ordinary new attempts. */
export function evidenceEpoch(state: WorkspaceState, knowledgeId: KnowledgeId, asOfRevision = state.revision): number {
  const knowledge = new Map(state.evidence.map(e => [e.id, e.knowledgeId]));
  const proposals = new Map((state.evidenceReviews?.proposals ?? []).map(p => [p.id, p]));
  let epoch = historyDeletionEpoch(state, knowledgeId, asOfRevision);
  for (const decision of acceptedEvidenceDecisions(state, asOfRevision)) {
    const proposal = proposals.get(decision.proposalId); if (!proposal) continue;
    const before = knowledge.get(decision.evidenceId), after = proposal.patch.knowledgeId ?? before;
    if (before === knowledgeId || after === knowledgeId) epoch = Math.max(epoch, decision.appliedRevision);
    if (after) knowledge.set(decision.evidenceId, after);
  }
  return epoch;
}
