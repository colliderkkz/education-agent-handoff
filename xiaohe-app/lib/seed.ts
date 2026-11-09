import type { Question, KnowledgeId, WorkspaceState, Evidence, Paper, Attempt } from "./types";

const seedDate = "2026-10-01T08:00:00.000Z";
type Item = [string, string, string, string, string, string];
const content: Record<KnowledgeId, Item[]> = {
  division: [
    ["图书角新买了 168 本书，平均分给 12 个小组，每组分到多少本？", "14", "本", "先想 12 乘几等于 168。", "168 ÷ 12 = 14。", "把 168 拆成 120 和 48，分别除以 12，10 + 4 = 14。"],
    ["一盒彩笔有 24 支。288 支彩笔可以装满多少盒？", "12", "盒", "用彩笔总数除以每盒的支数。", "288 ÷ 24 = 12。", "24 × 10 = 240，还剩 48 支，可再装 2 盒，共 12 盒。"],
    ["学校有 336 盆花，每 16 盆摆成一排，可以摆多少排？", "21", "排", "16 × 20 后还差多少？", "336 ÷ 16 = 21。", "320 ÷ 16 = 20，16 ÷ 16 = 1，合起来是 21。"],
    ["一辆小货车每次运 18 箱牛奶，运完 450 箱需要多少次？", "25", "次", "先估算 18 × 20 和 18 × 30。", "450 ÷ 18 = 25。", "18 × 20 = 360，剩 90 箱需 5 次，一共 25 次。"],
    ["把 624 张卡片平均装入 26 个袋子，每袋多少张？", "24", "张", "先试商 20，再计算剩余张数。", "624 ÷ 26 = 24。", "26 × 20 = 520，剩 104，104 ÷ 26 = 4，所以商是 24。"],
    ["工人 15 天做了 375 个零件，平均每天做多少个？", "25", "个", "平均每天的数量 = 总数量 ÷ 天数。", "375 ÷ 15 = 25。", "300 ÷ 15 = 20，75 ÷ 15 = 5，相加得 25。"],
    ["用 384 米长的绳子剪成每段 16 米长的小段，能剪成多少段？", "24", "段", "求段数，用绳子总长度除以每段长度；先试商 20。", "384 ÷ 16 = 24。", "384 = 320 + 64，320 ÷ 16 + 64 ÷ 16 = 20 + 4 = 24 段。"],
    ["一批 728 千克苹果，每筐装 28 千克，正好装多少筐？", "26", "筐", "28 × 20 = 560，剩余的还能装几筐？", "728 ÷ 28 = 26。", "728 = 560 + 168，20 + 6 = 26 筐。"],
    ["社区准备了 552 本练习本，先留出 48 本备用，剩下的平均分给 24 个班。每班分到多少本？", "21", "本", "先求真正参与平均分的数量，再除以班级数。", "参与分配：552 − 48 = 504 本；每班：504 ÷ 24 = 21 本。", "先检查 24 × 21 = 504，再加上备用的 48 本，正好是 552 本。"],
    ["体育组原计划买 18 个篮球，每个 24 元。如果用同样多的钱改买每个 16 元的排球，能买多少个？", "27", "个", "两种购买方案的总钱数相同，先求原计划的总钱数。", "总钱数：18 × 24 = 432 元；排球数量：432 ÷ 16 = 27 个。", "把 432 元分成 320 元和 112 元，分别可以买 20 个和 7 个排球，合起来是 27 个。"],
  ],
  geometry: [
    ["一个长方形长 12 厘米、宽 8 厘米，它的周长是多少厘米？", "40", "厘米", "长和宽各有两条。", "(12 + 8) × 2 = 40 厘米。", "12 × 2 + 8 × 2 = 40 厘米。"],
    ["一个长方形长 15 米、宽 6 米，它的面积是多少平方米？", "90", "平方米", "面积用长乘宽，单位是平方米。", "15 × 6 = 90 平方米。", "10 × 6 + 5 × 6 = 90 平方米。"],
    ["一个正方形边长 9 厘米，它的周长是多少厘米？", "36", "厘米", "正方形有四条相等的边。", "9 × 4 = 36 厘米。", "9 + 9 + 9 + 9 = 36 厘米。"],
    ["一块正方形地砖边长 7 分米，面积是多少平方分米？", "49", "平方分米", "正方形面积等于边长乘边长。", "7 × 7 = 49 平方分米。", "每排 7 个 1 平方分米，共 7 排，是 49 平方分米。"],
    ["一个长方形周长 50 厘米，长 16 厘米，宽是多少厘米？", "9", "厘米", "先求长与宽的和。", "50 ÷ 2 − 16 = 9 厘米。", "两条宽合计 50 − 16 × 2 = 18，宽是 18 ÷ 2 = 9 厘米。"],
    ["一个正方形的周长是 64 厘米，它的面积是多少平方厘米？", "256", "平方厘米", "先用周长除以 4 求边长，再求面积。", "边长：64 ÷ 4 = 16 厘米；面积：16 × 16 = 256 平方厘米。", "边长为 16 厘米，面积也可算成 16 × (10 + 6) = 160 + 96 = 256 平方厘米。"],
    ["一个长方形长 18 厘米、宽 12 厘米，把长增加 5 厘米、宽保持不变，面积增加多少平方厘米？", "60", "平方厘米", "增加的部分是一个长 5 厘米、宽 12 厘米的长方形。", "增加的面积：5 × 12 = 60 平方厘米。", "新面积 23 × 12 = 276 平方厘米，原面积 18 × 12 = 216 平方厘米，相差 60 平方厘米。"],
    ["一个长方形面积为 96 平方厘米，长 12 厘米，宽是多少厘米？", "8", "厘米", "宽 = 面积 ÷ 长。", "96 ÷ 12 = 8 厘米。", "12 × 8 = 96，所以宽是 8 厘米。"],
    ["一张长方形纸长 18 厘米、宽 8 厘米，另一张正方形纸边长 12 厘米。两张纸的面积相同，它们的周长相差多少厘米？", "4", "厘米", "面积相同不代表周长相同，要分别计算两张纸的边界长度。", "长方形周长：(18 + 8) × 2 = 52 厘米；正方形周长：12 × 4 = 48 厘米；相差：52 − 48 = 4 厘米。", "两张纸面积都是 144 平方厘米，但周长分别为 52 和 48 厘米，说明面积相同仍可能有不同周长。"],
    ["用一根长 64 厘米的铁丝围成一个正方形，再把这根铁丝改围成长 20 厘米的长方形，铁丝没有剩余。长方形的面积是多少平方厘米？", "240", "平方厘米", "改围前后周长相同。先由周长和长求宽，再求面积。", "长方形宽：64 ÷ 2 − 20 = 12 厘米；面积：20 × 12 = 240 平方厘米。", "去掉两条长还剩 64 − 20 × 2 = 24 厘米，两条宽各 12 厘米；20 × 12 = 240 平方厘米。"],
  ],
  multiplication: [
    ["学校买了 16 套课外书，每套 125 元，共需要多少元？", "2000", "元", "可以把 16 拆成 8 × 2。", "125 × 16 = 2000 元。", "125 × 8 × 2 = 1000 × 2 = 2000 元。"],
    ["每箱有 124 支铅笔，买 18 箱一共有多少支？", "2232", "支", "把 18 看成 20 − 2，注意乘十位数时的位置。", "124 × 18 = 2232 支。", "124 × 20 − 124 × 2 = 2480 − 248 = 2232 支。"],
    ["图书馆买了 132 套丛书，每套 15 本，一共有多少本？", "1980", "本", "可以把 15 拆成 10 和 5。", "132 × 15 = 1980 本。", "132 × 10 + 132 × 5 = 1320 + 660 = 1980 本。"],
    ["一列火车平均每小时行 165 千米，行驶 12 小时共行多少千米？", "1980", "千米", "路程 = 速度 × 时间，先求 10 小时和 2 小时的路程。", "165 × 12 = 1980 千米。", "165 × 10 + 165 × 2 = 1650 + 330 = 1980 千米。"],
    ["每张书桌售价 225 元，学校购买 48 张共需要多少元？", "10800", "元", "可以把 48 看成 50 − 2。", "225 × 48 = 10800 元。", "225 × 50 − 225 × 2 = 11250 − 450 = 10800 元。"],
    ["学校订购 136 套实验材料，每套 28 元，一共需要多少元？", "3808", "元", "把 28 拆成 20 和 8，再把两部分的积相加。", "136 × 28 = 3808 元。", "136 × 20 + 136 × 8 = 2720 + 1088 = 3808 元。"],
    ["每个书架放 108 本书，23 个书架共放多少本？", "2484", "本", "三位数乘两位数时，注意十位积的位置。", "108 × 23 = 2484 本。", "108 × 20 + 108 × 3 = 2160 + 324 = 2484 本。"],
    ["一台机器每分钟生产 205 个零件，14 分钟共生产多少个？", "2870", "个", "先计算乘 10 与乘 4 的两个部分。", "205 × 14 = 2870 个。", "205 × 10 + 205 × 4 = 2050 + 820 = 2870 个。"],
    ["每台小风扇售价 128 元，买满 25 台可从总价中减去 200 元。学校购买 25 台，应付多少元？", "3000", "元", "先算未优惠的总价，再减去一次总额优惠，不能每台都减 200 元。", "未优惠总价：128 × 25 = 3200 元；应付：3200 − 200 = 3000 元。", "128 × 25 = 32 × 100 = 3200，再减去总额优惠 200 元，得到 3000 元。"],
    ["学校购买 24 套实验材料，每套 135 元；又购买 18 套模型，每套 120 元。一共需要多少元？", "5400", "元", "两种物品单价不同，要分别算总价再相加。", "实验材料：135 × 24 = 3240 元；模型：120 × 18 = 2160 元；合计：3240 + 2160 = 5400 元。", "先算 135 × 20 + 135 × 4，再算 120 × 10 + 120 × 8，把四部分相加也是 5400 元。"],
  ],
};

