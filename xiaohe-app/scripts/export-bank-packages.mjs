/**
 * 把静态内容库切成内容包，写入移动端的内容包目录。
 *
 * 用法：node --experimental-strip-types scripts/export-bank-packages.mjs
 *
 * 内容包是移动端跨设备分发内容的唯一通道：教研端导出 → 人工拷贝到设备 →
 * 手机「我的 → 题库内容包」导入。内容包有 200 项 / 500 KiB 硬上限，
 * 所以按学科切、按上限再切。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportContentPackage, MAX_CONTENT_PACKAGE_ITEMS } from "../lib/server/content.ts";
import { createSeedWorkspace } from "../lib/seed.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");
const outRoot = join(root, "../xiaohe-mobile/content-packs");

/** 每个学科文件对应一个包名前缀与课程范围。 */
const sources = [
  { file: "chinese.json", slug: "chinese", grade: "四年级", course: "语文" },
  { file: "math.json", slug: "math", grade: "四年级", course: "数学" },
  { file: "english.json", slug: "english", grade: "四年级", course: "英语" },
  { file: "junior-math.json", slug: "junior-math", grade: "九年级", course: "数学" },
  { file: "senior-math.json", slug: "senior-math", grade: "高三", course: "数学" },
];

await mkdir(outRoot, { recursive: true });
const written = [];
for (const source of sources) {
  const items = JSON.parse(await readFile(join(bankRoot, source.file), "utf8"));
  if (!items.length) continue;
  for (let index = 0; index < items.length; index += MAX_CONTENT_PACKAGE_ITEMS) {
    const slice = items.slice(index, index + MAX_CONTENT_PACKAGE_ITEMS);
    const part = Math.floor(index / MAX_CONTENT_PACKAGE_ITEMS) + 1;
    const packageId = `xiaohe-${source.slug}-v1-${part}`;
    const state = createSeedWorkspace("bank-export", "内容库导出");
    // 库题不在工作区里，但导出时按合并后的题集取题。
    const pack = exportContentPackage(state, {
      packageId,
      publisherId: "xiaohe-bank",
      createdAt: "2026-11-01T00:00:00.000Z",
      bank: { version: "bank", digest: "", questions: items },
      questionIds: slice.map(question => question.id),
      grade: source.grade,
    });
    await writeFile(join(outRoot, `${packageId}.json`), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    written.push({ file: `${packageId}.json`, items: pack.items.length, bytes: Buffer.byteLength(JSON.stringify(pack), "utf8"), digest: pack.digest.slice(0, 16) });
  }
}

console.log(JSON.stringify({ packages: written.length, written }, null, 2));
