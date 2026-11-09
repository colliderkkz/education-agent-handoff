import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { LocalLearningEngine } from '../src/local/engine.ts';
import * as review from '../src/features/recognition-review.ts';

// Execute the real screen and handlers against the real local engine. Only native
// layout, image decoding, Router and React scheduling are replaced by a VM harness.
const compiled = ts.transpileModule(readFileSync(new URL('../src/screens/PhotoRecognitionScreen.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const uploadId = 'a5125a31-9a39-405d-b9d8-cc1830fdca49';
let sequence = 0;
const nextId = () => `screen-ocr-${++sequence}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ submitted = false } = {}) {
  let record = null;
  const engine = new LocalLearningEngine({
    persistence: {
      async load() { return record == null ? null : structuredClone(record); },
      async commit(next, expected) { assert.equal(record?.revision ?? null, expected); record = structuredClone(next); },
    },
    newId: nextId, now: () => '2026-10-27T08:00:00.000Z',
    recognizePhoto: async () => ({
      engine: 'mlkit-chinese', engineVersion: '16.0.1', imageDigest: 'c'.repeat(64), width: 1000, height: 1200,
      lines: [{ id: 'line-1', text: '一盒彩笔有 24 支。288 支彩笔可以装满多少盒？', confidence: null, box: { x: .1, y: .1, width: .8, height: .1 } }],
    }),
  });
  await engine.reload();
  await engine.act('local.upload', { id: uploadId, uri: `file:///app/Documents/xiaohe-images/${uploadId}.png`, name: '核对照片.png', purpose: 'single' });
  await engine.act('local.recognition.scan', { uploadId, requestId: nextId() });
  let state = engine.getSnapshot().state;
  const capture = state.recognition.captures[0], run = state.recognition.runs[0];
  const candidate = (await engine.act('recognition.match', { captureId: capture.id, text: run.lines[0].text })).result.candidates.find(item => item.questionId === 'seed-division-2');
  assert.ok(candidate);
  const fields = { captureId: capture.id, entryId: nextId(), runId: run.id, sourceLineIds: ['line-1'], originalNumber: '2', stem: run.lines[0].text, answer: '13', working: '原稿过程', candidate: review.candidatePin(candidate), checked: { stem: true, answer: true, match: true, unit: true } };
  await engine.act('recognition.entry.save', { ...fields, expectedRevision: capture.revision, requestId: nextId() });
  state = engine.getSnapshot().state;
  await engine.act('recognition.entry.save', { ...fields, expectedRevision: state.recognition.captures[0].revision, requestId: nextId() });
  if (submitted) await engine.act('recognition.submit', { captureId: capture.id, expectedRevision: engine.getSnapshot().state.recognition.captures[0].revision, entryIds: [fields.entryId], requestId: nextId() });
  return { engine, entryId: fields.entryId };
}

function harness(engine, { platform = 'android', canGoBack = true } = {}) {
  let failure = null, beforeAct = null, guard;
  const calls = [], navigations = [], cells = [], alerts = [], subscriptions = new Set();
  let focused = true, keyboardVisible = false, dismissCount = 0, defaultBackCount = 0;
  let cursor = 0, effects = [], changed = false;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], update => { const next = typeof update === 'function' ? update(cells[i]) : update; if (!Object.is(next, cells[i])) changed = true; cells[i] = next; }];
    },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!(i in cells) || !deps || deps.some((value, index) => !Object.is(value, cells[i].deps?.[index]))) {
        const prior = cells[i]; cells[i] = { deps }; effects.push(() => { prior?.cleanup?.(); cells[i].cleanup = effect(); });
      }
    },
    useMemo(fn, deps) { const i = cursor++; if (!(i in cells) || !deps || deps.some((value, index) => !Object.is(value, cells[i].deps?.[index]))) cells[i] = { deps, value: fn() }; return cells[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
  };
  const context = {
    get state() { return engine.getSnapshot().state; },
    get busy() { return engine.getSnapshot().busy; },
    get error() { return engine.getSnapshot().error; },
    async reload() { await engine.reload(); return engine.getSnapshot().state; },
    async act(action, payload) {
      calls.push({ action, payload: structuredClone(payload) });
      if (beforeAct) await beforeAct();
      if (failure === 'before') throw new Error('write not committed');
      const result = await engine.act(action, payload);
      if (failure === 'after') throw new Error('committed response lost');
      return result;
    },
  };
  const element = (type, props) => ({ type, props });
  const sandbox = { exports: {}, Date, Math, Set, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
    if (name === 'react-native') return { Text: 'Text', TextInput: 'TextInput', View: 'View', Image: 'Image', Pressable: 'Pressable',
      Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: value => value, absoluteFill: {} }, Platform: { OS: platform },
      Keyboard: { isVisible: () => keyboardVisible, dismiss() { keyboardVisible = false; dismissCount++; } },
      BackHandler: { addEventListener(event, callback) { assert.equal(event, 'hardwareBackPress'); subscriptions.add(callback); return { remove: () => subscriptions.delete(callback) }; } },
    };
    if (name === 'expo-router') return { router: { canGoBack: () => canGoBack, back: () => navigations.push('back'), push: value => navigations.push(value), replace: value => navigations.push(value) }, useLocalSearchParams: () => ({ uploadId }), usePreventRemove: (active, callback) => { guard = { active, callback }; }, useFocusEffect: effect => react.useEffect(() => focused ? effect() : undefined, [focused, effect]) };
    if (name.endsWith('/LearningContext')) return { useLearning: () => context };
    if (name.endsWith('/recognition-review')) return review;
    if (name.endsWith('/local-photo')) return { localPhotoUri: value => value };
    if (name.endsWith('/native-ocr')) return { getOcrAvailability: async () => ({ available: true, engine: 'mlkit-chinese', engineVersion: '16.0.1' }) };
    if (name.endsWith('/LearnUI')) return { errorMessage: error => error.message, LoadingPanel: 'LoadingPanel', Notice: 'Notice' };
    if (name.endsWith('/theme')) return { styles: {}, colors: {} };
    if (name.endsWith('/ui')) return { Badge: 'Badge', Button: 'Button', Card: 'Card' };
    if (name.endsWith('/Screen')) return { Screen: 'Screen' };
    throw new Error(`Unmocked screen dependency: ${name}`);
  } };
  vm.runInNewContext(compiled, sandbox);
  function render() {
    let tree;
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0; changed = false; effects = [];
      const wrapper = sandbox.exports.default(); tree = typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper;
      effects.forEach(effect => effect());
      if (!changed) break;
      assert.notEqual(pass, 9, 'component effects failed to settle');
    }
    const all = [], words = [];
    function visit(node) {
      if (typeof node === 'string' || typeof node === 'number') { words.push(String(node)); return; }
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node && typeof node === 'object') {
        all.push(node);
        if (node.type === 'Notice') words.push(node.props.text);
        if (node.props?.label) words.push(node.props.label);
        visit(node.props?.children);
      }
    }
    visit(tree);
    const named = (name, label) => all.find(node => node.type?.name === name && node.props.label === label)?.props;
    return {
      text: words.join('\n'), all,
      button: label => all.find(node => node.type === 'Button' && node.props.label === label)?.props,
      field: label => named('Field', label), check: label => named('Check', label),
      image: all.find(node => node.type?.name === 'SourceImage')?.props,
    };
  }
  return {
    render, calls, navigations, alerts,
    get guard() { return guard; }, fail: value => { failure = value; }, gate: value => { beforeAct = value; },
    focus(value) { focused = value; render(); }, keyboard(value) { keyboardVisible = value; },
    back() { const handled = [...subscriptions].reverse().some(callback => callback() === true); if (!handled) defaultBackCount++; return handled; },
    get backSubscriptions() { return subscriptions.size; }, get dismissCount() { return dismissCount; }, get defaultBackCount() { return defaultBackCount; },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); },
  };
}

