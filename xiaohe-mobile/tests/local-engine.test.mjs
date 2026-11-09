import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { createSQLitePersistence } from '../src/local/sqlite-store.ts';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
class MemoryStorage {
  record = null; writes = 0; fail = false; loseReply = false; failRead = false;
  async load() { if (this.failRead) throw new Error('disk offline'); return clone(this.record); }
  async commit(record, expected) {
    if (this.fail) throw new Error('disk full');
    if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('conflict', 'conflict');
    this.record = clone(record); this.writes++;
    if (this.loseReply) throw new Error('native reply lost');
  }
}
let serial = 0;
function engine(storage = new MemoryStorage()) {
  return { storage, model: new LocalLearningEngine({ persistence: storage, newId: () => `test-${++serial}`, now: () => '2026-10-26T02:00:00.000Z' }) };
}
async function setup(count = 2) {
  const result = engine(); await result.model.reload();
  const made = await result.model.act('paper.create', { count });
  const paperId = made.result.id;
  await result.model.act('paper.resume', { paperId });
  return { ...result, paperId, paper: result.model.getSnapshot().state.papers[0] };
}
function answersFor(storage, paperId) {
  return JSON.parse(storage.record.payload).workspace.papers.find(p => p.id === paperId).questions.map(q => ({ questionId: q.id, value: q.answer, working: '自己计算' }));
}

test('first launch has 30 published trial questions, no invented history and no exposed answers', async () => {
  const { model, storage } = engine(); await model.reload(); const s = model.getSnapshot().state;
  assert.equal(s.questions.length, 30);
  for (const key of ['papers', 'attempts', 'evidence', 'mistakes', 'events', 'messages', 'helpRequests', 'uploads']) assert.deepEqual(s[key], []);
  assert.ok(s.questions.every(q => !q.answer && !q.hint && !q.steps.length));
  assert.ok(s.knowledge.every(k => k.stars === null && k.ruleVersion === 'local-five-star-trial-v1/v1'));
  assert.deepEqual(s.mastery.assessments, []);
  assert.deepEqual(s.mastery.reviewPlans, []);
  assert.equal(s.actor.role, 'student'); assert.ok(s.actor.id.startsWith('local-')); assert.equal(s.access, undefined);
  assert.equal(storage.writes, 1);
});

test('restart restores a saved draft without exposing solutions', async () => {
  const { model, storage, paperId, paper } = await setup();
  await model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[0], value: '12', working: '计算草稿' }] });
  const next = engine(storage).model; await next.reload();
  assert.equal(next.getSnapshot().state.attempts[0].answers[0].value, '12');
  assert.equal(next.getSnapshot().state.attempts[0].answers[0].working, '计算草稿');
  assert.equal(next.getSnapshot().state.papers[0].questions[0].answer, '');
  assert.equal(next.getSnapshot().state.actor.id, model.getSnapshot().state.actor.id);
});

test('failed commit preserves old disk and published state, then queue accepts retry', async () => {
  const { model, storage, paperId, paper } = await setup();
  const before = clone(model.getSnapshot().state); const disk = clone(storage.record); storage.fail = true;
  await assert.rejects(model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[0], value: '999' }] }), error => error.commitState === 'not-saved');
  assert.deepEqual(model.getSnapshot().state, before); assert.deepEqual(storage.record, disk);
  assert.match(model.getSnapshot().error, /未能保存/); assert.equal(model.getSnapshot().busy, false);
  storage.fail = false;
  await model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[0], value: '42' }] });
  assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, '42'); assert.equal(model.getSnapshot().error, null);
});

test('fast edits are queued, payloads captured immediately, reload waits for all writes', async () => {
  const { model, storage, paperId, paper } = await setup();
  let active = 0, max = 0;
  const commit = storage.commit.bind(storage);
  storage.commit = async (...args) => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 4)); await commit(...args); active--; };
  const payload = { paperId, answers: [{ questionId: paper.questionIds[0], value: '1' }] };
  const first = model.act('attempt.save', payload); payload.answers[0].value = 'MUTATED';
  const second = model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[1], value: '2' }] });
  const third = model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[0], value: '3' }] });
  const reload = model.reload(); assert.equal(model.getSnapshot().busy, true);
  const [one] = await Promise.all([first, second, third, reload]);
  assert.equal(one.state.attempts[0].answers[0].value, '1'); assert.equal(max, 1);
  assert.deepEqual(model.getSnapshot().state.attempts[0].answers.map(a => a.value), ['3', '2']);
});

