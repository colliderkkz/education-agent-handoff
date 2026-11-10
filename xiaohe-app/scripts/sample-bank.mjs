import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bank = [];
for (const subject of ["chinese", "math", "english"]) {
  bank.push(...JSON.parse(await readFile(join(root, "content/bank", `${subject}.json`), "utf8")));
}

const ids = process.argv.slice(2);
for (const id of ids) {
  const q = bank.find(item => item.id === id || item.id.startsWith(id));
  if (!q) { console.log(`--- ${id}: NOT FOUND ---`); continue; }
  console.log(`\n=== ${q.id} ===`);
  console.log(`知识点 ${q.knowledgeId} | ${q.taskType} | ${q.contextId} | 难度 ${q.difficulty}`);
  console.log(`题干: ${q.text}`);
  console.log(`答案: ${q.answer}${q.unit ? " " + q.unit : ""}`);
  console.log(`步骤: ${q.steps.join(" / ")}`);
  console.log(`提示: ${q.hint}`);
  console.log(`另一解法: ${q.alternative}`);
  console.log(`前置: ${q.prerequisites.join(", ")}`);
  if (q.image) console.log(`配图: ${q.image}`);
}
