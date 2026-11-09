import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as merge from '../src/components/learning/chatDraft.ts';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';

const saved = (text = '', intent = 'note', revision = 0) => ({ text, intent, revision, updatedAt: '2026-10-27T02:00:00.000Z' });
test('chat recovery merges independent text/intent edits and retains unresolved conflicts across repeated reloads', () => {
  let draft = merge.createChatDraft(saved()); draft.local.text = '我的思路';
  draft = merge.reconcileChatDraft(draft, saved('', 'hint', 1));
  assert.deepEqual(draft.local, { text: '我的思路', intent: 'hint' }); assert.equal(draft.conflicts.length, 0);
  draft = merge.reconcileChatDraft(draft, saved('另一个窗口', 'hint', 2));
  draft = merge.reconcileChatDraft(draft, saved('另一个窗口', 'hint', 2));
  assert.equal(draft.conflicts.length, 1); assert.equal(draft.local.text, '我的思路');
  const resolved = merge.chooseChatConflict(draft, 'text', 'remote');
  assert.equal(resolved.local.text, '另一个窗口'); assert.equal(resolved.conflicts.length, 0);
});
test('old save completion cannot replace newer text or explicit help choice', () => {
  const draft = merge.createChatDraft(saved()); draft.local = { text: '后来的输入', intent: 'alternative' };
  const result = merge.acceptChatSave(draft, { text: '早先输入', intent: 'note' }, saved('早先输入', 'note', 1));
  assert.deepEqual(result.local, draft.local); assert.equal(result.base.revision, 1);
  assert.equal(merge.reconcileChatDraft(result, saved('更旧', 'hint', 0)), result);
});
test('observed deletion removes saved text and selection, keeping only genuinely unsaved fields', () => {
  const clean = merge.createChatDraft(saved('已保存的私人文字', 'hint', 3));
  const removed = merge.removeDeletedChatDraft(clean);
  assert.deepEqual(removed.local, { text: '', intent: 'note' });
  const dirty = merge.createChatDraft(saved('已保存的私人文字', 'hint', 3));
  dirty.local.text = '本页尚未保存的新文字';
  const kept = merge.removeDeletedChatDraft(dirty);
  assert.deepEqual(kept.local, { text: '本页尚未保存的新文字', intent: 'note' });
  assert.deepEqual(merge.removeDeletedChatDraft(kept), kept);
});

// Execute the production hook with deterministic React cells and real local persistence.
// This verifies commit ordering and recovery, not native TextInput or navigation rendering.
const source = ts.transpileModule(readFileSync(new URL('../src/components/learning/useChatDraft.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(model, initialThread, act = model.act) {
  const cells = []; let cursor = 0; let effects = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], next => { cells[i] = typeof next === 'function' ? next(cells[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) cells[i] = { fn, deps }; return cells[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || deps.some((d, j) => d !== cells[i].deps[j])) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const sandbox = { exports: {}, require(name) { if (name === 'react') return hooks; if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } }; if (name === './chatDraft') return merge; if (name === './LearnUI') return { errorMessage: cause => cause.message }; throw new Error(name); } };
  vm.runInNewContext(source, sandbox);
  return { render() { cursor = 0; effects = []; const state = model.getSnapshot().state; const hook = sandbox.exports.useChatDraft(initialThread, act, { exists: state.companion.threads.some(item => item.id === initialThread.id), revision: state.revision }); effects.forEach(effect => effect()); return hook; } };
}
let serial = 0;
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  let record = null;
  const disk = {
    failWrite: false, failRead: false,
    async load() { if (disk.failRead) throw new Error('read unavailable'); return record; },
    async commit(next, expected) { if (disk.failWrite) throw new Error('write unavailable'); if ((record?.revision ?? null) !== expected) throw new LocalStorageError('revision conflict', 'conflict'); record = next; },
  };
  const make = () => new LocalLearningEngine({ persistence: disk, newId: () => `chat-ui-${++serial}`, now: () => '2026-10-27T02:00:00.000Z' });
  const model = make(); await model.reload();
  const opened = await model.act('chat.open', { context: { source: 'general' } });
  const threadId = opened.result.id;
  const thread = opened.state.companion.threads.find(item => item.id === threadId);
  const other = make(); await other.reload();
  return { disk, model, other, threadId, make, harness: harness(model, thread), reload: async () => { await model.reload(); return model.getSnapshot().state; } };
}
const remoteDraft = (model, id) => model.getSnapshot().state.companion.threads.find(item => item.id === id).draft;

