import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { createSeedWorkspace } from '../src/local/shared/seed.ts';
import { recomputeKnowledge } from '../src/local/shared/server/domain.ts';
import { encodeWorkspace, decodeWorkspace } from '../src/local/validation.ts';
import { LocalStorageError } from '../src/local/types.ts';

const START = '2026-10-26T08:00:00.000Z';
const day = n => new Date(Date.parse(START) + n * 86400000).toISOString();
const clone = value => value == null ? value : structuredClone(value);
function harness(initial = null) {
  let serial = 0, now = START;
  const storage = { record: clone(initial), fail: false, writes: 0, loseReply: false,
    async load() { return clone(this.record); },
    async commit(next, expected) {
      if (this.fail) throw new Error('disk full');
      if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('conflict', 'conflict');
      this.record = clone(next); this.writes++;
      if (this.loseReply) throw new Error('reply lost');
    },
  };
  const make = () => new LocalLearningEngine({ persistence: storage, newId: () => `mastery-local-${++serial}`, now: () => now });
  return { storage, model: make(), make, time: n => { now = day(n); }, raw: () => decodeWorkspace(storage.record) };
}
function legacyRecord() {
  const s = createSeedWorkspace('local-before-upgrade', '旧本机档案', day(-4));
  s.actor.role = 'student';
  s.questions = s.questions.filter(q => q.status === 'published' && Number(q.id.split('-').at(-1)) <= 8).map(q => { const copy = { ...q, version: 1 }; delete copy.taskType; delete copy.contextId; return copy; });
  const q = s.questions[0];
  const paper = { id: 'old-paper', title: '升级前原卷', version: 1, createdAt: day(-4), questionIds: [q.id], questions: [clone(q)], status: 'completed', kind: 'practice', reason: '旧版本建立的真实本机练习', estimatedMinutes: 2 };
  const attempt = { id: 'old-attempt', paperId: paper.id, status: 'submitted', startedAt: day(-4), submittedAt: day(-4), answers: [{ questionId: q.id, value: q.answer, working: '升级前计算过程', help: 'independent', correct: true }], correctCount: 1, independentCount: 1 };
  s.papers = [paper]; s.attempts = [attempt];
  s.evidence = [{ id: 'old-evidence', knowledgeId: q.knowledgeId, questionId: q.id, questionVersion: q.version, familyId: q.familyId, attemptId: attempt.id, paperId: paper.id, questionText: q.text, answer: q.answer, expected: q.answer, help: 'independent', correct: true, createdAt: day(-4), kind: 'practice', eligible: true, reason: '旧版独立新题' }];
  s.mistakes = []; s.events = []; s.messages = []; s.helpRequests = [];
  s.uploads = [{ id: 'old-photo', name: '升级前照片.jpg', url: 'file:///documents/original.jpg', createdAt: day(-4), status: 'pending', purpose: 'homework' }];
  delete s.access; recomputeKnowledge(s);
  return encodeWorkspace(s);
}
async function submit(f, count, difficulty, extra = {}) {
  const made = await f.model.act('paper.create', { knowledgeIds: ['division'], count, difficulty });
  const paper = f.raw().papers.find(p => p.id === made.result.id);
  if (extra.help) await f.model.act('attempt.help', { paperId: paper.id, questionId: paper.questionIds[0], level: extra.help });
  await f.model.act('attempt.submit', { paperId: paper.id, submissionKey: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: q.answer, working: '测试中独立计算' })) });
  return paper;
}

