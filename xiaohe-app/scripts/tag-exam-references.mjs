/**
 * 给上海初高中的原创题挂上「考点对应」—— 指向上海市教育考试院官方点评里的出处。
 *
 * 这里只标**考点与题号**，不复述真题原文；出处与分级见 lib/exam-references.ts。
 * 用法：node --experimental-strip-types scripts/tag-exam-references.mjs
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { examTopics } from "../lib/exam-references.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");

/** 知识点 → 考点。取该考点里**最近且有题号**的一条作为代表出处（题号级最可核实）。 */
const refByKnowledge = new Map();
for (const topic of examTopics) {
  const concrete = [...topic.hits].reverse().find(hit => hit.questionNo);
  const pick = concrete ?? topic.hits[0];
  if (!pick) continue;
  // 方法类考点说的是「这类题常用这个思想」；具体题型才说「第 N 题的考点」。
  const label = topic.kind === "method"
    ? (pick.questionNo ? `${pick.year} 年上海中考数学第 ${pick.questionNo} 题等采用的${topic.label}` : `${pick.year} 年上海中考数学采用的${topic.label}`)
    : (pick.questionNo ? `${pick.year} 年上海中考数学第 ${pick.questionNo} 题的考点：${topic.label}` : `${pick.year} 年上海中考数学的${pick.topic}（官方点评未点名题号）`);
  for (const knowledgeId of topic.knowledgeIds) {
    refByKnowledge.set(knowledgeId, {
      topicKey: topic.key,
      label,
      sourceUrl: pick.source.url,
      sourceTier: pick.source.tier,
      sourceTitle: pick.source.title,
    });
  }
}

const files = (await readdir(bankRoot)).filter(name => name.startsWith("batch-") && name.endsWith(".json")).sort();
let tagged = 0;
let touched = 0;
for (const file of files) {
  const path = join(bankRoot, file);
  const items = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(items)) continue;
  let changed = false;
  for (const item of items) {
    if (!/^math-[js]-/.test(String(item.knowledgeId ?? ""))) continue;
    const ref = refByKnowledge.get(item.knowledgeId);
    if (!ref) continue;
    if (JSON.stringify(item.examRef) === JSON.stringify(ref)) { tagged += 1; continue; }
    item.examRef = ref;
    tagged += 1;
    changed = true;
  }
  if (changed) { await writeFile(path, `${JSON.stringify(items, null, 2)}\n`, "utf8"); touched += 1; }
}
console.log(JSON.stringify({ files: files.length, touched, tagged, topics: examTopics.length, knowledgePoints: refByKnowledge.size }, null, 2));
