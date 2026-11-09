import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { applyAction } from '../src/local/shared/server/domain.ts';
import { projectWorkspace } from '../src/local/shared/server/access-policy.ts';
import { decodeWorkspace } from '../src/local/validation.ts';

const copy = value => JSON.parse(JSON.stringify(value));
let serial = 0;
async function fixture(count = 3) {
  let record = null;
  const storage = {
    fail: false,
    async load() { return record && copy(record); },
    async commit(next, expected) { if (storage.fail) throw new Error('disk full'); if ((record?.revision ?? null) !== expected) throw new Error('CAS mismatch'); record = copy(next); },
  };
  const make = () => new LocalLearningEngine({ persistence: storage, newId: () => `return-${++serial}`, now: () => '2026-10-26T08:00:00.000Z' });
  const model = make(); await model.reload();
  const created = await model.act('paper.create', { count }); const paperId = created.result.id;
  const paper = model.getSnapshot().state.papers.find(p => p.id === paperId);
  const photos = ['photo-a', 'photo-b'];
  for (const id of photos) await model.act('local.upload', { id, name: `${id}.jpg`, uri: `file:///document/${id}.jpg`, purpose: 'homework' });
  const raw = () => decodeWorkspace(record);
  const payload = () => ({
    paperId, paperVersion: paper.version, questionIds: [...paper.questionIds], expectedRevision: 0, uploadIds: [...photos],
    entries: raw().papers.find(p => p.id === paperId).questions.map(q => ({ questionId: q.id, value: q.answer, working: '纸上过程', claimedHelp: 'independent', confirmed: true, unitConfirmed: true })),
  });
  const save = async data => { const result = await model.act('paper.return.save', data || payload()); return result.state.paperReturns.find(r => r.id === result.result.id); };
  const submit = (r, extra = {}) => model.act('paper.return.submit', { id: r.id, expectedRevision: r.revision, submissionKey: `paper-return:${r.id}`, ...extra });
  return { model, storage, make, raw, payload, save, submit, paper, paperId, photos, readDisk: () => copy(record) };
}

test('return draft binds original version/order and multiple local photos, restores without an attempt or report', async () => {
  const { model, make, save, payload, paper, paperId, photos } = await fixture();
  const data = payload(); data.entries[1].value = ''; data.entries[1].confirmed = false;
  const record = await save(data);
  assert.equal(record.paperVersion, paper.version); assert.deepEqual(record.questionIds, paper.questionIds); assert.deepEqual(record.uploadIds, photos);
  assert.equal(model.getSnapshot().state.attempts.length, 0); assert.equal(model.getSnapshot().state.evidence.length, 0);
  const reboot = make(); await reboot.reload();
  assert.deepEqual(reboot.getSnapshot().state.paperReturns[0], record);
  assert.equal(reboot.getSnapshot().state.papers.find(p => p.id === paperId).status, 'ready');
});

test('fixed version, fixed question order, missing/duplicate question and invalid claim fail without a write', async () => {
  const { model, payload, readDisk } = await fixture(); const before = readDisk();
  const cases = [
    d => { d.paperVersion++; }, d => { d.questionIds.reverse(); }, d => { d.questionIds[1] = d.questionIds[0]; },
    d => { d.entries.pop(); }, d => { d.entries[1].questionId = d.entries[0].questionId; }, d => { d.entries.reverse(); },
    d => { d.entries[0].claimedHelp = ['hint']; }, d => { d.entries[0].confirmed = 'true'; },
  ];
  for (const change of cases) { const data = payload(); change(data); await assert.rejects(model.act('paper.return.save', data)); assert.deepEqual(readDisk(), before); }
});

test('cross-paper version binding cannot attach the previous version’s question sequence', async () => {
  const { model, payload, paper } = await fixture();
  const replacement = await model.act('paper.replace', { paperId: paper.id, questionId: paper.questionIds[0] });
  const next = replacement.state.papers.find(p => p.id === replacement.result.id);
  const data = payload(); data.paperId = next.id; data.paperVersion = next.version;
  await assert.rejects(model.act('paper.return.save', data), /顺序/);
});

