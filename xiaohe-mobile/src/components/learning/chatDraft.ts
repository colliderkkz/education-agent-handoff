import type { ChatIntent, CompanionThread } from '../../local/types';

export type ChatDraft = CompanionThread['draft'];
export type ChatInput = Pick<ChatDraft, 'text' | 'intent'>;
export type ChatConflict = { field: keyof ChatInput; local: string; remote: string };
export type ChatDraftState = { base: ChatDraft; local: ChatInput; conflicts: ChatConflict[] };
export const sameChatInput = (a: ChatInput, b: ChatInput) => a.text === b.text && a.intent === b.intent;
export const createChatDraft = (draft: ChatDraft): ChatDraftState => ({ base: { ...draft }, local: { text: draft.text, intent: draft.intent }, conflicts: [] });
export function reconcileChatDraft(current: ChatDraftState, remote: ChatDraft): ChatDraftState {
  if (remote.revision < current.base.revision) return current;
  const local = { ...current.local };
  const conflicts: ChatConflict[] = [];
  for (const field of ['text', 'intent'] as const) {
    const priorConflict = current.conflicts.find(item => item.field === field);
    if (local[field] === remote[field]) continue;
    if (!priorConflict && local[field] === current.base[field]) {
      if (field === 'intent') local.intent = remote.intent; else local.text = remote.text;
    } else if (priorConflict || remote[field] !== current.base[field]) conflicts.push({ field, local: local[field], remote: remote[field] });
  }
  return { base: { ...remote }, local, conflicts };
}
export function acceptChatSave(current: ChatDraftState, sent: ChatInput, saved: ChatDraft): ChatDraftState {
  return { base: { ...saved }, local: sameChatInput(current.local, sent) ? { text: saved.text, intent: saved.intent } : { ...current.local }, conflicts: [] };
}
/** A deleted thread must not retain an already saved body in an older mounted page. */
export function removeDeletedChatDraft(current: ChatDraftState): ChatDraftState {
  const local: ChatInput = {
    text: current.local.text === current.base.text ? '' : current.local.text,
    intent: current.local.intent === current.base.intent ? 'note' : current.local.intent,
  };
  return { base: { ...current.base, text: '', intent: 'note' }, local, conflicts: [] };
}
export function chooseChatConflict(current: ChatDraftState, field: keyof ChatInput, choice: 'local' | 'remote'): ChatDraftState {
  const conflict = current.conflicts.find(item => item.field === field);
  if (!conflict) return current;
  const local = { ...current.local };
  if (choice === 'remote') {
    if (field === 'intent') local.intent = conflict.remote as ChatIntent; else local.text = conflict.remote;
  }
  return { ...current, local, conflicts: current.conflicts.filter(item => item.field !== field) };
}
// A persisted draft revision identifies one explicit send, including retry after an unknown write.
export const chatRequestId = (threadId: string, draft: ChatDraft) => `chat:${threadId}:${draft.revision}`;
export const intentNames: Record<ChatIntent, string> = { note: '只记下问题', hint: '给我提示', explanation: '完整讲解', alternative: '换一种讲法' };
