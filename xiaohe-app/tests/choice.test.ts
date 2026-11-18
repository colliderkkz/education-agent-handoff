import assert from "node:assert/strict";
import test from "node:test";
import { parseChoices, splitQuestionText } from "../lib/choice.ts";

test("从题干里解析出选择题的四个选项", () => {
  const text = "要调查全市初中生的视力情况，下列做法中不可行的是（　　）。A．随机抽取 500 名初中生做视力检查　B．对全市每一名初中生逐一做视力检查　C．按年级分层抽取 500 名初中生做视力检查　D．在全市各区随机抽取若干所学校，再从每所学校随机抽取学生";
  const choices = parseChoices(text);
  assert.equal(choices.length, 4);
  assert.deepEqual(choices.map(choice => choice.key), ["A", "B", "C", "D"]);
  assert.ok(choices[0].text.startsWith("随机抽取"));
  assert.ok(choices[3].text.includes("随机抽取学生"));
});

test("半角句点与顿号也能识别", () => {
  assert.equal(parseChoices("下面哪个是质数？ A. 21 B. 29 C. 33").length, 3);
  assert.equal(parseChoices("下面哪个是质数？ A、21 B、29 C、33").length, 3);
});

test("不是选择题的题目返回空数组", () => {
  assert.deepEqual(parseChoices("一个长方形长 12 厘米、宽 8 厘米，周长是多少厘米？"), []);
  // 正文里的孤立字母不构成选项。
  assert.deepEqual(parseChoices("A 地有 3 棵树，B 地有 5 棵树，一共几棵？"), []);
});

test("选项必须是从 A 开始的连续序列，否则不当成选择题", () => {
  // 只出现 B、C、D，不连续 —— 多半是正文里的字母，不按选择题处理。
  assert.deepEqual(parseChoices("某地 B 区有 3 棵树，C 区有 5 棵，D 区有 2 棵。"), []);
});

test("题干与选项可以分开，题干部分去掉选项正文", () => {
  const text = "下列说法正确的是（　　）。A．对角线相等的平行四边形是矩形　B．对角线相等的平行四边形是菱形";
  const { stem, choices } = splitQuestionText(text);
  assert.ok(stem.startsWith("下列说法正确的是"));
  assert.ok(!stem.includes("对角线相等的平行四边形是矩形"));
  assert.equal(choices.length, 2);
});

test("没有选项时题干原样返回", () => {
  const text = "一个长方形长 12 厘米、宽 8 厘米，周长是多少厘米？";
  const { stem, choices } = splitQuestionText(text);
  assert.equal(stem, text);
  assert.deepEqual(choices, []);
});
