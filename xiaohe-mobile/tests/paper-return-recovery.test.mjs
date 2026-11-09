import * as deletionDraft from '../src/features/history-deletion-draft.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { decodeWorkspace } from '../src/local/validation.ts';
import { photoRegistrationPayload } from '../src/features/photo-recovery.ts';
import { createPendingPhotoRecovery } from '../src/features/paper-photo-pending.ts';
import * as merge from '../src/components/learning/paperReturnDraft.ts';

// Exercise the production hook with a real domain engine and uncertain native writes.
// Native rendering, picker behavior and TextInput delivery remain device QA concerns.
const source = ts.transpileModule(readFileSync(new URL('../src/components/learning/usePaperReturnDraft.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(model, paperId) {
  const cells = []; let cursor = 0, effects = [];
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = value; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) cells[i] = { fn, deps }; return cells[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const sandbox = { exports: {}, require(name) { if (name === '../../features/history-deletion-draft') return deletionDraft; if (name === 'react') return hooks; if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } }; if (name === './LearnUI') return { errorMessage: e => e.message }; if (name === './paperReturnDraft') return merge; throw new Error(name); } };
  vm.runInNewContext(source, sandbox);
  return { render(state = model.getSnapshot().state) {
    cursor = 0; effects = [];
    const hook = sandbox.exports.usePaperReturnDraft(state.papers.find(p => p.id === paperId), state, model.act);
    for (const effect of effects) effect();
    return hook;
  } };
}

let serial = 0;
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  let disk = null;
  const storage = {
    failRead: false, uncertain: null,
    async load() { if (storage.failRead) throw new Error('native read unavailable'); return disk; },
    async commit(next, expected) {
      if ((disk?.revision ?? null) !== expected) throw new Error('CAS conflict');
      const mode = storage.uncertain; storage.uncertain = null;
      if (mode !== 'before-commit') disk = next;
      if (mode) { storage.failRead = true; throw new Error('native response lost'); }
    },
  };
  const make = () => new LocalLearningEngine({ persistence: storage, newId: () => `recovery-${++serial}`, now: () => '2026-10-26T08:00:00.000Z' });
  const model = make(); await model.reload(); const created = await model.act('paper.create', { count: 2 });
  const paper = created.state.papers.find(p => p.id === created.result.id);
  const photo = { id: 'durable-photo', name: '原纸面.jpg', uri: 'file:///document/durable-photo.jpg' };
  const raw = () => decodeWorkspace(disk);
  const reload = async () => { storage.failRead = false; await model.reload(); return model.getSnapshot().state; };
  const saveReady = async () => {
    await model.act('local.upload', { ...photo, purpose: 'homework' });
    const result = await model.act('paper.return.save', {
      paperId: paper.id, paperVersion: paper.version, questionIds: paper.questionIds, expectedRevision: 0, uploadIds: [photo.id],
      entries: raw().papers.find(p => p.id === paper.id).questions.map(q => ({ questionId: q.id, value: q.answer, working: '原纸面过程', claimedHelp: 'independent', confirmed: true, unitConfirmed: true })),
    });
    return result.state.paperReturns[0];
  };
  const submit = record => model.act('paper.return.submit', { id: record.id, expectedRevision: record.revision, submissionKey: `paper-return:${record.id}` });
  return { model, storage, paper, photo, raw, reload, make, saveReady, submit, ui: harness(model, paper.id) };
}

test('unknown final commit recovers the original submitted report and cannot be reopened by stale draft props', async () => {
  const { model, storage, raw, reload, saveReady, submit, ui } = await fixture();
  const record = await saveReady(); const old = model.getSnapshot().state; let hook = ui.render();
  const originalInput = hook.snapshot(); storage.uncertain = 'after-commit';
  await assert.rejects(submit(record), error => error.commitState === 'unknown');
  assert.equal(model.getSnapshot().state.paperReturns[0].status, 'draft');
  assert.equal(raw().paperReturns[0].status, 'submitted');
  await hook.recover(reload); hook = ui.render();
  assert.equal(hook.blocked, true); assert.deepEqual(hook.snapshot(), originalInput);
  hook = ui.render(old); await turn(); hook = ui.render(old);
  assert.equal(hook.blocked, true); await assert.rejects(hook.save(), /不能覆盖/);
  const before = JSON.stringify(raw()); const repeated = await submit(record);
  assert.equal(repeated.state.attempts.length, 1); assert.equal(repeated.state.evidence.length, 2);
  assert.equal(JSON.stringify(raw()), before);
});

