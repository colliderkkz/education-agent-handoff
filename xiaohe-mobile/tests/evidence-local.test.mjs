import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { decodeWorkspace, encodeWorkspace } from '../src/local/validation.ts';
import { effectiveAttempt, effectiveEvidence, effectiveMistakes, effectiveReviewSource } from '../src/local/shared/effective-evidence.ts';

const copy = value => value == null ? value : structuredClone(value);
let serial = 0;
class Disk {
  record = null; writes = 0; fail = false; loseReply = false; failRead = false;
  async load() { if (this.failRead) throw new Error('read unavailable'); return copy(this.record); }
  async commit(next, expected) {
    if (this.fail) throw new Error('disk full');
    if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('changed', 'conflict');
    this.record = copy(next); this.writes++;
    if (this.loseReply) throw new Error('native response lost');
  }
}
const modelFor = disk => new LocalLearningEngine({ persistence: disk, newId: () => `evidence-local-${++serial}`, now: () => '2026-10-27T04:00:00.000Z' });
const raw = disk => decodeWorkspace(disk.record);
const originals = state => Object.fromEntries(['papers', 'attempts', 'evidence', 'uploads', 'content', 'companion'].map(key => [key, copy(state[key])]));
async function setup() { const disk = new Disk(), model = modelFor(disk); await model.reload(); return { disk, model }; }
async function submitted(model, disk, correct = false, count = 1, helped = false) {
  const made = await model.act('paper.create', { count, knowledgeIds: ['division'], difficulty: '基础' });
  const paper = raw(disk).papers.find(p => p.id === made.result.id);
  if (helped) await model.act('attempt.help', { paperId: paper.id, questionId: paper.questionIds[0], level: 'hint' });
  await model.act('attempt.submit', { paperId: paper.id, submissionKey: `submit-${++serial}`, answers: paper.questions.map(q => ({ questionId: q.id, value: correct ? q.answer : '9999', working: '保留原始过程' })) });
  return raw(disk).evidence.find(e => e.paperId === paper.id);
}
async function propose(model, disk, entry, patch, extra = {}) {
  return (await model.act('evidence.propose', { evidenceId: entry.id, patch, reason: '依据原稿核对，不是事后学习订正', uploadIds: [], sourceRevision: raw(disk).revision, requestId: `proposal-${++serial}`, ...extra })).result.id;
}
async function preview(model, id, outcome = 'accept') { return (await model.act('evidence.preview', { proposalId: id, outcome })).result.preview; }
const decisionPayload = p => ({ proposalId: p.proposalId, outcome: p.outcome, sourceRevision: p.sourceRevision, digest: p.digest, reason: '本人在本机核对，未经教师验证', requestId: `decision-${++serial}` });
async function confirm(model, id, outcome = 'accept') { return model.act('local.evidence.confirm', decisionPayload(await preview(model, id, outcome))); }

test('evidence migration adds only an empty container and one migration event; failed upgrade preserves original bytes', async () => {
  const { disk, model } = await setup(); assert.deepEqual(raw(disk).evidenceReviews, { schemaVersion: 1, proposals: [], decisions: [] });
  await submitted(model, disk); const legacy = raw(disk); delete legacy.evidenceReviews;
  disk.record = encodeWorkspace(legacy); const before = copy(disk.record), writes = disk.writes;
  disk.fail = true; await assert.rejects(modelFor(disk).reload()); assert.deepEqual(disk.record, before);
  disk.fail = false; const upgraded = modelFor(disk); await upgraded.reload();
  const next = raw(disk); assert.equal(next.revision, legacy.revision + 1);
  for (const key of Object.keys(legacy).filter(k => !['revision', 'events'].includes(k))) assert.deepEqual(next[key], legacy[key], key);
  assert.equal(next.events.length, legacy.events.length + 1); assert.deepEqual(next.evidenceReviews.proposals, []);
  await upgraded.reload(); await modelFor(disk).reload(); assert.equal(disk.writes, writes + 1);
});

