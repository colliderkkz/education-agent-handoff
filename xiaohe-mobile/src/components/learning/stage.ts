import { stageOfKnowledge } from '../../local/shared/types';
import type { KnowledgeId, StageId } from '../../local/shared/types';

/**
 * 学段。
 *
 * 手机端和网页端共用同一份领域代码（src/local/shared），所以学段判定只有一份：
 * 知识点 id 的第二段是 j（初中）/ s（高中）/ 其他（小学）。
 * 这里只放手机端的显示文案和选择器 —— 状态本身放在 LearningContext，三屏共用。
 */

export const stageOptions: { id: StageId; label: string; short: string }[] = [
  { id: 'primary', label: '小学四年级', short: '小学' },
  { id: 'junior', label: '上海初中', short: '初中' },
  { id: 'senior', label: '上海高中', short: '高中' },
];

export function stageLabel(stage: StageId): string {
  return stageOptions.find(option => option.id === stage)?.label ?? '小学四年级';
}

export function stageOf(knowledgeId: string): StageId {
  return stageOfKnowledge(knowledgeId as KnowledgeId);
}

/** 学段里的学科名（小学三门 + 上海数学）。 */
export function subjectsOfStage(knowledgeIds: string[]): string[] {
  const names: string[] = [];
  for (const id of knowledgeIds) {
    const subject = id.split('-')[0];
    const label = subject === 'math' ? '数学' : subject === 'chinese' ? '语文' : subject === 'english' ? '英语' : subject;
    if (!names.includes(label)) names.push(label);
  }
  return names;
}
