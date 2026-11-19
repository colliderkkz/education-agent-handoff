/**
 * 静态内容库的编写规范常量（单一事实源）。
 *
 * 单独成文件、不 import 任何 JSON —— 这样 Node 侧的校验脚本与测试
 * 可以直接引用，而不会触发 JSON 模块的 import attribute 要求。
 * 测试、QC 脚本与内容编写规范共用这一份定义。
 */

/** 每知识点的目标题量（含选择题）。 */
export const BANK_TARGET_PER_POINT = 32;
/**
 * 每知识点的任务类型配比：基础 / 应用 / 迁移。
 *
 * 配比只统计**非选择题**（答案不是一个字母的题）。选择题单列一条规则：
 * 真实卷面选择题占两三成，它的作答交互（单选）与判分路径都和填空题不同，
 * 必须单独备足，不能混在填空题里凑数。
 */
export const BANK_MIX = { basic: 10, application: 10, transfer: 10 } as const;
/** 每知识点至少要有多少道选择题（答案是一个字母的题）。 */
export const BANK_CHOICE_PER_POINT = 2;
/** 每知识点每种任务类型至少要有多少个情境标识。 */
export const BANK_CONTEXT_MIN = { basic: 3, application: 5, transfer: 10 } as const;

/**
 * 初高中（上海考纲）知识点的编制规格 —— 题量与配比按初高中题型的实际密度定，
 * 比小学少：初高中一个知识点要覆盖的概念更重，单点题量少但每题深度大。
 */
export const SHANGHAI_TARGET_PER_POINT = 20;
export const SHANGHAI_MIX = { basic: 5, application: 5, transfer: 5 } as const;
export const SHANGHAI_CHOICE_PER_POINT = 5;
export const SHANGHAI_CONTEXT_MIN = { basic: 2, application: 3, transfer: 5 } as const;
/**
 * 每知识点至少要有这么多个互不相同的题族。
 * 五星门槛一次就要消耗 10 个题族（讲解1+提示1+基础3+应用3+迁移2），
 * 题族数不足时即使题量够也永远升不到五星。
 */
export const BANK_MIN_FAMILIES_PER_POINT = 24;

/** 静态库题目的统一来源与免责措辞。 */
export const BANK_SOURCE = "小禾教研原创静态题库 · 样例编写";
export const BANK_SOURCE_SCOPE = "小学四年级上册静态内容库 · 未人工逐题复核 · 教学有效性待教研验证";
export const BANK_REVIEW_NOTE = "题库由教研模板批量编写并通过自动校验脚本；未经逐题人工复核，不代表教学有效性已验证。";
/** 静态库题目的作者与审核标识：必须是两个不同的值，才能满足审核人分离的机械要求。 */
export const BANK_AUTHOR_PREFIX = "bank-author";
export const BANK_REVIEWER_PREFIX = "bank-check";