test('proposals do not apply themselves; accepted local transcription correction unifies report and mistakes without rewriting original records', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk);
  const old = raw(disk), fixedOriginals = originals(old), history = copy(old.mastery.assessments);
  assert.equal(effectiveMistakes(old).length, 1);
  const id = await propose(model, disk, entry, { answer: entry.expected });
  assert.equal(effectiveAttempt(raw(disk), entry.attemptId).correctCount, 0);
  const p = await preview(model, id); assert.equal(p.report.beforeCorrect, 0); assert.equal(p.report.afterCorrect, 1);
  assert.equal(p.mistake.beforeActive, true); assert.equal(p.mistake.afterActive, false);
  const beforePreview = copy(disk.record); await preview(model, id); assert.deepEqual(disk.record, beforePreview);
  await model.act('local.evidence.confirm', decisionPayload(p));
  const now = raw(disk); assert.deepEqual(originals(now), fixedOriginals); assert.deepEqual(now.mastery.assessments.slice(0, history.length), history);
  assert.equal(effectiveAttempt(now, entry.attemptId).correctCount, 1); assert.equal(effectiveAttempt(now, entry.attemptId).originalCorrectCount, 0);
  assert.equal(effectiveMistakes(now).length, 0); assert.equal(effectiveMistakes(now, { includeInactive: true }).length, 1);
  const current = effectiveEvidence(now).find(e => e.id === entry.id); assert.equal(current.authority, 'local-unverified'); assert.equal(current.eligible, false);
  assert.equal(now.knowledge.find(k => k.id === entry.knowledgeId).stars, null);
  assert.equal(effectiveAttempt(now, entry.attemptId, old.revision).correctCount, 0);
  const reopened = modelFor(disk); await reopened.reload(); assert.equal(effectiveAttempt(reopened.getSnapshot().state, entry.attemptId).correctCount, 1);
});

test('proposal and confirmation failures retain bytes and visible state; lost native replies and repeated request keys commit once', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk);
  const payload = { evidenceId: entry.id, patch: { answer: entry.expected }, reason: '原稿核对', uploadIds: [], sourceRevision: raw(disk).revision, requestId: 'retry-proposal' };
  const old = copy(disk.record); disk.fail = true;
  await assert.rejects(model.act('evidence.propose', payload)); assert.deepEqual(disk.record, old); assert.equal(model.getSnapshot().state.evidenceReviews.proposals.length, 0);
  disk.fail = false; disk.loseReply = true;
  const proposal = await model.act('evidence.propose', payload); const writes = disk.writes;
  await model.act('evidence.propose', payload); assert.equal(disk.writes, writes); disk.loseReply = false;
  const p = await preview(model, proposal.result.id), input = decisionPayload(p), before = copy(disk.record);
  disk.fail = true; await assert.rejects(model.act('local.evidence.confirm', input)); assert.deepEqual(disk.record, before);
  assert.equal(effectiveAttempt(model.getSnapshot().state, entry.attemptId).correctCount, 0);
  disk.fail = false; disk.loseReply = true; await model.act('local.evidence.confirm', input);
  const afterWrites = disk.writes; await model.act('local.evidence.confirm', input); assert.equal(disk.writes, afterWrites);
  assert.equal(raw(disk).evidenceReviews.decisions.length, 1);
  await assert.rejects(model.act('local.evidence.confirm', { ...input, reason: '重试不能换内容' }));
});

test('stale impact previews and a concurrent writer never overwrite newer records', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk);
  const id = await propose(model, disk, entry, { answer: entry.expected }), p = await preview(model, id);
  await model.act('profile.update', { profile: { name: '后续修改保留' } }); const before = copy(disk.record);
  await assert.rejects(model.act('local.evidence.confirm', decisionPayload(p)), /过期/); assert.deepEqual(disk.record, before);
  const stale = modelFor(disk); await stale.reload(); const sp = await preview(stale, id);
  await model.act('profile.update', { profile: { name: '另一个写入者最新资料' } }); const newest = copy(disk.record);
  await assert.rejects(stale.act('local.evidence.confirm', decisionPayload(sp)), error => error.code === 'conflict'); assert.deepEqual(disk.record, newest);
  await stale.reload(); await confirm(stale, id); assert.equal(raw(disk).profile.name, '另一个写入者最新资料');
});