async function openEditor(h) {
  h.render(); await tick(); h.render().button('继续核对第 2 题').onPress();
  const view = h.render(); view.image.onReady(true);
  return h.render();
}

test('a lost entry-save reply is claimed by request id without another write or lost input', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.fail('after');
  h.render().button('保存核对草稿').onPress(); await tick();
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '14');
  assert.equal(h.render().field('纸上原始答案').value, '14'); assert.equal(h.guard.active, true);
  h.render().button('重读并核对保存结果').onPress(); await tick();
  assert.equal(h.render().field('纸上原始答案').value, '14'); assert.equal(h.guard.active, false);
  assert.equal(h.render().button('原样重试本次操作'), undefined);
  assert.equal(h.calls.filter(call => call.action === 'recognition.entry.save').length, 1);
});

test('late IME change after save starts cannot be overwritten by the save receipt', async () => {
  const { engine } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); const view = h.render();
  let release; const wait = new Promise(resolve => { release = resolve; }); h.gate(() => wait);
  view.button('保存核对草稿').onPress(); view.field('纸上原始答案').onChange('999');
  const during = h.render().field('纸上原始答案').value;
  release(); await tick();
  assert.equal(during, '14', 'saving must synchronously lock stale native change handlers');
  assert.equal(h.render().field('纸上原始答案').value, '14');
});

