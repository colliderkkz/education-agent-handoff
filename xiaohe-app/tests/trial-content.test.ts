import assert from 'node:assert/strict';
import test from 'node:test';
import { seedQuestions } from '../lib/seed.ts';
import { trialQuestions } from '../lib/trial-content.ts';
import { exportContentPackage, parseContentPackage, previewContentPackage } from '../lib/server/content.ts';
import { createSeedWorkspace } from '../lib/seed.ts';

const questions = trialQuestions();
const get = (id: string) => {
  const question = questions.find(item => item.id === `trial-${id}`);
  assert.ok(question, `Missing trial question: ${id}`);
  return question;
};

test('division answers follow independent place-value, remainder and inverse checks', () => {
  const quotient = 684 / 36;
  assert.ok(quotient >= 10 && quotient < 100);
  assert.equal(Number(get('division-quotient-place').answer), Math.floor(Math.log10(quotient)) + 1);
  const validRemainders = Array.from({ length: 56 }, (_, remainder) => remainder).filter(remainder => remainder >= 0 && remainder < 28);
  assert.equal(Number(get('division-remainder-bound').answer), Math.max(...validRemainders));
  const dividend = Number(get('division-inverse-check').answer);
  assert.equal(dividend, 24 * 13 + 5);
  assert.equal(Math.floor(dividend / 24), 13);
  assert.equal(dividend % 24, 5);
});

test('geometry recognition has explicit numeric choices, and inverse side checks all four equal edges', () => {
  const formula = get('geometry-formula-recognition');
  const unit = get('geometry-unit-recognition');
  // Check the two displayed formulas on a non-square counterexample. Product
  // and boundary sum differ, so an accidental area key cannot pass this test.
  const length = 8, width = 3;
  const formulaValues = [length * width, (length + width) * 2];
  const boundary = length + width + length + width;
  assert.equal(Number(formula.answer), formulaValues.findIndex(value => value === boundary) + 1);
  const unitDimensions = { 1: 1, 2: 2 }; // displayed choices: metre, square metre
  assert.equal(unitDimensions[Number(unit.answer) as 1 | 2], 2);
  for (const question of [formula, unit]) {
    assert.match(question.text, /只填 1 或 2/);
    assert.equal(question.unit, '');
    assert.match(question.contextId!, /recognition/);
    assert.doesNotMatch(question.hint, /选[择项]?\s*[12]|填写\s*[12]|答案[是为：:]?\s*[12]/);
    assert.match(question.reviewNote!, /不证明.*计算稳定/);
  }
  const side = Number(get('geometry-inverse-side').answer);
  assert.equal(side, 28 / 4);
  assert.equal(side + side + side + side, 28);
  assert.equal(get('geometry-inverse-side').unit, '厘米');
});

test('multiplication keys check place value, estimation alternatives and factor scaling independently', () => {
  assert.equal(Number(get('multiplication-partial-place').answer), 124 * (Math.floor(23 / 10) * 10));
  const exact = 198 * 31;
  const nearest = [600, 6000, 60000].reduce((best, candidate) => Math.abs(candidate - exact) < Math.abs(best - exact) ? candidate : best);
  assert.equal(Number(get('multiplication-estimation').answer), nearest);
  assert.equal(123 * 12, 1476);
  assert.equal(Number(get('multiplication-factor-scaling').answer), 123 * 24);
  assert.equal(Number(get('multiplication-factor-scaling').answer), 1476 + 1476);
});

