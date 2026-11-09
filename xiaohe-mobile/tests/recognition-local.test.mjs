import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { decodeWorkspace, encodeWorkspace } from '../src/local/validation.ts';
import { newRecognitionEditor, recognitionBody, recognitionReady, recognitionEditor } from '../src/features/recognition-review.ts';

const clone = v => v == null ? v : structuredClone(v);
let sequence = 0;
const uuid = () => `ocr-test-${++sequence}`;
const uploadId = '0aacafae-d0ba-441c-a5a4-b002de4d8691';
const uri = `file:///app/Documents/xiaohe-images/${uploadId}.png`;
class Disk {
  record = null; fail = false; loseReply = false; failRead = false; writes = 0;
  async load() { if (this.failRead) throw Error('read'); return clone(this.record); }
  async commit(record, expected) {
    if (this.fail) throw Error('write');
    if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('changed', 'conflict');
    this.record = clone(record); this.writes++;
    if (this.loseReply) throw Error('lost reply');
  }
}
const raw = disk => decodeWorkspace(disk.record);
const nativeResult = () => ({ engine: 'mlkit-chinese', engineVersion: '16.0.1', imageDigest: 'a'.repeat(64), width: 1000, height: 1200, lines: [
  { id: 'line-1', text: '一盒彩笔有 24 支。288 支彩笔可以装满多少盒？', confidence: null, box: { x: .1, y: .1, width: .8, height: .1 } },
  { id: 'line-2', text: '原始答案：13盒', confidence: null, box: { x: .1, y: .3, width: .5, height: .1 } },
] });
function engine(disk, recognizePhoto) { return new LocalLearningEngine({ persistence: disk, newId: uuid, now: () => '2026-10-27T08:00:00.000Z', recognizePhoto }); }
async function setup(recognizePhoto = async () => nativeResult()) {
  const disk = new Disk(), model = engine(disk, recognizePhoto); await model.reload();
  await model.act('local.upload', { id: uploadId, uri, name: 'test.png', purpose: 'single' });
  return { disk, model };
}
const scan = (model, requestId = uuid()) => model.act('local.recognition.scan', { uploadId, requestId });
async function entry(model, disk, answer = '13') {
  let current = raw(disk), capture = current.recognition.captures[0], run = current.recognition.runs[0];
  const candidate = (await model.act('recognition.match', { captureId: capture.id, text: run.lines[0].text })).result.candidates.find(q => q.questionId === 'seed-division-2');
  assert.ok(candidate);
  const fields = { captureId: capture.id, entryId: uuid(), runId: run.id, sourceLineIds: ['line-1', 'line-2'], originalNumber: '2', stem: run.lines[0].text, answer, working: '纸上原始过程', candidate: { questionId: candidate.questionId, questionVersion: candidate.questionVersion, contentDigest: candidate.contentDigest }, checked: { stem: true, answer: true, match: true, unit: true } };
  await model.act('recognition.entry.save', { ...fields, expectedRevision: capture.revision, requestId: uuid() });
  current = raw(disk); assert.ok(Object.values(current.recognition.entries[0].checked).every(v => !v));
  await model.act('recognition.entry.save', { ...fields, expectedRevision: current.recognition.captures[0].revision, requestId: uuid() });
  return raw(disk).recognition.entries[0];
}

test('device OCR resolves the registered URI and commits capture and raw run atomically; retries do not call OCR twice', async () => {
  const seen = [], { disk, model } = await setup(async path => { seen.push(path); return nativeResult(); });
  const before = disk.writes, requestId = uuid(); const result = await scan(model, requestId);
  assert.deepEqual(seen, [uri]); assert.equal(disk.writes, before + 1);
  assert.equal(raw(disk).recognition.captures.length, 1); assert.deepEqual(raw(disk).recognition.runs[0].lines, nativeResult().lines);
  assert.equal(raw(disk).evidence.length, 0); assert.equal(result.state.recognition.runs[0].engine, 'mlkit-chinese');
  await scan(model, requestId); assert.equal(seen.length, 1); assert.equal(disk.writes, before + 1);
  await assert.rejects(model.act('local.recognition.scan', { uploadId, requestId: uuid(), uri: 'file:///private/other.png' }));
  await assert.rejects(model.act('recognition.run.save', {}), e => e.status === 403);
});

test('native failure or failed CAS does not create partial recognition records or change original images', async () => {
  let fail = true; const { disk, model } = await setup(async () => { if (fail) throw Error('OCR_TIMEOUT'); return nativeResult(); });
  const before = clone(disk.record); await assert.rejects(scan(model)); assert.deepEqual(disk.record, before);
  fail = false; disk.fail = true; await assert.rejects(scan(model)); assert.deepEqual(disk.record, before);
  disk.fail = false; await scan(model); assert.deepEqual(raw(disk).uploads, decodeWorkspace(before).uploads);
});

test('unknown scan commit is recovered without creating another run or re-running native OCR', async () => {
  let calls = 0; const { disk, model } = await setup(async () => { calls++; return nativeResult(); });
  const requestId = uuid(); disk.loseReply = true; disk.failRead = true;
  await assert.rejects(scan(model, requestId), e => e.commitState === 'unknown');
  await assert.rejects(scan(model, requestId)); assert.equal(calls, 1);
  disk.loseReply = false; disk.failRead = false; await model.reload(); await scan(model, requestId);
  assert.equal(calls, 1); assert.equal(raw(disk).recognition.runs.length, 1);
});

