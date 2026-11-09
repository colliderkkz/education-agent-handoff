import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { LocalStorageError } from '../src/local/types.ts';
import { encodeWorkspace } from '../src/local/validation.ts';
import { exportContentPackage } from '../src/local/shared/server/content.ts';

const copy = value => value == null ? value : structuredClone(value);
class Disk {
  record = null; writes = 0; fail = false; loseReply = false;
  async load() { return copy(this.record); }
  async commit(next, expected) {
    if (this.fail) throw new Error('disk full');
    if ((this.record?.revision ?? null) !== expected) throw new LocalStorageError('changed', 'conflict');
    this.record = copy(next); this.writes++;
    if (this.loseReply) throw new Error('native reply lost');
  }
}
let sequence = 0;
const modelFor = disk => new LocalLearningEngine({ persistence: disk, newId: () => `companion-test-${++sequence}`, now: () => '2026-10-27T02:00:00.000Z' });
const raw = disk => JSON.parse(disk.record.payload).workspace;
const thread = (model, id) => model.getSnapshot().state.companion.threads.find(item => item.id === id);
const history = state => Object.fromEntries(['papers', 'attempts', 'evidence', 'knowledge', 'mistakes', 'uploads', 'mastery'].map(key => [key, copy(state[key])]));
async function setup() { const disk = new Disk(), model = modelFor(disk); await model.reload(); return { disk, model }; }
async function open(model, context = { source: 'general' }) { return (await model.act('chat.open', { context })).result.id; }
async function paperContext(model) {
  const made = await model.act('paper.create', { count: 1 });
  const paper = made.state.papers.find(item => item.id === made.result.id), q = paper.questions[0];
  return { paper, q, context: { source: 'paper', paperId: paper.id, questionId: q.id, questionVersion: q.version } };
}
const requestId = () => `request-${++sequence}`;
async function send(model, id, text, intent = 'note', key = requestId()) {
  return model.act('chat.send', { threadId: id, text, intent, requestId: key });
}
async function deletion(model, id) { return (await model.act('chat.delete.preview', { threadId: id })).result.preview; }

test('first launch has no invented conversations or preferences; old messages migrate once without guessing a question version', async () => {
  const { disk, model } = await setup();
  assert.deepEqual(model.getSnapshot().state.companion.threads, []);
  assert.deepEqual(model.getSnapshot().state.companion.preferences, []);
  const legacy = raw(disk); delete legacy.companion;
  legacy.messages = [{ id: 'legacy-user', role: 'user', text: '旧消息的题目版本未知', questionId: legacy.questions[0].id, createdAt: '2026-10-26T03:00:00.000Z' }];
  disk.record = encodeWorkspace(legacy); const before = copy(disk.record), previousHistory = history(legacy), writes = disk.writes;
  disk.fail = true; await assert.rejects(modelFor(disk).reload()); assert.deepEqual(disk.record, before);
  disk.fail = false; const migrated = modelFor(disk); await migrated.reload();
  assert.equal(disk.writes, writes + 1); assert.deepEqual(history(raw(disk)), previousHistory);
  const old = raw(disk).companion.threads.find(item => item.context.source === 'legacy');
  assert.ok(old); assert.equal(old.snapshot, undefined); assert.equal(old.context.questionVersion, undefined);
  assert.equal(raw(disk).messages[0].text, legacy.messages[0].text);
  await migrated.reload(); assert.equal(disk.writes, writes + 1);
});

test('ordinary negative text never opens an answer; explicit help is visible only after a successful save', async () => {
  const { disk, model } = await setup(); const { context } = await paperContext(model); const id = await open(model, context);
  assert.equal(thread(model, id).snapshot, undefined);
  const before = history(raw(disk));
  await send(model, id, '不要给我答案，只想记下卡在哪里');
  assert.deepEqual(history(raw(disk)), before);
  assert.equal(raw(disk).events.filter(item => item.action === 'learning.exposure').length, 0);
  const saved = copy(disk.record); disk.fail = true;
  await assert.rejects(send(model, id, '', 'explanation', 'one-explicit-explanation'));
  assert.deepEqual(disk.record, saved);
  assert.equal(model.getSnapshot().state.messages.filter(item => item.threadId === id).length, 2);
  disk.fail = false; await send(model, id, '', 'explanation', 'one-explicit-explanation');
  assert.equal(raw(disk).events.filter(item => item.action === 'learning.exposure').length, 1);
  assert.equal(raw(disk).attempts[0].answers[0].help, 'explanation');
  const writes = disk.writes; await send(model, id, '', 'explanation', 'one-explicit-explanation');
  assert.equal(disk.writes, writes); assert.equal(raw(disk).messages.filter(item => item.threadId === id).length, 4);
  await assert.rejects(send(model, id, '另一次请求不能复用相同编号', 'note', 'one-explicit-explanation'));
});

