import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { decodeWorkspace, encodeWorkspace } from '../src/local/validation.ts';
import { effectiveAttempt } from '../src/local/shared/effective-evidence.ts';

const clone = value => value == null ? value : structuredClone(value);
let sequence = 0;
class Disk {
  record = null; fail = false; loseReply = false; failRead = false; writes = 0;
  async load() { if (this.failRead) throw new Error('read unavailable'); return clone(this.record); }
  async commit(record, revision) {
    if (this.fail) throw new Error('disk full');
    if ((this.record?.revision ?? null) !== revision) throw new LocalStorageError('changed', 'conflict');
    this.record = clone(record); this.writes++;
    if (this.loseReply) throw new Error('native reply lost');
  }
}
const raw = disk => decodeWorkspace(disk.record);
const make = (disk, removePhoto) => new LocalLearningEngine({ persistence: disk, newId: () => `history-local-${++sequence}`, now: () => '2026-10-27T07:00:00.000Z', removePhoto });
async function setup(removePhoto) { const disk = new Disk(), model = make(disk, removePhoto); await model.reload(); return { disk, model }; }
async function submit(model, disk) {
  const made = await model.act('paper.create', { count: 3, knowledgeIds: ['division'], difficulty: '基础' });
  const paper = raw(disk).papers.find(paper => paper.id === made.result.id);
  await model.act('attempt.submit', { paperId: paper.id, submissionKey: `submission-${++sequence}`, answers: paper.questions.map((q, index) => ({ questionId: q.id, value: q.answer, working: `private-work-${index}` })) });
  return { paper, evidence: raw(disk).evidence.filter(entry => entry.paperId === paper.id) };
}
async function attach(model, disk, evidence, id = 'b1509948-d2db-400b-8fcb-3525de8d63b8') {
  const uri = `file:///app/Documents/xiaohe-images/${id}.jpeg`;
  await model.act('local.upload', { id, name: 'private-original.jpeg', uri, purpose: 'homework' });
  await model.act('evidence.propose', { evidenceId: evidence.id, patch: { answer: 'private-proposal-answer' }, reason: 'private-proposal-reason', uploadIds: [id], sourceRevision: raw(disk).revision, requestId: `proposal-${++sequence}` });
  return { id, uri };
}
async function preview(model, evidenceIds, uploadIds = []) { return (await model.act('history.delete.preview', { evidenceIds, uploadIds })).result.preview; }
const confirmation = p => ({ ...p.selection, sourceRevision: p.sourceRevision, digest: p.digest, requestId: `delete-${++sequence}` });

test('history migration preserves every prior record and fails without resetting storage', async () => {
  const { disk, model } = await setup(); await submit(model, disk);
  const legacy = raw(disk); delete legacy.historyDeletion; disk.record = encodeWorkspace(legacy);
  const before = clone(disk.record); disk.fail = true; await assert.rejects(make(disk).reload()); assert.deepEqual(disk.record, before);
  disk.fail = false; await make(disk).reload(); const after = raw(disk);
  assert.equal(after.revision, legacy.revision + 1);
  for (const key of Object.keys(legacy).filter(key => !['revision', 'events'].includes(key))) assert.deepEqual(after[key], legacy[key], key);
  assert.deepEqual(after.historyDeletion.evidence, []); const writes = disk.writes; await make(disk).reload(); assert.equal(disk.writes, writes);
});

test('one selected answer and its copies disappear durably while other answers and the teaching paper remain', async () => {
  const { disk, model } = await setup(); const { paper, evidence } = await submit(model, disk); const first = evidence[0];
  const before = raw(disk); const index = paper.questions.findIndex(q => q.id === first.questionId);
  const p = await preview(model, [first.id]); const afterPreview = clone(disk.record);
  await preview(model, [first.id]); assert.deepEqual(disk.record, afterPreview);
  const result = await model.act('history.delete.confirm', confirmation(p)); const after = raw(disk);
  assert.deepEqual(after.papers, before.papers); assert.deepEqual(after.content, before.content);
  assert.equal(after.attempts[0].answers.length, 2); assert.equal(after.evidence.length, 2);
  assert.ok(!disk.record.payload.includes(`private-work-${index}`));
  assert.equal(result.state.historyDeletion.evidence.length, 1);
  const report = effectiveAttempt(after, first.attemptId); assert.equal(report.deletedCount, 1); assert.equal(report.correctCount, 2); assert.equal(report.originalCorrectCount, null);
  assert.equal(after.knowledge.find(k => k.id === 'division').stars, null);
  await make(disk).reload(); await model.act('mastery.reevaluate', { knowledgeId: 'division' }); assert.equal(raw(disk).knowledge[0].stars, null);
  await assert.rejects(model.act('attempt.save', { paperId: paper.id, answers: before.attempts[0].answers }));
  assert.ok(!disk.record.payload.includes(`private-work-${index}`));
});

