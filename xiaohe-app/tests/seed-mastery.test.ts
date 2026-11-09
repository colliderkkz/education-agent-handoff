import assert from 'node:assert/strict';
import test from 'node:test';
import { seedQuestions } from '../lib/seed.ts';
import { gradeAnswer } from '../lib/server/domain.ts';

test('six multi-step transfer samples have independently checked arithmetic, units and distinct task contexts', () => {
  const bank = seedQuestions();
  const expected: [string, number, string][] = [
    ['division-9', (552 - 48) / 24, '本'], ['division-10', 18 * 24 / 16, '个'],
    ['geometry-9', 2 * (18 + 8) - 4 * 12, '厘米'], ['geometry-10', 20 * (64 / 2 - 20), '平方厘米'],
    ['multiplication-9', 128 * 25 - 200, '元'], ['multiplication-10', 24 * 135 + 18 * 120, '元'],
  ];
  for (const [suffix, result, unit] of expected) {
    const q = bank.find(q => q.id === `seed-${suffix}`)!;
    assert.equal(q.taskType, 'transfer'); assert.equal(Number(q.answer), result); assert.equal(q.unit, unit);
    assert.equal(gradeAnswer(`${result}${unit}`, q), true);
    assert.equal(gradeAnswer(`${result + 1}${unit}`, q), false);
    assert.equal(q.version, 2);
  }
  assert.equal(bank.length, 30);
  for (const knowledgeId of ['division', 'geometry', 'multiplication']) {
    const questions = bank.filter(q => q.knowledgeId === knowledgeId);
    assert.equal(questions.filter(q => q.taskType === 'basic').length, 3);
    assert.equal(questions.filter(q => q.taskType === 'application').length, 5);
    const transfer = questions.filter(q => q.taskType === 'transfer');
    assert.equal(new Set(transfer.map(q => q.contextId)).size, 2);
    assert.equal(new Set(questions.map(q => q.familyId)).size, 10);
  }
});
