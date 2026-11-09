import * as deletionDraft from '../src/features/history-deletion-draft.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as merge from '../src/components/learning/draftMerge.ts';
import { LocalLearningEngine } from '../src/local/engine.ts';

const initial = () => [{ questionId: 'q1', value: '', working: '' }, { questionId: 'q2', value: '', working: '' }];
test('three-way recovery preserves local changed fields and incorporates untouched remote fields', () => {
  let state = merge.createDraft(initial());
  state = merge.updateDraft(state, 'q1', 'value', 'mine');
  const remote = initial(); remote[1].value = 'new remote'; remote[0].working = 'remote working';
  state = merge.reconcileDraft(state, remote);
  assert.deepEqual(state.local.map(a => [a.value, a.working]), [['mine', 'remote working'], ['new remote', '']]);
  assert.equal(state.conflicts.length, 0); assert.ok(merge.hasDraftChanges(state));
});
test('divergent same-field edits require an explicit choice; repeated reload does not erase conflict', () => {
  let state = merge.updateDraft(merge.createDraft(initial()), 'q1', 'value', 'mine');
  const remote = initial(); remote[0].value = 'saved elsewhere';
  state = merge.reconcileDraft(state, remote);
  assert.equal(state.conflicts.length, 1);
  state = merge.reconcileDraft(state, remote);
  assert.equal(state.conflicts.length, 1);
  const localChoice = merge.chooseDraftConflict(state, 'q1', 'value', 'local');
  assert.equal(localChoice.local[0].value, 'mine'); assert.equal(localChoice.conflicts.length, 0); assert.ok(merge.hasDraftChanges(localChoice));
  const remoteChoice = merge.chooseDraftConflict(state, 'q1', 'value', 'remote');
  assert.equal(remoteChoice.local[0].value, 'saved elsewhere'); assert.equal(remoteChoice.conflicts.length, 0); assert.equal(merge.hasDraftChanges(remoteChoice), false);
});
test('same resulting edits converge and changing a conflicted field to remote clears that conflict', () => {
  let state = merge.updateDraft(merge.createDraft(initial()), 'q1', 'working', 'same');
  const remote = initial(); remote[0].working = 'same';
  state = merge.reconcileDraft(state, remote); assert.equal(state.conflicts.length, 0); assert.equal(merge.hasDraftChanges(state), false);
  state = merge.updateDraft(state, 'q1', 'working', 'local again'); remote[0].working = 'remote again';
  state = merge.reconcileDraft(state, remote); assert.equal(state.conflicts.length, 1);
  state = merge.updateDraft(state, 'q1', 'working', 'remote again'); assert.equal(state.conflicts.length, 0);
});
test('old save echo normalizes only the sent snapshot and never overwrites later typing', () => {
  let state = merge.updateDraft(merge.createDraft(initial()), 'q1', 'value', ' 1 ');
  const sent = merge.copyAnswers(state.local);
  state = merge.updateDraft(state, 'q1', 'value', '12');
  state = merge.updateDraft(state, 'q2', 'working', 'new process');
  const remote = initial(); remote[0].value = '1';
  state = merge.acceptSavedDraft(state, sent, remote);
  assert.equal(state.base[0].value, '1'); assert.equal(state.local[0].value, '12'); assert.equal(state.local[1].working, 'new process');
});
test('mismatched reload never replaces the existing draft', () => {
  const state = merge.updateDraft(merge.createDraft(initial()), 'q1', 'value', 'keep me');
  assert.throws(() => merge.reconcileDraft(state, [initial()[0]]), /已保留/);
  assert.equal(state.local[0].value, 'keep me');
});