test('structural checklist distinguishes eight new tasks and preserves one old-family subtask', () => {
  // This checklist documents the intended item demand; string checks below
  // catch accidental numeric clones but do not claim automated semantic review.
  const structure = [
    ['division-quotient-place', 'trial-family-div-quotient-place', /商是几位数/, 'directed-place-value'],
    ['division-remainder-bound', 'trial-family-div-remainder-bound', /余数最大/, 'constraint-bound'],
    ['division-inverse-check', 'trial-family-div-inverse-dividend', /被除数是多少/, 'inverse-dividend'],
    ['geometry-formula-recognition', 'trial-family-geo-boundary-formula', /哪个算式/, 'formula-recognition'],
    ['geometry-unit-recognition', 'trial-family-geo-area-unit', /哪个单位/, 'unit-recognition'],
    ['geometry-inverse-side', 'family-geometry-6', /边长是多少/, 'inverse-square-side'],
    ['multiplication-partial-place', 'trial-family-mul-partial-product-place', /部分积/, 'partial-place-value'],
    ['multiplication-estimation', 'trial-family-mul-product-estimation', /不用计算精确/, 'magnitude-selection'],
    ['multiplication-factor-scaling', 'trial-family-mul-factor-scaling', /第一个因数不变/, 'factor-relation'],
  ] as const;
  assert.equal(structure.length, questions.length);
  assert.equal(new Set(structure.map(row => row[3])).size, questions.length);
  const normalizedShape = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').replace(/[+-]?\d+(?:\.\d+)?/g, '#');
  const old = seedQuestions();
  const oldShapes = new Set(old.map(question => normalizedShape(question.text)));
  const oldFamilies = new Set(old.map(question => question.familyId));
  for (const [id, family, demand] of structure) {
    const question = get(id);
    assert.equal(question.familyId, family);
    assert.match(question.text, demand);
    assert.equal(oldShapes.has(normalizedShape(question.text)), false, `${id} must not be a number-only seed variant`);
    assert.equal(oldFamilies.has(family), id === 'geometry-inverse-side');
    assert.match(question.reviewNote!, /旧 seed/);
  }
  assert.equal(new Set(questions.map(question => normalizedShape(question.text))).size, questions.length);
  assert.equal(questions.filter(question => !oldFamilies.has(question.familyId)).length, 8);
  const oldInverse = old.find(question => question.familyId === 'family-geometry-6');
  assert.ok(oldInverse);
  assert.equal(get('geometry-inverse-side').familyId, oldInverse.familyId);
  assert.match(get('geometry-inverse-side').reviewNote!, /旧题已见或帮助记录应同族处理/);
});

test('trial publication metadata cannot be mistaken for named human teaching review', () => {
  for (const knowledge of ['division', 'geometry', 'multiplication']) assert.equal(questions.filter(question => question.knowledgeId === knowledge).length, 3);
  assert.equal(new Set(questions.map(question => question.id)).size, 9);
  assert.equal(new Set(questions.map(question => question.familyId)).size, 9);
  for (const question of questions) {
    assert.match(question.answer, /^\d+$/);
    assert.equal(question.taskType, 'basic');
    assert.equal(question.difficulty, '基础');
    assert.equal(question.status, 'published');
    assert.equal(question.authorId, 'xiaohe-trial-draft');
    assert.equal(question.reviewerId, 'xiaohe-arithmetic-check');
    assert.match(question.source, /AI 起草与机器样例数学校核/);
    assert.match(question.source, /未经人工教研验证/);
    assert.match(question.reviewNote!, /未经人工教研验证/);
    assert.match(question.sourceScope, /已学所列前置知识/);
    assert.ok(question.hint && question.alternative && question.contextId);
    assert.ok(question.steps.length >= 3 && question.steps.every(step => step.trim()));
    assert.ok(question.prerequisites.length >= 2 && question.prerequisites.every(value => value.trim()));
  }
});

test('opt-in trial package exports with warnings and never changes existing learner or seed records', () => {
  const state = createSeedWorkspace('trial-export-test', 'test', '2026-10-27T00:00:00.000Z');
  const original = structuredClone(state);
  const exportSource = { ...state, questions: trialQuestions() };
  const pack = exportContentPackage(exportSource, { packageId: 'xiaohe-basic-trial-v1', publisherId: 'xiaohe-trial-draft', createdAt: '2026-10-27T00:00:00.000Z' });
  const parsed = parseContentPackage(JSON.stringify(pack));
  assert.equal(parsed.items.length, 9);
  assert.equal(parsed.teachingValidation, 'unvalidated-trial');
  assert.equal(parsed.trust, 'unsigned');
  assert.equal(previewContentPackage(state, parsed).counts.added, 9);
  assert.deepEqual(state, original);
  assert.equal(seedQuestions().some(question => question.id.startsWith('trial-')), false);
  assert.equal(Object.hasOwn(parsed, 'profile'), false);
  const mutable = trialQuestions();
  mutable[0].steps[0] = 'changed'; mutable[0].prerequisites[0] = 'changed';
  assert.notEqual(trialQuestions()[0].steps[0], 'changed');
  assert.notEqual(trialQuestions()[0].prerequisites[0], 'changed');
});
