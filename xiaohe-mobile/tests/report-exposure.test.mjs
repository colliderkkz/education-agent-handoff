import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';

const clone = value => value == null ? value : structuredClone(value);
function fixture() {
  let record = null, serial = 0, fail = false;
  const storage = {
    load: async () => clone(record),
    commit: async (next, expected) => {
      if (fail) throw new Error('injected disk failure');
      assert.equal(record?.revision ?? null, expected);
      record = clone(next);
    },
  };
  return {
    engine: new LocalLearningEngine({ persistence: storage, newId: () => `exposure-${++serial}`, now: () => '2026-10-26T02:00:00.000Z' }),
    raw: () => JSON.parse(record.payload).workspace,
    fail: value => { fail = value; },
  };
}

test('report exposure preserves submitted evidence and persists help on overlapping active papers', async () => {
  for (const source of ['practice', 'photo']) {
    const f = fixture(); const model = f.engine; await model.reload();
    const made = await model.act('paper.create', { count: 2, knowledgeIds: ['division'], difficulty: '综合' });
    const firstId = made.result.id;
    const first = f.raw().papers.find(p => p.id === firstId);
    let reportId, activeId, sharedQuestionId;
    if (source === 'practice') {
      const replaced = await model.act('paper.replace', { paperId: firstId, questionId: first.questionIds[0] });
      activeId = replaced.result.id; sharedQuestionId = first.questionIds[1];
      await model.act('paper.resume', { paperId: activeId });
      await model.act('attempt.submit', { paperId: firstId, submissionKey: firstId, answers: first.questions.map(q => ({ questionId: q.id, value: q.answer, working: '独立完成的原始过程' })) });
      reportId = firstId;
    } else {
      activeId = firstId; sharedQuestionId = first.questionIds[0];
      await model.act('paper.resume', { paperId: activeId });
      await model.act('local.upload', { id: 'original-photo', name: 'original', uri: 'file:///documents/original.jpg', purpose: 'single' });
      const original = await model.act('homework.confirm', { uploadId: 'original-photo', entries: [{ questionId: sharedQuestionId, answer: '0', working: '纸上原始答案' }] });
      reportId = original.result.id;
    }
    const before = clone(model.getSnapshot().state);
    const submitted = before.attempts.find(a => a.paperId === reportId);
    const evidence = before.evidence.filter(e => e.paperId === reportId);
    assert.equal(before.attempts.find(a => a.paperId === activeId).answers.find(a => a.questionId === sharedQuestionId).help, 'independent');
    if (source === 'practice') assert.ok(submitted.answers.every(a => a.help === 'independent'));
    f.fail(true);
    await assert.rejects(model.act('paper.expose', { paperId: reportId }));
    assert.deepEqual(model.getSnapshot().state, before, 'failed exposure must not publish help or modify records');
    f.fail(false);
    await model.act('paper.expose', { paperId: reportId });
    await model.reload();
    const after = model.getSnapshot().state;
    assert.deepEqual(after.attempts.find(a => a.paperId === reportId), submitted, 'submitted original help, answer and score stay immutable');
    assert.deepEqual(after.evidence.filter(e => e.paperId === reportId), evidence, 'original evidence stays immutable');
    assert.deepEqual(after.knowledge, before.knowledge, 'viewing a report never changes existing stars');
    assert.equal(after.attempts.find(a => a.paperId === activeId).answers.find(a => a.questionId === sharedQuestionId).help, 'explanation');
    assert.ok(after.papers.find(p => p.id === activeId).questions.find(q => q.id === sharedQuestionId).steps.length > 0);
  }
});
