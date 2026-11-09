import type { HistoryDeletionOperation, HistoryDeletionPreview, HistoryDeletionSelection, WorkspaceState } from '../local/types';

const unique = (ids: readonly string[]) => [...new Set(ids)].sort();
export function historySelection(evidenceIds: readonly string[], uploadIds: readonly string[] = []): HistoryDeletionSelection {
  return { evidenceIds: unique(evidenceIds), uploadIds: unique(uploadIds) };
}
export const historySelectionKey = (selection: HistoryDeletionSelection) => JSON.stringify(historySelection(selection.evidenceIds, selection.uploadIds));
export function historyCandidates(state: WorkspaceState) {
  const submitted = new Set(state.attempts.filter(item => item.status === 'submitted' && !item.id.startsWith('demo-')).map(item => item.id));
  return state.evidence.filter(item => submitted.has(item.attemptId) && item.provenance !== 'demo' && !item.id.startsWith('demo-')).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function initialHistorySelection(state: WorkspaceState, evidenceId?: string, paperId?: string) {
  return historySelection(historyCandidates(state).filter(item => evidenceId ? item.id === evidenceId : paperId ? item.paperId === paperId : false).map(item => item.id));
}
export function historyPreviewCurrent(preview: HistoryDeletionPreview | null, selection: HistoryDeletionSelection, revision: number): preview is HistoryDeletionPreview {
  return !!preview && preview.sourceRevision === revision && historySelectionKey(preview.selection) === historySelectionKey(selection);
}
export function historyConfirmPayload(preview: HistoryDeletionPreview | null, selection: HistoryDeletionSelection, revision: number, requestId: string, acknowledged: boolean) {
  if (!selection.evidenceIds.length) throw new Error('请先选择需要删除的已提交作答。');
  if (!historyPreviewCurrent(preview, selection, revision)) throw new Error('记录或选择已经变化，请重新预览删除影响。');
  if (!acknowledged) throw new Error('请先确认已了解报告变化、关联清除和照片保留范围。');
  if (!requestId.trim()) throw new Error('未能建立本次删除请求，请重新预览。');
  return { ...historySelection(selection.evidenceIds, selection.uploadIds), sourceRevision: preview.sourceRevision, digest: preview.digest, requestId };
}
export function findHistoryOperation(state: WorkspaceState, requestId: string): HistoryDeletionOperation | undefined {
  return state.historyDeletion?.operations.find(item => item.actorId === state.actor.id && item.requestId === requestId);
}
export const historyLink = (params: { evidenceId?: string; paperId?: string } = {}) => ({ pathname: '/history-delete' as const, params });
export const deletedForAttempt = (state: WorkspaceState, attemptId: string) => state.historyDeletion?.evidence.filter(item => item.attemptId === attemptId) || [];
export const isDeletedEvidence = (state: WorkspaceState, evidenceId: string) => !!state.historyDeletion?.evidence.some(item => item.evidenceId === evidenceId);
export const historyRequestWasDeleted = (state: WorkspaceState, requestId: string) => !!state.historyDeletion?.requests.some(item => item.actorId === state.actor.id && item.requestId === requestId);

/** Keep only text changed on this page; saved bodies must not reappear after deletion. */
export function unsavedDeletedFields<T extends { value: string; working: string }>(local: T, saved: Pick<T, 'value' | 'working'>): Pick<T, 'value' | 'working'> {
  return { value: local.value === saved.value ? '' : local.value, working: local.working === saved.working ? '' : local.working };
}
