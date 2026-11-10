/**
 * 把各批次的题库合并进学科文件，并重算 manifest。
 *
 * 用法：node --experimental-strip-types scripts/merge-bank.mjs
 *
 * 批次文件：content/bank/batch-<unitId>.json（由内容生产批次产出）
 * 学科文件：content/bank/{chinese,math,english,junior-math,senior-math}.json（合并产物，提交进仓库）
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");
/** 学科文件与它覆盖的知识点范围。 */
const bankFiles = [
  { file: "chinese.json", matches: id => id.startsWith("chinese-") },
  { file: "math.json", matches: id => id.startsWith("math-") && !id.startsWith("math-j-") && !id.startsWith("math-s-") },
  { file: "english.json", matches: id => id.startsWith("english-") },
  { file: "junior-math.json", matches: id => id.startsWith("math-j-") },
  { file: "senior-math.json", matches: id => id.startsWith("math-s-") },
];

const files = (await readdir(bankRoot)).filter(name => name.startsWith("batch-") && name.endsWith(".json")).sort();
const buckets = new Map(bankFiles.map(entry => [entry.file, []]));
for (const file of files) {
  const items = JSON.parse(await readFile(join(bankRoot, file), "utf8"));
  if (!Array.isArray(items)) throw new Error(`${file} 必须是数组`);
  for (const item of items) {
    const target = bankFiles.find(entry => entry.matches(item.knowledgeId));
    if (!target) throw new Error(`${file} 中的知识点无法归入学科文件：${item.knowledgeId}`);
    buckets.get(target.file).push(item);
  }
}

const counts = {};
const all = [];
for (const { file } of bankFiles) {
  const items = buckets.get(file).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await writeFile(join(bankRoot, file), `${JSON.stringify(items, null, 2)}\n`, "utf8");
  counts[file.replace(".json", "")] = items.length;
  all.push(...items);
}

// 库的版本摘要：覆盖题目的全部正文（题面、答案、步骤、提示、配图等），
// 任何一题改动 —— 哪怕只改了解题步骤 —— 都会改变它。
const digest = createHash("sha256").update(JSON.stringify(
  all.map(question => { const { status, ...body } = question; return body; }).sort((a, b) => String(a.id).localeCompare(String(b.id))),
)).digest("hex");

const manifest = { version: `2026.11.${files.length}`, digest, counts: { ...counts, total: all.length } };
await writeFile(join(bankRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ batches: files.length, counts: manifest.counts, digest: manifest.digest.slice(0, 16) }, null, 2));