test('help is published only after commit, persisted, and stale save cannot downgrade it', async () => {
  const { model, storage, paperId, paper } = await setup(); const questionId = paper.questionIds[0];
  storage.fail = true;
  await assert.rejects(model.act('attempt.help', { paperId, questionId, level: 'hint' }));
  assert.equal(model.getSnapshot().state.papers[0].questions[0].hint, ''); storage.fail = false;
  const result = await model.act('attempt.help', { paperId, questionId, level: 'hint' }); assert.ok(result.result.help);
  await model.act('attempt.save', { paperId, answers: [{ questionId, value: '10', help: 'independent' }] });
  await model.reload(); assert.equal(model.getSnapshot().state.attempts[0].answers[0].help, 'hint');
  assert.ok(model.getSnapshot().state.papers[0].questions[0].hint); assert.equal(model.getSnapshot().state.papers[0].questions[0].answer, '');
});

test('submission is immutable and idempotent, with independent and helped answers separated', async () => {
  const { model, storage, paperId, paper } = await setup(3);
  await model.act('attempt.help', { paperId, questionId: paper.questionIds[1], level: 'hint' });
  await model.act('attempt.help', { paperId, questionId: paper.questionIds[2], level: 'explanation' });
  const first = await model.act('attempt.submit', { paperId, answers: answersFor(storage, paperId), submissionKey: paperId });
  assert.equal(first.state.attempts[0].correctCount, 3); assert.equal(first.state.attempts[0].independentCount, 1);
  assert.equal(first.state.evidence.filter(e => e.eligible).length, 1);
  const writes = storage.writes;
  const repeated = await model.act('attempt.submit', { paperId, answers: [], submissionKey: paperId });
  assert.equal(storage.writes, writes); assert.deepEqual(repeated.state, first.state);
  await assert.rejects(model.act('attempt.save', { paperId, answers: [] }), /不可覆盖/);
  assert.ok(first.state.knowledge.every(k => k.stars === null || k.stars <= 3));
});

test('single explanation and paper exposure exclude the entire family from future papers', async () => {
  const { model } = engine(); await model.reload(); const q = model.getSnapshot().state.questions[0];
  await model.act('single.explain', { id: q.id });
  const made = await model.act('paper.create', { count: 6 });
  assert.ok(made.state.papers[0].questions.every(item => item.familyId !== q.familyId));
  await model.act('paper.expose', { paperId: made.result.id });
  const exposed = new Set(model.getSnapshot().state.papers[0].questions.map(item => item.familyId));
  const next = await model.act('paper.create', { count: 6 });
  assert.ok(next.state.papers[0].questions.every(item => !exposed.has(item.familyId)));
});

test('corrupt JSON is preserved and blocks new writes until a successful reload', async () => {
  const { model, storage } = engine(); await model.reload(); const good = clone(storage.record);
  storage.record.payload = '{broken'; const before = clone(storage.record); const writes = storage.writes;
  await assert.rejects(model.reload(), /保留原数据/);
  await assert.rejects(model.act('profile.update', { profile: { name: '不能覆盖' } }));
  assert.deepEqual(storage.record, before); assert.equal(storage.writes, writes);
  storage.record = good; await model.reload(); await model.act('profile.update', { profile: { name: '恢复后' } });
  assert.equal(model.getSnapshot().state.profile.name, '恢复后');
});

test('valid JSON with invalid schema or dangling history is also preserved', async () => {
  for (const breakIt of [envelope => { envelope.schemaVersion = 999; }, envelope => { envelope.workspace.questions[0].answer = ''; }, envelope => { envelope.workspace.revision++; }, envelope => { envelope.workspace.attempts = [{ id: 'orphan' }]; }]) {
    const { model, storage } = engine(); await model.reload(); const payload = JSON.parse(storage.record.payload); breakIt(payload);
    storage.record.payload = JSON.stringify(payload); const before = clone(storage.record);
    await assert.rejects(model.reload(), /保留原数据/); assert.deepEqual(storage.record, before);
  }
});

test('an existing record disappearing during this session is not silently replaced by a seed', async () => {
  const { model, storage } = engine(); await model.reload(); const writes = storage.writes;
  storage.record = null;
  await assert.rejects(model.reload(), /未创建新记录/);
  assert.equal(storage.record, null); assert.equal(storage.writes, writes);
});

