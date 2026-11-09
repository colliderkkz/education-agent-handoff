import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ui from '../src/features/history-deletion-ui.ts';
import { redactDraftAnswers, redactPracticeDraft, redactReturnContent } from '../src/features/history-deletion-draft.ts';

test('deletion selection excludes draft/demo records and deep links never expand to another paper', () => {
  const state = { attempts: [{ id: 'a1', status: 'submitted' }, { id: 'a2', status: 'draft' }, { id: 'demo-a', status: 'submitted' }], evidence: [{ id: 'e1', attemptId: 'a1', paperId: 'p1', createdAt: '2026-10-27' }, { id: 'e2', attemptId: 'a2', paperId: 'p1', createdAt: '2026-10-28' }, { id: 'demo-e', attemptId: 'demo-a', paperId: 'p2', createdAt: '2026-10-29' }] };
  assert.deepEqual(ui.initialHistorySelection(state, undefined, 'p1'), { evidenceIds: ['e1'], uploadIds: [] });
  assert.deepEqual(ui.initialHistorySelection(state, 'missing'), { evidenceIds: [], uploadIds: [] });
  assert.deepEqual(ui.initialHistorySelection(state), { evidenceIds: [], uploadIds: [] });
});
test('confirmation binds exact selection, photos, revision, digest and explicit acknowledgement', () => {
  const selection = ui.historySelection(['e2', 'e1', 'e1']);
  const preview = { sourceRevision: 4, digest: 'digest', selection };
  assert.deepEqual(ui.historyConfirmPayload(preview, ui.historySelection(['e1', 'e2']), 4, 'r1', true), { evidenceIds: ['e1', 'e2'], uploadIds: [], sourceRevision: 4, digest: 'digest', requestId: 'r1' });
  assert.throws(() => ui.historyConfirmPayload(preview, selection, 5, 'r1', true), /重新预览/);
  assert.throws(() => ui.historyConfirmPayload(preview, ui.historySelection(['e1', 'e2'], ['photo']), 4, 'r1', true), /重新预览/);
  assert.throws(() => ui.historyConfirmPayload(preview, selection, 4, 'r1', false), /确认已了解/);
});
test('only the same actor and request can recover a deletion; an unrelated receipt cannot unlock the current pending request', () => {
  const mine = { id: 'op1', actorId: 'student', requestId: 'r1' };
  const state = { actor: { id: 'student' }, historyDeletion: { operations: [{ id: 'op0', actorId: 'other', requestId: 'r2' }, mine] } };
  assert.equal(ui.findHistoryOperation(state, 'r1'), mine);
  assert.equal(ui.findHistoryOperation(state, 'r2'), undefined);
});
test('deleted draft fields clear saved text and conflicts but retain only changed local text without touching another question', () => {
  const base = [{ questionId: 'q1', value: 'saved answer', working: 'saved working' }, { questionId: 'q2', value: 'keep answer', working: 'keep working' }];
  const local = [{ ...base[0], working: 'unsaved thought' }, { ...base[1] }];
  const source = { base, local, conflicts: [{ questionId: 'q1', field: 'working', base: 'saved working', local: 'unsaved thought', remote: 'remote working' }] };
  const removed = redactPracticeDraft(source, ['q1']);
  assert.deepEqual(removed.local[0], { questionId: 'q1', value: '', working: 'unsaved thought' });
  assert.deepEqual(removed.base[0], { questionId: 'q1', value: '', working: '' });
  assert.deepEqual(removed.local[1], base[1]); assert.deepEqual(removed.conflicts, []);
  assert.deepEqual(redactPracticeDraft(removed, ['q1']), removed);
  assert.equal(base[0].value, 'saved answer'); assert.equal(source.conflicts.length, 1);
  assert.equal(redactDraftAnswers(base, base, ['q1'])[0].working, '');
});
test('paper-return deletion clears saved claims and confirmation flags, keeps only unsaved text and excludes only removed photos', () => {
  const entry = { questionId: 'q1', value: '8', working: '8×2', claimedHelp: 'independent', confirmed: true, unitConfirmed: true };
  const base = { entries: [entry], uploadIds: ['removed', 'shared'] };
  const result = redactReturnContent({ ...base, entries: [{ ...entry, value: '9' }] }, base, ['q1'], ['removed']);
  assert.deepEqual(result.uploadIds, ['shared']);
  assert.deepEqual(result.entries[0], { ...entry, value: '9', working: '', claimedHelp: 'unknown', confirmed: false, unitConfirmed: false });
  assert.deepEqual(base.uploadIds, ['removed', 'shared']); assert.equal(entry.working, '8×2');
});

