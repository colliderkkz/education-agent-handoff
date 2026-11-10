import type { CatalogSubject, CatalogUnit, CatalogPoint } from "./curriculum-catalog.ts";
import type { StageId } from "./types.ts";

/**
 * 上海初中 / 高中数学知识点目录。
 *
 * 依据上海市中考、高考数学科考纲的考点结构编写 —— 覆盖常考知识点与题型，
 * 但**每道题都是原创**，不是历年真题，也不照抄教材原文。
 * 目录 id 同时是题库的 knowledgeId：`math-j-<单元>-<知识点>` 为初中，
 * `math-s-<单元>-<知识点>` 为高中。
 *
 * 与四年级目录一样，目录只是「有哪些知识点、在教什么」的索引；
 * 题库在 `content/bank/`，知识点解释在 `curriculum-explanations.ts`。
 */

const p = (id: string, name: string, description: string): CatalogPoint => ({ id, name, description });
const u = (id: string, name: string, points: CatalogPoint[]): CatalogUnit => ({ id, name, points });

const junior: CatalogSubject = {
  id: "math",
  name: "数学",
  edition: "上海中考 · 考纲考点",
  sourceUrl: "https://www.shmeea.edu.cn/",
  stage: "junior",
  units: [
    u("math-j-1", "第一单元 · 数与式", [
      p("math-j-1-real", "实数与数的运算", "实数的意义、相反数与绝对值、数的开方与大小比较"),
      p("math-j-1-radical", "二次根式", "二次根式的意义与性质、最简二次根式、根式的加减乘除"),
      p("math-j-1-poly", "整式的运算", "整式的加减、幂的运算、整式的乘法与完全平方公式"),
      p("math-j-1-factor", "因式分解", "提公因式法与公式法分解因式"),
      p("math-j-1-fraction", "分式与分式方程", "分式的意义与运算、分式方程的解法与增根"),
      p("math-j-1-linear-eq", "一元一次方程与方程组", "方程的解法、实际问题中的方程与二元一次方程组"),
      p("math-j-1-inequality", "不等式与不等式组", "一元一次不等式的解法、不等式组的解集与实际应用"),
      p("math-j-1-quadratic-eq", "一元二次方程", "解法、根的判别式与根与系数的关系、实际应用"),
    ]),
    u("math-j-2", "第二单元 · 函数", [
      p("math-j-2-function", "函数的概念与表示", "变量、自变量取值范围、函数的表示方法与性质"),
      p("math-j-2-linear", "一次函数", "正比例与一次函数的图象与性质、待定系数法求解析式"),
      p("math-j-2-quadratic", "二次函数", "抛物线的开口与对称轴、顶点式与最值"),
      p("math-j-2-inverse", "反比例函数", "反比例函数的图象与性质、k 的几何意义"),
      p("math-j-2-graph", "函数图象与变换", "图象的平移、翻折与交点"),
      p("math-j-2-application", "函数的实际应用", "用函数关系解决行程、方案与分段计费问题"),
    ]),
    u("math-j-3", "第三单元 · 几何", [
      p("math-j-3-angle", "相交线与角", "对顶角与邻补角、平行线的判定与性质、角的计算"),
      p("math-j-3-parallel", "平行线及其判定", "平行线的判定与性质、平行线间的转化"),
      p("math-j-3-triangle", "三角形", "三边关系、内角和、中线角平分线与高"),
      p("math-j-3-quadrilateral", "四边形", "平行四边形、矩形、菱形、正方形的判定与性质"),
      p("math-j-3-circle", "圆", "垂径定理、圆周角、弧长与面积、圆的切线"),
      p("math-j-3-acute-right", "锐角三角函数", "正弦余弦正切的概念、特殊角与实际测量应用"),
      p("math-j-3-similar", "相似三角形", "相似的判定与性质、位似与实际应用"),
      p("math-j-3-proportion", "比例线段", "平行线分线段成比例、角平分线分线段成比例"),
      p("math-j-3-coordinates", "平面直角坐标系", "点的坐标、象限与距离、坐标系中的平移与对称"),
      p("math-j-3-transformation", "图形变换与全等", "轴对称与中心对称、全等三角形与全等判定"),
    ]),
    u("math-j-4", "第四单元 · 统计与概率", [
      p("math-j-4-statistics", "统计与数据分析", "总体与样本、频数分布表与统计图、平均数与中位数"),
      p("math-j-4-probability", "概率", "等可能事件的概率、树状图与列表法求概率"),
      p("math-j-4-survey", "抽样与总体估计", "抽样方法、总体估计与误差分析"),
    ]),
    u("math-j-5", "第五单元 · 综合与探究", [
      p("math-j-5-quadratic-geometry", "二次函数与几何综合", "抛物线与直线的交点、线段最值与面积问题"),
      p("math-j-5-moving-point", "动点问题", "动点运动中的线段长、角度与面积变化"),
      p("math-j-5-extreme", "几何最值问题", "将军饮马型、割补型与最值面积的求解"),
      p("math-j-5-parameter", "参数与存在性探究", "含参方程的讨论、分类讨论与取值范围"),
      p("math-j-5-new-definition", "新定义问题", "阅读新定义并用定义解决问题"),
      p("math-j-5-reading", "阅读理解与数学文化", "阅读材料提取信息、抽象结论与数学史情境"),
    ]),
  ],
};

