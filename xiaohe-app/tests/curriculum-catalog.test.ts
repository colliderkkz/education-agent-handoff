import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { curriculumCatalog } from '../lib/curriculum-catalog.ts';
import { shanghaiCatalog } from '../lib/curriculum-catalog-shanghai.ts';
import { shanghaiExplanations } from '../lib/curriculum-explanations-shanghai.ts';
import { allKnowledgeIds, stageOfKnowledge, subjectOfKnowledge } from '../lib/types.ts';
import { curriculumExercises } from '../lib/curriculum-practice.ts';
import { curriculumExplanations } from '../lib/curriculum-explanations.ts';
import { createSeedWorkspace } from '../lib/seed.ts';
import { catalogKnowledgeIds } from '../lib/types.ts';

test('catalog has unique IDs and maps only compatible demo practices into the revised units', () => {
  const ids = new Set<string>();
  for (const subject of curriculumCatalog) {
    assert.ok(subject.units.length > 0);
    assert.ok(!ids.has(subject.id)); ids.add(subject.id);
    for (const unit of subject.units) {
      assert.ok(unit.points.length > 0);
      assert.ok(!ids.has(unit.id)); ids.add(unit.id);
      for (const point of unit.points) {
        assert.ok(point.name && point.description);
        assert.ok(!ids.has(point.id)); ids.add(point.id);
      }
    }
  }
  assert.deepEqual(curriculumCatalog.map(item => item.name), ['语文', '数学', '英语']);
  assert.deepEqual(curriculumCatalog.map(item => item.units.length), [8, 7, 7]);
  for (const subject of curriculumCatalog) {
    assert.match(subject.edition, /四年级上册/);
    assert.match(subject.sourceUrl, /^https:\/\/(?:www|download)\.pep\.com\.cn\//);
  }
  const live = curriculumCatalog.flatMap(subject => subject.units.flatMap(unit => unit.points.flatMap(point => point.practiceId ? [point.practiceId] : [])));
  assert.deepEqual([...live].sort(), ['geometry', 'multiplication']);
  assert.ok(createSeedWorkspace('test', 'test').knowledge.some(item => item.id === 'division'));
  assert.ok(!curriculumCatalog[1].units.some(unit => /公顷和平方千米|除数是两位数的除法|数学广角——优化/.test(unit.name)));
});

test('each catalog point has one corresponding original practice question', () => {
  const points = curriculumCatalog.flatMap(subject => subject.units.flatMap(unit => unit.points.map(point => point.id)));
  assert.equal(new Set(curriculumExercises.map(item => item.pointId)).size, curriculumExercises.length);
  assert.deepEqual(curriculumExercises.map(item => item.pointId).sort(), points.sort());
  for (const exercise of curriculumExercises) assert.ok(exercise.question && exercise.reference);
  assert.deepEqual(Object.keys(curriculumExplanations).sort(), points);
  for (const explanation of Object.values(curriculumExplanations)) assert.ok(explanation.length >= 20);
});

test('catalog point ids are exactly the knowledge ids used by the formal question bank', () => {
  const points = curriculumCatalog.flatMap(subject => subject.units.flatMap(unit => unit.points.map(point => point.id)));
  // 题库 id 白名单现在还包含上海初高中，这里只比对小学部分。
  const primaryIds = catalogKnowledgeIds.filter(id => !id.includes("-j-") && !id.includes("-s-"));
  assert.equal(points.length, primaryIds.length);
  assert.deepEqual(points.slice().sort(), [...primaryIds].sort());
});

test('上海初高中目录的每个知识点都有讲解，且都在题库 id 白名单内', () => {
  const points = shanghaiCatalog.flatMap(subject => subject.units.flatMap(unit => unit.points.map(point => point.id)));
  assert.ok(points.length > 0);
  assert.equal(new Set(points).size, points.length);
  assert.deepEqual(Object.keys(shanghaiExplanations).sort(), points.slice().sort());
  for (const id of points) assert.ok(allKnowledgeIds.includes(id as never), `${id} 不在题库 id 白名单内`);
  for (const explanation of Object.values(shanghaiExplanations)) assert.ok(explanation.length >= 20, explanation.slice(0, 20));
  // 学段由 id 第二段决定，学科由第一段决定。
  assert.equal(stageOfKnowledge('math-j-1-real' as never), 'junior');
  assert.equal(stageOfKnowledge('math-s-1-function' as never), 'senior');
  assert.equal(stageOfKnowledge('math-1-place' as never), 'primary');
  assert.equal(subjectOfKnowledge('math-j-3-circle' as never), 'math');
  assert.equal(subjectOfKnowledge('chinese-1-imagery' as never), 'chinese');
});

test('textbook source snapshots are official and linked to catalog subjects', () => {
  const sources = JSON.parse(readFileSync(new URL('../data/textbook-source-snapshot.json', import.meta.url), 'utf8')) as Array<Record<string, string>>;
  assert.deepEqual(sources.map(item => item.subject), curriculumCatalog.map(item => item.id));
  for (const item of sources) {
    assert.equal(item.url, curriculumCatalog.find(subject => subject.id === item.subject)?.sourceUrl);
    assert.match(item.pageSha256, /^[a-f0-9]{64}$/);
  }
});
