import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalLearningEngine } from '../src/local/engine.ts';
import { stageOfKnowledge } from '../src/local/shared/types.ts';
import { practiceScopeForCause, mistakeCauses } from '../src/local/shared/mistake-causes.ts';
import { paperTemplates, examTopics, sourceTierLabels, examIndexDisclaimer } from '../src/local/shared/exam-references.ts';

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

async function withJuniorPack() {
  const disk = new Disk();
  const model = new LocalLearningEngine({ persistence: disk, newId: () => `stage-${++sequence}`, now: () => '2026-10-26T16:00:00.000Z' });
  await model.reload();
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const preview = (await model.act('local.content.preview', { json: JSON.stringify(pack) })).result.preview;
  await model.act('local.content.apply', { json: JSON.stringify(pack), sourceRevision: preview.sourceRevision, digest: preview.digest });
  const state = JSON.parse(disk.record.payload).workspace;
  return { disk, model, state, knowledgeIds: [...new Set(pack.items.map(item => item.knowledgeId))] };
}

test('学段判定只有一份：小学、初中、高中各归各的', () => {
  assert.equal(stageOfKnowledge('math-1-place'), 'primary');
  assert.equal(stageOfKnowledge('chinese-1-imagery'), 'primary');
  assert.equal(stageOfKnowledge('math-j-3-circle'), 'junior');
  assert.equal(stageOfKnowledge('math-s-4-conic'), 'senior');
});

test('手机端也能查到官方卷面结构与考点出处', () => {
  assert.ok(paperTemplates.length >= 1);
  for (const template of paperTemplates) {
    assert.ok(template.id && template.label);
    assert.ok(['junior', 'senior'].includes(template.stage), template.id);
    assert.ok(template.source.url.startsWith('https://'), template.id);
    assert.ok(template.officialFacts.length > 0, template.id);
    assert.ok(sourceTierLabels[template.source.tier], template.source.tier);
  }
  assert.ok(examTopics.length >= 1);
  for (const topic of examTopics) {
    assert.ok(topic.hits.length > 0, topic.key);
    for (const hit of topic.hits) assert.ok(hit.source.url.startsWith('https://'), `${topic.key} ${hit.year}`);
  }
  assert.ok(examIndexDisclaimer.length > 20);
});

test('导入上海初中内容包后，错因标签与按错因组卷都能用', async () => {
  const { disk, model, knowledgeIds } = await withJuniorPack();
  const point = knowledgeIds[0];
  const made = await model.act('paper.create', { count: 2, knowledgeIds: [point] });
  const paperId = made.result.id;
  await model.act('paper.resume', { paperId });
  const paper = JSON.parse(disk.record.payload).workspace.papers.find(item => item.id === paperId);
  // 故意答错，产出真实错题。
  await model.act('attempt.submit', { paperId, answers: paper.questions.map(question => ({ questionId: question.id, value: '0' })), submissionKey: paperId });
  const wrong = JSON.parse(disk.record.payload).workspace;
  const mistake = wrong.mistakes[0];
  assert.ok(mistake, '答错后应留下错题');

  const tagged = await model.act('mistake.tag', { id: mistake.id, cause: 'concept' });
  assert.equal(tagged.result.id, mistake.id);
  const afterTag = JSON.parse(disk.record.payload).workspace;
  assert.equal(afterTag.mistakes.find(item => item.id === mistake.id).cause, 'concept');
  // 未知标签被拒。
  await assert.rejects(model.act('mistake.tag', { id: mistake.id, cause: 'made-up' }), /错因标签无效/);
  assert.ok(mistakeCauses.every(cause => typeof cause.label === 'string' && cause.label.length > 0));
});

test('按错因组卷的范围带上同单元知识点，换得到新题', async () => {
  const { disk, model, knowledgeIds } = await withJuniorPack();
  const point = knowledgeIds[0];
  const made = await model.act('paper.create', { count: 2, knowledgeIds: [point] });
  const paperId = made.result.id;
  await model.act('paper.resume', { paperId });
  const paper = JSON.parse(disk.record.payload).workspace.papers.find(item => item.id === paperId);
  await model.act('attempt.submit', { paperId, answers: paper.questions.map(question => ({ questionId: question.id, value: '0' })), submissionKey: paperId });
  const wrong = JSON.parse(disk.record.payload).workspace;
  const mistake = wrong.mistakes[0];
  await model.act('mistake.tag', { id: mistake.id, cause: 'concept' });

  const tagged = JSON.parse(disk.record.payload).workspace;
  const scope = practiceScopeForCause(
    tagged.mistakes.map(item => ({ knowledgeId: item.question.knowledgeId, cause: item.cause })),
    tagged.knowledge,
    'concept',
  );
  assert.ok(scope.knowledgeIds.includes(point), '错题本身的知识点要在范围里');
  assert.ok(scope.knowledgeIds.length > 1, '同单元的其他知识点也要带上，否则换不到新题');
  // 真的能出卷。
  const again = await model.act('paper.create', { count: scope.count, knowledgeIds: scope.knowledgeIds, difficulty: '不限', kind: 'practice' });
  const second = JSON.parse(disk.record.payload).workspace.papers.find(item => item.id === again.result.id);
  assert.ok(second.questions.length > 0);
  assert.ok(second.questions.every(question => scope.knowledgeIds.includes(question.knowledgeId)));
});
