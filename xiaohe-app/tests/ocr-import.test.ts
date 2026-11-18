import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../lib/seed.ts';
import { applyAction } from '../lib/server/domain.ts';
import { validateContentState } from '../lib/server/content.ts';
import { ocrImportQuestions } from '../lib/ocr-questions.ts';

let serial = 0;
const context = { userId: 'editor', displayName: '教研', role: 'editor' as const, now: '2026-11-18T00:00:00.000Z', newId: () => `new-${++serial}` };
const command = { action: 'question.import', requestId: 'one-image', source: '图片：卷子.png', questions: ['1. 第一题', '2. 第二题'] };

test('OCR import creates incomplete drafts atomically, supports retry and requires real fields before review', () => {
  const initial = createSeedWorkspace('owner', '空间', context.now);
  const imported = applyAction(initial, command, context);
  const ids = imported.result?.questionIds as string[];
  assert.equal(ids.length, 2);
  const questions = ids.map(id => imported.state.questions.find(q => q.id === id)!);
  assert.ok(questions.every(q => q.status === 'draft' && !q.answer && !q.knowledgeId && !q.difficulty && !q.steps.length));
  validateContentState(imported.state);
  assert.throws(() => applyAction(imported.state, { action: 'question.submit', id: ids[0] }, context));
  const retry = applyAction(imported.state, command, context);
  assert.equal(retry.state.revision, imported.state.revision);
  assert.deepEqual(retry.result?.questionIds, ids);
  assert.throws(() => applyAction(imported.state, { ...command, questions: ['1. 改过的题目', '2. 第二题'] }, context), /不同内容/);
  assert.throws(() => applyAction(initial, command, { ...context, role: 'student' }), /权限/);
  const complete = { text: '第一题', answer: '6', unit: '', knowledgeId: 'division', difficulty: '基础', source: '自编', sourceScope: '校内', hint: '想一想', steps: ['计算'], alternative: '', prerequisites: [] };
  const edited = applyAction(imported.state, { action: 'question.update', id: ids[0], question: complete }, context);
  const submitted = applyAction(edited.state, { action: 'question.submit', id: ids[0] }, context);
  assert.equal(submitted.state.questions.find(q => q.id === ids[0])?.status, 'review');
  validateContentState(submitted.state);
  assert.deepEqual(applyAction(submitted.state, command, context).result?.questionIds, ids);
});

test('automatic import skips unnumbered page heading and preserves unnumbered single images', () => {
  assert.deepEqual(ocrImportQuestions('一、计算\n1. 甲\n2. 乙'), ['1. 甲', '2. 乙']);
  assert.deepEqual(ocrImportQuestions('一道没有编号的题'), ['一道没有编号的题']);
});
test('draft deletion retains archive and prevents replaying a deleted import', () => {
  const initial = createSeedWorkspace('owner', '空间', context.now);
  const imported = applyAction(initial, {...command, questions:['1. 删除测试']}, context);
  const id = (imported.result?.questionIds as string[])[0];
  const deleted = applyAction(imported.state, { action:'question.delete', id }, context);
  assert.equal(deleted.state.questions.some(q => q.id === id), false);
  validateContentState(deleted.state);
  assert.throws(() => applyAction(deleted.state, {...command, questions:['1. 删除测试']}, context));
  assert.throws(() => applyAction(initial, {action:'question.delete', id:initial.questions[0].id}, context));
});

test('OCR drafts remain intact while importing a Shanghai content package', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseContentPackage, previewContentPackage, applyContentPackage } = await import('../lib/server/content.ts');
  const initial = createSeedWorkspace('owner', '空间', context.now);
  const imported = applyAction(initial, command, context);
  const ids = imported.result!.questionIds as string[];
  const pack = parseContentPackage(await readFile(new URL('../../xiaohe-mobile/content-packs/xiaohe-junior-math-v1-2.json', import.meta.url), 'utf8'));
  const preview = previewContentPackage(imported.state, pack);
  assert.ok(preview.counts.added > 0);
  const merged = applyContentPackage(imported.state, pack, preview, context).state;
  for (const id of ids) assert.equal(merged.questions.find(q => q.id === id)?.status, 'draft');
  validateContentState(merged);
});