test('an unknown native commit result blocks writes until reload and then claims the saved decision exactly once', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk);
  const id = await propose(model, disk, entry, { answer: entry.expected }), input = decisionPayload(await preview(model, id));
  disk.loseReply = true; disk.failRead = true;
  await assert.rejects(model.act('local.evidence.confirm', input), error => error.commitState === 'unknown');
  assert.equal(effectiveAttempt(model.getSnapshot().state, entry.attemptId).correctCount, 0);
  await assert.rejects(model.act('profile.update', { profile: { name: '不允许继续盲写' } }));
  const writes = disk.writes; disk.failRead = false; disk.loseReply = false;
  await model.reload(); assert.equal(effectiveAttempt(model.getSnapshot().state, entry.attemptId).correctCount, 1);
  await model.act('local.evidence.confirm', input); assert.equal(disk.writes, writes);
  assert.equal(raw(disk).evidenceReviews.decisions.length, 1);
});

test('invalidation removes an earned level immediately and does not let later reevaluation hold a withdrawn star', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk, true, 3);
  const before = raw(disk); assert.equal(before.knowledge[0].stars, 3);
  const id = await propose(model, disk, entry, { invalidated: true }), p = await preview(model, id);
  assert.equal(p.report.beforeCorrect, 3); assert.equal(p.report.afterCorrect, 2);
  await model.act('local.evidence.confirm', decisionPayload(p)); assert.equal(raw(disk).knowledge[0].stars, null);
  assert.equal(effectiveAttempt(raw(disk), entry.attemptId).invalidatedCount, 1);
  await model.act('mastery.reevaluate', { knowledgeId: 'division' }); assert.equal(raw(disk).knowledge[0].stars, null);
  assert.deepEqual(raw(disk).evidence, before.evidence); assert.deepEqual(raw(disk).mastery.assessments.slice(0, before.mastery.assessments.length), before.mastery.assessments);
  await modelFor(disk).reload();
});

test('knowledge correction keeps old assessment mapping and plan while creating a current source plan from original submission time', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk, true);
  const before = raw(disk), oldPlan = copy(before.mastery.reviewPlans[0]);
  const id = await propose(model, disk, entry, { knowledgeId: 'geometry' }); await confirm(model, id);
  const after = raw(disk), moved = after.mastery.reviewPlans.find(p => p.knowledgeId === 'geometry');
  assert.ok(moved); assert.equal(moved.sourceAttemptId, entry.attemptId); assert.equal(moved.dueAt, oldPlan.dueAt);
  assert.deepEqual(after.mastery.reviewPlans.find(p => p.id === oldPlan.id), oldPlan);
  assert.equal(effectiveReviewSource(after, oldPlan).valid, false); assert.equal(effectiveReviewSource(after, moved).valid, true);
  assert.equal(effectiveEvidence(after, before.revision).find(e => e.id === entry.id).knowledgeId, 'division');
  assert.equal(effectiveEvidence(after).find(e => e.id === entry.id).knowledgeId, 'geometry');
  await modelFor(disk).reload();
  await model.act('profile.update', { profile: { name: '更正后的普通资料更新' } });
  const genuine = copy(disk.record);
  for (const mutate of [
    s => { s.mastery.reviewPlans.find(p => p.id === moved.id).sourceRevision = s.revision; },
    s => { s.mastery.reviewPlans.find(p => p.id === moved.id).createdAt = '2026-10-27T05:00:00.000Z'; },
  ]) {
    const envelope = JSON.parse(genuine.payload); mutate(envelope.workspace);
    disk.record = { ...genuine, payload: JSON.stringify(envelope) }; const damaged = copy(disk.record);
    await assert.rejects(modelFor(disk).reload(), /保留原数据/); assert.deepEqual(disk.record, damaged);
  }
});

