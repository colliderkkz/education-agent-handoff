import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bank = [];
for (const subject of ["chinese", "math", "english"]) {
  bank.push(...JSON.parse(await readFile(join(root, "content/bank", `${subject}.json`), "utf8")));
}
const isMath = q => q.knowledgeId.startsWith("math-");
const math = bank.filter(isMath);
const open = bank.filter(q => !isMath(q));
const equationFirst = q => /^\s*.+?\s*=\s*\d+(\.\d+)?\s*[。．.]?\s*$/.test(q.steps[0] ?? "");

const stats = list => {
  const s = list.map(q => q.text.length).sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], avg: Math.round(s.reduce((p, c) => p + c, 0) / s.length) };
};

console.log("总题数", bank.length, "| 数学", math.length, "| 开放题", open.length);
console.log("数学题首步为等式:", math.filter(equationFirst).length, "/", math.length);
console.log("开放题首步误写为等式:", open.filter(equationFirst).length, "(应为 0)");
console.log("开放题 answer 含『示例』:", open.filter(q => q.answer.includes("示例")).length);
console.log("开放题 answer 含『如』或『例如』:", open.filter(q => /[如例]/.test(q.answer)).length);
console.log("开放题 answer 含冒号引导的多种可能:", open.filter(q => q.answer.includes("：") || q.answer.includes(":")).length);
console.log("题干长度", JSON.stringify(stats(bank)));
console.log("语文题干长度", JSON.stringify(stats(open.filter(q => q.knowledgeId.startsWith("chinese-")))));
console.log("英语题干长度", JSON.stringify(stats(open.filter(q => q.knowledgeId.startsWith("english-")))));
console.log("开放题 answer 长度", JSON.stringify(stats(open)));
console.log("steps 条数分布", JSON.stringify(bank.reduce((m, q) => { m[q.steps.length] = (m[q.steps.length] || 0) + 1; return m; }, {})));
console.log("prerequisites 指向其他知识点的比例:", (bank.filter(q => q.prerequisites.some(p => p !== q.knowledgeId)).length / bank.length * 100).toFixed(1) + "%");
const withImage = bank.filter(q => q.image);
console.log("带配图的题:", withImage.length, "| 覆盖知识点:", new Set(withImage.map(q => q.knowledgeId)).size);
console.log("难度分布", JSON.stringify(bank.reduce((m, q) => { m[q.difficulty] = (m[q.difficulty] || 0) + 1; return m; }, {})));
console.log("hint 长度中位:", stats(bank.map(q => ({ text: q.hint }))).median);
console.log("alternative 长度中位:", stats(bank.map(q => ({ text: q.alternative }))).median);
const dupHint = bank.filter(q => q.hint.trim() === q.alternative.trim()).length;
console.log("hint 与 alternative 完全相同:", dupHint);