// Versioned local-trial teaching annotations, not a claim of validated curriculum
// coverage. Existing paper/evidence snapshots never inherit these new fields.
const taskMetadata: Record<KnowledgeId, [NonNullable<Question["taskType"]>, string][]> = {
  division: [["basic", "equal-sharing"], ["basic", "packing-groups"], ["basic", "array-arrangement"], ["application", "transport-trips"], ["application", "equal-sharing"], ["application", "average-production"], ["application", "length-segmentation"], ["application", "weight-packing"], ["transfer", "reserve-then-share"], ["transfer", "equal-budget-exchange"]],
  geometry: [["basic", "rectangle-perimeter"], ["basic", "rectangle-area"], ["basic", "square-perimeter"], ["application", "square-area"], ["application", "inverse-perimeter"], ["application", "perimeter-to-area"], ["application", "area-change"], ["application", "inverse-area"], ["transfer", "same-area-different-boundary"], ["transfer", "fixed-perimeter-reshape"]],
  multiplication: [["basic", "purchase-total"], ["basic", "equal-groups-total"], ["basic", "book-set-total"], ["application", "distance-from-rate"], ["application", "purchase-total"], ["application", "purchase-total"], ["application", "shelf-capacity"], ["application", "production-from-rate"], ["transfer", "total-price-discount"], ["transfer", "mixed-purchase-budget"]],
};