test('legacy upgrade commits once, preserves frozen records and old score, and updates only exact original samples', async () => {
  const old = legacyRecord(), before = decodeWorkspace(old);
  // An edited question and a deleted old sample must not be overwritten or resurrected.
  before.questions[1].text = '本机自定义题目，必须保留'; before.questions = before.questions.filter(q => q.id !== 'seed-geometry-8');
  const f = harness(encodeWorkspace(before)); await f.model.reload(); const after = f.raw();
  for (const key of ['knowledge', 'papers', 'attempts', 'evidence', 'uploads']) assert.deepEqual(after[key], before[key]);
  assert.equal(after.revision, before.revision + 1); assert.equal(after.mastery.assessments.length, 3);
  assert.equal(after.mastery.assessments[0].afterStars, 2); assert.equal(after.mastery.assessments[0].trigger, 'migration');
  assert.equal(after.questions.find(q => q.id === before.questions[1].id).text, before.questions[1].text);
  assert.equal(after.questions.find(q => q.id === before.questions[1].id).version, 1);
  assert.ok(!after.questions.some(q => q.id === 'seed-geometry-8'));
  assert.equal(after.questions.filter(q => q.taskType === 'transfer').length, 6);
  assert.equal(after.papers[0].questions[0].taskType, undefined);
  const saved = clone(f.storage.record); await f.model.reload(); await f.make().reload();
  assert.deepEqual(f.storage.record, saved); assert.equal(f.storage.writes, 1);
  await f.model.act('mastery.reevaluate', { knowledgeId: 'division' });
  assert.equal(f.raw().knowledge[0].stars, null); assert.match(f.raw().mastery.assessments.at(-1).excludedEvidence[0].reason, /旧证据/);
  assert.deepEqual(f.raw().mastery.assessments.slice(0, 3), after.mastery.assessments);
});

test('failed migration leaves old bytes intact and no partially upgraded UI; explicit reload retries atomically', async () => {
  const initial = legacyRecord(); const f = harness(initial); f.storage.fail = true;
  await assert.rejects(f.model.reload(), error => error.commitState === 'not-saved');
  assert.deepEqual(f.storage.record, initial); assert.equal(f.model.getSnapshot().state, null);
  await assert.rejects(f.model.act('profile.update', { profile: { name: '不可写' } }));
  f.storage.fail = false; await f.model.reload(); assert.equal(f.storage.writes, 1);
  assert.ok(f.model.getSnapshot().state.mastery); assert.equal(f.raw().uploads[0].id, 'old-photo');
});

test('migration resolves a lost native success reply using exact readback', async () => {
  const f = harness(legacyRecord()); f.storage.loseReply = true; await f.model.reload();
  assert.equal(f.storage.writes, 1); assert.ok(f.model.getSnapshot().state.mastery);
  await f.model.reload(); assert.equal(f.storage.writes, 1);
});

test('migration CAS conflict never overwrites a concurrent updated legacy record', async () => {
  const f = harness(legacyRecord()); const base = f.storage.commit.bind(f.storage); let first = true;
  f.storage.commit = async (next, expected) => {
    if (first) { first = false; const newer = decodeWorkspace(f.storage.record); newer.revision++; newer.profile.name = '另一写入者保存'; f.storage.record = encodeWorkspace(newer); }
    return base(next, expected);
  };
  await assert.rejects(f.model.reload(), error => error.code === 'conflict');
  assert.equal(f.raw().profile.name, '另一写入者保存'); assert.equal(f.raw().mastery, undefined);
  await f.model.reload(); assert.equal(f.raw().profile.name, '另一写入者保存'); assert.ok(f.raw().mastery);
});