test('an old paper conversation keeps its exact version after a newer content package is applied', async () => {
  const { disk, model } = await setup(); const { paper, q, context } = await paperContext(model); const id = await open(model, context);
  const original = copy(raw(disk).papers.find(item => item.id === paper.id).questions[0]);
  const exportState = raw(disk); exportState.questions = [{ ...copy(original), version: original.version + 1, text: '新版题目：请计算 999 + 1。', answer: '1000', steps: ['新版专用步骤，不能替换原卷讲解。'] }];
  const pack = exportContentPackage(exportState, { packageId: 'companion-new-content', publisherId: 'test-publisher', createdAt: '2026-10-27T01:00:00.000Z' });
  const json = JSON.stringify(pack), preview = (await model.act('local.content.preview', { json })).result.preview;
  await model.act('local.content.apply', { json, sourceRevision: preview.sourceRevision, digest: preview.digest });
  assert.equal(await open(model, context), id);
  await send(model, id, '', 'explanation');
  const reply = raw(disk).messages.filter(item => item.threadId === id && item.role === 'assistant').at(-1);
  assert.ok(reply.text.includes(original.steps[0])); assert.ok(!reply.text.includes('新版专用步骤'));
  assert.equal(thread(model, id).context.questionVersion, q.version);
  assert.deepEqual(raw(disk).papers.find(item => item.id === paper.id).questions[0], original);
  const bankThread = await open(model, { source: 'bank', questionId: q.id, questionVersion: q.version + 1 });
  assert.notEqual(bankThread, id);
});

test('conversation drafts survive restart, preserve previous bytes on failure, and reject stale edits', async () => {
  const { disk, model } = await setup(); const id = await open(model);
  await model.act('chat.draft.save', { threadId: id, text: '还没发送的思路', intent: 'note', expectedDraftRevision: thread(model, id).draft.revision });
  const next = modelFor(disk); await next.reload(); assert.equal(thread(next, id).draft.text, '还没发送的思路');
  const revision = thread(next, id).draft.revision, before = copy(disk.record);
  disk.fail = true; await assert.rejects(next.act('chat.draft.save', { threadId: id, text: '未保存的新文字', intent: 'note', expectedDraftRevision: revision }));
  assert.deepEqual(disk.record, before); disk.fail = false;
  await next.act('chat.draft.save', { threadId: id, text: '继续思考', intent: 'note', expectedDraftRevision: revision });
  await assert.rejects(next.act('chat.draft.save', { threadId: id, text: '过期界面内容', intent: 'note', expectedDraftRevision: revision }));
  assert.equal(raw(disk).companion.threads.find(item => item.id === id).draft.text, '继续思考');
});

test('deleting a conversation removes private text and drafts but retains help facts and original submitted records', async () => {
  const { disk, model } = await setup(); const { context, paper } = await paperContext(model); const id = await open(model, context);
  const secret = '仅测试用的私密文字-删除后不能恢复'; const key = requestId();
  await send(model, id, secret, 'hint', key);
  const q = raw(disk).papers.find(item => item.id === paper.id).questions[0];
  await model.act('attempt.submit', { paperId: paper.id, answers: [{ questionId: q.id, value: q.answer }], submissionKey: 'chat-test-submit' });
  await model.act('chat.draft.save', { threadId: id, text: '尚未发送的私密草稿', intent: 'note', expectedDraftRevision: thread(model, id).draft.revision });
  const frozen = history(raw(disk)), exposure = copy(raw(disk).events.filter(item => item.action === 'learning.exposure'));
  const p = await deletion(model, id); assert.equal(p.messageCount, 2); assert.equal(p.hasDraft, true);
  const payload = { threadId: id, sourceRevision: p.sourceRevision, digest: p.digest, requestId: 'delete-once' };
  await model.act('chat.delete', payload);
  assert.ok(!disk.record.payload.includes(secret)); assert.ok(!disk.record.payload.includes('尚未发送的私密草稿'));
  assert.deepEqual(history(raw(disk)), frozen); assert.deepEqual(raw(disk).events.filter(item => item.action === 'learning.exposure'), exposure);
  const writes = disk.writes; await model.act('chat.delete', payload); assert.equal(disk.writes, writes);
  await assert.rejects(send(model, id, secret, 'hint', key));
  const restarted = modelFor(disk); await restarted.reload(); assert.equal(thread(restarted, id), undefined);
  assert.equal(restarted.getSnapshot().state.messages.some(item => item.threadId === id), false);
});

