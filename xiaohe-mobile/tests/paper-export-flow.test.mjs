import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPaper } from '../src/features/paper-export-flow.ts';

const clone = value => structuredClone(value);
function question(id = 'q-a') {
  return { id, familyId: `family-${id}`, version: 2, text: `题目 ${id}：168 ÷ 12 =`, answer: '', unit: '',
    knowledgeId: 'division', difficulty: '基础', source: '冻结教学样题', sourceScope: '', steps: [], hint: '',
    alternative: '', prerequisites: [], status: 'published', authorId: '', createdAt: '2026-10-26T00:00:00Z' };
}
function paper() {
  return { id: 'paper-original', title: '冻结练习', version: 3, parentId: 'paper-parent', createdAt: '2026-10-26T00:00:00Z',
    questionIds: ['q-b', 'q-a'], questions: [question(), question('q-b')], status: 'ready', kind: 'practice', reason: '组卷理由', estimatedMinutes: 4 };
}
function exposed(source = paper()) {
  const result = clone(source);
  result.questions = result.questions.map(q => ({ ...q, answer: `FRESH_ANSWER_${q.id}`, steps: [`FRESH_STEP_${q.id}`], hint: '只从新返回值取得的提示', alternative: '新返回值的另一种思路' }));
  return result;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('student export never records answer exposure and returns only the renderer result', async () => {
  let rendered;
  const saved = { id: 'durable-batch' };
  const result = await exportPaper(exposed(), 'student', {
    act: async () => { assert.fail('Student-only export must not mutate exposure'); },
    render: async documents => { rendered = documents; return saved; },
  });
  assert.equal(result, saved);
  assert.deepEqual(rendered.map(document => document.kind), ['student']);
  assert.ok(!rendered[0].html.includes('FRESH_ANSWER')); assert.ok(!rendered[0].html.includes('FRESH_STEP'));
});

test('failed exposure persistence prevents all rendering for solutions and both', async () => {
  for (const mode of ['solutions', 'both']) {
    let renders = 0;
    const failure = new Error('cannot persist exposure');
    await assert.rejects(exportPaper(paper(), mode, {
      act: async (action, payload) => {
        assert.equal(action, 'paper.expose'); assert.deepEqual(payload, { paperId: 'paper-original' });
        throw failure;
      },
      render: async () => { renders++; },
    }), error => error === failure);
    assert.equal(renders, 0);
  }
});

test('render waits for exposure to resolve and reads only its fresh authorized projection', async () => {
  const pending = deferred();
  const input = paper();
  input.questions.forEach(q => { q.answer = 'STALE_ANSWER'; q.steps = ['STALE_STEP']; });
  let rendered;
  const operation = exportPaper(input, 'both', {
    act: async () => pending.promise,
    render: async documents => { rendered = documents; return 'finished'; },
  });
  await Promise.resolve();
  assert.equal(rendered, undefined);
  pending.resolve({ state: { papers: [exposed(paper())] } });
  assert.equal(await operation, 'finished');
  assert.deepEqual(rendered.map(document => document.kind), ['student', 'solutions']);
  assert.ok(!rendered[0].html.includes('FRESH_ANSWER'));
  assert.ok(rendered[1].html.includes('FRESH_ANSWER_q-b'));
  assert.ok(rendered[1].html.includes('FRESH_STEP_q-a'));
  for (const document of rendered) assert.doesNotMatch(document.html, /STALE_ANSWER|STALE_STEP/);
});

test('mutating the caller paper while exposure is pending cannot switch the frozen request', async () => {
  const pending = deferred();
  const input = paper();
  const frozen = clone(input);
  let rendered;
  const operation = exportPaper(input, 'solutions', {
    act: async (_action, payload) => { assert.deepEqual(payload, { paperId: frozen.id }); return pending.promise; },
    render: async documents => { rendered = documents; },
  });
  input.id = 'different-paper'; input.version = 99; input.title = '另一个标题'; input.questionIds.reverse();
  input.questions[0].text = '另一个题干';
  pending.resolve({ state: { papers: [exposed(frozen)] } });
  await operation;
  assert.equal(rendered[0].paperId, frozen.id); assert.equal(rendered[0].paperVersion, frozen.version);
  assert.ok(rendered[0].html.includes(frozen.title)); assert.ok(!rendered[0].html.includes('另一个题干'));
});

test('missing paper, changed paper version and changed question sequence reject before render', async () => {
  const mutations = [
    () => [],
    fresh => [{ ...fresh, version: fresh.version + 1 }],
    fresh => [{ ...fresh, questionIds: [...fresh.questionIds].reverse() }],
    fresh => [{ ...fresh, id: 'other-paper' }],
  ];
  for (const mutate of mutations) {
    let renders = 0;
    await assert.rejects(exportPaper(paper(), 'solutions', {
      act: async () => ({ state: { papers: mutate(exposed()) } }),
      render: async () => { renders++; },
    }), /版本|快照|变化/);
    assert.equal(renders, 0);
  }
});

test('question snapshot version or content drift cannot hide behind unchanged paper version and IDs', async () => {
  const mutations = [
    fresh => { fresh.questions[0].version++; },
    fresh => { fresh.questions[0].text = '同一编号下被换掉的题干'; },
    fresh => { fresh.questions[0].source = '另一份来源'; },
    fresh => { fresh.title = '另一份卷名'; },
    fresh => { fresh.parentId = 'another-parent'; },
  ];
  for (const mutate of mutations) {
    const fresh = exposed(); mutate(fresh);
    let renders = 0;
    await assert.rejects(exportPaper(paper(), 'solutions', {
      act: async () => ({ state: { papers: [fresh] } }),
      render: async () => { renders++; },
    }), /版本|快照|变化/);
    assert.equal(renders, 0);
  }
});

test('an exposure response that still lacks solutions never reaches PDF rendering', async () => {
  let renders = 0;
  await assert.rejects(exportPaper(paper(), 'both', {
    act: async () => ({ state: { papers: [paper()] } }),
    render: async () => { renders++; },
  }), error => error.code === 'MISSING_SOLUTIONS');
  assert.equal(renders, 0);
});

test('render failure is propagated and an explicit retry records exposure again before rendering', async () => {
  const events = [];
  let fail = true;
  const dependencies = {
    act: async () => { events.push('expose'); return { state: { papers: [exposed()] } }; },
    render: async () => { events.push('render'); if (fail) throw new Error('disk full'); return { saved: true }; },
  };
  await assert.rejects(exportPaper(paper(), 'solutions', dependencies), /disk full/);
  fail = false;
  assert.deepEqual(await exportPaper(paper(), 'solutions', dependencies), { saved: true });
  assert.deepEqual(events, ['expose', 'render', 'expose', 'render']);
});

test('invalid mode rejects without calling exposure or renderer', async () => {
  await assert.rejects(exportPaper(paper(), 'wrong', {
    act: async () => { assert.fail('No mutation for invalid mode'); },
    render: async () => { assert.fail('No PDF for invalid mode'); },
  }), /请选择/);
});
