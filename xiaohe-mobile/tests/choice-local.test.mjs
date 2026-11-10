import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChoices, splitQuestionText } from '../src/local/shared/choice.ts';

test('移动端同步过来的选项解析能取出四个选项', () => {
  const text = '要调查全市初中生的视力情况，下列做法中不可行的是（　　）。A．随机抽取 500 名初中生做视力检查　B．对全市每一名初中生逐一做视力检查　C．按年级分层抽取 500 名初中生做视力检查　D．在全市各区随机抽取若干所学校';
  const choices = parseChoices(text);
  assert.equal(choices.length, 4);
  assert.deepEqual(choices.map(choice => choice.key), ['A', 'B', 'C', 'D']);
});

test('普通文本题不会被当成选择题', () => {
  const text = '一个长方形长 12 厘米、宽 8 厘米，周长是多少厘米？';
  assert.deepEqual(parseChoices(text), []);
  const split = splitQuestionText(text);
  assert.equal(split.stem, text);
  assert.deepEqual(split.choices, []);
});

test('题干与选项分离，题干里不含选项正文', () => {
  const text = '下列说法正确的是（　　）。A．对角线相等的平行四边形是矩形　B．对角线相等的平行四边形是菱形';
  const { stem, choices } = splitQuestionText(text);
  assert.ok(stem.startsWith('下列说法正确的是'));
  assert.ok(!stem.includes('对角线相等的平行四边形是矩形'));
  assert.equal(choices.length, 2);
});
