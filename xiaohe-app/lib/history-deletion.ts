import type { DeletedEvidenceDescriptor, HelpLevel, KnowledgeId, WorkspaceState } from './types.ts';

/** File identity survives an iOS container relocation; arbitrary paths never gain deletion authority. */
export function historyFileIdentity(url: string): string {
  const owned = url.match(/\/xiaohe-images\/([a-f0-9-]{36}\.(?:jpe?g|png|webp|heic|heif|gif|avif))$/i);
  return owned ? `xiaohe-images/${owned[1].toLowerCase()}` : url;
}
export function historyDeletedUpload(state: WorkspaceState, uploadId: string, url?: string): boolean {
  return Boolean(state.historyDeletion?.fileTasks.some(t => t.uploadId === uploadId || url !== undefined && historyFileIdentity(t.uploadUrl) === historyFileIdentity(url)));
}
export function deletedEvidenceForAttempt(state: WorkspaceState, attemptId: string): DeletedEvidenceDescriptor[] {
  return (state.historyDeletion?.evidence ?? []).filter(e => e.attemptId === attemptId);
}
export function historyDeletionEpoch(state: WorkspaceState, knowledgeId: KnowledgeId, asOfRevision = state.revision): number {
  return Math.max(0, ...(state.historyDeletion?.operations ?? []).filter(o => o.appliedRevision <= asOfRevision && o.knowledgeIds.includes(knowledgeId)).map(o => o.appliedRevision));
}
export function retainedHistoryHelp(state: WorkspaceState, familyId: string): HelpLevel | undefined {
  return state.historyDeletion?.qualificationFacts.find(f => f.familyId === familyId)?.help;
}
