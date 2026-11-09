import type { Paper, PaperReturn, PaperReturnEntry } from '../../local/types.ts';

export type ReturnContent = Pick<PaperReturn, 'entries' | 'uploadIds'>;
export type ReturnField = Exclude<keyof PaperReturnEntry, 'questionId'>;
export type ReturnConflict = { key: string; questionId?: string; field: ReturnField | 'uploadIds'; local: string | boolean | string[]; remote: string | boolean | string[] };
const fields: ReturnField[] = ['value', 'working', 'claimedHelp', 'confirmed', 'unitConfirmed'];
export const copyReturn = (content: ReturnContent): ReturnContent => ({ uploadIds: [...content.uploadIds], entries: content.entries.map(entry => ({ ...entry })) });
export const sameReturn = (a: ReturnContent, b: ReturnContent) => JSON.stringify(a) === JSON.stringify(b);
export function emptyReturn(paper: Paper): ReturnContent {
  return { uploadIds: [], entries: paper.questionIds.map(questionId => ({ questionId, value: '', working: '', claimedHelp: 'unknown', confirmed: false, unitConfirmed: false })) };
}

/** Merge each field without silently replacing text entered since the last save. */
export function mergeReturn(base: ReturnContent, local: ReturnContent, remote: ReturnContent, previous: ReturnConflict[] = []) {
  if (base.entries.length !== remote.entries.length || base.entries.some((entry, i) => entry.questionId !== remote.entries[i].questionId)) throw new Error('重读的题序与当前试卷不一致，当前输入已保留。');
  const next = copyReturn(local); const conflicts: ReturnConflict[] = [];
  for (let i = 0; i < next.entries.length; i++) for (const field of fields) {
    const questionId = next.entries[i].questionId, key = `${questionId}:${field}`;
    const b = base.entries[i][field], l = local.entries[i][field], r = remote.entries[i][field];
    if (l === r) continue;
    if (previous.some(conflict => conflict.key === key)) conflicts.push({ key, questionId, field, local: l, remote: r });
    else if (l === b) Object.assign(next.entries[i], { [field]: r });
    else if (r !== b) conflicts.push({ key, questionId, field, local: l, remote: r });
  }
  for (let i = 0; i < next.entries.length; i++) if (['value', 'working', 'claimedHelp'].some(field => local.entries[i][field as ReturnField] !== remote.entries[i][field as ReturnField])) {
    next.entries[i].confirmed = false; next.entries[i].unitConfirmed = false;
  }
  const b = JSON.stringify(base.uploadIds), l = JSON.stringify(local.uploadIds), r = JSON.stringify(remote.uploadIds);
  if (l !== r) {
    if (previous.some(conflict => conflict.key === 'uploadIds')) conflicts.push({ key: 'uploadIds', field: 'uploadIds', local: [...local.uploadIds], remote: [...remote.uploadIds] });
    else if (l === b) next.uploadIds = [...remote.uploadIds];
    else if (r !== b) conflicts.push({ key: 'uploadIds', field: 'uploadIds', local: [...local.uploadIds], remote: [...remote.uploadIds] });
  }
  return { content: next, conflicts };
}

export function resolveReturn(content: ReturnContent, conflict: ReturnConflict, choice: 'local' | 'remote'): ReturnContent {
  const value = conflict[choice]; const next = copyReturn(content);
  if (conflict.field === 'uploadIds') next.uploadIds = [...value as string[]];
  else {
    const entry = next.entries.find(item => item.questionId === conflict.questionId);
    if (entry) Object.assign(entry, { [conflict.field]: value });
  }
  // A mixed version must be checked against the original paper again.
  next.entries = next.entries.map(entry => ({ ...entry, confirmed: false, unitConfirmed: false }));
  return next;
}

/** Server normalization applies to the sent snapshot, not later keystrokes. */
export function acceptReturnSave(sent: ReturnContent, local: ReturnContent, remote: ReturnContent): ReturnContent {
  const next = copyReturn(local);
  for (let i = 0; i < next.entries.length; i++) for (const field of fields) if (local.entries[i][field] === sent.entries[i][field]) Object.assign(next.entries[i], { [field]: remote.entries[i][field] });
  if (JSON.stringify(local.uploadIds) === JSON.stringify(sent.uploadIds)) next.uploadIds = [...remote.uploadIds];
  return next;
}
