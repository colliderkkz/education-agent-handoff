import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecoverablePhotos, MAX_IMAGE_BYTES, photoRegistrationPayload } from '../src/features/photo-recovery.ts';

const directory = 'file:///app/Documents/xiaohe-images';
const firstId = 'b1509948-d2db-400b-8fcb-3525de8d63b8';
const secondId = '05e177b5-c4cc-4293-8cee-a37732fbd23d';
const file = (id = firstId, extension = 'jpg') => ({ name: `${id}.${extension}`, uri: `${directory}/${id}.${extension}`, size: 1000 });

test('restart finds the same unregistered photo ID without changing inputs', () => {
  const files = [file()];
  const before = structuredClone(files);
  const initial = findRecoverablePhotos(files, [], directory);
  const afterRestart = findRecoverablePhotos(structuredClone(files), [], `${directory}/`);
  assert.deepEqual(afterRestart, initial);
  assert.deepEqual(initial, [{ id: firstId, name: `找回的拍题-${firstId.slice(0, 8)}`, uri: file().uri }]);
  assert.deepEqual(files, before);
});

test('recovery excludes registered IDs and URIs, including a moved iOS container', () => {
  const files = [file(), file(secondId, 'png')];
  const registered = [{ id: firstId, url: `file:///old-container/Documents/xiaohe-images/${firstId}.jpg` }, { id: 'legacy-id', url: file(secondId, 'png').uri }];
  const before = structuredClone(registered);
  assert.deepEqual(findRecoverablePhotos(files, registered, directory), []);
  assert.deepEqual(registered, before);
});

test('scan accepts only bounded UUID image files directly in the owned directory', () => {
  const good = file();
  const files = [
    { ...good, name: 'notes.txt', uri: `${directory}/notes.txt` },
    { ...good, name: 'holiday.jpg', uri: `${directory}/holiday.jpg` },
    { ...good, uri: `file:///camera/${good.name}` },
    { ...good, uri: `${directory}/nested/${good.name}` },
    { ...good, size: 0 }, { ...good, size: -1 }, { ...good, size: NaN },
    { ...good, size: MAX_IMAGE_BYTES + 1 },
    good, file(firstId, 'png'), file(secondId, 'heic'),
  ];
  assert.deepEqual(findRecoverablePhotos(files, [], directory).map(photo => photo.id), [firstId, secondId]);
});

test('after uncertain save and reread, retry uses committed metadata for idempotency', () => {
  const recovered = findRecoverablePhotos([file()], [], directory)[0];
  const recorded = [{ id: firstId, name: '第一次拍的题目.jpg', url: `file:///old/Documents/xiaohe-images/${firstId}.jpg` }];
  const resolve = uri => uri.replace('file:///old/Documents', 'file:///app/Documents');
  const payload = photoRegistrationPayload(recovered, recorded, resolve);
  assert.deepEqual(payload, { id: firstId, name: recorded[0].name, uri: recorded[0].url });
  assert.equal(recovered.name, `找回的拍题-${firstId.slice(0, 8)}`);
  assert.equal(photoRegistrationPayload(recovered, [], resolve), recovered);
});

test('an ID collision never switches the image to an unrelated saved file', () => {
  const recovered = findRecoverablePhotos([file()], [], directory)[0];
  assert.throws(() => photoRegistrationPayload(recovered, [{ id: firstId, name: '另一张', url: file(secondId).uri }], uri => uri), /保存记录不一致/);
});