test('failed state commit never removes files; successful commit cleans files once and retains a replay tombstone', async () => {
  let disk; const removed = [];
  const fixture = await setup(async uri => { assert.equal(raw(disk).uploads.length, 0); assert.equal(raw(disk).historyDeletion.fileTasks[0].status, 'pending'); removed.push(uri); }); disk = fixture.disk;
  const { model } = fixture; const { evidence } = await submit(model, disk); const photo = await attach(model, disk, evidence[0]);
  const input = confirmation(await preview(model, [evidence[0].id], [photo.id])); const old = clone(disk.record);
  disk.fail = true; await assert.rejects(model.act('history.delete.confirm', input)); assert.deepEqual(disk.record, old); assert.deepEqual(removed, []);
  disk.fail = false; const result = await model.act('history.delete.confirm', input);
  assert.equal(result.result.cleanupPending, 0); assert.deepEqual(removed, [photo.uri]); assert.equal(raw(disk).historyDeletion.fileTasks[0].status, 'complete');
  assert.ok(!disk.record.payload.includes('private-proposal-answer')); assert.ok(!disk.record.payload.includes('private-proposal-reason')); assert.ok(!disk.record.payload.includes('private-original.jpeg'));
  const writes = disk.writes; await model.act('history.delete.confirm', input); assert.equal(disk.writes, writes); assert.equal(removed.length, 1);
  await assert.rejects(model.act('local.upload', { id: photo.id, name: 'old-page', uri: photo.uri, purpose: 'homework' }), error => error.status === 410);
  await assert.rejects(model.act('local.upload', { id: 'alias-after-delete', name: 'alias', uri: photo.uri, purpose: 'homework' }), error => error.status === 410);
});

test('file failure remains pending across restart and retry; it never restores deleted learning records', async () => {
  let fail = true, calls = 0;
  const remove = async () => { calls++; if (fail) throw new Error('file locked'); };
  const { disk, model } = await setup(remove); const { evidence } = await submit(model, disk); const photo = await attach(model, disk, evidence[0]);
  const result = await model.act('history.delete.confirm', confirmation(await preview(model, [evidence[0].id], [photo.id])));
  assert.equal(result.result.cleanupPending, 1); assert.equal(raw(disk).evidence.length, 2); assert.equal(raw(disk).uploads.length, 0);
  const reopened = make(disk, remove); await reopened.reload(); assert.equal(raw(disk).historyDeletion.fileTasks[0].status, 'pending');
  fail = false; await reopened.act('history.files.retry'); assert.equal(raw(disk).historyDeletion.fileTasks[0].status, 'complete'); assert.equal(calls, 3);
  await reopened.reload(); assert.equal(calls, 3);
});

test('unknown deletion commit performs no physical cleanup until exact persisted state is reread', async () => {
  const removed = []; const remove = async uri => removed.push(uri);
  const { disk, model } = await setup(remove); const { evidence } = await submit(model, disk); const photo = await attach(model, disk, evidence[0]);
  const input = confirmation(await preview(model, [evidence[0].id], [photo.id]));
  disk.loseReply = true; disk.failRead = true; await assert.rejects(model.act('history.delete.confirm', input), error => error.commitState === 'unknown');
  assert.deepEqual(removed, []); await assert.rejects(model.act('history.files.retry'));
  disk.loseReply = false; disk.failRead = false; await model.reload(); assert.deepEqual(removed, [photo.uri]);
  await model.act('history.delete.confirm', input); assert.equal(raw(disk).historyDeletion.operations.length, 1); assert.equal(removed.length, 1);
});

test('a lost cleanup acknowledgment safely repeats only file deletion and cannot recreate removed answers', async () => {
  let disk, calls = 0;
  const remove = async () => { calls++; disk.fail = true; };
  const fixture = await setup(remove); disk = fixture.disk; const { model } = fixture; const { evidence } = await submit(model, disk); const photo = await attach(model, disk, evidence[0]);
  const result = await model.act('history.delete.confirm', confirmation(await preview(model, [evidence[0].id], [photo.id])));
  assert.equal(result.result.cleanupPending, 1); assert.equal(raw(disk).evidence.length, 2);
  disk.fail = false; const reopened = make(disk, async () => { calls++; }); await reopened.reload();
  assert.equal(raw(disk).historyDeletion.fileTasks[0].status, 'complete'); assert.equal(calls, 2); assert.equal(raw(disk).evidence.length, 2);
});

