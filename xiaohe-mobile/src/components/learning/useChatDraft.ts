import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ApiResult, ChatIntent, CompanionThread, WorkspaceState } from '../../local/types';
import { acceptChatSave, chooseChatConflict, createChatDraft, reconcileChatDraft, removeDeletedChatDraft, sameChatInput, type ChatDraft, type ChatInput } from './chatDraft';
import { errorMessage } from './LearnUI';

type Act = (action: string, payload?: Record<string, unknown>) => Promise<ApiResult>;
export function useChatDraft(thread: CompanionThread, act: Act, observed?: { exists: boolean; revision: number }) {
  const draft = useRef(createChatDraft(thread.draft));
  const [view, setView] = useState(() => createChatDraft(thread.draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const blocked = useRef(false);
  const recovering = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<Promise<ChatDraft> | null>(null);
  const observedDeleted = observed?.exists === false;
  const deletedMessage = '这段对话已删除。已保存的旧文字已清除；只有尚未保存的页面输入会保留供复制，不能重新写入这段对话。';
  const publish = useCallback(() => { if (mounted.current) setView({ ...draft.current, local: { ...draft.current.local }, conflicts: [...draft.current.conflicts] }); }, []);
  const markDeleted = useCallback(() => {
    blocked.current = true;
    draft.current = removeDeletedChatDraft(draft.current); publish();
    if (mounted.current) { setDeleted(true); setError(deletedMessage); }
  }, [publish]);
  const save = useCallback((): Promise<ChatDraft> => {
    if (blocked.current || observedDeleted) { markDeleted(); return Promise.reject(new Error(deletedMessage)); }
    if (recovering.current) return Promise.reject(new Error('正在重读记录，请稍等。'));
    if (draft.current.conflicts.length) return Promise.reject(new Error('请先选择要保留的草稿版本。'));
    if (pending.current) return pending.current;
    if (sameChatInput(draft.current.base, draft.current.local)) return Promise.resolve({ ...draft.current.base });
    setSaving(true); setError('');
    pending.current = Promise.resolve().then(async () => {
      try {
        while (!sameChatInput(draft.current.base, draft.current.local) && !recovering.current && !blocked.current) {
          const input = { ...draft.current.local };
          const result = await act('chat.draft.save', { threadId: thread.id, ...input, expectedDraftRevision: draft.current.base.revision });
          const saved = result.state.companion?.threads.find(item => item.id === thread.id)?.draft;
          if (!saved) throw new Error('未能确认草稿保存结果，请重读记录。当前输入仍保留。');
          draft.current = acceptChatSave(draft.current, input, saved);
          // A newer deletion can be published while this older save reply is in flight.
          // The acknowledgement identifies what was saved, so keep only later unsaved edits.
          if (blocked.current) draft.current = removeDeletedChatDraft(draft.current);
          publish();
        }
        return { ...draft.current.base };
      } catch (cause) { if (mounted.current) setError(blocked.current ? deletedMessage : errorMessage(cause)); throw cause; }
      finally { pending.current = null; if (mounted.current) setSaving(false); }
    });
    return pending.current;
  }, [act, publish, thread.id, observedDeleted, markDeleted]);
  const update = (field: keyof ChatInput, value: string) => {
    if (blocked.current || observedDeleted || draft.current.conflicts.length) return;
    const local = { ...draft.current.local };
    if (field === 'intent') local.intent = value as ChatIntent; else local.text = value;
    draft.current = { ...draft.current, local }; publish();
    void save().catch(() => {});
  };
  const reset = (saved: ChatDraft): boolean => {
    if (blocked.current || observedDeleted) { markDeleted(); return false; }
    draft.current = createChatDraft(saved); publish(); setError(''); return true;
  };
  const recover = async (reload: () => Promise<WorkspaceState>, completedRequestId?: string) => {
    recovering.current = true;
    try {
      await pending.current?.catch(() => {});
      const state = await reload();
      const remote = state.companion?.threads.find(item => item.id === thread.id);
      if (!remote || blocked.current) { markDeleted(); return state; }
      const sent = completedRequestId && state.messages.some(message => message.threadId === thread.id && message.requestId === completedRequestId);
      draft.current = sent ? createChatDraft(remote.draft) : reconcileChatDraft(draft.current, remote.draft);
      publish(); setError(draft.current.conflicts.length ? '草稿有不同版本，请逐项选择后再保存。' : '');
      return state;
    } finally { recovering.current = false; }
  };
  const choose = (field: keyof ChatInput, choice: 'local' | 'remote') => { draft.current = chooseChatConflict(draft.current, field, choice); publish(); setError(''); };
  useEffect(() => {
    if (!observedDeleted) return;
    // Publish after render; the visible state below is already filtered synchronously.
    void Promise.resolve().then(markDeleted);
  }, [observedDeleted, markDeleted]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', status => { if (status !== 'active') void save().catch(() => {}); });
    return () => { mounted.current = false; listener.remove(); };
  }, [save]);
  const visible = observedDeleted || deleted ? removeDeletedChatDraft(view) : view;
  return { input: visible.local, conflicts: visible.conflicts, dirty: !sameChatInput(visible.base, visible.local), saving, error: observedDeleted || deleted ? deletedMessage : error, deleted: observedDeleted || deleted, save, update, reset, recover, choose };
}
