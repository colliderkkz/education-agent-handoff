import type { ApiResult, Paper } from '../local/types.ts';
import { buildPaperPrintDocuments, type PaperPrintDocument, type PaperPrintMode } from './paper-print-template.ts';

export interface PaperExportDependencies<T> {
  act: (action: string, payload: Record<string, unknown>) => Promise<ApiResult>;
  render: (documents: PaperPrintDocument[]) => Promise<T>;
}
const printableIdentity = (paper: Paper) => JSON.stringify({
  id: paper.id, title: paper.title, version: paper.version, parentId: paper.parentId,
  questionIds: paper.questionIds,
  questions: paper.questions.map(question => ({
    id: question.id, version: question.version, text: question.text, source: question.source,
    knowledgeId: question.knowledgeId, difficulty: question.difficulty, unit: question.unit,
  })),
});

/** Persist answer exposure before any answer-bearing file can be produced. */
export async function exportPaper<T>(paper: Paper, mode: PaperPrintMode, dependencies: PaperExportDependencies<T>): Promise<T> {
  if (!['student', 'solutions', 'both'].includes(mode)) throw new Error('请选择要导出的试卷。');
  // Freeze the request before awaiting persistence; navigation/state updates cannot switch versions.
  let snapshot: Paper = JSON.parse(JSON.stringify(paper));
  if (mode !== 'student') {
    const result = await dependencies.act('paper.expose', { paperId: snapshot.id });
    const exposed = result.state.papers.find(item => item.id === snapshot.id);
    if (!exposed || printableIdentity(exposed) !== printableIdentity(snapshot)) {
      throw new Error('试卷版本发生变化，请重新打开原卷后再导出。');
    }
    snapshot = JSON.parse(JSON.stringify(exposed));
  }
  const documents = buildPaperPrintDocuments(snapshot, mode);
  return dependencies.render(documents);
}
