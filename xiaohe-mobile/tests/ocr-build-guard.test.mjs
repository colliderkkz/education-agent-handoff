import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOcrReleaseText, mlkitRegistrars } from '../scripts/assert-ocr-release.mjs';

const names = [
  'com.google.mlkit.common.internal.CommonComponentRegistrar',
  'com.google.mlkit.vision.common.internal.VisionCommonRegistrar',
  'com.google.mlkit.vision.text.internal.TextRegistrar',
];
const metadata = name => `<meta-data android:name="com.google.firebase.components:${name}" android:value="com.google.firebase.components.ComponentRegistrar" />`;
const manifest = `<manifest><application><service>${names.map(metadata).join('\n')}</service></application></manifest>`;
const block = (name, constructor = '    1:4:void <init>():0:0 -> <init>') => `${name} -> ${name}:\n# {"id":"sourceFile","fileName":"Registrar.java"}\n${constructor}\n    1:6:java.util.List getComponents():1:1 -> a`;
const module = 'expo.modules.xiaoheocr.XiaoheOcrModule -> y14:\n    1:3:void <init>():25:25 -> <init>\n';
const mapping = (overrides = {}) => [...names.map(name => block(name, overrides[name])), module].join('\n');

test('release guard derives registrar names from merged metadata and accepts actual R8 constructor forms', () => {
  assert.deepEqual(assertOcrReleaseText(manifest, mapping()).registrars, [...names].sort());
  for (const constructor of ['    void <init>() -> <init>', '    1:4:void <init>():0 -> <init>', '    1:4:void <init>():0:0 -> <init>']) {
    assert.doesNotThrow(() => assertOcrReleaseText(manifest, mapping({ [names[0]]: constructor })));
  }
  assert.deepEqual(mlkitRegistrars(`<!-- ${metadata('com.google.mlkit.fake.Comment')} -->${manifest}`), [...names].sort());
  const added = 'com.google.mlkit.future.NewRegistrar';
  assert.throws(() => assertOcrReleaseText(manifest.replace('</service>', `${metadata(added)}</service>`), mapping()), /NewRegistrar.*absent/);
});

test('release guard rejects the observed class-only keep failure for each registrar', () => {
  for (const name of names) assert.throws(() => assertOcrReleaseText(manifest, mapping({ [name]: '' })), /lost its own void <init>/);
});

test('other classes, nonzero arguments, inlined frames and static initializers cannot impersonate the constructor', () => {
  for (const constructor of [
    '    1:4:void com.google.mlkit.internal.Other.<init>():0:0 -> <init>',
    '    1:4:void <init>():0:0 -> a',
    '    1:4:void <init>(java.lang.Object):0:0 -> <init>',
    '    1:4:void <clinit>():0:0 -> <clinit>',
  ]) assert.throws(() => assertOcrReleaseText(manifest, mapping({ [names[0]]: constructor })), /lost its own void <init>/);
  assert.throws(() => assertOcrReleaseText(manifest, mapping({ [names[0]]: '' }) + '\nOther -> Other:\n    void <init>() -> <init>'), /lost its own void <init>/);
});

test('missing or renamed reflective classes, metadata and native module fail closed', () => {
  assert.throws(() => assertOcrReleaseText(manifest, mapping().replace(`${names[0]} -> ${names[0]}:`, `${names[0]} -> a:`)), /was renamed/);
  assert.throws(() => assertOcrReleaseText(manifest, mapping().replace(block(names[0]), '')), /absent/);
  assert.throws(() => assertOcrReleaseText('<manifest/>', mapping()), /no ML Kit/);
  assert.throws(() => assertOcrReleaseText(manifest.replace('android:value=', 'android:wrong='), mapping()), /invalid ML Kit/);
  assert.throws(() => assertOcrReleaseText(manifest, mapping().replace(module, '')), /XiaoheOcrModule/);
  assert.throws(() => assertOcrReleaseText(manifest, mapping().replace(module, 'expo.modules.xiaoheocr.XiaoheOcrModule -> y14:\n')), /XiaoheOcrModule/);
});
