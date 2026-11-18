import test from 'node:test';
import assert from 'node:assert/strict';
import { splitOcrQuestions } from '../lib/ocr-questions.ts';

test('question suggestions retain text, options and unnumbered preamble', () => {
  assert.deepEqual(splitOcrQuestions('练习题\n1. 第一题\nA. 选项\n（2）小问\n2、第二题\n3.14 米'), [
    '练习题', '1. 第一题\nA. 选项\n（2）小问', '2、第二题\n3.14 米',
  ]);
});

test('empty text and unnumbered text remain usable', () => {
  assert.deepEqual(splitOcrQuestions(' \n '), []);
  assert.deepEqual(splitOcrQuestions('没有题号\n仍需核对'), ['没有题号\n仍需核对']);
});
