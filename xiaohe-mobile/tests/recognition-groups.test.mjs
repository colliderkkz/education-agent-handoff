import test from 'node:test';
import assert from 'node:assert/strict';
import { newRecognitionEditor, suggestRecognitionGroups } from '../src/features/recognition-review.ts';

const lines = values => values.map((text, index) => ({ id: `line-${index}`, text, box: { x: 0, y: 0, width: 1, height: 1 }, confidence: null }));

test('numbered OCR suggestions retain source order and leave preamble available for manual selection', () => {
  const source = lines(['一、计算题', '1. 第一题', 'A. 选项', '（2）小问', '2、第二题', '3.14 是圆周率']);
  const groups = suggestRecognitionGroups(source);
  assert.deepEqual(groups, [{ number: '1', lineIds: ['line-1', 'line-2', 'line-3'] }, { number: '2', lineIds: ['line-4', 'line-5'] }]);
  const editor = newRecognitionEditor('draft', 'run', source, groups[0].lineIds);
  assert.equal(editor.stem, '1. 第一题\nA. 选项\n（2）小问');
  assert.equal(editor.answer, '');
  assert.equal(editor.candidate, null);
  assert.ok(Object.values(editor.checked).every(value => !value));
});

test('no plausible line-start numbering produces no suggestions', () => {
  assert.deepEqual(suggestRecognitionGroups(lines(['（1）小问', '3.14 米', '答案是 2.'])), []);
});
