// Generated from xiaohe-app/lib/exam-references.ts; SHA-256: e3742f03a769df37ecf740c69310dc0e87ed3b659be4f7504d2c9667d20e25ba
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
/**
 * 上海中考 / 高中数学「真题出处索引」与「卷面结构」。
 *
 * ## 为什么不是真题本身
 *
 * 上海市教育考试院**只公开发布「专家点评」，从不公开发布试卷原件** —— 逐页核对了
 * 2017–2026 各年的「中招中考 › 考试规定」栏目，正文只有定性评析，没有试卷附件。
 * 商业题库站上的「上海中考真题 PDF」多是学生考后回忆版或扫描转录件，来源混杂、
 * 版权归属不明；教辅书里的真题更是付费出版物。
 *
 * 所以本产品**不存真题原文、不 OCR 真题、不改编真题**。能做的是：
 * 1. **出处索引**：官方点评里点名的「年份 → 题号 → 考点」映射，附官方链接；
 * 2. **卷面结构**：市教委文件规定的时长、分值、内容比例；
 * 3. **考点对应**：我们的原创题标注它覆盖的是哪个真题考点（用我方语言表述）。
 *
 * 小学更没有「区级统考真题」这回事：上海市教委《中小学课程计划》明令禁止全区统考，
 * 三四五年级期末考试仅限语文、数学，网上流传的「区期末卷」实为学校或教研组命题的
 * **校本卷**，版权属命题学校，同样不能复制。
 *
 * 每条来源都带 `sourceTier`，前端必须按等级显示措辞：
 * - `official-commentary` 上海市教育考试院官方点评
 * - `official-policy` 上海市教委 / 市政府文件
 * - `third-party` 第三方整理，未获官方核实，仅供参考
 */

export type SourceTier = "official-commentary" | "official-policy" | "third-party";

export interface ExamSource {
  /** 来源链接（必须是官方页面） */
  url: string;
  tier: SourceTier;
  /** 来源标题 */
  title: string;
}

/** 来源分级的人话说法 —— 前端必须原样显示，不要自己发挥。 */
export const sourceTierLabels: Record<SourceTier, string> = {
  "official-commentary": "上海市教育考试院官方点评",
  "official-policy": "上海市教委 / 市政府文件",
  "third-party": "第三方整理，未获官方核实，仅供参考",
};

/** 一个考点在哪些年份、哪一题出现过（官方点评点名的）。 */
export interface ExamTopicHit {
  year: number;
  /** 题号。官方没有点名时留空。 */
  questionNo?: string;
  /** 官方点评里的考点表述。 */
  topic: string;
  source: ExamSource;
}

export interface ExamTopic {
  /** 我们内部的考点标签（用我方语言，不复述原题） */
  key: string;
  /** method = 通用解题思想（可覆盖多个知识点）；topic = 具体题型（只覆盖对应知识点） */
  kind: "method" | "topic";
  label: string;
  /** 覆盖这个考点的知识点 id —— 用来把原创题挂到考点上。 */
  knowledgeIds: string[];
  hits: ExamTopicHit[];
}

const commentary = (year: number, url: string): ExamSource => ({
  url,
  tier: "official-commentary",
  title: `${year} 年上海中考数学「专家点评」（上海市教育考试院）`,
});

const policy = (title: string, url: string): ExamSource => ({ url, tier: "official-policy", title });

/**
 * 考点索引。只收录**官方点评里出现过**的考点。
 * 2019 / 2020 / 2021 三年官方点评点名了具体题号；2022 年以后只有情境描述，没有题号 —— 如实留空。
 */
