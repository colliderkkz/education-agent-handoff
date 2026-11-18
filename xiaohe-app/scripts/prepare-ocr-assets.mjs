import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Runtime and language data are served from the same origin, not a third-party CDN.
const target = resolve('public/ocr');
await mkdir(target, { recursive: true });
const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map(name => [`node_modules/tesseract.js-core/${name}`, name]),
  ...['chi_sim', 'eng'].map(lang => [`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `${lang}.traineddata.gz`]),
];
for (const [from, name] of assets) await copyFile(resolve(from), resolve(target, name));