test('a mounted paper-return screen clears deleted answer, process and claims while preserving another question and blocking autosave', async () => {
  const { model, paper, saveReady, submit, ui } = await fixture();
  const record = await saveReady(); ui.render(); await turn(); await submit(record);
  const evidenceId = model.getSnapshot().state.evidence.find(item => item.questionId === paper.questionIds[0]).id;
  const preview = (await model.act('history.delete.preview', { evidenceIds: [evidenceId], uploadIds: [] })).result.preview;
  await model.act('history.delete.confirm', { ...preview.selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: 'delete-mounted-return' });
  let hook = ui.render(); assert.equal(hook.content.entries[0].value, ''); assert.equal(hook.content.entries[0].working, ''); assert.equal(hook.content.entries[0].claimedHelp, 'unknown');
  assert.equal(hook.content.entries[1].value, record.entries[1].value);
  await turn(); hook = ui.render(); await turn(); assert.equal(hook.snapshot().entries[0].value, '');
  const revision = model.getSnapshot().state.revision; await assert.rejects(hook.save(), /不能覆盖/);
  hook.update(paper.questionIds[0], 'value', 'late keyboard event'); assert.equal(hook.snapshot().entries[0].value, ''); assert.equal(model.getSnapshot().state.revision, revision);
});

test('unknown uncommitted submit recovers the saved draft and a same-key retry produces exactly one report', async () => {
  const { storage, model, reload, saveReady, submit, ui } = await fixture();
  const record = await saveReady(); let hook = ui.render(); storage.uncertain = 'before-commit';
  await assert.rejects(submit(record), error => error.commitState === 'unknown');
  await hook.recover(reload); hook = ui.render(); assert.equal(hook.blocked, false);
  const saved = await hook.save(); assert.equal(saved.id, record.id); assert.equal(saved.revision, record.revision);
  await submit(saved); await submit(saved);
  assert.equal(model.getSnapshot().state.attempts.length, 1);
  assert.equal(model.getSnapshot().state.paperReturns[0].status, 'submitted');
});

test('unknown save plus later typing keeps the latest field through explicit conflict recovery', async () => {
  const { storage, paper, model, reload, ui } = await fixture(); let hook = ui.render();
  let release; const gate = new Promise(resolve => { release = resolve; }); const commit = storage.commit;
  storage.commit = async (...args) => { await gate; await commit(...args); };
  storage.uncertain = 'after-commit'; hook.update(paper.questionIds[0], 'value', '10'); await turn();
  hook.update(paper.questionIds[0], 'value', '100'); hook.update(paper.questionIds[1], 'working', '后来输入的过程');
  const pending = hook.save(); release(); await assert.rejects(pending, error => error.commitState === 'unknown');
  await hook.recover(reload); hook = ui.render();
  assert.equal(hook.snapshot().entries[0].value, '100'); assert.equal(hook.snapshot().entries[1].working, '后来输入的过程');
  const conflict = hook.conflicts.find(item => item.field === 'value'); assert.ok(conflict);
  assert.equal(conflict.remote, '10'); hook.resolveConflict(conflict.key, 'local'); await hook.save();
  assert.equal(model.getSnapshot().state.paperReturns[0].entries[0].value, '100');
  assert.equal(model.getSnapshot().state.paperReturns[0].entries[1].working, '后来输入的过程');
});

