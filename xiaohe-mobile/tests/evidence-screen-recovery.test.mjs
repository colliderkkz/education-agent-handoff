import * as historyUI from '../src/features/history-deletion-ui.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as form from '../src/components/learning/evidenceReviewInput.ts';

// Drive the actual screen's handlers with deterministic React cells. Native layout and
// hardware back gestures are left to device QA; this test covers its persistence protocol.
const compiled = ts.transpileModule(readFileSync(new URL('../src/screens/EvidenceReviewScreen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness() {
  const evidence = { id: 'e1', answer: '9', help: 'hint', knowledgeId: 'division', attemptId: 'a1', paperId: 'p1', correct: false, createdAt: '2026-10-27T00:00:00Z' };
  let state = { revision: 1, actor: { id: 'student' }, evidence: [evidence], evidenceReviews: { proposals: [], decisions: [] } };
  const calls = []; let failure = null; let beforeCommit = null; let guard;
  const context = {
    get state() { return state; }, busy: false,
    async reload() { return state; },
    async act(action, payload) {
      calls.push({ action, payload: structuredClone(payload) });
      if (beforeCommit) await beforeCommit();
      if (failure === 'before') throw new Error('revision conflict');
      if (action === 'evidence.propose') {
        if (!state.evidenceReviews.proposals.some(item => item.requestId === payload.requestId)) {
          state = { ...state, revision: state.revision + 1, evidenceReviews: { ...state.evidenceReviews, proposals: [...state.evidenceReviews.proposals, { ...structuredClone(payload), id: 'proposal-1', requestedBy: 'student', delivery: 'local-only', createdAt: '2026-10-27T00:00:00Z' }] } };
        }
        if (failure === 'after') throw new Error('saved response lost');
        return { state, result: { id: 'proposal-1' } };
      }
      if (action === 'evidence.preview') return { state, result: { preview: { proposalId: payload.proposalId, outcome: payload.outcome, sourceRevision: state.revision, digest: 'digest-1' } } };
      if (action === 'local.evidence.confirm') {
        if (!state.evidenceReviews.decisions.some(item => item.requestId === payload.requestId)) state = { ...state, revision: state.revision + 1, evidenceReviews: { ...state.evidenceReviews, decisions: [...state.evidenceReviews.decisions, { ...structuredClone(payload), id: 'decision-1', evidenceId: 'e1', actorId: 'student', authority: 'local-unverified' }] } };
        if (failure === 'after') throw new Error('decision response lost');
        return { state, result: { id: 'decision-1' } };
      }
      throw new Error(action);
    },
  };
  const cells = []; let cursor = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useEffect() {},
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
  };
  const element = (type, props) => ({ type, props });
  const sandbox = { exports: {}, Date, Math, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-native') return { Text: 'Text', TextInput: 'TextInput', View: 'View', Alert: { alert() {} } };
    if (name === 'expo-router') return { router: { canGoBack: () => true, back() {}, push() {}, replace() {} }, useLocalSearchParams: () => ({ id: 'e1' }), usePreventRemove: (active, callback) => { guard = { active, callback }; } };
    if (name.endsWith('/LearningContext')) return { useLearning: () => context };
    if (name.endsWith('/history-deletion-ui')) return historyUI;
    if (name.endsWith('/evidenceReviewInput')) return form;
    if (name.endsWith('/evidenceView')) return { effectiveEvidence: snapshot => snapshot.evidence.map(item => ({ ...item, original: item, authority: 'original', valid: true })), evidenceAuthorityLabel: () => '原始提交', effectiveHelpLabel: () => '使用提示' };
    if (name.endsWith('/LearnUI')) return { errorMessage: error => error.message, helpNames: {}, knowledgeNames: {}, learningStyles: {}, LoadingPanel: 'LoadingPanel', Notice: 'Notice' };
    if (name.endsWith('/reviewTime')) return { fullDateTime: () => '已记录时间' };
    if (name.endsWith('/theme')) return { styles: {} };
    if (name.endsWith('/ui')) return { Badge: 'Badge', Button: 'Button', Card: 'Card' };
    const symbol = name.split('/').at(-1); return { [symbol]: symbol };
  } };
  vm.runInNewContext(compiled, sandbox);
  function render() {
    cursor = 0;
    const wrapper = sandbox.exports.default(); const tree = wrapper.type(wrapper.props);
    const all = []; const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { all.push(node); visit(node.props?.children); } }; visit(tree);
    return { tree, all, button: label => all.find(node => node.type === 'Button' && node.props.label === label)?.props, form: all.find(node => node.type === 'EvidenceReviewForm')?.props, input: label => all.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label)?.props };
  }
  return { render, calls, get state() { return state; }, get guard() { return guard; }, fail: value => { failure = value; }, gate: fn => { beforeCommit = fn; }, changeRevision: () => { state = { ...state, revision: state.revision + 1 }; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function edit(h) {
  h.render().button('填写新的更正申请').onPress(); const view = h.render();
  view.form.onChange({ ...view.form.input, changeAnswer: true, answer: '8', reason: '原稿写的是8' });
  return h.render();
}

test('lost proposal reply is claimed on authoritative reload, without creating a second proposal or losing its exact fields', async () => {
  const h = harness(); edit(h); h.fail('after');
  h.render().button('保存本人更正申请').onPress(); await tick();
  assert.equal(h.state.evidenceReviews.proposals.length, 1);
  assert.equal(h.render().form.disabled, true); assert.equal(h.guard.active, true);
  h.render().button('重读本机记录，保留当前输入').onPress(); await tick();
  const recovered = h.render(); assert.equal(recovered.form, undefined); assert.ok(recovered.button('查看采用后的影响'));
  assert.equal(h.calls.filter(item => item.action === 'evidence.propose').length, 1);
  assert.equal(h.state.evidenceReviews.proposals[0].patch.answer, '8'); assert.equal(h.guard.active, false);
});
test('CAS failure reload retains text and selection, and a fresh save uses the reloaded revision', async () => {
  const h = harness(); edit(h); h.fail('before'); h.render().button('保存本人更正申请').onPress(); await tick();
  h.changeRevision(); h.render().button('重读本机记录，保留当前输入').onPress(); await tick();
  const recovered = h.render(); assert.equal(recovered.form.input.answer, '8'); assert.equal(recovered.form.input.reason, '原稿写的是8'); assert.equal(recovered.form.input.changeAnswer, true);
  h.fail(null); recovered.button('保存本人更正申请').onPress(); await tick();
  assert.equal(h.calls.at(-1).payload.sourceRevision, 2); assert.equal(h.state.evidenceReviews.proposals.length, 1);
});
test('late native input events cannot alter the request once saving starts; exact retry reuses its request id', async () => {
  const h = harness(); const view = edit(h); let release; const barrier = new Promise(resolve => { release = resolve; });
  h.gate(() => barrier); h.fail('after'); view.button('保存本人更正申请').onPress();
  view.form.onChange({ ...view.form.input, answer: '999' }); assert.equal(h.render().form.input.answer, '8');
  release(); await tick(); h.gate(null); h.fail(null); h.render().button('原样重试本次保存').onPress(); await tick();
  assert.equal(h.calls[0].payload.requestId, h.calls[1].payload.requestId); assert.equal(h.state.evidenceReviews.proposals.length, 1);
});
test('outdated preview cannot confirm and re-preview preserves the explicitly edited decision reason', async () => {
  const h = harness(); edit(h); h.render().button('保存本人更正申请').onPress(); await tick();
  h.render().button('查看采用后的影响').onPress(); await tick();
  h.render().input('本机核对决定原因').onChangeText('另外核对了单位'); h.changeRevision();
  assert.equal(h.render().button('确认应用本机核对（未经教师复核）').disabled, true);
  h.render().button('重读本机记录，保留当前输入').onPress(); await tick();
  h.render().button('查看采用后的影响').onPress(); await tick();
  assert.equal(h.render().input('本机核对决定原因').value, '另外核对了单位');
});
test('lost confirmation reply is recovered by the decision request id and never repeats the decision', async () => {
  const h = harness(); edit(h); h.render().button('保存本人更正申请').onPress(); await tick();
  h.render().button('查看采用后的影响').onPress(); await tick(); h.fail('after');
  h.render().button('确认应用本机核对（未经教师复核）').onPress(); await tick();
  assert.equal(h.state.evidenceReviews.decisions.length, 1); assert.equal(h.render().button('原样重试本次保存').disabled, false);
  h.render().button('重读本机记录，保留当前输入').onPress(); await tick();
  assert.equal(h.render().button('原样重试本次保存'), undefined);
  assert.equal(h.render().button('确认应用本机核对（未经教师复核）'), undefined);
  assert.equal(h.calls.filter(item => item.action === 'local.evidence.confirm').length, 1);
});