// Runs the production hook body with deterministic hook cells/effects and real domain persistence.
// This tests save/reload ordering, not native rendering or TextInput event delivery.
const hookSource = ts.transpileModule(readFileSync(new URL('../src/components/learning/usePracticeDraft.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function hookHarness(model, paperId) {
  const cells = []; let cursor = 0, effects = [];
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in cells)) cells[i] = value; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in cells)) cells[i] = { current: value }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) cells[i] = { fn, deps }; return cells[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const sandbox = { exports: {}, require(name) { if (name === '../../features/history-deletion-draft') return deletionDraft; if (name === 'react') return hooks; if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } }; if (name === './LearnUI') return { errorMessage: e => e.message }; if (name === './draftMerge') return merge; throw new Error(name); } };
  vm.runInNewContext(hookSource, sandbox);
  return {
    render(state = model.getSnapshot().state) {
      const attempt = state.attempts.find(a => a.paperId === paperId);
      cursor = 0; effects = [];
      const hook = sandbox.exports.usePracticeDraft(paperId, attempt.answers, model.act, { revision: state.revision, status: attempt.status, deletedQuestionIds: (state.historyDeletion?.evidence || []).filter(item => item.attemptId === attempt.id).map(item => item.questionId) });
      for (const effect of effects) effect();
      return hook;
    },
  };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
let serial = 0;
async function fixture() {
  let record = null;
  const storage = {
    failRead: false, failWrite: false,
    async load() { if (storage.failRead) throw new Error('read failed'); return record; },
    async commit(next, expected) { if (storage.failWrite) throw new Error('write failed'); if ((record?.revision ?? null) !== expected) throw new Error('CAS conflict'); record = next; },
  };
  const make = () => new LocalLearningEngine({ persistence: storage, newId: () => `draft-${++serial}`, now: () => '2026-10-26T05:00:00.000Z' });
  const model = make(); await model.reload(); const created = await model.act('paper.create', { count: 2 }); const paperId = created.result.id;
  await model.act('paper.resume', { paperId });
  const other = make(); await other.reload();
  const harness = hookHarness(model, paperId);
  const ids = model.getSnapshot().state.papers[0].questionIds;
  const reload = async () => { await model.reload(); return model.getSnapshot().state; };
  return { model, other, storage, harness, paperId, ids, reload };
}

test('regression: CAS failure + reload + retry preserves another session’s saved second answer', async () => {
  const { other, model, harness, paperId, ids, reload } = await fixture();
  let hook = harness.render();
  await other.act('attempt.save', { paperId, answers: [{ questionId: ids[1], value: 'remote second' }] });
  hook.update(ids[0], 'value', 'local first'); await assert.rejects(hook.save());
  await hook.recover(reload); hook = harness.render();
  assert.deepEqual(hook.snapshot().map(a => a.value), ['local first', 'remote second']);
  await hook.save();
  assert.deepEqual(model.getSnapshot().state.attempts[0].answers.map(a => a.value), ['local first', 'remote second']);
});

test('hook blocks unresolved conflicts, preserves choices across repeated reload, and saves only after choice', async () => {
  const { other, model, harness, paperId, ids, reload } = await fixture();
  let hook = harness.render();
  await other.act('attempt.save', { paperId, answers: [{ questionId: ids[0], value: 'remote' }] });
  hook.update(ids[0], 'value', 'local'); await assert.rejects(hook.save());
  await hook.recover(reload); await hook.recover(reload); hook = harness.render();
  assert.equal(hook.conflicts.length, 1); await assert.rejects(hook.save(), /逐项选择/);
  assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, 'remote');
  hook.resolveConflict(ids[0], 'value', 'local'); await hook.save();
  assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, 'local');
});

test('hook recovers unknown storage outcome without clearing unsaved input', async () => {
  const { storage, model, harness, ids, reload } = await fixture(); let hook = harness.render();
  storage.failWrite = true; storage.failRead = true;
  hook.update(ids[0], 'value', 'my input'); await assert.rejects(hook.save());
  storage.failWrite = false; storage.failRead = false;
  await assert.rejects(hook.save(), /重试读取/);
  await hook.recover(reload); hook = harness.render(); assert.equal(hook.snapshot()[0].value, 'my input');
  await hook.save(); assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, 'my input');
});

