import type { ContentBank, KnowledgeId, Question } from "./types.ts";
import { bankCounts, bankDigest, bankQuestions, bankVersion } from "../content/bank/index.ts";

/**
 * 静态内容库（服务端专用）。
 *
 * 这个模块只被 lib/server/store.ts 引用，因此：
 * - 不进入客户端 bundle（题库有答案，绝不能下发到浏览器）
 * - 不会被 xiaohe-mobile/scripts/sync-local-domain.mjs 同步到移动端
 *   （移动端是纯本机试用形态，题库随 App 打包或经内容包导入，不走这里）
 *
 * 编写规范常量放在 lib/bank-spec.ts —— 那里不 import 任何 JSON，
 * Node 侧的校验脚本与测试可以直接引用。
 */
export { BANK_CONTEXT_MIN, BANK_MIN_FAMILIES_PER_POINT, BANK_MIX, BANK_SOURCE, BANK_SOURCE_SCOPE, BANK_REVIEW_NOTE, BANK_TARGET_PER_POINT, SHANGHAI_CONTEXT_MIN, SHANGHAI_MIX, SHANGHAI_TARGET_PER_POINT } from "./bank-spec.ts";

let cached: ContentBank | undefined;

/** 读取静态内容库。库是仓库内的只读产物，随构建内联，运行时无需文件系统。 */
export function loadContentBank(): ContentBank {
  if (!cached) cached = { version: bankVersion, digest: bankDigest, questions: bankQuestions };
  return cached;
}

/** 库题按知识点分组，供教研台浏览与内容包切分使用。 */
export function bankByKnowledge(bank: ContentBank | undefined): Map<KnowledgeId, Question[]> {
  const grouped = new Map<KnowledgeId, Question[]>();
  for (const question of bank?.questions ?? []) {
    const list = grouped.get(question.knowledgeId) ?? [];
    list.push(question);
    grouped.set(question.knowledgeId, list);
  }
  return grouped;
}

export const bankSummary = { version: bankVersion, digest: bankDigest, counts: bankCounts };
