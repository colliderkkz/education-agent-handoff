import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ApiResult, Paper, PaperReturn, PaperReturnEntry, WorkspaceState } from '../../local/types';
import { acceptReturnSave, copyReturn, emptyReturn, mergeReturn, resolveReturn, sameReturn, type ReturnConflict, type ReturnContent, type ReturnField } from './paperReturnDraft';
import { errorMessage } from './LearnUI';
import { redactReturnContent } from '../../features/history-deletion-draft';

type Act = (action: string, payload?: Record<string, unknown>) => Promise<ApiResult>;
export function usePaperReturnDraft(paper: Paper, state: WorkspaceState, act: Act) {
  const initial = state.paperReturns?.find(item => item.paperId === paper.id);
  const record = useRef<PaperReturn | undefined>(initial);
  const base = useRef<ReturnContent>(copyReturn(initial || emptyReturn(paper)));
  const local = useRef(copyReturn(initial || emptyReturn(paper)));
  const conflictRef = useRef<ReturnConflict[]>([]);
  const [content, setContent] = useState(copyReturn(initial || emptyReturn(paper)));
  const [savedContent, setSavedContent] = useState(copyReturn(initial || emptyReturn(paper)));
  const [dirty, setDirty] = useState(false), [isBlocked, setIsBlocked] = useState(initial?.status === 'submitted' || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted'));
  const [conflicts, setConflicts] = useState<ReturnConflict[]>([]);
  const [saving, setSaving] = useState(false), [recovering, setRecovering] = useState(false), [error, setError] = useState('');
  const pending = useRef<Promise<PaperReturn> | null>(null), recoveringRef = useRef(false), failed = useRef(false), mounted = useRef(true);
  const blocked = useRef(initial?.status === 'submitted' || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted'));
  const action = useRef(act);
  useEffect(() => { action.current = act; }, [act]);
  const publish = useCallback(() => { if (mounted.current) { setContent(copyReturn(local.current)); setSavedContent(copyReturn(base.current)); setConflicts([...conflictRef.current]); setDirty(!sameReturn(base.current, local.current)); setIsBlocked(blocked.current); } }, []);
  const save = useCallback((): Promise<PaperReturn> => {
    if (blocked.current) return Promise.reject(new Error('这份试卷已经提交，不能覆盖原始记录。当前页面输入仍保留。'));
    if (recoveringRef.current || conflictRef.current.length) return Promise.reject(new Error('请先完成重读和版本选择，再保存纸面草稿。'));
    if (pending.current) return pending.current;
    if (record.current && sameReturn(base.current, local.current)) return Promise.resolve(record.current);
    if (mounted.current) { setSaving(true); setError(''); }
    const work = async () => {
      try {
        do {
          const sent = copyReturn(local.current);
          const result = await action.current('paper.return.save', { paperId: paper.id, paperVersion: paper.version, questionIds: paper.questionIds, expectedRevision: record.current?.revision || 0, ...sent });
          const saved = result.state.paperReturns?.find(item => item.paperId === paper.id);
          if (!saved) throw new Error('保存回复中缺少纸面草稿，请重读本机记录。');
          record.current = saved;
          local.current = acceptReturnSave(sent, local.current, saved); base.current = copyReturn(saved); failed.current = false; publish();
        } while (!sameReturn(base.current, local.current) && !recoveringRef.current && !conflictRef.current.length);
        return record.current!;
      } catch (cause) { failed.current = true; if (mounted.current) setError(errorMessage(cause)); throw cause; }
      finally { pending.current = null; if (mounted.current) setSaving(false); }
    };
    pending.current = Promise.resolve().then(work);
    return pending.current;
  }, [paper.id, paper.version, paper.questionIds, publish]);
  const reconcile = useCallback((next: WorkspaceState) => {
    const saved = next.paperReturns?.find(item => item.paperId === paper.id);
    blocked.current = saved?.status === 'submitted' || next.attempts.some(item => item.paperId === paper.id && item.status === 'submitted');
    if (blocked.current) {
      const deleted = next.historyDeletion?.evidence.filter(item => item.paperId === paper.id).map(item => item.questionId) || [];
      const photos = next.historyDeletion?.operations.flatMap(item => item.deletedUploadIds) || [];
      local.current = redactReturnContent(local.current, base.current, deleted, photos);
      base.current = redactReturnContent(base.current, base.current, deleted, photos);
      conflictRef.current = conflictRef.current.filter(item => !('questionId' in item) || !deleted.includes(String(item.questionId)));
      record.current = saved; publish(); if (mounted.current) setError('已有提交记录。当前未保存输入仍保留，已删除的保存内容不再展示，不能覆盖原始作答。'); return;
    }
    const remote = saved || emptyReturn(paper);
    const merged = mergeReturn(base.current, local.current, remote, conflictRef.current);
    local.current = merged.content; conflictRef.current = merged.conflicts; base.current = copyReturn(remote); record.current = saved;
    failed.current = false; publish();
    if (mounted.current) setError(merged.conflicts.length ? '重读发现不同版本，请逐项选择要保留的内容。' : '');
  }, [paper, publish]);
  const recover = useCallback(async (reload: () => Promise<WorkspaceState>) => {
    if (recoveringRef.current) return;
    recoveringRef.current = true; setRecovering(true);
    try { await pending.current?.catch(() => undefined); reconcile(await reload()); }
    catch (cause) { setError(errorMessage(cause)); throw cause; }
    finally { recoveringRef.current = false; setRecovering(false); }
  }, [reconcile]);
  const update = (questionId: string, field: ReturnField, value: PaperReturnEntry[ReturnField]) => {
    if (blocked.current || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted')) return;
    local.current = { ...local.current, entries: local.current.entries.map(entry => entry.questionId === questionId ? { ...entry, [field]: value, ...(['value', 'working', 'claimedHelp'].includes(field) ? { confirmed: false, unitConfirmed: false } : {}) } : entry) };
    publish(); if (!failed.current && !conflictRef.current.length && !recoveringRef.current) void save().catch(() => {});
  };
  const setPhotos = (uploadIds: string[]) => { if (blocked.current || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted')) return; local.current = { ...local.current, uploadIds: [...uploadIds] }; publish(); };
  const resolveConflict = (key: string, choice: 'local' | 'remote') => {
    const conflict = conflictRef.current.find(item => item.key === key); if (!conflict) return;
    local.current = resolveReturn(local.current, conflict, choice); conflictRef.current = conflictRef.current.filter(item => item.key !== key); publish();
    if (!conflictRef.current.length) setError('版本已选好。请重新核对各题，再保存。');
  };
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || pending.current || recoveringRef.current) return;
      const remote = state.paperReturns?.find(item => item.paperId === paper.id);
      if ((remote?.revision || 0) > (record.current?.revision || 0) || state.attempts.some(item => item.paperId === paper.id && item.status === 'submitted')) reconcile(state);
    });
    return () => { active = false; };
  }, [state, paper.id, reconcile, saving]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', status => { if (status !== 'active' && !failed.current && !sameReturn(base.current, local.current)) void save().catch(() => {}); });
    return () => { mounted.current = false; listener.remove(); };
  }, [save]);
  const deleted = state.historyDeletion?.evidence.filter(item => item.paperId === paper.id).map(item => item.questionId) || [];
  const photos = state.historyDeletion?.operations.flatMap(item => item.deletedUploadIds) || [];
  const visibleContent = deleted.length || photos.length ? redactReturnContent(content, savedContent, deleted, photos) : content;
  return { content: visibleContent, update, setPhotos, save, saving, recovering, recover, conflicts, resolveConflict, error, dirty, blocked: isBlocked, snapshot: () => copyReturn(local.current) };
}
