import type { RecognitionEntry, RecognitionLine, RecognitionCandidate } from '../local/types';

export type RecognitionEditor = Pick<RecognitionEntry, 'id' | 'runId' | 'sourceLineIds' | 'originalNumber' | 'stem' | 'answer' | 'working' | 'candidate' | 'checked'>;
export const uncheckedRecognition = () => ({ stem: false, answer: false, match: false, unit: false });
export function recognitionEditor(entry: RecognitionEntry): RecognitionEditor {
  return { id: entry.id, runId: entry.runId, sourceLineIds: [...entry.sourceLineIds], originalNumber: entry.originalNumber, stem: entry.stem, answer: entry.answer, working: entry.working, candidate: entry.candidate ? { ...entry.candidate } : null, checked: { ...entry.checked } };
}
export function recognitionBody(editor: RecognitionEditor): string {
  return JSON.stringify([editor.id, editor.runId, editor.sourceLineIds, editor.originalNumber, editor.stem, editor.answer, editor.working, editor.candidate]);
}
export function newRecognitionEditor(id: string, runId: string, lines: readonly RecognitionLine[], selectedIds: readonly string[]): RecognitionEditor {
  const selected = new Set(selectedIds);
  const source = lines.filter(line => selected.has(line.id));
  const stem = source.map(line => line.text).join('\n');
  if (stem.length > 2000) throw new Error('选中的文字超过单题 2000 字，请只选择同一道题的文字行。');
  return { id, runId, sourceLineIds: source.map(line => line.id), originalNumber: '', stem, answer: '', working: '', candidate: null, checked: uncheckedRecognition() };
}
export function recognitionReady(entry: RecognitionEntry): boolean {
  return entry.status === 'draft' && !!entry.candidate && !!entry.stem.trim() && !!entry.answer.trim() && Object.values(entry.checked).every(Boolean);
}
export function candidatePin(candidate: RecognitionCandidate): RecognitionCandidate {
  return { questionId: candidate.questionId, questionVersion: candidate.questionVersion, contentDigest: candidate.contentDigest };
}