test('in-flight save followed by more typing drains latest input and stale props cannot roll it back', async () => {
  const { model, storage, harness, ids } = await fixture(); let hook = harness.render(); const old = model.getSnapshot().state;
  let release; const barrier = new Promise(resolve => { release = resolve; }); const commit = storage.commit.bind(storage); let gated = true;
  storage.commit = async (...args) => { if (gated) { gated = false; await barrier; } await commit(...args); };
  hook.update(ids[0], 'value', '1'); await turn();
  hook.update(ids[0], 'value', '12'); hook.update(ids[1], 'working', 'later thinking');
  release(); await hook.save();
  hook = harness.render(old); await turn(); hook = harness.render(old);
  assert.equal(hook.snapshot()[0].value, '12'); assert.equal(hook.snapshot()[1].working, 'later thinking');
  assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, '12');
});

test('remote submitted attempt keeps local unsaved text visible and refuses overwrite', async () => {
  const { other, model, harness, paperId, ids, reload } = await fixture(); let hook = harness.render();
  await other.act('attempt.submit', { paperId, answers: ids.map(questionId => ({ questionId, value: '1' })), submissionKey: paperId });
  hook.update(ids[0], 'value', 'my uncommitted text'); await assert.rejects(hook.save());
  const result = await hook.recover(reload); assert.equal(result.submitted, true); hook = harness.render();
  assert.equal(hook.remoteSubmitted, true); assert.equal(hook.snapshot()[0].value, 'my uncommitted text');
  await assert.rejects(hook.save(), /不能覆盖/);
  assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, '1');
});

test('recovery waits for an existing commit and does not start an additional write during reload', async () => {
  const { model, storage, harness, ids, reload } = await fixture(); const hook = harness.render();
  let release; const barrier = new Promise(resolve => { release = resolve; }); const commit = storage.commit.bind(storage); let writes = 0;
  storage.commit = async (...args) => { writes++; await barrier; await commit(...args); };
  hook.update(ids[0], 'value', 'first'); await turn(); hook.update(ids[0], 'value', 'later');
  const recovering = hook.recover(reload); await assert.rejects(hook.save(), /正在重读/);
  release(); await recovering;
  assert.equal(writes, 1); assert.equal(hook.snapshot()[0].value, 'later');
  await hook.save(); assert.equal(model.getSnapshot().state.attempts[0].answers[0].value, 'later');
});

test('a mounted practice draft clears deleted saved fields immediately, retains only unsaved text and cannot write them back', async () => {
  const { model, storage, harness, ids, paperId } = await fixture();
  await model.act('attempt.save', { paperId, answers: ids.map((questionId, i) => ({ questionId, value: `saved ${i}`, working: `process ${i}` })) });
  let hook = harness.render(); await turn(); storage.failWrite = true;
  hook.update(ids[0], 'working', 'my unsaved thought'); await assert.rejects(hook.save());
  storage.failWrite = false; await model.reload();
  await model.act('attempt.submit', { paperId, answers: model.getSnapshot().state.attempts[0].answers, submissionKey: paperId });
  const evidenceId = model.getSnapshot().state.evidence.find(item => item.questionId === ids[0]).id;
  const preview = (await model.act('history.delete.preview', { evidenceIds: [evidenceId], uploadIds: [] })).result.preview;
  await model.act('history.delete.confirm', { ...preview.selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: 'delete-mounted-practice' });
  hook = harness.render();
  assert.equal(hook.answers[0].value, ''); assert.equal(hook.answers[0].working, 'my unsaved thought'); assert.equal(hook.answers[1].value, 'saved 1');
  await turn(); hook = harness.render(); await turn();
  assert.equal(hook.snapshot()[0].value, ''); assert.equal(hook.snapshot()[0].working, 'my unsaved thought');
  const revision = model.getSnapshot().state.revision; await assert.rejects(hook.save(), /不能覆盖/);
  hook.update(ids[0], 'value', 'late native event'); assert.equal(hook.snapshot()[0].value, ''); assert.equal(model.getSnapshot().state.revision, revision);
});
