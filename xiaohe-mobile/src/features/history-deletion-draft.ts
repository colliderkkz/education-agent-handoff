import type { DraftAnswer, DraftState } from '../components/learning/draftMerge';
import type { ReturnContent } from '../components/learning/paperReturnDraft';

/** Deletion is not a remote blank answer: clear saved bodies without auto-saving them back. */
export function redactDraftAnswers(local: readonly DraftAnswer[], base: readonly DraftAnswer[], questionIds: readonly string[]): DraftAnswer[] {
  const deleted = new Set(questionIds);
  return local.map(answer => {
    if (!deleted.has(answer.questionId)) return { ...answer };
    const saved = base.find(item => item.questionId === answer.questionId);
    return { questionId: answer.questionId, value: !saved || answer.value === saved.value ? '' : answer.value, working: !saved || answer.working === saved.working ? '' : answer.working };
  });
}
export function redactPracticeDraft(draft: DraftState, questionIds: readonly string[]): DraftState {
  const deleted = new Set(questionIds);
  return { base: draft.base.map(answer => deleted.has(answer.questionId) ? { questionId: answer.questionId, value: '', working: '' } : { ...answer }), local: redactDraftAnswers(draft.local, draft.base, questionIds), conflicts: draft.conflicts.filter(item => !deleted.has(item.questionId)).map(item => ({ ...item })) };
}
export function redactReturnContent(local: ReturnContent, base: ReturnContent, questionIds: readonly string[], uploadIds: readonly string[]): ReturnContent {
  const deleted = new Set(questionIds), photos = new Set(uploadIds);
  const answers = redactDraftAnswers(local.entries, base.entries, questionIds);
  return { uploadIds: local.uploadIds.filter(id => !photos.has(id)), entries: local.entries.map(entry => deleted.has(entry.questionId) ? { ...entry, ...answers.find(answer => answer.questionId === entry.questionId)!, claimedHelp: 'unknown', confirmed: false, unitConfirmed: false } : { ...entry }) };
}
