import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperPrintDocuments, PaperPrintTemplateError } from '../src/features/paper-print-template.ts';

function question(id = 'question-a', overrides = {}) {
  return {
    id, familyId: `family-${id}`, version: 2, text: `${id} 的题干：一共 168 本书，平均分给 12 组，每组多少本？`,
    answer: `ANSWER_SECRET_${id}`, unit: '本', knowledgeId: 'division', difficulty: '巩固', source: `冻结来源_${id}`,
    sourceScope: `PRIVATE_SCOPE_${id}`, steps: [`STEP_SECRET_${id}`, '用乘法检查除法计算。'], hint: `HINT_SECRET_${id}`,
    alternative: `ALTERNATIVE_SECRET_${id}`, prerequisites: [`PREREQUISITE_SECRET_${id}`], status: 'published',
    authorId: `PRIVATE_AUTHOR_${id}`, reviewerId: `PRIVATE_REVIEWER_${id}`, reviewNote: `REVIEW_SECRET_${id}`,
    createdAt: '2026-10-26T00:00:00Z', ...overrides,
  };
}
function paper(overrides = {}) {
  return {
    id: 'paper-frozen-02', title: '整数运算与长方形', version: 3, parentId: 'paper-frozen-01',
    createdAt: '2026-10-26T00:00:00Z', questionIds: ['question-b', 'question-a'],
    questions: [question(), question('question-b', { version: 5 })], status: 'completed', kind: 'practice',
    reason: 'PRIVATE_LEARNING_REASON', estimatedMinutes: 4, ...overrides,
  };
}
function freezeDeep(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  return value;
}
const escaped = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('both returns two complete independent HTML files with distinct safe filenames', () => {
  const docs = buildPaperPrintDocuments(paper(), 'both');
  assert.deepEqual(docs.map(doc => doc.kind), ['student', 'solutions']);
  assert.notEqual(docs[0].fileName, docs[1].fileName);
  for (const doc of docs) {
    assert.equal(doc.paperId, 'paper-frozen-02');
    assert.equal(doc.paperVersion, 3); assert.equal(doc.questionCount, 2);
    assert.match(doc.fileName, /\.pdf$/); assert.doesNotMatch(doc.fileName, /[/\\<>:"|?*]/);
    assert.equal((doc.html.match(/<!DOCTYPE html>/g) || []).length, 1);
    assert.match(doc.html, /<html lang="zh-CN">/); assert.match(doc.html, /size: A4 portrait/);
  }
  assert.equal(buildPaperPrintDocuments(paper(), 'student').length, 1);
  assert.equal(buildPaperPrintDocuments(paper(), 'solutions').length, 1);
});

test('student HTML has no answer, hints, hidden solutions or completed learner data', () => {
  const input = paper({ answers: [{ value: 'LEARNER_ANSWER_SECRET', working: 'LEARNER_WORKING_SECRET' }], profile: { name: 'PRIVATE_CHILD_NAME' } });
  const output = buildPaperPrintDocuments(input, 'both')[0];
  for (const sentinel of ['ANSWER_SECRET', 'HINT_SECRET', 'STEP_SECRET', 'ALTERNATIVE_SECRET', 'PREREQUISITE_SECRET', 'REVIEW_SECRET', 'PRIVATE_', 'LEARNER_']) assert.ok(!output.html.includes(sentinel), sentinel);
  assert.doesNotMatch(output.html, /<script\b|<input\b|<textarea\b|display\s*:\s*none|data-answer|type="hidden"/i);
  assert.doesNotMatch(output.html, /参考答案|通用核验提示|解题方法与步骤|已完成|独立答对/);
  assert.match(output.html, /姓名：<i class="blank"><\/i>/);
  assert.match(output.html, /班级：<i class="blank"><\/i>/);
  assert.equal((output.html.match(/class="writing-space"/g) || []).length, 2);
});

test('student path never reads solution fields, even if accessing one would throw', () => {
  const input = paper();
  for (const snapshot of input.questions) for (const key of ['answer', 'unit', 'hint', 'steps', 'alternative', 'prerequisites', 'sourceScope', 'authorId', 'reviewerId', 'reviewNote']) {
    Object.defineProperty(snapshot, key, { get() { throw new Error(`Forbidden read: ${key}`); } });
  }
  assert.doesNotThrow(() => buildPaperPrintDocuments(input, 'student'));
});

test('frozen questionIds controls both orders while exact source and versions are preserved', () => {
  const input = freezeDeep(paper());
  const before = JSON.stringify(input);
  for (const doc of buildPaperPrintDocuments(input, 'both')) {
    assert.ok(doc.html.indexOf('question-b 的题干') < doc.html.indexOf('question-a 的题干'));
    assert.match(doc.html, /data-question-number="1"/); assert.match(doc.html, /data-question-number="2"/);
    assert.match(doc.html, /题目编号：question-b · 题目版本：V5/);
    assert.match(doc.html, /题目编号：question-a · 题目版本：V2/);
    assert.match(doc.html, /题目来源：冻结来源_question-a/);
    assert.match(doc.html, /题目来源：冻结来源_question-b/);
    assert.match(doc.html, /试卷编号：paper-frozen-02/); assert.match(doc.html, /上版试卷编号：paper-frozen-01/);
    assert.match(doc.html, /试卷版本：V3 · 共 2 题/);
  }
  assert.equal(JSON.stringify(input), before);
});

test('solutions include only snapshot answers, units, methods and explicitly generic checking advice', () => {
  const [doc] = buildPaperPrintDocuments(paper(), 'solutions');
  assert.match(doc.html, /ANSWER_SECRET_question-b 本/);
  assert.match(doc.html, /STEP_SECRET_question-b/);
  assert.match(doc.html, /ALTERNATIVE_SECRET_question-b/);
  assert.match(doc.html, /通用核验提示/);
  assert.match(doc.html, /并不表示系统已完成本题的逐题自动核验/);
  assert.match(doc.html, /检查计算过程及单位/);
  assert.doesNotMatch(doc.html, /HINT_SECRET|PRIVATE_SCOPE|PRIVATE_AUTHOR|PRIVATE_REVIEWER|REVIEW_SECRET|PRIVATE_LEARNING_REASON/);
  assert.doesNotMatch(doc.html, /class="writing-space"|class="identity"/);
});

test('every user string is escaped and cannot introduce executable HTML, CSS or external resources', () => {
  const hostile = '</style><script src="https://evil.invalid/x">alert(1)</script><img src=x onerror="x()"> & \' "><iframe src="https://evil.invalid">';
  const q = question(hostile, { text: hostile, answer: hostile, unit: hostile, source: hostile, steps: [hostile], alternative: hostile });
  const input = paper({ id: hostile, title: hostile, parentId: hostile, questionIds: [hostile], questions: [q] });
  for (const doc of buildPaperPrintDocuments(input, 'both')) {
    assert.ok(doc.html.includes(escaped(hostile)));
    assert.doesNotMatch(doc.html, /<script\b|<iframe\b|<img\b|<link\b|<a\b|<base\b|url\s*\(/i);
    assert.equal((doc.html.match(/<style>/g) || []).length, 1);
    assert.equal((doc.html.match(/<\/style>/g) || []).length, 1);
    assert.ok(!doc.html.includes(hostile));
    assert.doesNotMatch(doc.fileName, /[/\\<>:"|?*]/);
    assert.match(doc.html, /default-src 'none'/);
  }
});

test('missing or incomplete solution snapshots fail before producing either combined-mode document', () => {
  for (const change of [{ answer: '' }, { answer: '  ' }, { steps: [] }, { steps: ['有效步骤', ''] }, { steps: null }, { unit: undefined }, { alternative: undefined }]) {
    const input = paper({ questions: [question('question-a', change), question('question-b')] });
    for (const mode of ['solutions', 'both']) assert.throws(() => buildPaperPrintDocuments(input, mode), error => {
      assert.ok(error instanceof PaperPrintTemplateError); assert.equal(error.code, 'MISSING_SOLUTIONS');
      assert.deepEqual(error.questionNumbers, [2]); assert.match(error.message, /第 2 题/); return true;
    });
    assert.doesNotThrow(() => buildPaperPrintDocuments(input, 'student'));
  }
});

test('zero and unitless answers are valid and optional alternative text can be blank', () => {
  const input = paper({ questionIds: ['zero'], questions: [question('zero', { answer: '0', unit: '', steps: ['相同的数相减，结果为 0。'], alternative: '' })] });
  const [doc] = buildPaperPrintDocuments(input, 'solutions');
  assert.match(doc.html, /class="answer-text">0<\/p>/);
  assert.doesNotMatch(doc.html, /<h3>另一种思路<\/h3>/);
});

test('invalid, missing, duplicate or extra frozen questions never silently print a partial paper', () => {
  const badPapers = [
    null, paper({ questionIds: [], questions: [] }), paper({ questionIds: ['question-a'] }),
    paper({ questionIds: ['question-a', 'missing'] }), paper({ questionIds: ['question-a', 'question-a'] }),
    paper({ questions: [question(), question()] }), paper({ questions: [question(), question('extra')] }),
    paper({ version: 0 }), paper({ version: 1.2 }), paper({ version: NaN }), paper({ title: ' ' }),
    paper({ questions: [question('question-a', { version: -1 }), question('question-b')] }),
    paper({ questions: [question('question-a', { text: '' }), question('question-b')] }),
  ];
  for (const input of badPapers) assert.throws(() => buildPaperPrintDocuments(input, 'student'), error => error instanceof PaperPrintTemplateError && error.code === 'INVALID_PAPER');
  assert.throws(() => buildPaperPrintDocuments(paper(), 'invalid'), error => error.code === 'INVALID_MODE');
});

test('optional identity lines are genuinely blank or absent, never populated from learner state', () => {
  const input = paper({ profile: { name: 'PRIVATE_NAME', school: 'PRIVATE_CLASS' } });
  const [withIdentity] = buildPaperPrintDocuments(input, 'student');
  const [withoutIdentity] = buildPaperPrintDocuments(input, 'student', { showIdentityFields: false });
  assert.match(withIdentity.html, /class="identity"/);
  assert.doesNotMatch(withoutIdentity.html, /class="identity"|姓名：|班级：|PRIVATE_NAME|PRIVATE_CLASS/);
});

test('long multilingual text is kept intact and can fragment without clipping or fixed question heights', () => {
  const long = `长题干与方法${'甲乙丙丁'.repeat(1500)}\n${'LongUnbrokenText'.repeat(1000)}\n末尾标记`;
  const input = paper({ questionIds: ['long'], questions: [question('long', { text: long, source: long, steps: [long], alternative: long })] });
  for (const doc of buildPaperPrintDocuments(input, 'both')) {
    assert.ok(doc.html.includes(escaped(long)));
    assert.match(doc.html, /overflow-wrap: anywhere/);
    assert.match(doc.html, /\.question \{[^}]*break-inside: avoid/);
    assert.match(doc.html, /page-break-inside: avoid/);
    assert.match(doc.html, /counter\(page\)/); assert.match(doc.html, /counter\(pages\)/);
    assert.doesNotMatch(doc.html, /overflow\s*:\s*hidden|max-height\s*:|text-overflow\s*:|line-clamp\s*:/);
  }
});

test('missing source is explicitly labelled and unusual object-key IDs remain valid', () => {
  const input = paper({ questionIds: ['__proto__'], questions: [question('__proto__', { source: ' ' })] });
  const [doc] = buildPaperPrintDocuments(input, 'student');
  assert.match(doc.html, /题目来源：来源未标注/);
  assert.match(doc.html, /题目编号：__proto__/);
});
