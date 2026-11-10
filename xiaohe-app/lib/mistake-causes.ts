/**
 * 错因标签。
 *
 * 错题本只按「待订正 / 已订正」分组，学生看到的是一堆题，看不出自己错在哪。
 * 主流学习产品的做法是给错题打**错因**标签（作业帮要求必填知识点 + 归因，小猿挂具体错误类型），
 * 这样才能「按这组错因再练 5 道」—— 从「一堆错题」变成「我老是算错」。
 *
 * 标签只有学生自己能选：系统不知道他为什么错，让机器猜反而会污染判断。
 */

import type { KnowledgeId } from "./types.ts";

export const mistakeCauses = [
  { id: "concept", label: "概念不清", hint: "定义、性质没记牢" },
  { id: "calculation", label: "计算失误", hint: "思路对，算错了" },
  { id: "reading", label: "审题偏差", hint: "条件看漏或看错" },
  { id: "step", label: "步骤遗漏", hint: "会做，但少写了一步" },
  { id: "formula", label: "公式记错", hint: "用错了公式或定理" },
] as const;

export type MistakeCause = (typeof mistakeCauses)[number]["id"];

export const mistakeCauseIds: readonly string[] = mistakeCauses.map(item => item.id);

export function mistakeCauseLabel(cause?: string): string {
  return mistakeCauses.find(item => item.id === cause)?.label ?? "";
}

/** 知识点所属单元（同一单元的知识点算「一组」）。 */
export function unitKeyOf(knowledgeId: string): string {
  return knowledgeId.split("-").slice(0, 3).join("-");
}

/**
 * 按一组错因组卷的范围。
 *
 * 同一题族 14 天内不重复出题 —— 只拿错题本身那几个知识点组卷，往往一道都出不来：
 * 刚做错的那道题正是最近做过的题族。所以把同单元**已解锁**的知识点一起带上，
 * 让这一组错因能换到新题，而不是卡在「题库不足」。
 */
export function practiceScopeForCause(
  mistakes: { knowledgeId: KnowledgeId; cause?: MistakeCause }[],
  knowledge: { id: KnowledgeId; learningState: string }[],
  cause: MistakeCause,
): { knowledgeIds: KnowledgeId[]; count: number } {
  const tagged = mistakes.filter(item => item.cause === cause);
  const points = [...new Set(tagged.map(item => item.knowledgeId))].filter(Boolean) as KnowledgeId[];
  if (!points.length) return { knowledgeIds: [], count: 0 };
  const units = new Set(points.map(unitKeyOf));
  const siblings = knowledge.filter(item => item.learningState === "current" && units.has(unitKeyOf(item.id))).map(item => item.id as KnowledgeId);
  return {
    knowledgeIds: [...new Set([...points, ...siblings])],
    count: Math.min(6, Math.max(3, tagged.length)),
  };
}