const senior: CatalogSubject = {
  id: "math",
  name: "数学",
  edition: "上海高考 · 考纲考点",
  sourceUrl: "https://www.shmeea.edu.cn/",
  stage: "senior",
  units: [
    u("math-s-1", "第一单元 · 函数与导数", [
      p("math-s-1-function", "函数的概念与性质", "定义域值域、单调性、奇偶性与反函数"),
      p("math-s-1-log", "指数函数与对数函数", "指数与对数的运算性质、对数函数图象与性质"),
      p("math-s-1-trig", "三角函数", "弧度制、同角三角函数关系、诱导公式与图象变换"),
      p("math-s-1-derivative", "导数与切线", "导数的概念与几何意义、求导法则与切线方程"),
      p("math-s-1-extreme", "函数极值与最值", "单调性判别、极值与最值、恒成立问题"),
    ]),
    u("math-s-2", "第二单元 · 数列", [
      p("math-s-2-sequence", "等差与等比数列", "通项公式与前 n 项和、递推关系"),
      p("math-s-2-application", "数列综合应用", "数列在数列求和、递推与放缩中的应用"),
    ]),
    u("math-s-3", "第三单元 · 立体几何", [
      p("math-s-3-solid", "空间几何体与表面积体积", "柱锥球的表面积与体积、组合体与三视图"),
      p("math-s-3-vector", "空间向量与立体证明", "空间向量法证明线面平行与垂直、二面角"),
    ]),
    u("math-s-4", "第四单元 · 解析几何", [
      p("math-s-4-conic", "圆锥曲线", "椭圆与双曲线的标准方程、焦点与离心率"),
      p("math-s-4-parameter", "解析几何综合", "直线与圆锥曲线的位置关系、定点定值与最值"),
    ]),
    u("math-s-5", "第五单元 · 概率与统计", [
      p("math-s-5-probability", "概率", "古典概型与几何概型、条件概率与全概率"),
      p("math-s-5-statistics", "统计", "统计推断、回归分析与独立性检验"),
    ]),
    u("math-s-6", "第六单元 · 复数与三角", [
      p("math-s-6-complex", "复数", "复数的概念与运算、共轭复数与模"),
      p("math-s-6-trig-apply", "三角恒等变换与应用", "三角恒等式、二倍角与辅助角公式的应用"),
    ]),
  ],
};

export const shanghaiCatalog: CatalogSubject[] = [junior, senior];
export const shanghaiStageOf = (subject: CatalogSubject): StageId | undefined => subject.stage;
