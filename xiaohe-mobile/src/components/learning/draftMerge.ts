import type { Answer } from '../../local/types.ts';

export type DraftAnswer = Pick<Answer, 'questionId' | 'value' | 'working'>;
export type DraftField = 'value' | 'working';
export interface DraftConflict { questionId: string; field: DraftField; base: string; local: string; remote: string; }
export interface DraftState { base: DraftAnswer[]; local: DraftAnswer[]; conflicts: DraftConflict[]; }
const fields: DraftField[] = ['value', 'working'];
export const copyAnswers = (answers: DraftAnswer[]): DraftAnswer[] => answers.map(({ questionId, value, working }) => ({ questionId, value, working }));
export function sameAnswers(a: DraftAnswer[], b: DraftAnswer[]): boolean {
  return a.length === b.length && a.every((item, i) => item.questionId === b[i].questionId && fields.every(field => item[field] === b[i][field]));
}
function align(reference: DraftAnswer[], incoming: DraftAnswer[]): DraftAnswer[] {
  if (reference.length !== incoming.length || new Set(incoming.map(a => a.questionId)).size !== incoming.length) throw new Error('重读的题目列表与当前草稿不一致，已保留当前输入。');
  return reference.map(answer => {
    const next = incoming.find(a => a.questionId === answer.questionId);
    if (!next || fields.some(field => typeof next[field] !== 'string')) throw new Error('重读的作答不完整，已保留当前输入。');
    return { questionId: next.questionId, value: next.value, working: next.working };
  });
}
export const createDraft = (initial: DraftAnswer[]): DraftState => ({ base: copyAnswers(initial), local: copyAnswers(initial), conflicts: [] });
export const hasDraftChanges = (state: DraftState): boolean => !sameAnswers(state.base, state.local);

/** Explicit three-way merge: a reload may update untouched fields, never silently overwrite edits. */
export function reconcileDraft(state: DraftState, incoming: DraftAnswer[]): DraftState {
  const remote = align(state.base, incoming);
  const local = copyAnswers(state.local); const conflicts: DraftConflict[] = [];
  for (let i = 0; i < local.length; i++) for (const field of fields) {
    const baseValue = state.base[i][field], localValue = local[i][field], remoteValue = remote[i][field];
    const previous = state.conflicts.find(c => c.questionId === local[i].questionId && c.field === field);
    if (localValue === remoteValue) local[i][field] = remoteValue;
    else if (previous) conflicts.push({ ...previous, local: localValue, remote: remoteValue });
    else if (localValue === baseValue) local[i][field] = remoteValue;
    else if (remoteValue !== baseValue) conflicts.push({ questionId: local[i].questionId, field, base: baseValue, local: localValue, remote: remoteValue });
  }
  return { base: remote, local, conflicts };
}
export function updateDraft(state: DraftState, questionId: string, field: DraftField, value: string): DraftState {
  const local = state.local.map(answer => answer.questionId === questionId ? { ...answer, [field]: value } : answer);
  const conflicts = state.conflicts.map(c => c.questionId === questionId && c.field === field ? { ...c, local: value } : c).filter(c => c.local !== c.remote);
  return { ...state, local, conflicts };
}
export function chooseDraftConflict(state: DraftState, questionId: string, field: DraftField, choice: 'local' | 'remote'): DraftState {
  const conflict = state.conflicts.find(c => c.questionId === questionId && c.field === field);
  if (!conflict) return state;
  return {
    base: state.base,
    local: state.local.map(answer => answer.questionId === questionId ? { ...answer, [field]: choice === 'local' ? conflict.local : conflict.remote } : answer),
    conflicts: state.conflicts.filter(c => c !== conflict),
  };
}
/** A successful echo is authoritative for the sent snapshot, but newer keystrokes remain local. */
export function acceptSavedDraft(state: DraftState, sent: DraftAnswer[], incoming: DraftAnswer[]): DraftState {
  const remote = align(state.base, incoming); const snapshot = align(state.base, sent);
  const local = state.local.map((answer, i) => ({
    questionId: answer.questionId,
    value: answer.value === snapshot[i].value ? remote[i].value : answer.value,
    working: answer.working === snapshot[i].working ? remote[i].working : answer.working,
  }));
  return { base: remote, local, conflicts: state.conflicts };
}