test('the actual 30-question bank supports basic → stable application → D4 fresh transfer, surviving restart', async () => {
  const f = harness(); await f.model.reload();
  const basic = await submit(f, 3, '基础'); assert.equal(f.raw().knowledge[0].stars, 3);
  const app = await submit(f, 3, '巩固'); assert.equal(f.raw().knowledge[0].stars, 4);
  const historical = clone(f.raw().mastery.assessments);
  const plan = f.raw().mastery.reviewPlans.find(p => p.sourcePaperId === app.id);
  assert.equal(plan.dueAt, day(3)); const before = clone(f.storage.record);
  await assert.rejects(f.model.act('review.start', { planId: plan.id }), /尚未到期/); assert.deepEqual(f.storage.record, before);
  f.time(3); const result = await f.model.act('review.start', { planId: plan.id });
  const paper = f.raw().papers.find(p => p.id === result.result.id);
  assert.equal(paper.questions.length, 2); assert.ok(paper.questions.every(q => q.taskType === 'transfer'));
  const seen = new Set([...basic.questions, ...app.questions].map(q => q.familyId)); assert.ok(paper.questions.every(q => !seen.has(q.familyId)));
  await f.model.act('attempt.submit', { paperId: paper.id, submissionKey: paper.id, answers: paper.questions.map(q => ({ questionId: q.id, value: q.answer })) });
  assert.equal(f.raw().knowledge[0].stars, 5); assert.deepEqual(f.raw().mastery.assessments.slice(0, historical.length), historical);
  assert.deepEqual(f.raw().mastery.assessments.at(-1).gaps, [], 'five-star evidence must not demand lower-level aided success');
  const reopened = f.make(); await reopened.reload(); const s = reopened.getSnapshot().state;
  assert.equal(s.knowledge[0].stars, 5); assert.equal(s.mastery.reviewPlans.find(p => p.id === plan.id).status, 'completed');
  const writes = f.storage.writes; await reopened.act('review.start', { planId: plan.id }); assert.equal(f.storage.writes, writes);
});

test('helped success can schedule review and grant the aided level, without granting independence', async () => {
  for (const [help, stars] of [['hint', 2], ['explanation', 1]]) {
    const f = harness(); await f.model.reload(); await submit(f, 1, '基础', { help });
    assert.equal(f.raw().knowledge[0].stars, stars); assert.equal(f.raw().evidence[0].eligible, false);
    assert.equal(f.raw().mastery.reviewPlans.length, 1); await f.make().reload();
  }
});

test('invalid mastery references/parameters/current result are preserved and rejected before further writes', async () => {
  const f = harness(); await f.model.reload(); await submit(f, 3, '基础'); const good = clone(f.storage.record);
  for (const breakIt of [s => { s.mastery.activeRuleId = 'missing'; }, s => { delete s.mastery.rules[0].parameters.star3BasicCorrect; }, s => { s.mastery.assessments[0].adoptedEvidenceIds.push('orphan'); }, s => { s.mastery.reviewPlans[0].dueAt = day(-1); }, s => { s.knowledge[0].stars = 5; }, s => { s.mastery.reviewPlans[0].sourceAttemptId = 'missing'; }]) {
    const envelope = JSON.parse(good.payload); breakIt(envelope.workspace); f.storage.record = { ...good, payload: JSON.stringify(envelope) }; const broken = clone(f.storage.record), writes = f.storage.writes;
    await assert.rejects(f.make().reload(), /保留原数据/); assert.deepEqual(f.storage.record, broken); assert.equal(f.storage.writes, writes);
  }
});

test('single report exposure persists only one family and cannot alter original grades or assessment history', async () => {
  const f = harness(); await f.model.reload(); const paper = await submit(f, 3, '基础'); const before = f.raw();
  f.storage.fail = true;
  await assert.rejects(f.model.act('paper.question.expose', { paperId: paper.id, questionId: paper.questionIds[0] }));
  assert.deepEqual(f.raw(), before); f.storage.fail = false;
  await f.model.act('paper.question.expose', { paperId: paper.id, questionId: paper.questionIds[0] }); await f.model.reload();
  const after = f.raw(); for (const key of ['knowledge', 'attempts', 'evidence', 'mastery']) assert.deepEqual(after[key], before[key]);
  const exposure = JSON.parse(after.events.find(e => e.action === 'learning.exposure').detail);
  assert.deepEqual(exposure.familyIds, [paper.questions[0].familyId]);
  assert.equal(after.events.filter(e => e.action === 'learning.exposure').length, 1);
});
