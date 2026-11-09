import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ApiResult, WorkspaceState } from '../../local/types';
import { errorMessage } from './LearnUI';
import { redactDraftAnswers, redactPracticeDraft } from '../../features/history-deletion-draft';
import { acceptSavedDraft, chooseDraftConflict, copyAnswers, createDraft, hasDraftChanges, reconcileDraft, sameAnswers, updateDraft, type DraftAnswer, type DraftConflict, type DraftField } from './draftMerge';

export type { DraftAnswer, DraftConflict } from './draftMerge';
type Act = (action: string, payload?: Record<string, unknown>) => Promise<ApiResult>;
type RemoteVersion = { revision: number; status: 'draft' | 'submitted'; deletedQuestionIds?: string[] };
const conflictMessage = '重读发现同一字段有不同修改。请逐项选择保留内容，再保存草稿。';

/** Coalesced writes + field-level three-way recovery; newer input survives old replies and reloads. */
export function usePracticeDraft(paperId: string, initial: DraftAnswer[], act: Act, remote?: RemoteVersion) {
  const draft = useRef(createDraft(initial));
  const [answers, setAnswers] = useState(copyAnswers(initial));
  const [savedAnswers, setSavedAnswers] = useState(copyAnswers(initial));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [saveError, setSaveError] = useState('');
  const [remoteSubmitted, setRemoteSubmitted] = useState(remote?.status === 'submitted');
  const pending = useRef<Promise<void> | null>(null);
  const recovery = useRef<Promise<{ submitted: boolean }> | null>(null);
  const recoveringRef = useRef(false);
  const submittedRef = useRef(remote?.status === 'submitted');
  const acceptedRevision = useRef(remote?.revision ?? -1);
  const redacted = useRef(new Set<string>());
  const mounted = useRef(true);
  const action = useRef(act);
  useEffect(() => { action.current = act; }, [act]);
  const publishDraft = useCallback(() => {
    if (!mounted.current) return;
    setAnswers(copyAnswers(draft.current.local));
    setSavedAnswers(copyAnswers(draft.current.base));
    setDirty(hasDraftChanges(draft.current));
    setConflicts(draft.current.conflicts.map(c => ({ ...c })));
  }, []);
  const readAttempt = useCallback((state: WorkspaceState) => {
    const attempt = state.attempts.find(a => a.paperId === paperId);
    if (!attempt) throw new Error('重读后没有找到这份作答，已保留当前输入。');
    return attempt;
  }, [paperId]);
  const save = useCallback((): Promise<void> => {
    const reason = submittedRef.current ? '这份练习已有提交记录，当前未保存输入保留在页面中，不能覆盖原始作答。' : recoveringRef.current ? '正在重读本机记录，请稍等。' : draft.current.conflicts.length ? conflictMessage : '';
    if (reason) { if (mounted.current) setSaveError(reason); return Promise.reject(new Error(reason)); }
    if (pending.current) return pending.current;
    if (!hasDraftChanges(draft.current)) return Promise.resolve();
    if (mounted.current) { setSaving(true); setSaveError(''); }
    const work = async () => {
      try {
        while (hasDraftChanges(draft.current) && !recoveringRef.current && !submittedRef.current && !draft.current.conflicts.length) {
          const snapshot = copyAnswers(draft.current.local);
          const result = await action.current('attempt.save', { paperId, answers: snapshot });
          const attempt = readAttempt(result.state);
          if (attempt.status === 'submitted') throw new Error('本机已有提交记录，请重读查看，当前输入已保留。');
          draft.current = acceptSavedDraft(draft.current, snapshot, attempt.answers);
          acceptedRevision.current = result.state.revision;
          publishDraft();
        }
      } catch (error) {
        if (mounted.current) setSaveError(errorMessage(error));
        throw error;
      } finally {
        pending.current = null;
        if (mounted.current) setSaving(false);
      }
    };
    // Defer one microtask so even a synchronous action failure cannot leave a stale pending promise.
    pending.current = Promise.resolve().then(work);
    return pending.current;
  }, [paperId, publishDraft, readAttempt]);
  const update = (questionId: string, field: DraftField, value: string) => {
    if (submittedRef.current || remote?.status === 'submitted') return;
    draft.current = updateDraft(draft.current, questionId, field, value);
    publishDraft();
    if (!recoveringRef.current && !submittedRef.current && !draft.current.conflicts.length) void save().catch(() => {});
  };
  const reconcile = useCallback((remoteAnswers: DraftAnswer[]): DraftConflict[] => {
    draft.current = reconcileDraft(draft.current, remoteAnswers);
    publishDraft();
    if (mounted.current) setSaveError(draft.current.conflicts.length ? conflictMessage : '');
    return draft.current.conflicts.map(c => ({ ...c }));
  }, [publishDraft]);
  const recover = useCallback((reload: () => Promise<WorkspaceState>): Promise<{ submitted: boolean }> => {
    if (recovery.current) return recovery.current;
    recoveringRef.current = true;
    if (mounted.current) { setRecovering(true); setSaveError(''); }
    const work = async () => {
      try {
        // A queued save can still succeed. Wait for its real result before selecting the merge base.
        await pending.current?.catch(() => undefined);
        const state = await reload(); const attempt = readAttempt(state);
        acceptedRevision.current = state.revision;
        submittedRef.current = attempt.status === 'submitted';
        if (mounted.current) setRemoteSubmitted(submittedRef.current);
        if (!submittedRef.current) reconcile(attempt.answers);
        else if (mounted.current) setSaveError('已读取原始提交记录。当前未保存输入仍保留在页面，不能覆盖已提交答案。');
        return { submitted: submittedRef.current };
      } catch (error) { if (mounted.current) setSaveError(errorMessage(error)); throw error; }
      finally { recoveringRef.current = false; recovery.current = null; if (mounted.current) setRecovering(false); }
    };
    recovery.current = Promise.resolve().then(work);
    return recovery.current;
  }, [readAttempt, reconcile]);
  const resolveConflict = (questionId: string, field: DraftField, choice: 'local' | 'remote') => {
    draft.current = chooseDraftConflict(draft.current, questionId, field, choice);
    publishDraft();
    if (mounted.current) setSaveError(draft.current.conflicts.length ? conflictMessage : '');
  };
  // Props can arrive after an action reply. Revision gating prevents a stale render from undoing it.
  useEffect(() => {
    let active = true;
    // Settle action replies before rebasing an externally supplied persistence snapshot.
    void Promise.resolve().then(() => {
      if (!active || !remote || remote.revision < acceptedRevision.current || pending.current || recoveringRef.current) return;
      if (remote.status === 'submitted') {
        submittedRef.current = true; acceptedRevision.current = remote.revision;
        const removed = (remote.deletedQuestionIds || []).filter(id => !redacted.current.has(id));
        if (removed.length) { draft.current = redactPracticeDraft(draft.current, removed); removed.forEach(id => redacted.current.add(id)); publishDraft(); }
        return; // Keep local text for explicit user review before leaving a submitted record.
      }
      if (!sameAnswers(draft.current.base, initial)) {
        try { reconcile(initial); } catch (error) { setSaveError(errorMessage(error)); }
      }
      acceptedRevision.current = remote.revision;
    });
    return () => { active = false; };
  }, [initial, remote, saving, recovering, reconcile, publishDraft]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', status => { if (status !== 'active') void save().catch(() => {}); });
    return () => { mounted.current = false; listener.remove(); void save().catch(() => {}); };
  }, [save]);
  const visibleAnswers = remote?.deletedQuestionIds?.length ? redactDraftAnswers(answers, savedAnswers, remote.deletedQuestionIds) : answers;
  return { answers: visibleAnswers, update, save, dirty, saving, saveError, recovering, recover, conflicts, resolveConflict, reconcile, remoteSubmitted: remoteSubmitted || remote?.status === 'submitted', snapshot: () => copyAnswers(draft.current.local) };
}
