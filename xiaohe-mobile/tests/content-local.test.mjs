import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { encodeWorkspace } from '../src/local/validation.ts';
import { exportContentPackage, canonicalStringify, sha256 } from '../src/local/shared/server/content.ts';

const copy = value => value == null ? value : structuredClone(value);
class Disk {
  record = null; writes = 0; fail = false; loseReply = false;
  async load() { return copy(this.record); }
  async commit(next, expected) {
    if (this.fail) throw new Error('disk full');
    if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('changed', 'conflict');
    this.record = copy(next); this.writes++;
    if (this.loseReply) throw new Error('reply lost');
  }
}
let sequence = 0;
const modelFor = disk => new LocalLearningEngine({ persistence: disk, newId: () => `content-test-${++sequence}`, now: () => '2026-10-26T16:00:00.000Z' });
const raw = disk => JSON.parse(disk.record.payload).workspace;
async function setup() { const disk = new Disk(), model = modelFor(disk); await model.reload(); return { disk, model }; }
function contentPackage(disk, packageId = 'trial-package-one', update = {}) {
  const state = raw(disk);
  const q = { ...copy(state.questions[0]), id: 'trial-remainder', familyId: 'trial-remainder-family', version: 1,
    text: '计算 847 ÷ 21 的余数是多少？', answer: '7', unit: '', ...update };
  state.questions = [q]; delete state.content;
  return exportContentPackage(state, { packageId, publisherId: 'test-publisher', createdAt: '2026-10-26T16:00:00.000Z' });
}
const json = pack => JSON.stringify(pack);
async function preview(model, pack) { return (await model.act('local.content.preview', { json: json(pack) })).result.preview; }
async function apply(model, pack, p) { const view = p || await preview(model, pack); return model.act('local.content.apply', { json: json(pack), sourceRevision: view.sourceRevision, digest: view.digest }); }
const history = state => Object.fromEntries(['papers', 'attempts', 'evidence', 'knowledge', 'mistakes', 'uploads', 'paperReturns', 'mastery', 'messages'].map(k => [k, copy(state[k])]));

test('content preview is read-only and does not expose teaching answers; import and rollback preserve learner records', async () => {
  const { model, disk } = await setup();
  const made = await model.act('paper.create', { count: 1 });
  const paper = model.getSnapshot().state.papers.find(p => p.id === made.result.id);
  await model.act('attempt.save', { paperId: paper.id, answers: [{ questionId: paper.questionIds[0], value: '12', working: '尚未提交的原始草稿' }] });
  const before = history(raw(disk)), pack = contentPackage(disk), writes = disk.writes;
  const p = await preview(model, pack);
  assert.equal(disk.writes, writes); assert.equal(p.counts.added, 1);
  assert.ok(!json(p).includes(pack.items[0].text)); assert.ok(!json(p).includes('"answer"'));
  const result = await apply(model, pack, p);
  assert.equal(disk.writes, writes + 1); assert.deepEqual(history(raw(disk)), before);
  assert.equal(result.state.questions.find(q => q.id === pack.items[0].id).answer, '');
  assert.deepEqual(result.state.content.versions, []);
  const batch = raw(disk).content.batches.at(-1);
  await model.act('local.content.rollback', { batchId: batch.id, sourceRevision: raw(disk).revision, reason: '本机验收后退回原题库' });
  assert.ok(!raw(disk).questions.some(q => q.id === pack.items[0].id));
  assert.deepEqual(history(raw(disk)), before);
  const restarted = modelFor(disk); await restarted.reload();
  assert.equal(restarted.getSnapshot().state.content.batches.at(-1).status, 'rolled-back');
  assert.ok(!restarted.getSnapshot().state.questions.some(q => q.id === pack.items[0].id));
});

test('repeat application is a no-op even after rollback; package ID conflicts never write', async () => {
  const { model, disk } = await setup(), pack = contentPackage(disk);
  await apply(model, pack); let writes = disk.writes;
  await apply(model, pack); assert.equal(disk.writes, writes);
  const batch = raw(disk).content.batches.at(-1);
  await model.act('local.content.rollback', { batchId: batch.id, sourceRevision: raw(disk).revision, reason: '撤回试验' });
  writes = disk.writes; const p = await preview(model, pack); assert.equal(p.rolledBack, true);
  await apply(model, pack, p); assert.equal(disk.writes, writes);
  const changed = contentPackage(disk, pack.packageId, { text: '计算 848 ÷ 21 的余数是多少？', answer: '8' });
  const snapshot = copy(disk.record);
  await assert.rejects(preview(model, changed)); assert.deepEqual(disk.record, snapshot);
});

test('changed preview baseline and CAS conflicts cannot overwrite current learning work', async () => {
  const { model, disk } = await setup(), pack = contentPackage(disk);
  const p = await preview(model, pack);
  await model.act('profile.update', { profile: { name: '编辑后档案' } });
  const saved = copy(disk.record);
  await assert.rejects(apply(model, pack, p)); assert.deepEqual(disk.record, saved);
  const stale = modelFor(disk); await stale.reload(); const stalePreview = await preview(stale, pack);
  await model.act('profile.update', { profile: { name: '另一处已保存' } });
  const latest = copy(disk.record);
  await assert.rejects(apply(stale, pack, stalePreview), e => e.code === 'conflict'); assert.deepEqual(disk.record, latest);
});

test('failed content write keeps exact old bytes; committed lost reply is recovered once', async () => {
  const { model, disk } = await setup(), pack = contentPackage(disk), saved = copy(disk.record);
  disk.fail = true; await assert.rejects(apply(model, pack), e => e.commitState === 'not-saved');
  assert.deepEqual(disk.record, saved); assert.equal(model.getSnapshot().state.questions.length, 30);
  disk.fail = false; disk.loseReply = true; await apply(model, pack);
  assert.equal(raw(disk).content.batches.length, 1); assert.equal(model.getSnapshot().state.questions.length, 31);
});

test('unknown/private fields and edited checksums are rejected before writes', async () => {
  const { model, disk } = await setup(), pack = contentPackage(disk), saved = copy(disk.record);
  const bad = [ { ...pack, profile: { name: '不得导入的学习身份' } }, { ...pack, digest: '0'.repeat(64) }, { ...pack, items: [{ ...pack.items[0], attempts: [] }] } ];
  for (const item of bad) { await assert.rejects(preview(model, item)); assert.deepEqual(disk.record, saved); }
});

test('migration archives an existing dossier once and damaged archive is never silently reset', async () => {
  const { model, disk } = await setup(); await model.act('paper.create', { count: 1 });
  const state = raw(disk); delete state.content; disk.record = encodeWorkspace(state);
  const before = history(state), writes = disk.writes;
  const migrated = modelFor(disk); await migrated.reload(); assert.equal(disk.writes, writes + 1);
  assert.deepEqual(history(raw(disk)), before); assert.ok(raw(disk).content.versions.length >= 30);
  await migrated.reload(); assert.equal(disk.writes, writes + 1);
  const corrupt = JSON.parse(disk.record.payload); corrupt.workspace.content.versions[0].digest = sha256(canonicalStringify({ wrong: true }));
  disk.record.payload = JSON.stringify(corrupt); const damaged = copy(disk.record);
  const broken = modelFor(disk); await assert.rejects(broken.reload(), e => e.code === 'corrupt'); assert.deepEqual(disk.record, damaged);
});
