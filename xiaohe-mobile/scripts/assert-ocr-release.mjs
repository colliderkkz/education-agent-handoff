import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleClass = 'expo.modules.xiaoheocr.XiaoheOcrModule';
const registrarPrefix = 'com.google.firebase.components:';
const registrarType = 'com.google.firebase.components.ComponentRegistrar';
const fail = message => { throw new Error(`OCR release guard: ${message}`); };

// Kept outside generated android/. An APK graph must actually build this local
// module and run R8; otherwise an old mapping file is not evidence for this APK.
export const ocrGradleGuard = `gradle.taskGraph.whenReady { graph ->
  if (gradle.parent != null) return
  def root = gradle.rootProject
  def ocr = root.findProject(':xiaohe-ocr')
  def expected = new File(root.projectDir.parentFile, 'modules/xiaohe-ocr/android').canonicalFile
  if (ocr == null || ocr.projectDir.canonicalFile != expected) {
    throw new GradleException('OCR release guard: local :xiaohe-ocr source project is missing or points elsewhere.')
  }
  def compile = ocr.tasks.findByName('compileReleaseKotlin')
  def shrink = root.findProject(':app')?.tasks?.findByName('minifyReleaseWithR8')
  if (compile == null || !graph.hasTask(compile) || shrink == null || !graph.hasTask(shrink)) {
    throw new GradleException('OCR release guard: OCR compilation and release R8 must both participate in this APK task graph.')
  }
  root.logger.lifecycle('OCR release guard: local OCR source and release R8 verified in APK task graph.')
}
`;

/** The input is AGP's merged XML, not a hand-maintained list of dependencies. */
export function mlkitRegistrars(manifest) {
  const found = new Set();
  for (const tag of manifest.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<meta-data\b[^>]*>/g)) {
    const attributes = new Map([...tag[0].matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1], match[3]]));
    const name = attributes.get('android:name');
    if (!name?.startsWith(`${registrarPrefix}com.google.mlkit.`)) continue;
    const className = name.slice(registrarPrefix.length);
    if (!/^com\.google\.mlkit\.[\w.$]+$/.test(className) || attributes.get('android:value') !== registrarType) fail('invalid ML Kit registrar metadata in the merged manifest.');
    found.add(className);
  }
  if (!found.size) fail('no ML Kit component registrars in the merged release manifest.');
  return [...found].sort();
}

export function assertOcrReleaseText(manifest, mapping) {
  const registrars = mlkitRegistrars(manifest);
  const required = new Set([...registrars, moduleClass]);
  const classes = new Map();
  let current;
  for (const line of mapping.split(/\r?\n/)) {
    const header = /^(\S+) -> (\S+):$/.exec(line);
    if (header) {
      current = required.has(header[1]) ? { name: header[1], renamed: header[2], constructor: false } : undefined;
      if (current) {
        if (classes.has(current.name)) fail(`duplicate mapping block for ${current.name}.`);
        classes.set(current.name, current);
      }
    } else if (current && /^\s+(?:\d+:\d+:)?void <init>\(\)(?::\d+(?::\d+)?)? -> <init>$/.test(line)) {
      // A qualified OtherClass.<init>() frame or an inlined -> a method does not
      // retain this class's reflection-accessible zero-argument constructor.
      current.constructor = true;
    }
  }
  for (const name of registrars) {
    const klass = classes.get(name);
    if (!klass) fail(`registrar ${name} is absent from release R8 mapping.`);
    if (klass.renamed !== name) fail(`registrar ${name} was renamed to ${klass.renamed}; manifest reflection would fail.`);
    if (!klass.constructor) fail(`registrar ${name} lost its own void <init>() constructor; refuse this APK.`);
  }
  if (!classes.get(moduleClass)?.constructor) fail('XiaoheOcrModule and its constructor are absent from the release mapping.');
  return { registrars, moduleClass };
}

export async function assertOcrRelease(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const build = join(root, 'android', 'app', 'build');
  const [manifest, mapping] = await Promise.all([
    readFile(join(build, 'intermediates', 'merged_manifests', 'release', 'processReleaseManifest', 'AndroidManifest.xml'), 'utf8'),
    readFile(join(build, 'outputs', 'mapping', 'release', 'mapping.txt'), 'utf8'),
  ]);
  const result = assertOcrReleaseText(manifest, mapping);
  console.log(`OCR release guard: ${result.registrars.length} manifest registrars retain names and no-arg constructors; native OCR module is present.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await assertOcrRelease(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
