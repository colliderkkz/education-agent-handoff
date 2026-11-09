import type { Question } from '../../local/types';

export function companionQuestionLink(question: Pick<Question, 'id' | 'version'>, paperId?: string) {
  return { pathname: '/chat' as const, params: { source: paperId ? 'paper' : 'bank', questionId: question.id, questionVersion: String(question.version), ...(paperId ? { paperId } : {}) } };
}