test('external disk changes while native OCR runs cannot be overwritten by the late result', async () => {
  let finish; const { disk, model } = await setup(() => new Promise(resolve => { finish = resolve; }));
  const operation = scan(model); await new Promise(resolve => setTimeout(resolve, 0));
  const changed = raw(disk); changed.profile.name = '另一窗口保存'; changed.revision++; disk.record = encodeWorkspace(changed); const authoritative = clone(disk.record);
  finish(nativeResult()); await assert.rejects(operation, e => e.code === 'conflict'); assert.deepEqual(disk.record, authoritative);
  assert.equal(raw(disk).recognition.runs.length, 0);
});

test('review edits preserve raw OCR, require separate checks, and submit only selected confirmed answers', async () => {
  const { disk, model } = await setup(); await scan(model); const reviewed = await entry(model, disk);
  assert.equal(recognitionReady(reviewed), true); const runBefore = clone(raw(disk).recognition.runs);
  const capture = raw(disk).recognition.captures[0], run = runBefore[0];
  await model.act('recognition.entry.save', { captureId: capture.id, expectedRevision: capture.revision, entryId: uuid(), runId: run.id, sourceLineIds: [], originalNumber: '3', stem: '没有题库匹配的题', answer: '', working: '', candidate: null, checked: { stem: false, answer: false, match: false, unit: false }, requestId: uuid() });
  const result = await model.act('recognition.submit', { captureId: capture.id, expectedRevision: raw(disk).recognition.captures[0].revision, entryIds: [reviewed.id], requestId: uuid() });
  const current = raw(disk); assert.equal(current.evidence.length, 1); assert.equal(current.attempts[0].answers.length, 1); assert.equal(current.attempts[0].correctCount, 0);
  assert.equal(current.evidence[0].help, 'unknown'); assert.equal(current.evidence[0].eligible, false); assert.equal(current.recognition.entries.filter(e => e.status === 'draft').length, 1);
  assert.deepEqual(current.recognition.runs, runBefore); assert.ok(result.state.recognition.entries.every(e => e.snapshot === undefined));
  await engine(disk).reload(); assert.equal(raw(disk).recognition.entries[1].stem, '没有题库匹配的题');
});

test('history deletion clears raw OCR and affected drafts, prevents re-scan, and preserves teaching questions', async () => {
  let calls = 0; const { disk, model } = await setup(async () => { calls++; return nativeResult(); }); await scan(model); const reviewed = await entry(model, disk);
  let capture = raw(disk).recognition.captures[0]; await model.act('recognition.submit', { captureId: capture.id, expectedRevision: capture.revision, entryIds: [reviewed.id], requestId: uuid() });
  const before = raw(disk), evidenceId = before.evidence[0].id;
  const impact = (await model.act('history.delete.preview', { evidenceIds: [evidenceId], uploadIds: [] })).result.preview;
  assert.equal(impact.recognition.runCount, 1);
  await model.act('history.delete.confirm', { ...impact.selection, sourceRevision: impact.sourceRevision, digest: impact.digest, requestId: uuid() });
  const after = raw(disk); assert.deepEqual(after.questions, before.questions); assert.equal(after.uploads.length, 1);
  assert.deepEqual(after.recognition.runs[0].lines, []); assert.equal(after.recognition.entries[0].answer, '');
  assert.equal(after.recognition.entries[0].status, 'redacted'); await assert.rejects(scan(model), e => e.status === 410); assert.equal(calls, 1);
  await engine(disk).reload(); assert.equal(raw(disk).recognition.runs[0].lines.length, 0);
});

test('migration creates only an empty recognition container and preserves old learning records', async () => {
  const { disk } = await setup(); const legacy = raw(disk); delete legacy.recognition; disk.record = encodeWorkspace(legacy); const before = clone(disk.record);
  disk.fail = true; await assert.rejects(engine(disk).reload()); assert.deepEqual(disk.record, before);
  disk.fail = false; await engine(disk).reload(); const current = raw(disk);
  for (const key of Object.keys(legacy).filter(k => !['revision', 'events'].includes(k))) assert.deepEqual(current[key], legacy[key]);
  assert.deepEqual(current.recognition, { schemaVersion: 1, captures: [], runs: [], entries: [], requests: [] });
});

test('line selection keeps reading order, does not silently truncate, and separates body edits from check flags', () => {
  const lines = nativeResult().lines;
  const editor = newRecognitionEditor('entry', 'run', lines, ['line-2', 'line-1']);
  assert.deepEqual(editor.sourceLineIds, ['line-1', 'line-2']); assert.equal(editor.stem, lines.map(l => l.text).join('\n'));
  assert.throws(() => newRecognitionEditor('entry', 'run', [{ ...lines[0], text: 'x'.repeat(2001) }], ['line-1']));
  const copy = clone(editor); copy.checked.stem = true; assert.equal(recognitionBody(editor), recognitionBody(copy)); copy.answer = '14'; assert.notEqual(recognitionBody(editor), recognitionBody(copy));
  assert.equal(recognitionReady({ ...editor, status: 'draft' }), false);
  assert.deepEqual(recognitionEditor({ ...editor, snapshot: { answer: 'secret' } }), editor);
});