// Exercise the production screen's event protocol. Domain cascade and file cleanup
// are covered by local engine tests; native accessibility/layout remain device QA.
const source = ts.transpileModule(readFileSync(new URL('../src/screens/HistoryDeletionScreen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness() {
  let state = { revision: 1, actor: { id: 'student' }, attempts: [{ id: 'a1', paperId: 'p1', status: 'submitted' }], papers: [{ id: 'p1', title: '原卷', questionIds: ['q1', 'q2'] }], evidence: [{ id: 'e1', attemptId: 'a1', paperId: 'p1', questionId: 'q1', answer: 'private answer', knowledgeId: 'division', help: 'independent', createdAt: '2026-10-27' }, { id: 'e2', attemptId: 'a1', paperId: 'p1', questionId: 'q2', answer: 'another answer', knowledgeId: 'division', help: 'hint', createdAt: '2026-10-27' }], uploads: [{ id: 'photo1', name: '原稿', url: 'file:///photo.jpg' }], historyDeletion: { operations: [], fileTasks: [] } };
  let failure, barrier, guard; const calls = [];
  const context = { get state() { return state; }, busy: false, async reload() { return state; }, async act(action, payload) {
    calls.push({ action, payload: structuredClone(payload) });
    if (barrier) await barrier;
    if (action === 'history.delete.preview') return { state, result: { preview: { sourceRevision: state.revision, digest: 'digest-' + state.revision, selection: structuredClone(payload), evidenceCount: payload.evidenceIds.length, mistakeCount: 1, proposalCount: 0, decisionCount: 0, threadCount: 0, messageCount: 0, draftCount: 0, helpRequestCount: 0, sharedHelpRequestCount: 0, assessmentCount: 0, auditEventCount: 0, rulePreviewCount: 0, reports: [], knowledge: [], reviewPlans: [], photos: [{ uploadId: 'photo1', name: '原稿', selected: payload.uploadIds.includes('photo1'), willDelete: payload.uploadIds.includes('photo1'), retainedReferenceCount: payload.uploadIds.includes('photo1') ? 0 : 1, reason: payload.uploadIds.includes('photo1') ? '所选照片没有其他保留引用' : '照片未选择，保留登记引用' }], retainedOtherThreadCount: 0, warnings: [] } } };
    if (action === 'history.delete.confirm') {
      if (failure === 'before') throw new Error('revision conflict');
      let operation = state.historyDeletion.operations.find(item => item.requestId === payload.requestId);
      if (!operation) { operation = { id: 'op1', actorId: 'student', requestId: payload.requestId, evidenceIds: payload.evidenceIds, deletedThreadIds: [], deletedHelpRequestIds: [], removedProposalIds: [], removedDecisionIds: [], redactedAssessmentIds: [], createdAt: '2026-10-27' }; state = { ...state, revision: state.revision + 1, evidence: state.evidence.filter(item => !payload.evidenceIds.includes(item.id)), historyDeletion: { ...state.historyDeletion, operations: [...state.historyDeletion.operations, operation] } }; }
      if (failure === 'after') throw new Error('response lost');
      return { state, result: { id: operation.id } };
    }
    throw new Error(action);
  } };
  const cells = []; let cursor = 0;
  const react = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; }, useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; } };
  const element = (type, props) => ({ type, props });
  const sandbox = { exports: {}, Date, Math, Set, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-native') return { Text: 'Text', Image: 'Image', View: 'View', Pressable: 'Pressable', Alert: { alert() {} } };
    if (name === 'expo-router') return { router: { canGoBack: () => true, back() {}, push() {}, replace() {} }, useLocalSearchParams: () => ({ evidenceId: 'e1' }), usePreventRemove: (active, callback) => { guard = { active, callback }; } };
    if (name.endsWith('/history-deletion-ui')) return ui;
    if (name.endsWith('/local-photo')) return { localPhotoUri: value => value };
    if (name.endsWith('/LearningContext')) return { useLearning: () => context };
    if (name.endsWith('/LearnUI')) return { errorMessage: cause => cause.message, helpNames: {}, knowledgeNames: {}, learningStyles: {}, LoadingPanel: 'LoadingPanel', Notice: 'Notice' };
    if (name.endsWith('/reviewTime')) return { fullDateTime: value => value };
    if (name.endsWith('/theme')) return { styles: {}, colors: {} };
    if (name.endsWith('/ui')) return { Badge: 'Badge', Button: 'Button', Card: 'Card' };
    return { Screen: 'Screen' };
  } };
  vm.runInNewContext(source, sandbox);
  const render = () => {
    cursor = 0; const wrapper = sandbox.exports.default(); const tree = wrapper.type(wrapper.props); const all = [];
    const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { if (typeof node.type === 'function') { visit(node.type(node.props)); return; } all.push(node); visit(node.props?.children); } }; visit(tree);
    return { all, button: label => all.find(node => node.type === 'Button' && node.props.label === label)?.props, check: label => all.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label)?.props };
  };
  return { render, calls, get state() { return state; }, get guard() { return guard; }, fail: value => { failure = value; }, gate: value => { barrier = value; }, changeRevision() { state = { ...state, revision: state.revision + 1 }; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const acknowledgement = '我已核对报告变化、关联记录与照片保留范围，了解应用内无法恢复';
async function preview(h) { h.render().button('查看删除影响').onPress(); await tick(); h.render().check(acknowledgement).onPress(); return h.render(); }

test('native selection change or newer global revision invalidates confirmation and preserves the chosen photos for a fresh preview', async () => {
  const h = harness(); await preview(h);
  h.render().check('申请同时删除本机照片：原稿').onPress(); assert.equal(h.render().button('确认删除这 1 条历史作答').disabled, true);
  h.render().button('重新核对本次删除影响').onPress(); await tick(); assert.deepEqual(h.calls.at(-1).payload.uploadIds, ['photo1']);
  h.render().check(acknowledgement).onPress(); h.changeRevision(); assert.equal(h.render().button('确认删除这 1 条历史作答').disabled, true);
  assert.equal(h.calls.filter(call => call.action === 'history.delete.confirm').length, 0);
});
test('changing photo selection hides stale retention counts and reasons until a matching preview confirms deletion', async () => {
  const h = harness(); await preview(h);
  const original = JSON.stringify(h.render().all);
  assert.match(original, /照片未选择，保留登记引用/);
  assert.doesNotMatch(original, /仍有 1 处保留引用/);
  h.render().check('申请同时删除本机照片：原稿').onPress();
  const stale = JSON.stringify(h.render().all);
  assert.match(stale, /照片选择或记录已变化，请重新预览确认处理结果/);
  assert.doesNotMatch(stale, /照片未选择，保留登记引用|仍有 1 处保留引用|本次将删除应用内照片副本/);
  h.render().button('重新核对本次删除影响').onPress(); await tick();
  const refreshed = JSON.stringify(h.render().all);
  assert.match(refreshed, /本次将删除应用内照片副本/);
  assert.doesNotMatch(refreshed, /照片未选择，保留登记引用|仍有 1 处保留引用/);
  h.changeRevision();
  assert.doesNotMatch(JSON.stringify(h.render().all), /本次将删除应用内照片副本|所选照片没有其他保留引用/);
});
test('lost deletion reply is claimed by reload; selected private body disappears and no second confirmation is sent', async () => {
  const h = harness(); const view = await preview(h); h.fail('after'); view.button('确认删除这 1 条历史作答').onPress(); await tick();
  assert.equal(h.state.historyDeletion.operations.length, 1); assert.equal(h.render().button('原样重试这次删除').disabled, false); assert.equal(h.guard.active, true);
  h.render().button('重读本机记录，保留选择').onPress(); await tick();
  const restored = h.render(); assert.equal(restored.button('原样重试这次删除'), undefined); assert.equal(h.guard.active, false);
  assert.ok(restored.button('继续管理其他历史作答')); assert.equal(JSON.stringify(restored.all).includes('private answer'), false);
  assert.equal(h.calls.filter(call => call.action === 'history.delete.confirm').length, 1);
});
test('one-frame double presses cannot create two requests; retry keeps the exact frozen payload and requestId', async () => {
  const h = harness(); const view = await preview(h); let release; h.gate(new Promise(resolve => { release = resolve; })); h.fail('after');
  view.button('确认删除这 1 条历史作答').onPress(); view.button('确认删除这 1 条历史作答').onPress(); view.check('原卷 · 第 2 题').onPress();
  assert.equal(h.calls.filter(call => call.action === 'history.delete.confirm').length, 1); release(); await tick(); h.gate(null); h.fail(null);
  h.render().button('原样重试这次删除').onPress(); await tick();
  const writes = h.calls.filter(call => call.action === 'history.delete.confirm'); assert.deepEqual(writes[0].payload, writes[1].payload); assert.deepEqual(writes[0].payload.evidenceIds, ['e1']); assert.equal(h.state.historyDeletion.operations.length, 1);
});
test('failed CAS keeps the chosen records, requires re-preview after reload and uses the latest revision', async () => {
  const h = harness(); await preview(h); h.fail('before'); h.render().button('确认删除这 1 条历史作答').onPress(); await tick(); h.changeRevision();
  h.render().button('重读本机记录，保留选择').onPress(); await tick(); assert.equal(h.render().check('原卷 · 第 1 题').accessibilityState.checked, true);
  assert.equal(h.render().button('确认删除这 1 条历史作答'), undefined); h.fail(null); await preview(h); h.render().button('确认删除这 1 条历史作答').onPress(); await tick();
  assert.equal(h.calls.at(-1).payload.sourceRevision, 2); assert.equal(h.state.historyDeletion.operations.length, 1);
});