test('stale engine cannot overwrite another writer and can explicitly reload', async () => {
  const { model, storage } = engine(); await model.reload(); const second = engine(storage).model; await second.reload();
  await model.act('profile.update', { profile: { name: '第一份' } }); const disk = clone(storage.record);
  await assert.rejects(second.act('profile.update', { profile: { name: '过期写入' } }), error => error.code === 'conflict');
  assert.deepEqual(storage.record, disk); await second.reload();
  assert.equal(second.getSnapshot().state.profile.name, '第一份');
});

test('commit succeeded but native response failed is resolved by exact readback', async () => {
  const { model, storage } = engine(); await model.reload(); storage.loseReply = true;
  const result = await model.act('profile.update', { profile: { name: '已写入' } });
  assert.equal(result.state.profile.name, '已写入'); assert.equal(model.getSnapshot().error, null);
});

test('unknown write outcome blocks later writes until reload', async () => {
  const { model, storage } = engine(); await model.reload(); const before = clone(model.getSnapshot().state);
  storage.fail = true; storage.failRead = true;
  await assert.rejects(model.act('profile.update', { profile: { name: '不确定' } }), error => error.commitState === 'unknown');
  assert.deepEqual(model.getSnapshot().state, before);
  storage.fail = false; storage.failRead = false;
  await assert.rejects(model.act('profile.update', { profile: { name: '仍应阻止' } }));
  await model.reload(); await model.act('profile.update', { profile: { name: '恢复写入' } });
});

test('local photo registration is idempotent, local only, and survives restart', async () => {
  const { model, storage } = engine(); await model.reload(); const payload = { id: 'photo-1', name: '作业.jpg', uri: 'file:///document/xiaohe-images/a.jpg', purpose: 'single' };
  await model.act('local.upload', payload); const writes = storage.writes;
  await model.act('local.upload', payload); assert.equal(storage.writes, writes);
  await assert.rejects(model.act('local.upload', { ...payload, uri: 'file:///other.jpg' }), /其他文件/);
  await assert.rejects(model.act('local.upload', { ...payload, id: 'photo-2', uri: 'https://example.com/image.jpg' }));
  await model.reload(); assert.equal(model.getSnapshot().state.uploads[0].url, payload.uri);
});

test('local student cannot elevate via payload or modify content, help stays local', async () => {
  const { model } = engine(); await model.reload();
  await assert.rejects(model.act('question.create', { role: 'owner', question: {} }), error => error.status === 403);
  const updated = await model.act('profile.update', { profile: { name: '新昵称' }, action: 'question.create', role: 'owner' });
  assert.equal(updated.state.actor.role, 'student'); assert.equal(updated.state.profile.name, '新昵称');
  const request = await model.act('help.create', { topic: '不会除法', summary: '请当面帮助我' });
  assert.match(request.result.message, /尚未发送/);
});

test('UI mutation and broken subscribers cannot mutate raw data or fail committed actions', async () => {
  const { model } = engine(); await model.reload();
  const shown = model.getSnapshot().state; shown.questions[0].answer = '888'; shown.actor.role = 'owner';
  model.subscribe(() => { throw new Error('broken UI'); });
  const result = await model.act('profile.update', { profile: { name: '正常保存' } });
  assert.equal(result.state.questions[0].answer, ''); assert.equal(result.state.actor.role, 'student');
});

test('real SQLite adapter persists restart, CAS conflicts and malformed data without replacement', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = { execAsync: async sql => db.exec(sql), getFirstAsync: async sql => db.prepare(sql).get() ?? null, runAsync: async (sql, ...params) => db.prepare(sql).run(...params) };
    const storage = await createSQLitePersistence(adapter);
    const first = engine(storage).model; await first.reload(); await first.act('profile.update', { profile: { name: 'SQLite恢复' } });
    const second = engine(await createSQLitePersistence(adapter)).model; await second.reload(); assert.equal(second.getSnapshot().state.profile.name, 'SQLite恢复');
    await first.act('profile.update', { profile: { name: '较新数据' } });
    await assert.rejects(second.act('profile.update', { profile: { name: '过期覆盖' } }), error => error.code === 'conflict');
    db.exec("UPDATE local_workspace SET payload = 'broken'");
    await assert.rejects(first.reload(), /保留原数据/);
    assert.equal((await storage.load()).payload, 'broken');
  } finally { db.close(); }
});