test('unknown/duplicate/nonlocal photos rejected; draft-bound photos cannot be claimed by another return or old homework action', async () => {
  const { model, raw, payload, save, photos } = await fixture();
  await assert.rejects(save({ ...payload(), uploadIds: ['missing'] }), /本机/);
  await assert.rejects(save({ ...payload(), uploadIds: [photos[0], photos[0]] }), /重复/);
  const modified = raw(); modified.uploads[0].url = 'https://example.com/photo.jpg';
  const remoteId = modified.uploads[0].id;
  assert.throws(() => applyAction(modified, { action: 'paper.return.save', ...payload(), uploadIds: [remoteId] }, { userId: modified.actor.id, displayName: '本机', role: 'student' }), /本机/);
  await save();
  await assert.rejects(model.act('homework.confirm', { uploadId: photos[0], entries: [{ questionId: model.getSnapshot().state.questions[0].id, answer: '1' }] }), /绑定原卷/);
  const another = await model.act('paper.create', { count: 3 }); const p = another.state.papers[0];
  await assert.rejects(model.act('paper.return.save', { ...payload(), paperId: p.id, paperVersion: p.version, questionIds: p.questionIds, entries: p.questionIds.map(questionId => ({ questionId })), uploadIds: photos }), /其他作业/);
});

test('previously confirmed photo cannot be rebound to paper return', async () => {
  const { model, payload, photos } = await fixture();
  const q = model.getSnapshot().state.questions[0];
  await model.act('homework.confirm', { uploadId: photos[0], entries: [{ questionId: q.id, answer: '12' }] });
  await assert.rejects(model.act('paper.return.save', { ...payload(), uploadIds: [photos[0]] }), /其他作业/);
});

test('different upload IDs pointing at the same file cannot duplicate or bypass a photo binding', async () => {
  const { model, payload, photos, save } = await fixture();
  await model.act('local.upload', { id: 'alias', name: 'alias.jpg', uri: `file:///document/${photos[0]}.jpg`, purpose: 'homework' });
  await assert.rejects(save({ ...payload(), uploadIds: [photos[0], 'alias'] }), /同一个照片/);
  await save();
  await assert.rejects(model.act('homework.confirm', { uploadId: 'alias', entries: [{ questionId: model.getSnapshot().state.questions[0].id, answer: '1' }] }), /绑定原卷/);
});

test('final confirmation rechecks photo existence and ownership even when the draft was valid earlier', async () => {
  const { save, raw, photos } = await fixture(); const record = await save();
  const context = { userId: 'local-check', displayName: '本机', role: 'student' };
  for (const change of [state => { state.uploads = state.uploads.filter(u => u.id !== photos[0]); }, state => { state.uploads.find(u => u.id === photos[0]).status = 'confirmed'; }]) {
    const state = raw(); change(state);
    assert.throws(() => applyAction(state, { action: 'paper.return.submit', id: record.id, expectedRevision: record.revision, submissionKey: record.id }, context));
    assert.equal(state.paperReturns[0].status, 'draft'); assert.equal(state.attempts.length, 0);
  }
});

test('save uses independent optimistic revision and preserves newer paper return from another screen', async () => {
  const { save, payload, model } = await fixture(); const first = await save();
  const newer = payload(); newer.expectedRevision = first.revision; newer.entries[0].value = 'newer saved';
  const latest = await save(newer);
  await assert.rejects(save({ ...payload(), expectedRevision: first.revision }), /草稿已变化/);
  await assert.rejects(model.act('paper.return.submit', { id: first.id, expectedRevision: first.revision, submissionKey: first.id }), /草稿已变化/);
  assert.equal(model.getSnapshot().state.paperReturns[0].entries[0].value, 'newer saved'); assert.equal(latest.revision, first.revision + 1);
});

