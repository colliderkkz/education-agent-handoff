import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LocalLearningEngine } from '../src/local/engine.ts';
import * as evidenceView from '../src/components/learning/evidenceView.ts';
import * as historyUI from '../src/features/history-deletion-ui.ts';

// Render the real ReportScreen with real domain projections. Only native layout,
// Router and context are replaced; score/validity/deletion selectors remain real.
const source = ts.transpileModule(readFileSync(new URL('../src/screens/ReportScreen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let serial = 0;
async function reportFixture(mode) {
  let record = null;
  const engine = new LocalLearningEngine({ persistence: { async load() { return record; }, async commit(next, expected) { assert.equal(record?.revision ?? null, expected); record = next; } }, newId: () => `report-empty-${++serial}`, now: () => '2026-10-27T08:00:00.000Z' });
  await engine.reload();
  const created = await engine.act('paper.create', { count: 2 }); const paperId = created.result.id;
  await engine.act('paper.resume', { paperId });
  const paper = engine.getSnapshot().state.papers.find(item => item.id === paperId);
  await engine.act('attempt.submit', { paperId, answers: paper.questionIds.map(questionId => ({ questionId, value: '999999', working: '原始思考' })), submissionKey: paperId });
  const ids = engine.getSnapshot().state.evidence.map(item => item.id);
  if (mode === 'deleted') {
    const { result: { preview } } = await engine.act('history.delete.preview', { evidenceIds: ids, uploadIds: [] });
    await engine.act('history.delete.confirm', { ...preview.selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: 'report-all-deleted' });
  } else if (mode === 'invalid') {
    for (const evidenceId of ids) {
      const proposal = await engine.act('evidence.propose', { evidenceId, patch: { invalidated: true }, reason: '核对后排除本次记录', uploadIds: [], sourceRevision: engine.getSnapshot().state.revision, requestId: `invalid:${evidenceId}` });
      const { result: { preview } } = await engine.act('evidence.preview', { proposalId: proposal.result.id, outcome: 'accept' });
      await engine.act('local.evidence.confirm', { proposalId: proposal.result.id, outcome: 'accept', sourceRevision: preview.sourceRevision, digest: preview.digest, reason: '本人在本机核对', requestId: `confirm:${evidenceId}` });
    }
  }
  return { state: engine.getSnapshot().state, paperId, paper };
}
function renderReport(state, paperId) {
  const element = (type, props) => ({ type, props });
  const sandbox = { exports: {}, Set, require(name) {
    if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }) };
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-native') return { Text: 'Text', Image: 'Image', View: 'View', Alert: { alert() {} } };
    if (name === 'expo-router') return { router: { canGoBack: () => true, back() {}, push() {}, replace() {}, navigate() {} }, useLocalSearchParams: () => ({ id: paperId }), usePreventRemove() {} };
    if (name.endsWith('/LearningContext')) return { useLearning: () => ({ state, reload() {}, act() {} }) };
    if (name.endsWith('/evidenceView')) return evidenceView;
    if (name.endsWith('/history-deletion-ui')) return historyUI;
    if (name.endsWith('/companionLink')) return { companionQuestionLink: () => ({ pathname: '/chat' }) };
    if (name.endsWith('/local-photo')) return { localPhotoUri: value => value };
    if (name.endsWith('/LearnUI')) return { errorMessage: error => error.message, dateLabel: value => value, helpNames: { independent: '独立作答' }, knowledgeNames: {}, learningStyles: {}, LoadingPanel: 'LoadingPanel', Notice: 'Notice', Stat: 'Stat' };
    if (name.endsWith('/theme')) return { styles: {} };
    if (name.endsWith('/ui')) return { Badge: 'Badge', Button: 'Button', Card: 'Card' };
    return { Screen: 'Screen' };
  } };
  vm.runInNewContext(source, sandbox);
  const nodes = [], words = [];
  const visit = node => {
    if (typeof node === 'string' || typeof node === 'number') words.push(String(node));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') { nodes.push(node); if (node.type === 'Notice') words.push(node.props.text); if (node.type === 'Stat') words.push(String(node.props.value), node.props.label); visit(node.props?.children); }
  };
  visit(sandbox.exports.default());
  return { text: words.join(''), stats: nodes.filter(node => node.type === 'Stat'), nodes };
}

test('fully deleted submitted report shows a deletion state, no score or performance categories, and retains teaching questions and placeholders', async () => {
  const { state, paperId, paper } = await reportFixture('deleted');
  const result = renderReport(state, paperId);
  assert.match(result.text, /作答已全部删除/); assert.match(result.text, /当前无可统计作答/);
  assert.equal(result.stats.length, 0);
  assert.doesNotMatch(result.text, /0\s*\/\s*0|看见哪里还不清楚|把这次思路记下来|每次认真思考/);
  assert.doesNotMatch(result.text, /999999|原始思考/);
  for (const question of paper.questions) assert.ok(result.text.includes(question.text));
  assert.equal((result.text.match(/个人作答与过程已删除/g) || []).length, 2);
  assert.equal(state.attempts[0].status, 'submitted');
});
test('all-invalid retained report has no zero-denominator score and explains invalidation while keeping the original records', async () => {
  const { state, paperId, paper } = await reportFixture('invalid');
  const result = renderReport(state, paperId);
  assert.match(result.text, /暂无有效统计/); assert.match(result.text, /2 条已标记无效，不计入当前分母/);
  assert.equal(result.stats.length, 0);
  assert.doesNotMatch(result.text, /0\s*\/\s*0|看见哪里还不清楚|把这次思路记下来|作答已全部删除/);
  assert.match(result.text, /原始提交结果仍保留/); assert.match(result.text, /999999/);
  for (const question of paper.questions) assert.ok(result.text.includes(question.text));
});
test('a retained report with valid wrong answers continues to show its real denominator and result categories', async () => {
  const { state, paperId } = await reportFixture('retained');
  const result = renderReport(state, paperId);
  assert.equal(result.stats.length, 5); assert.equal(result.stats[0].props.value, '0 / 2');
  assert.match(result.text, /看见哪里还不清楚/); assert.doesNotMatch(result.text, /当前无可统计作答|暂无有效统计/);
});