test('stale deletion preview and another engine write cannot discard newer user work; lost replies recover exactly once', async () => {
  const { disk, model } = await setup(); const id = await open(model); const p = await deletion(model, id);
  await model.act('profile.update', { profile: { name: '用户后续修改' } }); const saved = copy(disk.record);
  await assert.rejects(model.act('chat.delete', { threadId: id, sourceRevision: p.sourceRevision, digest: p.digest, requestId: 'stale-delete' })); assert.deepEqual(disk.record, saved);
  const stale = modelFor(disk); await stale.reload();
  await send(model, id, '另一个写入者已保存'); const newest = copy(disk.record);
  await assert.rejects(send(stale, id, '旧引擎不能覆盖'), error => error.code === 'conflict'); assert.deepEqual(disk.record, newest);
  disk.loseReply = true; await send(model, id, '回复丢失但已保存', 'note', 'reply-lost-once');
  const writes = disk.writes; await send(model, id, '回复丢失但已保存', 'note', 'reply-lost-once'); assert.equal(disk.writes, writes);
  assert.equal(raw(disk).messages.filter(item => item.text === '回复丢失但已保存').length, 1);
});

test('explicit presentation preferences persist and can be removed without changing replies or learning history', async () => {
  const { disk, model } = await setup(); const { context } = await paperContext(model); const id = await open(model, context);
  await model.act('memory.preference.set', { key: 'presentation', value: 'compact', sourceRevision: raw(disk).revision });
  const restarted = modelFor(disk); await restarted.reload(); assert.equal(restarted.getSnapshot().state.companion.preferences[0].source, 'self');
  assert.equal(restarted.getSnapshot().state.companion.preferences[0].value, 'compact');
  await send(restarted, id, '', 'explanation');
  const reply = copy(raw(disk).messages.at(-1)); assert.equal(reply.preferenceUsed.value, 'compact');
  const before = history(raw(disk));
  await restarted.act('memory.preference.delete', { key: 'presentation', sourceRevision: raw(disk).revision });
  assert.deepEqual(raw(disk).companion.preferences, []); assert.deepEqual(raw(disk).messages.at(-1), reply); assert.deepEqual(history(raw(disk)), before);
  await assert.rejects(restarted.act('memory.preference.set', { key: 'personality', value: '懒惰', sourceRevision: raw(disk).revision }));
});

test('confirmed summaries stay local, copy only the selected context, and remain separate when a conversation is deleted', async () => {
  const { disk, model } = await setup(); const { context } = await paperContext(model); const id = await open(model, context);
  await send(model, id, '不应自动加入求助的完整私聊内容');
  await model.act('memory.preference.set', { key: 'presentation', value: 'compact', sourceRevision: raw(disk).revision });
  const input = { topic: '核对这道题的思路', summary: '这是我确认要保留的求助摘要。', threadId: id, requestId: 'local-help-once' };
  const before = copy(disk.record); disk.fail = true;
  await assert.rejects(model.act('help.create', input)); assert.deepEqual(disk.record, before);
  disk.fail = false; disk.loseReply = true;
  const created = await model.act('help.create', input); disk.loseReply = false;
  const saved = copy(raw(disk).helpRequests.find(item => item.id === created.result.id));
  assert.equal(saved.delivery, 'local-only'); assert.equal(saved.ownerId, raw(disk).actor.id);
  assert.deepEqual(saved.context, thread(model, id).context);
  assert.equal(saved.snapshot, undefined); assert.equal(saved.messages, undefined); assert.equal(saved.preferences, undefined);
  assert.ok(!JSON.stringify(saved).includes('不应自动加入求助的完整私聊内容'));
  assert.match(created.result.message, /尚未发送/);
  const writes = disk.writes; await model.act('help.create', input); assert.equal(disk.writes, writes);
  await assert.rejects(model.act('help.create', { ...input, summary: '同一请求不能更换摘要' }));
  await assert.rejects(model.act('help.create', { ...input, requestId: 'forged-channel', delivery: 'workspace', channel: 'workspace' }));
  const p = await deletion(model, id); assert.equal(p.retainedHelpRequestCount, 1);
  await model.act('chat.delete', { threadId: id, sourceRevision: p.sourceRevision, digest: p.digest, requestId: 'delete-summary-source' });
  assert.deepEqual(raw(disk).helpRequests.find(item => item.id === saved.id), saved);
  assert.ok(!disk.record.payload.includes('不应自动加入求助的完整私聊内容'));
  const afterDelete = disk.writes; await model.act('help.create', input); assert.equal(disk.writes, afterDelete);
  const restarted = modelFor(disk); await restarted.reload();
  assert.deepEqual(restarted.getSnapshot().state.helpRequests.find(item => item.id === saved.id), saved);
  assert.equal(thread(restarted, id), undefined);
});

test('a damaged conversation snapshot is preserved and blocks writes instead of silently resetting records', async () => {
  const { disk, model } = await setup(); const { context } = await paperContext(model); await open(model, context);
  const envelope = JSON.parse(disk.record.payload); envelope.workspace.companion.threads[0].snapshot.answer = '被破坏的答案';
  disk.record.payload = JSON.stringify(envelope); const damaged = copy(disk.record);
  const next = modelFor(disk); await assert.rejects(next.reload(), /保留原数据/);
  await assert.rejects(next.act('chat.open', { context: { source: 'general' } })); assert.deepEqual(disk.record, damaged);
});
