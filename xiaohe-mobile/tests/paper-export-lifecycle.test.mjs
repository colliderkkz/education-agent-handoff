import test from 'node:test';
import assert from 'node:assert/strict';
import { bestEffortExportCleanup, PaperRenderTimeoutError, runPaperExportLifecycle, waitForPaperRender } from '../src/features/paper-export-lifecycle.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture() {
  const oldBatch = { files: ['old-student.pdf', 'manifest.json'] };
  const photo = { contents: 'original photo' };
  const disk = new Map([['old-batch', oldBatch], ['photo', photo]]);
  const events = [];
  const manifest = { id: 'new-batch', files: ['student.pdf', 'solutions.pdf'] };
  const operations = {
    create: () => {
      events.push('create');
      if (disk.has('new-batch')) throw new Error('already exists');
      disk.set('new-batch', { files: [] });
    },
    prepare: async () => {
      events.push('prepare'); disk.get('new-batch').files.push('student.pdf', 'solutions.pdf');
      return manifest;
    },
    publish: async ready => {
      events.push('publish'); disk.get('new-batch').files.push('manifest.json');
      return ready;
    },
    cleanupUnpublished: () => { events.push('cleanup'); disk.delete('new-batch'); },
  };
  return { disk, events, manifest, operations, oldBatch, photo };
}

test('successful generation publishes only after prepare and preserves the ready directory', async () => {
  const f = fixture();
  assert.equal(await runPaperExportLifecycle(f.operations), f.manifest);
  assert.deepEqual(f.events, ['create', 'prepare', 'publish']);
  assert.deepEqual(f.disk.get('new-batch').files, ['student.pdf', 'solutions.pdf', 'manifest.json']);
});

test('first PDF failure removes only the newly allocated unpublished directory', async () => {
  const f = fixture();
  const failure = new Error('native renderer failed');
  f.operations.prepare = async () => { throw failure; };
  await assert.rejects(runPaperExportLifecycle(f.operations), error => error === failure);
  assert.equal(f.disk.has('new-batch'), false);
  assert.equal(f.disk.get('old-batch'), f.oldBatch);
  assert.equal(f.disk.get('photo'), f.photo);
  assert.deepEqual(f.events, ['create', 'cleanup']);
});

test('second PDF failure removes the already copied first PDF and repeated retries do not accumulate batches', async () => {
  const f = fixture();
  const failure = new Error('second PDF copy failed: no space');
  f.operations.prepare = async () => {
    f.disk.get('new-batch').files.push('student.pdf');
    throw failure;
  };
  for (let retry = 0; retry < 3; retry++) {
    await assert.rejects(runPaperExportLifecycle(f.operations), error => error === failure);
    assert.deepEqual([...f.disk.keys()], ['old-batch', 'photo']);
  }
  assert.equal(f.events.filter(event => event === 'cleanup').length, 3);
  assert.ok(!f.events.includes('publish'));
});

test('a creation collision never deletes an existing batch', async () => {
  const f = fixture();
  const existing = { files: ['saved.pdf', 'manifest.json'] };
  f.disk.set('new-batch', existing);
  await assert.rejects(runPaperExportLifecycle(f.operations), /already exists/);
  assert.equal(f.disk.get('new-batch'), existing);
  assert.deepEqual(f.events, ['create']);
});

test('cleanup failure cannot replace the original export error', async () => {
  const f = fixture();
  const original = new Error('copy failed');
  f.operations.prepare = async () => { throw original; };
  f.operations.cleanupUnpublished = () => { throw new Error('cleanup also failed'); };
  await assert.rejects(runPaperExportLifecycle(f.operations), error => error === original);
  assert.ok(f.disk.has('new-batch'));
  assert.equal(f.disk.get('photo'), f.photo);
});

test('asynchronous cleanup failure is also best effort', async () => {
  const f = fixture();
  const original = new Error('verification failed');
  f.operations.prepare = async () => { throw original; };
  f.operations.cleanupUnpublished = async () => { throw new Error('delete reply failed'); };
  await assert.rejects(runPaperExportLifecycle(f.operations), error => error === original);
});

test('manifest write rejection before a known result preserves all files for reread recovery', async () => {
  const f = fixture();
  const failure = new Error('manifest commit unknown');
  f.operations.publish = async () => { f.events.push('publish'); throw failure; };
  await assert.rejects(runPaperExportLifecycle(f.operations), error => error === failure);
  assert.deepEqual(f.disk.get('new-batch').files, ['student.pdf', 'solutions.pdf']);
  assert.ok(!f.events.includes('cleanup'));
});

