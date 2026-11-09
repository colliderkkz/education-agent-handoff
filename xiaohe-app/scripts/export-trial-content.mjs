#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeedWorkspace } from '../lib/seed.ts';
import { trialQuestions } from '../lib/trial-content.ts';
import { exportContentPackage, parseContentPackage } from '../lib/server/content.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../xiaohe-mobile/content-packs/xiaohe-basic-trial-v1.json');
const state = createSeedWorkspace('trial-content-export', '本地内容编制');
state.questions = trialQuestions();
const content = exportContentPackage(state, {
  packageId: 'xiaohe-basic-trial-v1', publisherId: 'xiaohe-local-trial',
  createdAt: '2026-10-27T00:00:00.000Z',
});
const serialized = `${JSON.stringify(content, null, 2)}\n`;
parseContentPackage(serialized);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized);
console.log(JSON.stringify({ output, items: content.items.length, digest: content.digest, teachingValidation: content.teachingValidation }, null, 2));