export function seedQuestions(): Question[] {
  return (Object.entries(content) as [KnowledgeId, Item[]][]).flatMap(([knowledgeId, items]) => items.map((item, i) => ({
    id: `seed-${knowledgeId}-${i + 1}`, familyId: `family-${knowledgeId}-${i + 1}`, version: 2,
    taskType: taskMetadata[knowledgeId][i][0], contextId: taskMetadata[knowledgeId][i][1],
    text: item[0], answer: item[1], unit: item[2], knowledgeId,
    difficulty: i < 3 ? "基础" : i < 6 ? "巩固" : "挑战", source: "小禾教研原创演示题 · 非教材授权题库",
    sourceScope: "小学四年级数学演示 · 知识范围需教研校验", steps: [item[4], `答：${item[1]}${item[2]}。`],
    hint: item[3], alternative: item[5], prerequisites: knowledgeId === "geometry" ? ["长度单位与乘法"] : ["整数乘除法"],
    status: "published", authorId: "seed-author", reviewerId: "seed-reviewer", reviewNote: "演示题解已样例校核，正式教材范围待教研确认。", createdAt: seedDate,
  })));
}

export function createSeedWorkspace(userId: string, displayName: string, now = new Date().toISOString()): WorkspaceState {
  const questions = seedQuestions();
  const originalDate = new Date(Date.parse(now) - 8 * 86400000).toISOString();
  const practiceDate = new Date(Date.parse(now) - 4 * 86400000).toISOString();
  const originalQuestions = [...questions.filter(q => q.knowledgeId === "division").slice(0, 6), ...questions.filter(q => q.knowledgeId === "geometry").slice(0, 4)].map((q, i) => ({ ...q, id: `demo-original-q-${i}`, familyId: `demo-original-family-${i}`, source: "演示历史 · 非真实学生作答" }));
  const original: Paper = { id: "demo-original-paper", title: "演示原作业 · 10 题", version: 1, createdAt: originalDate, questionIds: originalQuestions.map(q => q.id), questions: originalQuestions, status: "completed", kind: "whole", reason: "演示：一次识别错误已核对，原始结果为 7 对、3 待订正；不代表你的真实学情。", estimatedMinutes: 20 };
  const practiceQuestions = [...questions.filter(q => q.knowledgeId === "division").slice(0, 4), ...questions.filter(q => q.knowledgeId === "geometry").slice(0, 2)].map((q, i) => ({ ...q, id: `demo-practice-q-${i}`, familyId: `demo-practice-family-${i}`, source: "演示历史 · 非真实学生作答" }));
  const practice: Paper = { id: "demo-practice-paper", title: "演示针对练习 · 6 题", version: 1, createdAt: practiceDate, questionIds: practiceQuestions.map(q => q.id), questions: practiceQuestions, status: "completed", kind: "practice", reason: "演示：4 题独立、1 题提示后完成、1 题讲解后完成。", estimatedMinutes: 12 };
  const originalAttempt: Attempt = { id: "demo-original-attempt", paperId: original.id, status: "submitted", startedAt: originalDate, submittedAt: originalDate, correctCount: 7, independentCount: 0, answers: originalQuestions.map((q, i) => ({ questionId: q.id, value: i < 7 ? q.answer : "0", working: "演示原作业记录", help: "unknown", correct: i < 7 })) };
  const practiceAttempt: Attempt = { id: "demo-practice-attempt", paperId: practice.id, status: "submitted", startedAt: practiceDate, submittedAt: practiceDate, correctCount: 6, independentCount: 4, answers: practiceQuestions.map((q, i) => ({ questionId: q.id, value: q.answer, working: "演示作答过程", help: i < 4 ? "independent" : i === 4 ? "hint" : "explanation", correct: true })) };
  const evidence: Evidence[] = [originalAttempt, practiceAttempt].flatMap(attempt => attempt.answers.map((answer, i) => {
    const paper = attempt.paperId === original.id ? original : practice;
    const q = paper.questions[i];
    return { id: `demo-evidence-${attempt.id}-${i}`, knowledgeId: q.knowledgeId, questionId: q.id, questionVersion: q.version, attemptId: attempt.id, paperId: paper.id, questionText: q.text, answer: answer.value, expected: q.answer, help: answer.help, correct: answer.correct === true, createdAt: attempt.submittedAt!, kind: paper.kind === "whole" ? "original" : "practice", familyId: q.familyId, eligible: false, reason: "演示历史，不计入真实星级" };
  }));
  // This is deliberately authored by a different demonstrator so an owner can
  // exercise review -> approval -> publication without bypassing author separation.
  questions.push({
    id: "seed-review-division-1", familyId: "family-review-division-1", version: 1,
    text: "科技小组有 364 个零件，每 14 个装入一个盒子，可以装满多少盒？", answer: "26", unit: "盒", knowledgeId: "division", difficulty: "巩固",
    source: "小禾教研原创待审核样例", sourceScope: "小学四年级数学演示",
    steps: ["364 ÷ 14 = 26。", "验算：26 × 14 = 364。", "答：可以装满 26 盒。"], hint: "先计算 14 × 20，再看剩下多少个零件。", alternative: "364 = 280 + 84，280 ÷ 14 + 84 ÷ 14 = 20 + 6 = 26。",
    prerequisites: ["整数乘除法"], status: "review", authorId: "seed-author", createdAt: now,
  });
  return {
    revision: 0, actor: { id: userId, name: displayName, role: "owner" },
    profile: { name: "小禾同学", grade: "四年级", semester: "上学期", course: "数学", textbook: "演示课程", school: "" },
    questions, papers: [practice, original], attempts: [practiceAttempt, originalAttempt], evidence,
    knowledge: [
      { id: "division", name: "除数是两位数的除法", description: "理解平均分，练习两位数除数的试商与验算", learningState: "current", stars: null, evidenceIds: [], reason: "完成新题后建立你的学习证据；演示不计分。首版试点最高评为 3 星，4—5 星暂不评定。", ruleVersion: "pilot-v2-max3" },
      { id: "geometry", name: "长方形与正方形的周长、面积", description: "区分周长与面积，选择长度或面积单位", learningState: "current", stars: null, evidenceIds: [], reason: "尚无真实独立新题证据。首版试点最高评为 3 星，4—5 星暂不评定。", ruleVersion: "pilot-v2-max3" },
      { id: "multiplication", name: "三位数乘两位数", description: "运用竖式与分步计算解决三位数乘两位数问题", learningState: "current", stars: null, evidenceIds: [], reason: "尚无真实独立新题证据。首版试点最高评为 3 星，4—5 星暂不评定。", ruleVersion: "pilot-v2-max3" },
    ],
    mistakes: evidence.filter(e => !e.correct).map((e, i) => ({ id: `demo-mistake-${i}`, question: originalQuestions.find(q => q.id === e.questionId)!, originalAnswer: e.answer, evidenceId: e.id })),
    events: [{ id: "demo-audit", action: "workspace.seed", label: "建立独立工作区", actorId: userId, createdAt: now, detail: "已载入 30 道已发布原创演示题、1 道待审核样例和两份明确标注的演示历史。演示历史不计入真实星级；情境与迁移标注为本地试用配置，尚待教研验证。" }],
    uploads: [], helpRequests: [], messages: [{ id: "welcome", role: "assistant", text: "你好，我是小禾。当前提供已审核题库的提示与解法检索。选择一道题，我会先给思路；你的提示使用情况会如实记录。", createdAt: now }],
    capabilities: { ocr: false, ai: false, speech: false, storage: true },
  };
}
