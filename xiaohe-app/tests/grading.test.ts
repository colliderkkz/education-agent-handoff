import assert from "node:assert/strict";
import test from "node:test";
import { gradeAnswer } from "../lib/grading.ts";

test("数值题判分不变：单位别名、错单位、错数、垃圾输入", () => {
  const q = { answer: "40", unit: "厘米" };
  for (const answer of ["40", "４０", "40.0", "答：40 厘米。", "40cm"]) assert.equal(gradeAnswer(answer, q), true, answer);
  for (const answer of ["40米", "40abc", "40.1", "40平方厘米", "", "40+0"]) assert.equal(gradeAnswer(answer, q), false, answer);
  assert.equal(gradeAnswer("90m²", { answer: "90", unit: "平方米" }), true);
  assert.equal(gradeAnswer("90米", { answer: "90", unit: "平方米" }), false);
});

test("英文数词与数字等价：英语题的 Six 应判为 6", () => {
  const q = { answer: "6", unit: "" };
  for (const answer of ["6", "six", "Six", "six.", "答：six"]) assert.equal(gradeAnswer(answer, q), true, answer);
  for (const answer of ["7", "seven", "sixty"]) assert.equal(gradeAnswer(answer, q), false, answer);
  assert.equal(gradeAnswer("twenty", { answer: "20", unit: "" }), true);
  assert.equal(gradeAnswer("twenty three", { answer: "23", unit: "" }), true);
});

test("开放题按要点判分：措辞不同但要点覆盖到，应判对", () => {
  const q = { answer: "看到清亮的溪水在长满青苔的石缝间流动，发出淙淙的水声。", unit: "" };
  assert.equal(gradeAnswer("看到清亮的溪水在长满青苔的石缝间流动，发出淙淙的水声。", q), true);
  assert.equal(gradeAnswer("我看到清亮的溪水在长满青苔的石缝间流动，还听见淙淙的水声。", q), true);
  assert.equal(gradeAnswer("我看到清亮的溪水在长满青苔的石缝间流动。", q), true);
});

test("开放题不能蒙对：与参考答案无关的作答应判错", () => {
  const q = { answer: "看到清亮的溪水在长满青苔的石缝间流动，发出淙淙的水声。", unit: "" };
  for (const answer of ["溪水很清澈", "今天天气很好", "我觉得很好看", ""]) assert.equal(gradeAnswer(answer, q), false, answer);
});

test("开放题要点多于两个时按 60% 命中率判定", () => {
  const q = { answer: "因为长方形的长是宽的两倍，所以周长是长加宽再乘二，所以要先求出一条长。", unit: "" };
  assert.equal(gradeAnswer("长是宽的两倍，所以周长等于长加宽乘二，所以要先求出一条长。", q), true);
  assert.equal(gradeAnswer("所以要先求出一条长。", q), false);
});

test("英文开放题按实词覆盖率判定", () => {
  const q = { answer: "It is warm outside and the trees have small green leaves.", unit: "" };
  assert.equal(gradeAnswer("It is warm outside and the trees have small green leaves.", q), true);
  assert.equal(gradeAnswer("Outside it is warm, and the trees have small green leaves.", q), true);
  assert.equal(gradeAnswer("It is cold outside today.", q), false);
});

test("只有一个要点的题仍然要求逐字相符，不放宽成蒙对", () => {
  const q = { answer: "Spring.", unit: "" };
  assert.equal(gradeAnswer("Spring.", q), true);
  assert.equal(gradeAnswer("Spring is nice.", q), false);
});

test("证明题按「｜」分开的得分点判定，命中一半即可", () => {
  const q = {
    answer: "由坐标得 B₁ = (2 0 2) 与 D₁ = (0 2 2)｜向量 BD = (−2 2 0)，所以 B₁D₁ = BD｜因 BD ⊂ 平面 ABCD 且直线 B₁D₁ ⊄ 平面 ABCD｜由线面平行的判定定理得直线 B₁D₁ ∥ 平面 ABCD",
    unit: "",
  };
  // 学生写出坐标与向量，两侧数字对得上，就算命中要点。
  assert.equal(gradeAnswer("由坐标得 B₁=(2,0,2)、D₁=(0,2,2)，向量 B₁D₁=(−2,2,0)", q), true);
  assert.equal(gradeAnswer("BD 在平面 ABCD 内，由线面平行判定定理得 B₁D₁ ∥ 平面 ABCD", q), true);
  // 与证明无关的内容不能蒙对。
  assert.equal(gradeAnswer("这道题我不太会做，先放着。", q), false);
});

