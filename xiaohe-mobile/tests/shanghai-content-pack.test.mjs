import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalLearningEngine } from '../src/local/engine.ts';

const copy = value => value == null ? value : structuredClone(value);
class Disk {
  record = null;
  async load() { return copy(this.record); }
  async commit(next, expected) {
    if ((this.record?.revision ?? null) !== expected) throw new Error('changed');
    this.record = copy(next);
  }
}
let sequence = 0;
const packPath = fileURLToPath(new URL('../content-packs/xiaohe-junior-math-v1-2.json', import.meta.url));
const seniorPath = fileURLToPath(new URL('../content-packs/xiaohe-senior-math-v1-2.json', import.meta.url));

test('导入上海初中内容包后，题目与知识点都能在本机练起来', async () => {
  const disk = new Disk();
  const model = new LocalLearningEngine({ persistence: disk, newId: () => `sh-pack-${++sequence}`, now: () => '2026-10-26T16:00:00.000Z' });
  await model.reload();
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  assert.equal(pack.courseScope.grade, '九年级');
  assert.equal(pack.courseScope.course, '数学');

  const preview = (await model.act('local.content.preview', { json: JSON.stringify(pack) })).result.preview;
  assert.ok(preview.counts.added > 0, '预览应有新增题目');
  const applied = await model.act('local.content.apply', { json: JSON.stringify(pack), sourceRevision: preview.sourceRevision, digest: preview.digest });
  const state = JSON.parse(disk.record.payload).workspace;

  // 包里的知识点要变成可练的知识点条目。
  const knowledgeIds = [...new Set(pack.items.map(item => item.knowledgeId))];
  assert.ok(knowledgeIds.length > 0);
  for (const knowledgeId of knowledgeIds) {
    const point = state.knowledge.find(item => item.id === knowledgeId);
    assert.ok(point, `导入后应建立知识点条目：${knowledgeId}`);
    assert.equal(point.learningState, 'current');
    assert.ok(point.name && point.name !== knowledgeId, `知识点应带目录名称：${knowledgeId}`);
  }

  // 能用这个知识点组出卷子。
  const paper = await model.act('paper.create', { count: 2, knowledgeIds: [knowledgeIds[0]] });
  const made = JSON.parse(disk.record.payload).workspace.papers.find(item => item.id === paper.result.id);
  assert.equal(made.questions.length, 2);
  assert.ok(made.questions.every(question => question.knowledgeId === knowledgeIds[0]));
});

test('导入上海高中内容包后同样可以组卷', async () => {
  const disk = new Disk();
  const model = new LocalLearningEngine({ persistence: disk, newId: () => `sh-senior-${++sequence}`, now: () => '2026-10-26T16:00:00.000Z' });
  await model.reload();
  const pack = JSON.parse(readFileSync(seniorPath, 'utf8'));
  assert.equal(pack.courseScope.grade, '高三');
  const preview = (await model.act('local.content.preview', { json: JSON.stringify(pack) })).result.preview;
  await model.act('local.content.apply', { json: JSON.stringify(pack), sourceRevision: preview.sourceRevision, digest: preview.digest });
  const state = JSON.parse(disk.record.payload).workspace;
  const knowledgeIds = [...new Set(pack.items.map(item => item.knowledgeId))];
  for (const knowledgeId of knowledgeIds) assert.ok(state.knowledge.some(item => item.id === knowledgeId), knowledgeId);
});