test('stale preview and external CAS writers cannot silently broaden deletion or touch photos', async () => {
  const removed = []; const { disk, model } = await setup(async uri => removed.push(uri)); const { evidence } = await submit(model, disk); const photo = await attach(model, disk, evidence[0]);
  const input = confirmation(await preview(model, [evidence[0].id], [photo.id])); await model.act('profile.update', { profile: { name: 'newer profile' } });
  const old = clone(disk.record); await assert.rejects(model.act('history.delete.confirm', input)); assert.deepEqual(disk.record, old); assert.deepEqual(removed, []);
  const stale = make(disk, async uri => removed.push(uri)); await stale.reload(); const next = confirmation(await preview(stale, [evidence[0].id], [photo.id]));
  await model.act('profile.update', { profile: { name: 'external writer' } }); const latest = clone(disk.record);
  await assert.rejects(stale.act('history.delete.confirm', next)); assert.deepEqual(disk.record, latest); assert.deepEqual(removed, []);
});

test('missing or forged deletion descriptors never turn corruption into an accepted partial attempt', async () => {
  const { disk, model } = await setup(); const { evidence } = await submit(model, disk);
  await model.act('history.delete.confirm', confirmation(await preview(model, [evidence[0].id]))); const good = clone(disk.record);
  for (const mutate of [s => { s.historyDeletion.operations = []; }, s => { s.historyDeletion.evidence[0].operationId = 'forged'; }, s => { s.historyDeletion.evidence = []; }, s => { s.attempts[0].answers.pop(); }]) {
    const envelope = JSON.parse(good.payload); mutate(envelope.workspace); disk.record = { ...good, payload: JSON.stringify(envelope) }; const damaged = clone(disk.record);
    await assert.rejects(make(disk).reload()); assert.deepEqual(disk.record, damaged);
  }
});

test('partial paper deletion redacts both paper entries and archived online answers, retains a shared page, then cleans it after the last answer is selected', async () => {
  const removed = []; const { disk, model } = await setup(async uri => removed.push(uri));
  const made = await model.act('paper.create', { count: 3 }); const paper = raw(disk).papers.find(p => p.id === made.result.id);
  const id = '05e177b5-c4cc-4293-8cee-a37732fbd23d', uri = `file:///app/Documents/xiaohe-images/${id}.png`;
  await model.act('local.upload', { id, name: 'shared-page.png', uri, purpose: 'homework' });
  await model.act('attempt.save', { paperId: paper.id, answers: paper.questionIds.map((questionId, i) => ({ questionId, value: `online-private-${i}`, working: `online-work-${i}` })) });
  const saved = await model.act('paper.return.save', { paperId: paper.id, paperVersion: paper.version, questionIds: paper.questionIds, expectedRevision: 0, uploadIds: [id], entries: paper.questions.map((q, i) => ({ questionId: q.id, value: q.answer, working: `paper-private-${i}`, claimedHelp: 'independent', confirmed: true, unitConfirmed: true })) });
  const record = raw(disk).paperReturns.find(r => r.id === saved.result.id);
  await model.act('paper.return.submit', { id: record.id, expectedRevision: record.revision, submissionKey: 'paper-history-delete', replaceOnlineDraft: true });
  const first = raw(disk).evidence.find(e => e.questionId === paper.questionIds[0]);
  const p = await preview(model, [first.id], [id]); assert.equal(p.photos.find(p => p.uploadId === id).willDelete, false);
  await model.act('history.delete.confirm', confirmation(p));
  let after = raw(disk); assert.equal(after.paperReturns[0].entries.length, 2); assert.equal(after.paperReturns[0].onlineDraftSnapshot.answers.length, 2); assert.equal(after.uploads.length, 1); assert.deepEqual(removed, []);
  for (const text of ['online-private-0','online-work-0','paper-private-0']) assert.ok(!disk.record.payload.includes(text));
  await make(disk).reload();
  await model.act('history.delete.confirm', confirmation(await preview(model, after.evidence.map(e => e.id), [id])));
  after = raw(disk); assert.equal(after.attempts[0].answers.length, 0); assert.equal(after.paperReturns[0].entries.length, 0); assert.deepEqual(after.paperReturns[0].uploadIds, []); assert.deepEqual(removed, [uri]);
  const reopened = make(disk); await reopened.reload(); const report = effectiveAttempt(raw(disk), first.attemptId); assert.equal(report.deletedCount, 3); assert.equal(report.retainedCount, 0); assert.equal(report.answers.length, 0);
});