test('scanning again with a clean open editor rebases its unchanged saved body before the next edit', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  assert.equal(h.render().button('重新识别这张图').disabled, false);
  h.render().button('重新识别这张图').onPress(); await tick();
  h.render().field('纸上原始答案').onChange('14');
  h.render().button('保存核对草稿').onPress(); await tick();
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '14');
  assert.equal(h.render().button('原样重试本次操作'), undefined, 'an unchanged draft should not get stuck on its own scan revision');
});

test('trusted deletion of the photo releases a pending-operation leave guard and never restores the old editor', async () => {
  const { engine } = await fixture({ submitted: true }); const h = harness(engine);
  h.render(); await tick(); h.fail('before');
  h.render().button('重新识别这张图').onPress(); await tick();
  h.render(); assert.equal(h.guard.active, true);
  const state = engine.getSnapshot().state;
  const preview = (await engine.act('history.delete.preview', { evidenceIds: [state.evidence[0].id], uploadIds: [uploadId] })).result.preview;
  await engine.act('history.delete.confirm', { ...preview.selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: nextId() });
  const after = h.render();
  assert.match(after.text, /已删除|无法找到/); assert.equal(after.field('纸上原始答案'), undefined);
  assert.equal(h.guard.active, false, 'the removed-photo branch has no recovery controls, so pending must not trap the page');
  assert.equal(h.back(), false);
  assert.equal(h.calls.length, 1);
});

test('editing original answers clears checks and a separate confirmed save is required before submission', async () => {
  const { engine } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14');
  assert.equal(h.render().check('题干、条件和数字已核对'), undefined);
  h.render().button('保存核对草稿').onPress(); await tick();
  for (const label of ['题干、条件和数字已核对', '这是纸上原本写的答案', '候选与原图是同一道题', '题目和答案单位已核对']) {
    const check = h.render().check(label); assert.equal(check.checked, false); assert.equal(check.disabled, false); check.onPress();
  }
  assert.equal(engine.getSnapshot().state.evidence.length, 0);
  h.render().button('保存核对状态').onPress(); await tick();
  const entry = engine.getSnapshot().state.recognition.entries[0]; assert.equal(review.recognitionReady(entry), true);
  h.render().check(`原题 2 · ${entry.stem}`).onPress();
  assert.equal(h.render().button('确认将 1 道核对题入档').disabled, true);
  h.render().check('已再次核对所选原始答案；纸面帮助情况尚未核实').onPress();
  assert.equal(h.render().button('确认将 1 道核对题入档').disabled, false);
  h.render().button('确认将 1 道核对题入档').onPress(); await tick();
  assert.equal(engine.getSnapshot().state.evidence.length, 1);
  assert.equal(engine.getSnapshot().state.evidence[0].help, 'unknown');
  assert.equal(engine.getSnapshot().state.evidence[0].eligible, false);
  assert.ok(h.render().button('打开刚才的作业报告'));
});

test('CAS recovery preserves local input and rebases only when the stored editor baseline is unchanged', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14');
  await engine.act('local.recognition.scan', { uploadId, requestId: nextId() });
  h.render().button('保存核对草稿').onPress(); await tick();
  assert.ok(h.render().button('原样重试本次操作'));
  h.render().button('重读并核对保存结果').onPress(); await tick();
  const recovered = h.render(); assert.equal(recovered.field('纸上原始答案').value, '14');
  assert.equal(recovered.button('原样重试本次操作'), undefined);
  recovered.button('保存核对草稿').onPress(); await tick();
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '14');
});

test('CAS recovery does not overwrite a remotely changed answer or discard the current unsaved answer', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14');
  const state = engine.getSnapshot().state, stored = state.recognition.entries.find(item => item.id === entryId);
  const { id, ...body } = review.recognitionEditor(stored); assert.equal(id, entryId);
  await engine.act('recognition.entry.save', { ...body, entryId, captureId: stored.captureId, expectedRevision: state.recognition.captures[0].revision, answer: '17', requestId: nextId() });
  h.render().button('保存核对草稿').onPress(); await tick();
  h.render().button('重读并核对保存结果').onPress(); await tick();
  assert.equal(h.render().field('纸上原始答案').value, '14');
  assert.ok(h.render().button('原样重试本次操作'));
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '17');
});

test('an exact retry uses the original request id and cannot create a second saved entry', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.fail('before');
  h.render().button('保存核对草稿').onPress(); await tick();
  h.fail(null); h.render().button('原样重试本次操作').onPress(); await tick();
  const saves = h.calls.filter(call => call.action === 'recognition.entry.save');
  assert.equal(saves.length, 2); assert.deepEqual(saves[0].payload, saves[1].payload);
  assert.equal(engine.getSnapshot().state.recognition.entries.length, 1);
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '14');
});