test('typing during an in-flight write drains latest text and choice; restart reads final draft', async () => {
  const f = await fixture(); const hook = f.harness.render();
  let release; const barrier = new Promise(resolve => { release = resolve; }); const commit = f.disk.commit.bind(f.disk); let gated = true;
  f.disk.commit = async (...args) => { if (gated) { gated = false; await barrier; } await commit(...args); };
  hook.update('text', '1'); await turn(); hook.update('text', '12'); hook.update('intent', 'note');
  release(); await hook.save();
  assert.equal(f.harness.render().input.text, '12');
  const restarted = f.make(); await restarted.reload(); assert.equal(remoteDraft(restarted, f.threadId).text, '12');
});
test('CAS failure recovery preserves local text and incorporates remote help option', async () => {
  const f = await fixture(); const hook = f.harness.render();
  await f.other.act('chat.draft.save', { threadId: f.threadId, text: '', intent: 'hint', expectedDraftRevision: 0 });
  hook.update('text', '保留我的问题'); await assert.rejects(hook.save());
  await hook.recover(f.reload); const recovered = f.harness.render();
  assert.equal(recovered.input.text, '保留我的问题'); assert.equal(recovered.input.intent, 'hint');
  await recovered.save(); assert.equal(remoteDraft(f.model, f.threadId).text, '保留我的问题');
});
test('same-field conflict blocks writes until explicit choice; repeated read retains the conflict', async () => {
  const f = await fixture(); let hook = f.harness.render();
  await f.other.act('chat.draft.save', { threadId: f.threadId, text: '本机另一份', intent: 'note', expectedDraftRevision: 0 });
  hook.update('text', '本页文字'); await assert.rejects(hook.save());
  await hook.recover(f.reload); await hook.recover(f.reload); hook = f.harness.render();
  assert.equal(hook.conflicts.length, 1); await assert.rejects(hook.save(), /选择/);
  hook.choose('text', 'local'); await hook.save(); assert.equal(remoteDraft(f.model, f.threadId).text, '本页文字');
});
test('failed persistence/read keeps text and restores writing only after successful reload', async () => {
  const f = await fixture(); let hook = f.harness.render();
  f.disk.failWrite = true; f.disk.failRead = true;
  hook.update('text', '不要丢掉'); await assert.rejects(hook.save()); await assert.rejects(hook.recover(f.reload));
  hook = f.harness.render(); assert.equal(hook.input.text, '不要丢掉');
  f.disk.failWrite = false; f.disk.failRead = false; await hook.recover(f.reload); await hook.save();
  assert.equal(remoteDraft(f.model, f.threadId).text, '不要丢掉');
});
test('lost send response is reconciled by stable request id without resurrecting sent draft', async () => {
  const f = await fixture(); let hook = f.harness.render(); hook.update('text', '不要给我答案，只记录');
  const draft = await hook.save(); const requestId = merge.chatRequestId(f.threadId, draft);
  const payload = { threadId: f.threadId, text: draft.text, intent: draft.intent, expectedDraftRevision: draft.revision, requestId };
  await f.model.act('chat.send', payload); // Simulate caller losing the response after persistence.
  await hook.recover(f.reload, requestId); hook = f.harness.render(); assert.equal(hook.input.text, '');
  await f.model.act('chat.send', payload); assert.equal(f.model.getSnapshot().state.messages.length, 2);
  assert.equal(f.model.getSnapshot().state.events.filter(item => item.action === 'learning.exposure').length, 0);
});
test('deleted remote thread preserves unsaved input and blocks recreating it through draft save', async () => {
  const f = await fixture(); let hook = f.harness.render();
  const preview = (await f.other.act('chat.delete.preview', { threadId: f.threadId })).result.preview;
  await f.other.act('chat.delete', { threadId: f.threadId, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId: 'delete-ui-remote' });
  hook.update('text', '待复制的文字'); await assert.rejects(hook.save()); await hook.recover(f.reload);
  hook = f.harness.render(); assert.equal(hook.deleted, true); assert.equal(hook.input.text, '待复制的文字'); await assert.rejects(hook.save(), /已删除/);
});
async function deleteThread(model, threadId, requestId) {
  const preview = (await model.act('chat.delete.preview', { threadId })).result.preview;
  await model.act('chat.delete', { threadId, sourceRevision: preview.sourceRevision, digest: preview.digest, requestId });
}
test('returning to an older mounted page after another page deletes its thread immediately hides saved draft', async () => {
  const f = await fixture(); let olderPage = f.harness.render();
  olderPage.update('text', '之前保存的私密草稿'); await olderPage.save();
  assert.equal(f.harness.render().dirty, false);
  await deleteThread(f.model, f.threadId, 'delete-from-second-page');
  olderPage = f.harness.render();
  assert.equal(olderPage.deleted, true); assert.equal(olderPage.input.text, ''); assert.equal(olderPage.dirty, false);
  await assert.rejects(olderPage.save(), /已删除/);
  olderPage.update('text', '不应复活'); assert.equal(f.harness.render().input.text, '');
  assert.equal(f.model.getSnapshot().state.companion.threads.length, 0);
});
test('a late old save or send completion cannot restore draft body after a newer deletion', async () => {
  const f = await fixture(); const original = f.model.getSnapshot().state.companion.threads[0];
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const delayedAct = async (action, payload) => { const result = await f.model.act(action, payload); if (action === 'chat.draft.save') await barrier; return result; };
  const older = harness(f.model, original, delayedAct); let hook = older.render();
  hook.update('text', '正在返回的已保存草稿'); const inFlight = hook.save(); await turn();
  const staleSaved = remoteDraft(f.model, f.threadId);
  await deleteThread(f.model, f.threadId, 'delete-before-old-response');
  hook = older.render(); assert.equal(hook.deleted, true); await turn();
  release(); await inFlight;
  hook = older.render(); assert.equal(hook.input.text, ''); assert.equal(hook.dirty, false);
  assert.equal(hook.reset(staleSaved), false); assert.equal(older.render().input.text, '');
  await assert.rejects(hook.save(), /已删除/);
});