test("数学符号写法不同也要判对：减号、区间、反函数上标", () => {
  assert.equal(gradeAnswer("55≤乙≤70", { answer: "55 ≤ 乙 ≤ 70", unit: "" }), true);
  assert.equal(gradeAnswer("55<=乙<=70", { answer: "55 ≤ 乙 ≤ 70", unit: "" }), true);
  assert.equal(gradeAnswer("f^-1(x)", { answer: "f⁻¹(x)", unit: "" }), true);
  assert.equal(gradeAnswer("x=−3", { answer: "x=-3", unit: "" }), true);
});

test("分数与小数等价：15/8 与 1.875 互相判对", () => {
  assert.equal(gradeAnswer("15/8", { answer: "1.875", unit: "" }), true);
  assert.equal(gradeAnswer("1.875", { answer: "15/8", unit: "" }), true);
  assert.equal(gradeAnswer("3/4", { answer: "0.75", unit: "" }), true);
  assert.equal(gradeAnswer("5/8", { answer: "1.875", unit: "" }), false);
  // 分数答案本身也要能判对。
  assert.equal(gradeAnswer("3/4", { answer: "3/4", unit: "" }), true);
});

test("短文本答案的等价写法算对，但否定与并列不算", () => {
  // 学生常把「平行」写成「互相平行」「两直线平行」，把「相似」写成「相似三角形」。
  for (const [expected, student] of [
    ["平行", "互相平行"], ["平行", "两直线平行"], ["相似", "相似三角形"],
    ["全等", "全等三角形"], ["第二象限", "在第二象限"], ["相切", "相切于点 A"],
    ["钝角", "∠ABC是钝角"], ["直角", "90 度"], ["直角", "90°"], ["垂直", "互相垂直"],
    ["相等", "两边都相等"], ["相切", "切"], ["1 或 -3", "-3 或 1"],
  ]) assert.equal(gradeAnswer(student, { answer: expected, unit: "" }), true, `${expected} <= ${student}`);
  // 否定句、多一个条件、说错的对象都不能蒙对。
  for (const [expected, student] of [
    ["平行", "不平行"], ["平行", "平行且垂直"], ["相似", "不相似"], ["垂直", "不垂直"],
    ["直角", "锐角"], ["相等", "相似"], ["Spring.", "Spring is nice."],
  ]) assert.equal(gradeAnswer(student, { answer: expected, unit: "" }), false, `${expected} <= ${student}`);
});

test("长答案不适用短文本规则，避免把多说的一句话当成答对", () => {
  const q = { answer: "看到清亮的溪水在长满青苔的石缝间流动，发出淙淙的水声。", unit: "" };
  assert.equal(gradeAnswer("溪水很清澈", q), false);
  assert.equal(gradeAnswer("看到清亮的溪水在长满青苔的石缝间流动，发出淙淙的水声。", q), true);
});

test("选择题提交的是字母，参考答案写的是选项内容时也要判对", () => {
  // 英语选词题：卷面渲染成单选，学生提交字母，参考答案写的是选项正文。
  const english = { answer: "tall", unit: "", text: "Choose the best word. 'My friend is very ___.' A. tall B. thin" };
  assert.equal(gradeAnswer("A", english), true);
  assert.equal(gradeAnswer("B", english), false);
  assert.equal(gradeAnswer("tall", english), true);
  // 答案本身就是字母的题走另一条路：只有那一个字母算对。
  const letter = { answer: "A", unit: "", text: "下列做法不可行的是（　　）。A．普查 B．抽样 C．分层 D．随机" };
  assert.equal(gradeAnswer("A", letter), true);
  assert.equal(gradeAnswer("B", letter), false);
});

test("开放题：学生写出结论即可，但相反的结论不能蒙对", () => {
  // 参考答案是一整句话，学生只写结论时也算答对。
  const q = { answer: "可以在犯错误的概率不超过 0.01 的前提下认为吸烟与患肺部疾病有关", unit: "" };
  assert.equal(gradeAnswer("认为吸烟与患肺部疾病有关", q), true);
  assert.equal(gradeAnswer("吸烟与患肺部疾病有关", q), true);
  // 结论相反必须判错 —— 「有关」与「无关」只差一个字，不能靠覆盖率蒙混。
  assert.equal(gradeAnswer("认为吸烟与患肺部疾病无关", q), false);
  // 只写两个字不算答对（说得太少）。
  assert.equal(gradeAnswer("吸烟", q), false);
});

test("开放题：参考��案有多个要点时，学生要覆盖到足够多", () => {
  const q = { answer: "样本不具有代表性，估计结果有偏、不可靠", unit: "" };
  assert.equal(gradeAnswer("样本不具有代表性，估计结果有偏、不可靠", q), true);
  assert.equal(gradeAnswer("样本不具有代表性", q), false);
  assert.equal(gradeAnswer("样本具有代表性", q), false);
});