test('an externally submitted entry cannot trap unsaved local input behind a hidden editor', async () => {
  const { engine, entryId } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14');
  const capture = engine.getSnapshot().state.recognition.captures[0];
  await engine.act('recognition.submit', { captureId: capture.id, expectedRevision: capture.revision, entryIds: [entryId], requestId: nextId() });
  const view = h.render();
  assert.equal(h.guard.active, true, 'unsaved input must not be silently dropped');
  const discard = view.button('放弃本页未保存修改并查看已提交记录');
  assert.ok(discard, 'the terminal entry needs an explicit discard route outside the hidden editable card');
  assert.equal(discard.disabled, false); discard.onPress(); h.render();
  assert.equal(h.guard.active, false);
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).answer, '13');
  assert.equal(engine.getSnapshot().state.recognition.entries.find(item => item.id === entryId).status, 'submitted');
});

test('focused Android cold-link root catches unsaved hardware Back, then releases it after a successful save', async () => {
  const { engine } = await fixture(); const h = harness(engine, { canGoBack: false }); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.render();
  assert.equal(h.backSubscriptions, 1); assert.equal(h.back(), true); assert.equal(h.defaultBackCount, 0);
  assert.equal(h.alerts.length, 1); assert.match(h.alerts[0][1], /还没有保存/);
  assert.equal(h.render().field('纸上原始答案').value, '14'); assert.equal(h.navigations.length, 0);
  h.render().button('保存核对草稿').onPress(); await tick(); h.render();
  assert.equal(h.back(), false); assert.equal(h.defaultBackCount, 1); assert.equal(h.alerts.length, 1);
});

test('hardware Back only dismisses a visible keyboard before asking about unsaved work', async () => {
  const { engine } = await fixture(); const h = harness(engine, { canGoBack: false }); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.render(); h.keyboard(true);
  assert.equal(h.back(), true); assert.equal(h.dismissCount, 1); assert.equal(h.alerts.length, 0);
  assert.equal(h.render().field('纸上原始答案').value, '14'); assert.equal(h.defaultBackCount, 0);
  assert.equal(h.back(), true); assert.equal(h.alerts.length, 1); assert.match(h.alerts[0][1], /还没有保存/);
});

test('hardware Back covers the synchronous operation lock and the later uncertain-save state', async () => {
  const { engine } = await fixture(); const h = harness(engine, { canGoBack: false }); await openEditor(h);
  let release; const wait = new Promise(resolve => { release = resolve; }); h.gate(() => wait);
  h.render().button('重新识别这张图').onPress();
  assert.equal(h.back(), true, 'the same-tick back press must see the operation ref before React rerenders');
  assert.match(h.alerts.at(-1)[1], /进行/);
  release(); await tick(); h.gate(null); h.render();
  assert.equal(h.back(), false);
  h.fail('before'); h.render().button('重新识别这张图').onPress(); await tick(); h.render();
  assert.equal(h.back(), true); assert.match(h.alerts.at(-1)[1], /尚未确认/);
});

test('hardware Back subscriptions leave with focus, do not leak on rerender, and are removed on unmount', async () => {
  const { engine } = await fixture(); const h = harness(engine); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.render();
  assert.equal(h.backSubscriptions, 1); h.focus(false); assert.equal(h.backSubscriptions, 0);
  assert.equal(h.back(), false); assert.equal(h.alerts.length, 0);
  h.focus(true); assert.equal(h.backSubscriptions, 1); h.render(); h.render(); assert.equal(h.backSubscriptions, 1);
  assert.equal(h.back(), true); h.unmount(); assert.equal(h.backSubscriptions, 0);
});

test('redacted recognition with a retained photo releases Android Back despite an old pending request', async () => {
  const { engine } = await fixture({ submitted: true }); const h = harness(engine, { canGoBack: false });
  h.render(); await tick(); h.fail('before'); h.render().button('重新识别这张图').onPress(); await tick(); h.render();
  assert.equal(h.back(), true);
  const preview = (await engine.act('history.delete.preview', { evidenceIds: [engine.getSnapshot().state.evidence[0].id], uploadIds: [] })).result.preview;
  await engine.act('history.delete.confirm', { ...preview.selection, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: nextId() });
  const view = h.render(); assert.equal(engine.getSnapshot().state.uploads.length, 1);
  assert.match(view.text, /不能重新扫描恢复旧文字/); assert.equal(h.guard.active, false); assert.equal(h.back(), false);
});

test('iOS keeps the navigator leave guard without installing an Android hardware listener', async () => {
  const { engine } = await fixture(); const h = harness(engine, { platform: 'ios' }); await openEditor(h);
  h.render().field('纸上原始答案').onChange('14'); h.render();
  assert.equal(h.guard.active, true); assert.equal(h.backSubscriptions, 0);
});