export const examTopics: ExamTopic[] = [
  {
    key: "quadratic-transform",
    kind: "topic",
    label: "二次函数的图象与性质（平移、顶点、对称轴）",
    knowledgeIds: ["math-j-2-quadratic", "math-j-2-graph", "math-j-5-moving-point"],
    hits: [
      { year: 2021, questionNo: "3", topic: "二次函数图像与性质（平移）", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2026, topic: "正方形上的动点情境（官方点评未点名题号）", source: { url: "https://m.shedunews.sh.cn/msite_4/con/2026-06/22/content_31661.html", tier: "official-commentary", title: "2026 年上海中考数学「专家点评」（上海市教育考试院供稿，上海教育新闻网）" } },
    ],
  },
  {
    key: "num-shape-idea",
    kind: "method",
    label: "数形结合思想",
    knowledgeIds: ["math-j-1-real", "math-j-1-poly", "math-j-2-function", "math-j-2-linear", "math-j-2-quadratic", "math-j-2-inverse", "math-j-2-graph", "math-j-3-coordinates"],
    hits: [
      { year: 2020, questionNo: "16、24", topic: "数形结合思想", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "24、25", topic: "数形结合思想", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2019, questionNo: "25", topic: "数形结合思想", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
    ],
  },
  {
    key: "equation-idea",
    kind: "method",
    label: "方程思想",
    knowledgeIds: ["math-j-1-linear-eq", "math-j-1-quadratic-eq", "math-j-1-fraction", "math-j-5-parameter"],
    hits: [
      { year: 2020, questionNo: "22、25", topic: "方程思想", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
    ],
  },
  {
    key: "case-discussion",
    kind: "method",
    label: "分类讨论思想",
    knowledgeIds: ["math-j-1-inequality", "math-j-1-linear-eq", "math-j-1-factor", "math-j-2-quadratic", "math-j-5-parameter"],
    hits: [
      { year: 2020, questionNo: "25", topic: "分类讨论思想", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "25", topic: "分类讨论思想", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2019, questionNo: "25", topic: "分类讨论思想", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
    ],
  },
  {
    key: "quadratic-geometry",
    kind: "topic",
    label: "二次函数与几何综合（抛物线顶点、开口与范围）",
    knowledgeIds: ["math-j-5-quadratic-geometry", "math-j-2-quadratic"],
    hits: [
      { year: 2020, questionNo: "24", topic: "二次函数与几何综合（抛物线顶点范围 / 开口大小）", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "24", topic: "二次函数与几何综合（抛物线顶点范围 / 开口大小）", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2024, topic: "探求抛物线开口大小（情境级，无题号）", source: commentary(2024, "https://www.shmeea.edu.cn/page/03500/20240619/18596.html") },
    ],
  },
  {
    key: "circle-comprehensive",
    kind: "topic",
    label: "圆综合（圆与相似、勾股结合）",
    knowledgeIds: ["math-j-3-circle", "math-j-3-similar"],
    hits: [
      { year: 2020, questionNo: "25", topic: "圆综合（圆 + 相似 + 勾股）", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2026, topic: "半圆中的线角关系（情境级，无题号）", source: { url: "https://m.shedunews.sh.cn/msite_4/con/2026-06/22/content_31661.html", tier: "official-commentary", title: "2026 年上海中考数学「专家点评」（上海市教育考试院供稿，上海教育新闻网）" } },
    ],
  },
  {
    key: "fold-geometry",
    kind: "topic",
    label: "翻折与图形运动",
    knowledgeIds: ["math-j-3-transformation", "math-j-3-triangle", "math-j-3-quadrilateral"],
    hits: [
      { year: 2019, questionNo: "17", topic: "三角形翻折 / 图形运动", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
      { year: 2020, questionNo: "17", topic: "三角形翻折 / 图形运动", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "14、16、17、21", topic: "三角形翻折 / 图形运动", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2024, topic: "平行四边形翻折（情境级，无题号）", source: commentary(2024, "https://www.shmeea.edu.cn/page/03500/20240619/18596.html") },
    ],
  },
  {
    key: "new-definition",
    kind: "topic",
    label: "新定义题（阅读理解）",
    knowledgeIds: ["math-j-5-new-definition", "math-j-5-reading"],
    hits: [
      { year: 2019, questionNo: "24", topic: "新定义题（阅读理解）", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
      { year: 2020, questionNo: "6", topic: "新定义题（阅读理解）", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "18", topic: "新定义题（阅读理解）", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2026, topic: "派生点 / 派生直线（情境级，无题号）", source: { url: "https://m.shedunews.sh.cn/msite_4/con/2026-06/22/content_31661.html", tier: "official-commentary", title: "2026 年上海中考数学「专家点评」（上海市教育考试院供稿，上海教育新闻网）" } },
    ],
  },
  {
    key: "probability",
    kind: "topic",
    label: "概率",
    knowledgeIds: ["math-j-4-probability", "math-j-4-survey"],
    hits: [
      { year: 2019, questionNo: "11", topic: "概率", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
      { year: 2021, questionNo: "12", topic: "概率（与数列结合）", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2025, topic: "生活中的概率与统计（情境级，无题号）", source: commentary(2025, "https://www.shmeea.edu.cn/page/08000/20250615/19522.html") },
    ],
  },
  {
    key: "statistics",
    kind: "topic",
    label: "统计（读图、样本估计总体）",
    knowledgeIds: ["math-j-4-statistics", "math-j-4-survey"],
    hits: [
      { year: 2019, questionNo: "4、14", topic: "统计（读图 / 样本估计总体）", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
      { year: 2020, questionNo: "14", topic: "统计（读图 / 样本估计总体）", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2024, topic: "统计图信息提取（情境级，无题号）", source: commentary(2024, "https://www.shmeea.edu.cn/page/03500/20240619/18596.html") },
      { year: 2025, topic: "样本估计总体（情境级，无题号）", source: commentary(2025, "https://www.shmeea.edu.cn/page/08000/20250615/19522.html") },
    ],
  },
  {
    key: "trig-model",
    kind: "topic",
    label: "解直角三角形建模",
    knowledgeIds: ["math-j-3-acute-right"],
    hits: [
      { year: 2025, topic: "人脸识别自动门（情境级，无题号）", source: commentary(2025, "https://www.shmeea.edu.cn/page/08000/20250615/19522.html") },
      { year: 2026, topic: "气象观测场（情境级，无题号）", source: { url: "https://m.shedunews.sh.cn/msite_4/con/2026-06/22/content_31661.html", tier: "official-commentary", title: "2026 年上海中考数学「专家点评」（上海市教育考试院供稿，上海教育新闻网）" } },
    ],
  },
  {
    key: "math-culture",
    kind: "topic",
    label: "数学文化（九章算术、赵爽弦图、日高图说）",
    knowledgeIds: ["math-j-5-reading", "math-j-4-statistics"],
    hits: [
      { year: 2019, questionNo: "12", topic: "数学文化", source: commentary(2019, "https://www.shmeea.edu.cn/page/03500/20190616/12952.html") },
      { year: 2020, questionNo: "14", topic: "数学文化", source: commentary(2020, "https://www.shmeea.edu.cn/page/03500/20200628/14192.html") },
      { year: 2021, questionNo: "17", topic: "数学文化", source: commentary(2021, "https://www.shmeea.edu.cn/page/03500/20210620/15383.html") },
      { year: 2022, topic: "赵爽《日高图说》（情境级，无题号）", source: commentary(2022, "https://www.shmeea.edu.cn/page/08000/20220711/16528.html") },
    ],
  },
];

/** 一道题挂的「考点对应」。用官方点评的考点名，但不复述原题。 */
export interface ExamRef {
  topicKey: string;
  /** 「2020 年上海中考数学第 24 题」这类可读表述 */
  label: string;
  sourceUrl: string;
  sourceTier: SourceTier;
  sourceTitle: string;
}

/** 知识点 → 考点标签。原创题按知识点挂到对应考点上。 */
export const topicByKnowledgeId = new Map<string, ExamTopic>();
for (const topic of examTopics) {
  for (const knowledgeId of topic.knowledgeIds) topicByKnowledgeId.set(knowledgeId, topic);
}

/** 卷面结构模板 —— 组卷时可选。官方能核实的与机构口径的分开标。 */
export interface PaperTemplate {
  id: string;
  label: string;
  stage: "junior" | "senior";
  /** 各题型的题数与分值 */
  structure: { choice: number; fill: number; solve: number };
  totalScore: number;
  minutes: number;
  source: ExamSource;
  /** 这条结构里哪些数字是官方公布的，哪些是第三方口径 */
  officialFacts: string[];
  thirdPartyFacts: string[];
}

export const paperTemplates: PaperTemplate[] = [
  {
    id: "zhongkao-math",
    label: "上海中考数学卷面结构",
    stage: "junior",
    structure: { choice: 6, fill: 12, solve: 7 },
    totalScore: 150,
    minutes: 100,
    source: policy("《上海市初中学业水平考试实施办法》沪教委规〔2023〕5 号", "https://www.sh.gov.cn/202316bmgfxwj/20230829/986c99823c694ad1bac84fb0241b09ab.html"),
    officialFacts: ["闭卷笔试", "考试时间 100 分钟", "满分 150 分"],
    thirdPartyFacts: ["卷面共 25 题：选择 6 题、填空 12 题、解答 7 题（题量与分值分布来自商业题库与机构解析，官方未公布）"],
  },
  {
    id: "gaokao-math",
    label: "上海高考数学卷面结构",
    stage: "senior",
    structure: { choice: 0, fill: 0, solve: 0 },
    totalScore: 150,
    minutes: 120,
    source: policy("《2025 年普通高校春季考试招生试点方案》沪教委学〔2024〕48 号", "https://www.shanghai.gov.cn/nw12344/20241119/9fba618659c24b62b50cc4fef843df66.html"),
    officialFacts: ["数学满分 150 分", "考试时间 120 分钟"],
    thirdPartyFacts: ["各题型的题数与分值分布未查到官方公布"],
  },
  {
    id: "qualifying-math",
    label: "高中数学学业水平合格考结构",
    stage: "senior",
    structure: { choice: 0, fill: 0, solve: 0 },
    totalScore: 100,
    minutes: 90,
    source: policy("《2026 年普通高中语数外学业水平合格性考试命题要求》沪教委基〔2025〕29 号", "https://www.shanghai.gov.cn/gwk/search/content/d0b8dd1a56e44c1c96838d58e9cd8af3"),
    officialFacts: ["闭卷 90 分钟", "满分 100 分", "内容比例：预备知识 15%、函数 40%、几何与代数 30%、概率与统计 15%", "题型形式为选择、填空、解答"],
    thirdPartyFacts: ["各题型的题数与分值未公布"],
  },
];

/** 组卷结构 → 题型配比（按题数比例分到选择/填空/解答）。 */
export function templateMix(template: PaperTemplate): { choice: number; fill: number; solve: number } {
  const total = template.structure.choice + template.structure.fill + template.structure.solve;
  if (!total) return { choice: 0, fill: 0, solve: 0 };
  const scale = (value: number) => Math.round((value / total) * 100);
  return { choice: scale(template.structure.choice), fill: scale(template.structure.fill), solve: scale(template.structure.solve) };
}

/** 学生端的统一说明：为什么这里没有真题原文。 */
export const examIndexDisclaimer =
  "上海市教育考试院只公开发布试卷的「专家点评」，从不发布试卷原件；商业题库站上的「真题」多为回忆版，版权归属不明。"
  + "本产品因此不收录真题原文，只提供官方公布的考点出处索引与卷面结构 —— 想做原卷，请通过学校或正规渠道获取。";