for (const mode of ['before-commit', 'after-commit']) test(`unknown photo registration (${mode}) retries the same prepared file without duplication`, async () => {
  const { model, storage, photo, reload, paper, ui, make, raw } = await fixture();
  storage.uncertain = mode;
  await assert.rejects(model.act('local.upload', { ...photo, purpose: 'homework' }), error => error.commitState === 'unknown');
  await reload();
  const retry = photoRegistrationPayload(photo, model.getSnapshot().state.uploads, uri => uri);
  await model.act('local.upload', { ...retry, purpose: 'homework' });
  const hook = ui.render(); hook.setPhotos([photo.id]); await hook.save();
  const restarted = make(); await restarted.reload();
  assert.deepEqual(restarted.getSnapshot().state.uploads.map(p => [p.id, p.url]), [[photo.id, photo.uri]]);
  assert.equal(raw().events.filter(e => e.action === 'local.upload').length, 1);
  assert.deepEqual(restarted.getSnapshot().state.paperReturns.find(r => r.paperId === paper.id).uploadIds, [photo.id]);
});

test('unknown photo association can be reread and retried without a second binding or new revision', async () => {
  const { model, storage, photo, reload, ui } = await fixture();
  await model.act('local.upload', { ...photo, purpose: 'homework' }); let hook = ui.render();
  storage.uncertain = 'after-commit'; hook.setPhotos([photo.id]);
  await assert.rejects(hook.save(), error => error.commitState === 'unknown');
  await hook.recover(reload); hook = ui.render();
  const revision = model.getSnapshot().state.revision;
  const payload = photoRegistrationPayload(photo, model.getSnapshot().state.uploads, uri => uri);
  await model.act('local.upload', { ...payload, purpose: 'homework' });
  hook.setPhotos([...new Set([...hook.snapshot().uploadIds, photo.id])]); await hook.save();
  assert.equal(model.getSnapshot().state.revision, revision);
  assert.equal(model.getSnapshot().state.paperReturns.length, 1);
  assert.deepEqual(model.getSnapshot().state.paperReturns[0].uploadIds, [photo.id]);
});

test('one-shot picker result survives its first consumer leaving before native recovery resolves', async () => {
  const cache = createPendingPhotoRecovery(); let resolve, reads = 0;
  const nativeResult = new Promise(done => { resolve = done; });
  const load = () => { reads++; return nativeResult; };
  const abandoned = cache.read(load); await turn();
  // The first component is now unmounted and ignores its result; native has consumed it.
  const result = { canceled: false, assets: [{ uri: 'file:///cache/camera.jpg' }] };
  resolve(result); await abandoned;
  assert.equal(await cache.read(async () => { reads++; return null; }), result);
  assert.equal(reads, 1);
  cache.clear(); assert.equal(await cache.read(async () => null), null);
});

test('pending picker reads share one request; late null or failure cannot clear retained remaining photos', async () => {
  for (const rejects of [false, true]) {
    const cache = createPendingPhotoRecovery(); let finish;
    const old = cache.read(() => new Promise((resolve, reject) => { finish = rejects ? () => reject(new Error('old native failure')) : () => resolve(null); }));
    const alsoOld = cache.read(async () => { throw new Error('must not read native twice'); });
    assert.equal(old, alsoOld); await turn();
    const remaining = { canceled: false, assets: [{ uri: 'file:///cache/second-page.jpg' }] };
    cache.retain(remaining); finish();
    if (rejects) await assert.rejects(old, /old native failure/); else assert.equal(await old, null);
    assert.equal(await cache.read(async () => null), remaining);
  }
});

test('empty or failed picker recovery is retryable and does not hide a later native result', async () => {
  const cache = createPendingPhotoRecovery();
  assert.equal(await cache.read(async () => null), null);
  await assert.rejects(cache.read(async () => { throw new Error('native temporarily unavailable'); }));
  const recovered = { canceled: false, assets: [{ uri: 'file:///cache/recovered.jpg' }] };
  assert.equal(await cache.read(async () => recovered), recovered);
});