test('only final confirmation submits the original paper, claims stay separate and never award independent stars', async () => {
  const { model, save, submit, paperId } = await fixture(); const record = await save();
  const beforePaperCount = model.getSnapshot().state.papers.length;
  const result = await submit(record); const attempt = result.state.attempts.find(a => a.paperId === paperId);
  assert.equal(result.result.id, paperId); assert.equal(result.state.papers.length, beforePaperCount);
  assert.equal(attempt.correctCount, 3); assert.equal(attempt.independentCount, 0); assert.ok(attempt.answers.every(a => a.help === 'unknown'));
  assert.ok(result.state.evidence.every(e => e.kind === 'original' && e.eligible === false)); assert.ok(result.state.knowledge.every(k => k.stars === null));
  assert.ok(result.state.paperReturns[0].entries.every(e => e.claimedHelp === 'independent')); assert.equal(result.state.paperReturns[0].attemptId, attempt.id);
  assert.ok(result.state.uploads.every(u => u.status === 'confirmed'));
});

test('each original answer and unit requires explicit confirmation, blank original is allowed and graded wrong', async () => {
  const { save, submit, payload } = await fixture();
  let data = payload(); data.uploadIds = []; let record = await save(data);
  await assert.rejects(submit(record), /至少/);
  data = payload(); data.expectedRevision = record.revision; data.entries[0].unitConfirmed = false; record = await save(data);
  await assert.rejects(submit(record), /逐题核对/);
  data = payload(); data.expectedRevision = record.revision; data.entries[0].confirmed = false; record = await save(data);
  await assert.rejects(submit(record), /逐题核对/);
  data = payload(); data.expectedRevision = record.revision; data.entries[0].value = ''; record = await save(data);
  const result = await submit(record); assert.equal(result.state.attempts[0].correctCount, 2); assert.equal(result.state.mistakes[0].originalAnswer, '');
});

test('online draft is unchanged by save and requires explicit submission confirmation before immutable archival', async () => {
  const { model, paperId, paper, save, submit } = await fixture();
  await model.act('attempt.save', { paperId, answers: [{ questionId: paper.questionIds[0], value: 'earlier online', working: 'retain process' }] });
  await model.act('attempt.help', { paperId, questionId: paper.questionIds[1], level: 'hint' });
  const prior = copy(model.getSnapshot().state.attempts[0]); const record = await save();
  assert.deepEqual(model.getSnapshot().state.attempts[0], prior);
  await assert.rejects(submit(record), /明确确认/); assert.deepEqual(model.getSnapshot().state.attempts[0], prior);
  const result = await submit(record, { replaceOnlineDraft: true });
  assert.deepEqual(result.state.paperReturns[0].onlineDraftSnapshot, prior);
  assert.equal(result.state.attempts[0].answers[1].help, 'hint'); assert.equal(result.state.attempts[0].answers[0].help, 'unknown');
});

test('help-only online draft needs no replacement consent but its help and snapshot are preserved', async () => {
  const { model, paperId, paper, save, submit } = await fixture();
  await model.act('attempt.help', { paperId, questionId: paper.questionIds[0], level: 'explanation' });
  const prior = copy(model.getSnapshot().state.attempts[0]); const record = await save(); const result = await submit(record);
  assert.deepEqual(result.state.paperReturns[0].onlineDraftSnapshot, prior); assert.equal(result.state.attempts[0].answers[0].help, 'explanation');
});

test('paper.expose after return draft raises final help floor; claimed hint/explanation cannot reduce observed help', async () => {
  const { model, paperId, payload, save, submit } = await fixture(); const data = payload();
  data.entries[0].claimedHelp = 'hint'; data.entries[1].claimedHelp = 'explanation'; const record = await save(data);
  await model.act('paper.expose', { paperId }); const result = await submit(record);
  assert.ok(result.state.attempts[0].answers.every(a => a.help === 'explanation'));
  assert.equal(result.state.paperReturns[0].entries[0].claimedHelp, 'hint'); assert.ok(result.state.evidence.every(e => !e.eligible));
});

test('claimed assistance is conservative and applies to overlapping active paper families', async () => {
  const { model, paper, payload, save, submit } = await fixture();
  const changed = await model.act('paper.replace', { paperId: paper.id, questionId: paper.questionIds[0] }); const other = changed.state.papers[0];
  const data = payload(); data.entries[1].claimedHelp = 'hint'; data.entries[2].claimedHelp = 'explanation';
  const result = await submit(await save(data));
  const overlapping = result.state.attempts.find(a => a.paperId === other.id);
  assert.equal(overlapping.answers.find(a => a.questionId === paper.questionIds[1]).help, 'hint');
  assert.equal(overlapping.answers.find(a => a.questionId === paper.questionIds[2]).help, 'explanation');
});