test('a newly wrong effective answer creates a stable mistake; later learning correction remains separate from recorded answer', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk, true);
  const id = await propose(model, disk, entry, { answer: '0' }); await confirm(model, id);
  const mistake = effectiveMistakes(raw(disk))[0]; assert.ok(mistake); assert.equal(mistake.currentAnswer, '0');
  await model.act('mistake.correct', { id: mistake.id, answer: entry.expected });
  const after = raw(disk), current = effectiveMistakes(after)[0]; assert.equal(current.id, mistake.id); assert.ok(current.correctedAt);
  assert.equal(effectiveAttempt(after, entry.attemptId).correctCount, 0); assert.equal(after.attempts[0].correctCount, 1);
  assert.equal(after.evidence[0].answer, entry.expected); await modelFor(disk).reload();
});

test('rejection leaves learning results unchanged and local clients cannot forge trusted teacher decisions or erase recorded help', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk, true, 1, true);
  const before = raw(disk); await assert.rejects(propose(model, disk, entry, { help: 'independent' }), /帮助|提示|讲解/);
  const id = await propose(model, disk, entry, { invalidated: true });
  const p = await preview(model, id, 'reject'); assert.equal(p.report.beforeCorrect, p.report.afterCorrect);
  await assert.rejects(model.act('evidence.review', decisionPayload(p)));
  await assert.rejects(model.act('local.evidence.confirm', { ...decisionPayload(p), authority: 'teacher-verified', role: 'teacher' }));
  await model.act('local.evidence.confirm', decisionPayload(p));
  const after = raw(disk); assert.deepEqual(originals(after), originals(before)); assert.deepEqual(after.mastery, before.mastery); assert.deepEqual(after.knowledge, before.knowledge);
  assert.equal(after.evidenceReviews.decisions[0].outcome, 'reject'); assert.equal(after.evidenceReviews.decisions[0].authority, 'local-unverified');
});

test('selected local originals are explicit and private; tampered chains or teacher identities block reload without resetting bytes', async () => {
  const { disk, model } = await setup(), entry = await submitted(model, disk);
  await model.act('local.upload', { id: 'photo-a', name: '原稿.png', uri: 'file:///documents/photo-a.png', purpose: 'homework' });
  await assert.rejects(propose(model, disk, entry, { answer: entry.expected }, { uploadIds: ['not-owned'] }));
  const id = await propose(model, disk, entry, { answer: entry.expected }, { uploadIds: ['photo-a'] }); await confirm(model, id);
  const good = copy(disk.record), state = raw(disk); assert.equal(state.evidenceReviews.proposals[0].delivery, 'local-only');
  assert.deepEqual(state.evidenceReviews.proposals[0].uploadIds, ['photo-a']); assert.equal(state.evidenceReviews.proposals[0].materials, undefined);
  for (const mutate of [
    s => { s.evidenceReviews.proposals[0].patch.answer = 'forged'; },
    s => { s.evidenceReviews.decisions[0].authority = 'teacher-verified'; },
    s => { s.evidenceReviews.decisions[0].priorDecisionId = 'nonexistent'; },
    s => { s.evidenceReviews.proposals[0].materials = [{ id: 'photo-a', url: 'https://external.test' }]; },
    s => { s.mastery.assessments.at(-1).evidenceAsOfRevision = s.revision + 1; },
  ]) {
    const envelope = JSON.parse(good.payload); mutate(envelope.workspace); disk.record = { ...good, payload: JSON.stringify(envelope) }; const corrupt = copy(disk.record);
    const next = modelFor(disk); await assert.rejects(next.reload(), /保留原数据/); await assert.rejects(next.act('profile.update', { profile: { name: '不得写入' } })); assert.deepEqual(disk.record, corrupt);
  }
});
