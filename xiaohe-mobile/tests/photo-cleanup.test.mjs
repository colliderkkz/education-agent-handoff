import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedPhotoName, blockedPhotoIds } from '../src/features/photo-cleanup.ts';
import { findRecoverablePhotos } from '../src/features/photo-recovery.ts';

const id = 'b1509948-d2db-400b-8fcb-3525de8d63b8';
const name = `${id}.jpeg`;
const url = `file:///old-container/Documents/xiaohe-images/${name}`;

test('cleanup uses only an owned basename and rejects external, nested, traversal and malformed paths', () => {
  assert.equal(ownedPhotoName(url), name);
  for (const uri of [`https://example.com/xiaohe-images/${name}`, `content://xiaohe-images/${name}`, `file:///camera/${name}`, `file:///camera/xiaohe-images/${name}`, `${url}?x=1`, `${url}#hash`, 'file:///app/xiaohe-images/../other.jpg', 'file:///app/xiaohe-images/not-a-uuid.jpg', `file:///app/xiaohe-images/nested/${name}`]) assert.equal(ownedPhotoName(uri), null, uri);
});

test('deleted aliases and restored iOS containers cannot return through photo recovery, including pending cleanup', () => {
  const blocked = blockedPhotoIds([{ uploadId: 'legacy-alias', url }]);
  assert.deepEqual(blocked, ['legacy-alias', id]);
  const directory = 'file:///new-container/Documents/xiaohe-images';
  assert.deepEqual(findRecoverablePhotos([{ name, uri: `${directory}/${name}`, size: 1200 }], [], directory, blocked), []);
  assert.deepEqual(blockedPhotoIds([{ uploadId: id, url }, { uploadId: id, url }]), [id]);
});