test('a lost native reply after writing the manifest never deletes a published batch', async () => {
  const f = fixture();
  const failure = new Error('native reply lost after write');
  f.operations.publish = async () => {
    f.disk.get('new-batch').files.push('manifest.json');
    throw failure;
  };
  await assert.rejects(runPaperExportLifecycle(f.operations), error => error === failure);
  assert.deepEqual(f.disk.get('new-batch').files, ['student.pdf', 'solutions.pdf', 'manifest.json']);
  assert.ok(!f.events.includes('cleanup'));
});

test('a synchronous exception at the publication boundary is conservatively treated as unknown', async () => {
  const f = fixture();
  f.operations.publish = () => { throw new Error('write invocation failed'); };
  await assert.rejects(runPaperExportLifecycle(f.operations), /write invocation failed/);
  assert.ok(f.disk.has('new-batch'));
  assert.ok(!f.events.includes('cleanup'));
});

test('failure to delete a verified temporary cache file does not stop publication', async () => {
  const f = fixture();
  const prepare = f.operations.prepare;
  f.operations.prepare = async () => {
    const prepared = await prepare();
    await bestEffortExportCleanup(() => { throw new Error('cache delete failed'); });
    return prepared;
  };
  assert.equal(await runPaperExportLifecycle(f.operations), f.manifest);
  assert.ok(f.disk.get('new-batch').files.includes('manifest.json'));
});

test('timely native rendering returns its result without running late cleanup', async () => {
  const result = { uri: 'file:///cache/current.pdf', numberOfPages: 2 };
  assert.equal(await waitForPaperRender(Promise.resolve(result), () => assert.fail('Not a late result'), 1000), result);
});

test('a timely native rejection retains its original error', async () => {
  const original = new Error('native renderer rejected');
  await assert.rejects(waitForPaperRender(Promise.reject(original), () => assert.fail('No result to clean'), 1000), error => error === original);
});

test('a hanging renderer times out and rolls back the unpublished batch', async () => {
  const f = fixture();
  f.operations.prepare = () => waitForPaperRender(new Promise(() => {}), () => assert.fail('No native result'), 5);
  await assert.rejects(runPaperExportLifecycle(f.operations), error => {
    assert.ok(error instanceof PaperRenderTimeoutError);
    assert.equal(error.code, 'PAPER_RENDER_TIMEOUT');
    assert.match(error.message, /重新打开 App/);
    return true;
  });
  assert.equal(f.disk.has('new-batch'), false);
  assert.equal(f.disk.get('old-batch'), f.oldBatch);
  assert.ok(!f.events.includes('publish'));
});

test('late native success after timeout cleans only that cache result and cannot publish over a retry', async () => {
  const pending = deferred();
  const cache = new Set();
  const f = fixture();
  const cleaned = [];
  f.operations.prepare = () => waitForPaperRender(pending.promise, result => {
    cleaned.push(result.uri); cache.delete(result.uri);
  }, 5);
  await assert.rejects(runPaperExportLifecycle(f.operations), PaperRenderTimeoutError);
  assert.equal(f.disk.has('new-batch'), false);

  const retry = fixture();
  await runPaperExportLifecycle(retry.operations);
  cache.add('file:///cache/retry.pdf');
  cache.add('file:///cache/late-first.pdf');
  pending.resolve({ uri: 'file:///cache/late-first.pdf' });
  await nextTick();
  assert.deepEqual(cleaned, ['file:///cache/late-first.pdf']);
  assert.deepEqual([...cache], ['file:///cache/retry.pdf']);
  assert.equal(f.disk.has('new-batch'), false);
  assert.ok(!f.events.includes('publish'));
  assert.ok(retry.disk.get('new-batch').files.includes('manifest.json'));
});

test('native rejection after timeout is consumed without changing the timeout outcome', async () => {
  const pending = deferred();
  await assert.rejects(waitForPaperRender(pending.promise, () => assert.fail('A rejection has no file'), 5), PaperRenderTimeoutError);
  pending.reject(new Error('late native rejection'));
  await nextTick();
});

test('late cache cleanup rejection is best effort and cannot create an unhandled rejection', async () => {
  const pending = deferred();
  let cleanupCalled = false;
  await assert.rejects(waitForPaperRender(pending.promise, async () => {
    cleanupCalled = true;
    throw new Error('late cache cleanup failed');
  }, 5), PaperRenderTimeoutError);
  pending.resolve({ uri: 'file:///cache/late.pdf' });
  await nextTick();
  assert.equal(cleanupCalled, true);
});
