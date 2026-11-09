import * as deletionDraft from '../src/features/history-deletion-draft.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as merge from '../src/components/learning/paperReturnDraft.ts';
import { LocalLearningEngine } from '../src/local/engine.ts';

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
  const storage = { fail: false, async load() { return disk; }, async commit(next, expected) { if (storage.fail) throw new Error('disk unavailable'); if ((disk?.revision ?? null) !== expected) throw new Error('CAS'); disk = next; } };
  const make = () => new LocalLearningEngine({ persistence: storage, newId: () => `return-ui-${++serial}`, now: () => '2026-10-26T08:00:00.000Z' });
  const model = make(); await model.reload(); const created = await model.act('paper.create', { count: 3 }); const paperId = created.result.id;
  const paper = model.getSnapshot().state.papers.find(p => p.id === paperId);
  const other = make(); await other.reload();
  const saveRemote = content => other.act('paper.return.save', { paperId, paperVersion: paper.version, questionIds: paper.questionIds, expectedRevision: other.getSnapshot().state.paperReturns?.[0]?.revision || 0, ...content });
  const reload = async () => { await model.reload(); return model.getSnapshot().state; };
  return { model, other, storage, paper, saveRemote, reload, make, ui: harness(model, paperId) };
}

test('paper-return UI drains later typing, preserves other fields and restores its saved draft', async () => {
  const { model, storage, paper, ui, make } = await fixture(); let hook = ui.render(); const old = model.getSnapshot().state;
  let release; const gate = new Promise(resolve => { release = resolve; }); let held = true; const commit = storage.commit;
  storage.commit = async (...args) => { if (held) { held = false; await gate; } await commit(...args); };
  hook.update(paper.questionIds[0], 'value', ' 1 '); await turn(); hook.update(paper.questionIds[0], 'value', '12'); hook.update(paper.questionIds[1], 'working', 'my process');
  release(); await hook.save(); hook = ui.render(old); await turn();
  assert.equal(hook.snapshot().entries[0].value, '12'); assert.equal(hook.snapshot().entries[1].working, 'my process');
  const restarted = make(); await restarted.reload(); assert.equal(restarted.getSnapshot().state.paperReturns[0].entries[0].value, '12');
});
test('paper-return CAS recovery incorporates untouched remote answers without overwriting local text', async () => {
  const { paper, ui, saveRemote, reload, model } = await fixture(); let hook = ui.render();
  const remote = merge.emptyReturn(paper); remote.entries[1].value = 'remote q2'; await saveRemote(remote);
  hook.update(paper.questionIds[0], 'value', 'local q1'); await assert.rejects(hook.save());
  await hook.recover(reload); hook = ui.render(); assert.equal(hook.conflicts.length, 0);
  await hook.save(); assert.deepEqual(model.getSnapshot().state.paperReturns[0].entries.map(item => item.value), ['local q1', 'remote q2', '']);
});
test('paper-return same-field and photo conflicts survive repeated reload until explicit choice', async () => {
  const paper = { questionIds: ['q'] }; const base = merge.emptyReturn(paper), local = merge.copyReturn(base), remote = merge.copyReturn(base);
  local.entries[0].value = 'local'; local.uploadIds = ['local-photo']; remote.entries[0].value = 'remote'; remote.uploadIds = ['remote-photo'];
  let result = merge.mergeReturn(base, local, remote); assert.equal(result.conflicts.length, 2);
  result = merge.mergeReturn(remote, result.content, remote, result.conflicts); assert.equal(result.conflicts.length, 2);
  let selected = merge.resolveReturn(result.content, result.conflicts[0], 'local'); selected = merge.resolveReturn(selected, result.conflicts[1], 'remote');
  assert.equal(selected.entries[0].value, 'local'); assert.deepEqual(selected.uploadIds, ['remote-photo']); assert.equal(selected.entries[0].confirmed, false);
});
test('paper-return conflict blocks save; explicit choice keeps local answer and requires fresh confirmation', async () => {
  const { paper, ui, saveRemote, reload, model } = await fixture(); let hook = ui.render();
  const remote = merge.emptyReturn(paper); remote.entries[0].value = 'remote'; remote.entries[0].confirmed = true; remote.entries[0].unitConfirmed = true; await saveRemote(remote);
  hook.update(paper.questionIds[0], 'value', 'local'); await assert.rejects(hook.save()); await hook.recover(reload); await hook.recover(reload); hook = ui.render();
  await assert.rejects(hook.save(), /版本选择/); hook.resolveConflict(hook.conflicts[0].key, 'local'); await hook.save();
  assert.equal(model.getSnapshot().state.paperReturns[0].entries[0].value, 'local'); assert.equal(model.getSnapshot().state.paperReturns[0].entries[0].confirmed, false);
});
test('editing paper answer resets both confirmations, while a failed commit retains entered text', async () => {
  const { paper, ui, storage } = await fixture(); let hook = ui.render();
  hook.update(paper.questionIds[0], 'confirmed', true); hook.update(paper.questionIds[0], 'unitConfirmed', true); await hook.save();
  storage.fail = true; hook.update(paper.questionIds[0], 'value', 'preserve me'); await assert.rejects(hook.save()); hook = ui.render();
  assert.equal(hook.snapshot().entries[0].value, 'preserve me'); assert.equal(hook.snapshot().entries[0].confirmed, false); assert.equal(hook.snapshot().entries[0].unitConfirmed, false); assert.equal(hook.dirty, true);
});
test('remote submitted online attempt blocks paper overwrite and leaves local original answer visible', async () => {
  const { other, paper, ui, reload } = await fixture(); let hook = ui.render();
  await other.act('attempt.submit', { paperId: paper.id, answers: paper.questionIds.map(questionId => ({ questionId, value: '1' })), submissionKey: paper.id });
  hook.update(paper.questionIds[0], 'value', 'uncommitted paper'); await assert.rejects(hook.save()); await hook.recover(reload); hook = ui.render();
  assert.equal(hook.blocked, true); assert.equal(hook.snapshot().entries[0].value, 'uncommitted paper'); await assert.rejects(hook.save(), /不能覆盖/);
});
