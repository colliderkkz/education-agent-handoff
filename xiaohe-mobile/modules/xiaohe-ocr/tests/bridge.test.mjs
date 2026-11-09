import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../../../src/features/native-ocr.ts', import.meta.url), 'utf8');

function load(native) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    exports: module.exports,
    module,
    require(id) {
      assert.equal(id, '../../modules/xiaohe-ocr/src/XiaoheOcrModule');
      return { __esModule: true, default: native };
    },
  });
  return module.exports;
}

test('old native build remains usable without pretending that OCR is available', async () => {
  const bridge = load(null);
  const availability = await bridge.getOcrAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.engine, null);
  assert.match(availability.reason, /继续手工/);
  await assert.rejects(bridge.recognizePhoto('file:///owned/image.jpg'), /没有本机文字识别模块/);
});

test('availability waits for the real device language check', async () => {
  let resolve;
  let completed = false;
  const nativeResult = { available: false, engine: 'apple-vision', engineVersion: null, reason: 'unsupported language' };
  const bridge = load({ getAvailability: () => new Promise(done => { resolve = done; }) });
  const pending = bridge.getOcrAvailability().then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  resolve(nativeResult);
  assert.equal(await pending, nativeResult);
});

test('native photo identity, empty result and raw digest are preserved without invented text', async () => {
  const uri = 'file:///private/documents/xiaohe-images/23db793f-4e4a-4d23-9058-efde5b09df6c.jpg';
  const result = { engine: 'mlkit-chinese', engineVersion: 'text-recognition-chinese:16.0.1', imageDigest: 'b'.repeat(64), width: 1024, height: 768, lines: [] };
  let received;
  const bridge = load({ recognize: async value => { received = value; return result; } });
  assert.equal(await bridge.recognizePhoto(uri), result);
  assert.equal(received, uri);
  assert.equal(result.lines.length, 0);
});

test('native timeout is propagated rather than converted to a success or seeded candidate', async () => {
  const error = Object.assign(new Error('识别超时'), { code: 'OCR_TIMEOUT' });
  const bridge = load({ recognize: async () => { throw error; } });
  await assert.rejects(bridge.recognizePhoto('file:///owned/image.jpg'), value => value === error);
});
