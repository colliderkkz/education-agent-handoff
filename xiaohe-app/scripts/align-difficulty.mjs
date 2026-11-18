/**
 * 把题目难度与任务类型对齐。
 *
 * 用法：node --experimental-strip-types scripts/align-difficulty.mjs
 *
 * 难度用于组卷筛选。如果难度分布与任务类型脱钩，按「基础」筛选时可选题量会
 * 不均衡（曾经是 462/637/611，而每点的基础题只有 10 道）。
 * 让难度严格跟随任务类型（basic→基础、application→巩固、transfer→挑战），
 * 每个知识点就恰好各有 10 道可选，筛选不会误伤。
 *
 * 改的是批次原始文件（content/bank/batch-*.json）—— 学科文件由 merge-bank 重建，
 * 直接改学科文件会被下次 merge 覆盖。
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");
const mapping = { basic: "基础", application: "巩固", transfer: "挑战" };

const files = (await readdir(bankRoot)).filter(name => name.startsWith("batch-") && name.endsWith(".json")).sort();
let changed = 0;
let total = 0;
const distribution = {};
for (const file of files) {
  const path = join(bankRoot, file);
  const items = JSON.parse(await readFile(path, "utf8"));
  let touched = false;
  for (const item of items) {
    total += 1;
    const expected = mapping[item.taskType];
    if (!expected) continue;
    if (item.difficulty !== expected) { item.difficulty = expected; changed += 1; touched = true; }
    distribution[expected] = (distribution[expected] ?? 0) + 1;
  }
  if (touched) await writeFile(path, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ batches: files.length, total, changed, distribution }, null, 2));