test('same-key repeat is idempotent after other changes; different key and all later editing cannot replace original report', async () => {
  const { model, save, submit, payload } = await fixture(); const record = await save(); const first = await submit(record);
  const original = copy({ attempts: first.state.attempts, evidence: first.state.evidence, mistakes: first.state.mistakes, paperReturns: first.state.paperReturns });
  await model.act('profile.update', { profile: { name: 'new name' } }); const revision = model.getSnapshot().state.revision;
  const duplicate = await submit(record); assert.equal(duplicate.state.revision, revision);
  assert.deepEqual({ attempts: duplicate.state.attempts, evidence: duplicate.state.evidence, mistakes: duplicate.state.mistakes, paperReturns: duplicate.state.paperReturns }, original);
  await assert.rejects(submit(record, { submissionKey: 'changed-key' }), /已提交/);
  await assert.rejects(save({ ...payload(), expectedRevision: duplicate.state.paperReturns[0].revision }), /不能覆盖/);
});

test('submission key already used by another paper cannot link two returns to one report', async () => {
  const { model, save, submit, paperId } = await fixture(); const record = await save();
  const made = await model.act('paper.create', { count: 1 }); const other = made.state.papers[0];
  await model.act('attempt.submit', { paperId: other.id, answers: [{ questionId: other.questionIds[0], value: '0' }], submissionKey: `paper-return:${record.id}` });
  await assert.rejects(submit(record), /其他作答/);
  assert.equal(model.getSnapshot().state.paperReturns[0].status, 'draft');
  assert.ok(!model.getSnapshot().state.attempts.some(a => a.paperId === paperId));
});

test('an online submission made after return draft cannot be overwritten by paper confirmation', async () => {
  const { model, save, submit, payload, paperId } = await fixture(); const record = await save();
  const online = await model.act('attempt.submit', { paperId, answers: payload().entries, submissionKey: paperId });
  const prior = copy(online.state.attempts[0]);
  await assert.rejects(submit(record, { replaceOnlineDraft: true }), /不能覆盖/);
  assert.deepEqual(model.getSnapshot().state.attempts[0], prior);
});

test('save and final persistence failure keep prior draft and do not produce partial report or confirmed uploads', async () => {
  const { model, storage, save, submit, readDisk } = await fixture(); const before = readDisk();
  storage.fail = true; await assert.rejects(save()); assert.deepEqual(readDisk(), before); assert.equal(model.getSnapshot().state.paperReturns, undefined);
  storage.fail = false; const record = await save(); const draftDisk = readDisk();
  storage.fail = true; await assert.rejects(submit(record)); assert.deepEqual(readDisk(), draftDisk);
  assert.equal(model.getSnapshot().state.attempts.length, 0); assert.ok(model.getSnapshot().state.uploads.every(u => u.status === 'pending'));
  storage.fail = false; await submit(record); assert.equal(model.getSnapshot().state.paperReturns[0].status, 'submitted');
});

test('old dossiers without optional returns still decode; malformed return relation is rejected without altering stored input', async () => {
  const { raw, readDisk, save } = await fixture(); const old = readDisk(); assert.equal(decodeWorkspace(old).paperReturns, undefined);
  await save(); const saved = raw(); saved.paperReturns[0].questionIds.reverse();
  const malformed = { revision: saved.revision, payload: JSON.stringify({ schemaVersion: 1, workspace: saved }) };
  const copyBefore = copy(malformed); assert.throws(() => decodeWorkspace(malformed), /保留原数据/); assert.deepEqual(malformed, copyBefore);
});

test('new paper-return material is student/owner only and does not leak through other role projections', async () => {
  const { raw, save } = await fixture(); await save(); const stored = raw();
  assert.equal(projectWorkspace(stored, 'student').paperReturns.length, 1); assert.equal(projectWorkspace(stored, 'owner').paperReturns.length, 1);
  for (const role of ['parent', 'teacher', 'editor', 'reviewer']) assert.deepEqual(projectWorkspace(stored, role).paperReturns, []);
});
