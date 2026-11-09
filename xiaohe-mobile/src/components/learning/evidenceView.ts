import type { EffectiveEvidence, EffectiveAttempt, WorkspaceState } from '../../local/types';
import { effectiveAttempt, effectiveEvidence, effectiveMistakes, effectiveReviewSource } from '../../local/shared/effective-evidence.ts';

export { effectiveAttempt, effectiveEvidence, effectiveMistakes, effectiveReviewSource };
export function evidenceAuthorityLabel(authority: EffectiveEvidence['authority']): string {
  return authority === 'local-unverified' ? '本人本机核对 · 未经教师复核' : authority === 'teacher-verified' ? '教师复核记录' : '原始提交记录';
}
export function effectiveHelpLabel(evidence: Pick<EffectiveEvidence, 'help' | 'authority'>): string {
  if (evidence.help === 'independent' && evidence.authority === 'local-unverified') return '本人称独立 · 尚未核实';
  return { independent: '独立作答', hint: '使用提示', explanation: '看过讲解', unknown: '帮助情况待确认' }[evidence.help];
}
export const realEvidence = (state: WorkspaceState) => effectiveEvidence(state).filter(item => item.provenance !== 'demo' && !item.id.startsWith('demo-') && !item.attemptId.startsWith('demo-'));
export function effectiveReportCounts(attempt: EffectiveAttempt) {
  const answers = attempt.answers.filter(item => item.valid);
  return {
    correct: attempt.correctCount,
    independent: attempt.independentCorrect,
    hint: answers.filter(item => item.correct && item.help === 'hint').length,
    explanation: answers.filter(item => item.correct && item.help === 'explanation').length,
    unknown: answers.filter(item => item.help === 'unknown').length,
    needsCorrection: answers.filter(item => !item.correct).length,
    valid: answers.length,
    invalidated: attempt.invalidatedCount,
  };
}
export const evidenceLink = (id: string) => ({ pathname: '/evidence/[id]' as const, params: { id } });
export function effectiveReviewPlanCounts(state: WorkspaceState) {
  const unfinished = (state.mastery?.reviewPlans || []).filter(plan => plan.status !== 'completed');
  const blocked = unfinished.filter(plan => !plan.paperId && !effectiveReviewSource(state, plan).valid).length;
  return { readyOrWaiting: unfinished.length - blocked, blocked };
}
