/**
 * 静态内容库质量校验。
 *
 * 用法：node --experimental-strip-types scripts/validate-bank.mjs
 *
 * 这是一道内容生产的闸门：题目由批量工作流产出，错误必须在这里被拦下，
 * 而不是等到组卷或导出内容包时才失败。最后一项检查直接调用生产代码的
 * parseContentPackage —— 它复刻了「题干全库唯一」「数字同形必须同族」
 * 「审核人分离」「来源范围必填」「摘要自洽」等全部规则。
 */
import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeAnswer } from "../lib/grading.ts";
import { parseChoices } from "../lib/choice.ts";
import { canonicalStringify, parseContentPackage, sha256 } from "../lib/server/content.ts";
import { allKnowledgeIds, catalogKnowledgeIds, stageOfKnowledge } from "../lib/types.ts";
import { BANK_CHOICE_PER_POINT, BANK_CONTEXT_MIN, BANK_MIX, BANK_MIN_FAMILIES_PER_POINT, BANK_TARGET_PER_POINT, SHANGHAI_CHOICE_PER_POINT, SHANGHAI_CONTEXT_MIN, SHANGHAI_MIX, SHANGHAI_TARGET_PER_POINT } from "../lib/bank-spec.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bankRoot = join(root, "content/bank");
/** 题库文件与它覆盖的知识点范围。 */
const bankFiles = [
  { file: "chinese.json", matches: id => id.startsWith("chinese-") },
  { file: "math.json", matches: id => id.startsWith("math-") && !id.startsWith("math-j-") && !id.startsWith("math-s-") },
  { file: "english.json", matches: id => id.startsWith("english-") },
  { file: "junior-math.json", matches: id => id.startsWith("math-j-") },
  { file: "senior-math.json", matches: id => id.startsWith("math-s-") },
];
const taskTypes = ["basic", "application", "transfer", "choice"];
const difficulties = ["基础", "巩固", "挑战"];

/** 按学段取该知识点的编制规格：小学与初高中的题量密度不同。 */
function specFor(knowledgeId) {
  const stage = stageOfKnowledge(knowledgeId);
  return stage === "primary"
    ? { target: BANK_TARGET_PER_POINT, mix: BANK_MIX, contexts: BANK_CONTEXT_MIN, choice: BANK_CHOICE_PER_POINT }
    : { target: SHANGHAI_TARGET_PER_POINT, mix: SHANGHAI_MIX, contexts: SHANGHAI_CONTEXT_MIN, choice: SHANGHAI_CHOICE_PER_POINT };
}
/** 选择题：答案是一个字母的题。 */
const isChoice = (question) => /^[A-D]$/.test(String(question.answer ?? "").trim());

const problems = [];
const notes = [];
const fail = (message) => { problems.push(message); };

const bank = [];
for (const { file, matches } of bankFiles) {
  let items;
  try { items = JSON.parse(await readFile(join(bankRoot, file), "utf8")); }
  catch (error) { fail(`无法读取 ${file}：${error.message}`); continue; }
  if (!Array.isArray(items)) { fail(`${file} 必须是数组`); continue; }
  for (const item of items) {
    if (!matches(item.knowledgeId)) fail(`${file} 中的题目 ${item.id} 不属于该学科范围`);
    bank.push(item);
  }
}

/** 与 lib/server/content.ts 的 ContentOperation.identity 完全一致的规范化算法。 */
const fingerprint = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const shapeOf = (text) => fingerprint(text).replace(/[+-]?\d+(?:\.\d+)?/g, "#");
const identifier = /^[A-Za-z0-9_.:-]{1,150}$/;

/**
 * 安全表达式求值：递归下降，只支持数字、+ - × ÷ 与括号，不使用 eval。
 * 这样 (12 + 8) × 2 = 40 这类几何题的两步算式也能自动验算。
 */
function parseArithmetic(source) {
  const text = source.replace(/[−–—]/g, "-").replace(/[×✕]/g, "*").replace(/[÷∕]/g, "/").replace(/（/g, "(").replace(/）/g, ")");
  let position = 0;
  const skip = () => { while (position < text.length && /\s/.test(text[position])) position += 1; };
  const factor = () => {
    skip();
    // 一元负号：-5 + 5 = 0、2 - 6 = -4 这类写法要能验算。
    if (text[position] === "-") { position += 1; return -factor(); }
    if (text[position] === "+") { position += 1; return factor(); }
    if (text[position] === "(") {
      position += 1;
      const value = expression();
      skip();
      if (text[position] !== ")") throw new Error("缺少右括号");
      position += 1;
      return value;
    }
    const match = /^\d+(?:\.\d+)?/.exec(text.slice(position));
    if (!match) throw new Error("不是数字");
    position += match[0].length;
    return Number(match[0]);
  };
  const term = () => {
    let value = factor();
    for (;;) {
      skip();
      const operator = text[position];
      if (operator !== "*" && operator !== "/") return value;
      position += 1;
      const right = factor();
      value = operator === "*" ? value * right : right === 0 ? NaN : value / right;
    }
  };
  const expression = () => {
    let value = term();
    for (;;) {
      skip();
      const operator = text[position];
      if (operator !== "+" && operator !== "-") return value;
      position += 1;
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
  };
  const value = expression();
  skip();
  if (position !== text.length) throw new Error("表达式尾部有多余内容");
  return value;
}

/**
 * 解析 steps[0] 的规范等式「表达式 = 数字」。
 * 运算符接受常见的数学符号（减号 U+2212、乘号 U+00D7 等），写题时不必强行用 ASCII。
 */
const equation = /^(.+?)\s*=\s*(-?\d+(?:\.\d+)?)\s*[。．.]?\s*$/;
function evaluateEquation(text) {
  const match = equation.exec(String(text ?? "").trim());
  if (!match) return null;
  let actual;
  try { actual = parseArithmetic(match[1]); }
  catch { return null; }
  const expected = Number(match[2]);
  const operands = (match[1].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const operators = (match[1].match(/[+\-*/]/g) ?? []);
  return { actual, expected, operands, operatorCount: operators.length, operators };
}

/**
 * 凑式检测：这个等式其实没有做任何计算。
 * 「5 + 0 = 5」「12 - 0 = 12」是作者为了满足格式要求硬凑的，必须重写；
 * 「a × 1 = a」「a - a = 0」也几乎没有计算量，只作提示。
 */
function fillerKind(computed) {
  const { operands, operators, actual } = computed;
  if (operators.length !== 1 || operands.length !== 2) return null;
  const [operator] = operators;
  if ((operator === "+" || operator === "-") && operands.includes(0)) {
    const other = operands.find(value => value !== 0);
    if (other !== undefined && Math.abs(actual - other) <= 1e-9) return "zero";
  }
  if ((operator === "*" || operator === "/") && operands.includes(1)) {
    const other = operands.find(value => value !== 1);
    if (other !== undefined && Math.abs(actual - other) <= 1e-9) return "one";
  }
  if (operator === "-" && operands[0] === operands[1] && Math.abs(actual) <= 1e-9) return "self";
  return null;
}

const byKnowledge = new Map();
for (const question of bank) {
  const list = byKnowledge.get(question.knowledgeId) ?? [];
  list.push(question);
  byKnowledge.set(question.knowledgeId, list);
}

// 1. 覆盖范围与题量（按学段取规格：小学 32 道 = 30 解答 + 2 选择；初高中 20 道 = 15 解答 + 5 选择）
for (const knowledgeId of catalogKnowledgeIds) {
  const spec = specFor(knowledgeId);
  const list = byKnowledge.get(knowledgeId) ?? [];
  if (list.length !== spec.target) fail(`${knowledgeId} 有 ${list.length} 道题，应为 ${spec.target} 道`);
  // 任务类型配比只统计非选择题；选择题单算。
  const mix = { basic: 0, application: 0, transfer: 0 };
  let choices = 0;
  for (const question of list) {
    if (isChoice(question)) { choices += 1; continue; }
    if (taskTypes.includes(question.taskType)) mix[question.taskType] += 1;
  }
  for (const taskType of taskTypes) {
    if (mix[taskType] !== spec.mix[taskType]) fail(`${knowledgeId} 的 ${taskType} 题有 ${mix[taskType]} 道，应为 ${spec.mix[taskType]} 道`);
  }
  if (choices !== spec.choice) fail(`${knowledgeId} 的选择题有 ${choices} 道，应为 ${spec.choice} 道`);
}
for (const knowledgeId of byKnowledge.keys()) {
  if (!allKnowledgeIds.includes(knowledgeId)) fail(`题库里出现不在教材范围内的知识点：${knowledgeId}`);
}

// 2/3/4/5. 唯一性、题干规范化唯一、数字同形同族、题族覆盖
const ids = new Map();
const families = new Map();
const fingerprints = new Map();
const shapes = new Map();
for (const question of bank) {
  const id = String(question.id ?? "");
  if (!identifier.test(id)) fail(`题号不符合标识规范：${id}`);
  if (ids.has(id)) fail(`题号重复：${id}`);
  ids.set(id, question);
  const family = String(question.familyId ?? "");
  if (!identifier.test(family)) fail(`题族不符合标识规范：${family}`);
  const fingerprintValue = fingerprint(String(question.text ?? ""));
  if (fingerprints.has(fingerprintValue)) fail(`题干规范化后重复：${id} 与 ${fingerprints.get(fingerprintValue)}`);
  fingerprints.set(fingerprintValue, id);
  const shape = shapeOf(String(question.text ?? ""));
  const priorFamily = shapes.get(shape);
  if (priorFamily !== undefined && priorFamily !== family) fail(`题目 ${id} 与同形题目仅数字有别，必须沿用同一题族`);
  shapes.set(shape, family);
  if (!families.has(question.knowledgeId)) families.set(question.knowledgeId, new Set());
  families.get(question.knowledgeId).add(family);
}
for (const [knowledgeId, set] of families) {
  // 题族数不可能超过该知识点的题量：初高中每点 15 道题，门槛取 min(24, 题量)，
  // 否则一题一族的知识点永远无法通过这道检查。
  const need = Math.min(BANK_MIN_FAMILIES_PER_POINT, specFor(knowledgeId).target);
  if (set.size < need) fail(`${knowledgeId} 只有 ${set.size} 个题族，至少需要 ${need} 个（题族不足时五星门槛永远达不到）`);
}

// 6/7. 情境覆盖与任务类型联动
for (const [knowledgeId, list] of byKnowledge) {
  const contexts = { basic: new Set(), application: new Set(), transfer: new Set(), choice: new Set() };
  for (const question of list) {
    if (!taskTypes.includes(question.taskType)) fail(`${question.id} 的任务类型无效：${question.taskType}`);
    if (!question.contextId) fail(`${question.id} 缺少情境标识`);
    else contexts[question.taskType]?.add(question.contextId);
    if (String(question.contextId ?? "").length > 100) fail(`${question.id} 的情境标识超过 100 字符`);
  }
  for (const taskType of taskTypes) {
    const need = specFor(knowledgeId).contexts[taskType];
    const got = contexts[taskType].size;
    if (got < need) fail(`${knowledgeId} 的 ${taskType} 情境只有 ${got} 个，至少需要 ${need} 个`);
  }
}

// 8/9/10/11/13. 答案、算术、步骤、提示、前置知识、字段
const allowedPrerequisites = new Set(allKnowledgeIds);
for (const question of bank) {
  const id = String(question.id);
  if (!difficulties.includes(question.difficulty)) fail(`${id} 的难度无效：${question.difficulty}`);
  if (!Array.isArray(question.steps) || !question.steps.length) fail(`${id} 缺少解题步骤`);
  if (question.steps?.some(step => typeof step !== "string" || !step.trim() || step.length > 1500)) fail(`${id} 的解题步骤格式不正确`);
  if (!question.steps?.some(step => step.includes("答："))) fail(`${id} 的解题步骤末条应包含「答：」`);
  if (!String(question.hint ?? "").trim()) fail(`${id} 缺少提示`);
  if (!String(question.alternative ?? "").trim()) fail(`${id} 缺少另一种解法`);
  if (String(question.alternative ?? "").trim() === String(question.steps?.[0] ?? "").trim()) fail(`${id} 的另一种解法与首步完全相同`);
  if (!Array.isArray(question.prerequisites) || !question.prerequisites.length) fail(`${id} 缺少前置知识标注`);
  for (const prerequisite of question.prerequisites ?? []) {
    if (!allowedPrerequisites.has(prerequisite)) fail(`${id} 的前置知识不在教材范围内：${prerequisite}`);
  }
  if (!String(question.source ?? "").trim()) fail(`${id} 缺少来源`);
  if (!String(question.sourceScope ?? "").trim()) fail(`${id} 缺少使用范围`);
  if (!String(question.authorId ?? "").trim() || !String(question.reviewerId ?? "").trim()) fail(`${id} 缺少作者或审核标识`);
  if (question.authorId === question.reviewerId) fail(`${id} 的审核人与作者相同`);
  if (question.status !== "published") fail(`${id} 的状态应为 published`);

  const numeric = /^[+-]?\d+(?:\.\d+)?$/.test(String(question.answer ?? "").trim());
  if (numeric) {
    if (!gradeAnswer(String(question.answer), question)) fail(`${id} 的参考答案与自身不符`);
    if (gradeAnswer(String(Number(question.answer) + 1), question)) fail(`${id} 的判分过宽，任何数字都会被判对`);
    // 解题步骤里所有能验算的等式 —— 不限于首步：有些题第一步是列式，
    // 真正的算式在第二、三步，硬要求首步写成等式只会逼出「5 + 0 = 5」这种凑式。
    const equations = (question.steps ?? [])
      .map(step => ({ step, computed: evaluateEquation(step) }))
      .filter(item => item.computed);
    for (const { computed } of equations) {
      if (Math.abs(computed.actual - computed.expected) > 1e-9) {
        fail(`${id} 的等式不成立：${computed.operands.join(" ")} 算得 ${computed.actual}，与等号右边不符`);
      }
    }
    const matching = equations.filter(item => Math.abs(item.computed.actual - Number(question.answer)) <= 1e-9);
    if (!matching.length) {
      // 纯读图题的数据在配图上，或题目靠定理直接得出答案，无法写成等式，交人工复核。
      notes.push(`${id} 的步骤里没有能算出参考答案的等式，请人工确认答案`);
    } else {
      const stem = String(question.text ?? "");
      for (const { computed } of matching) {
        const filler = fillerKind(computed);
        if (filler === "zero") fail(`${id} 的等式是凑式（加上或减去 0 得到原数），没有实际计算，请重写解题步骤`);
        else if (filler) notes.push(`${id} 的等式几乎没有计算量（${filler}），请确认`);
        // 等式左边的第一个数字是题目的核心数，最好出现在题干里。
        // 其余操作数可以是换算常数（2、10、10000）或中间量（如 300 − 200 里的 200）。
        const leading = computed.operands[0];
        if (leading === undefined || !stem.includes(String(leading))) notes.push(`${id} 的等式第一个操作数没有出现在题干中`);
      }
    }
    if (String(question.unit ?? "").trim() && !String(question.text ?? "").includes(String(question.unit).trim()) && !String(question.steps ?? []).some(step => String(step).includes(String(question.unit).trim()))) {
      fail(`${id} 的单位「${question.unit}」没有出现在题干或解题步骤中`);
    }
  }
}

// 12. 语义近似查重：同知识点内字符 3-gram 的 Jaccard 相似度
function trigrams(text) {
  const value = fingerprint(text);
  const set = new Set();
  for (let index = 0; index + 3 <= value.length; index += 1) set.add(value.slice(index, index + 3));
  return set;
}
for (const [knowledgeId, list] of byKnowledge) {
  const grams = list.map(question => trigrams(question.text ?? ""));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      let shared = 0;
      for (const gram of grams[i]) if (grams[j].has(gram)) shared += 1;
      const union = grams[i].size + grams[j].size - shared;
      const similarity = union ? shared / union : 0;
      if (similarity > 0.85) notes.push(`${knowledgeId}：${list[i].id} 与 ${list[j].id} 题意相似度 ${similarity.toFixed(2)}，请确认是否重复`);
    }
  }
}

// 14. 配图存在性；题干提到「如图」却没有配图，也算缺陷 —— 学生会去找一张不存在的图。
for (const question of bank) {
  const mentionsFigure = /如图|图中|下图|右图|图\s*[（(]/.test(String(question.text ?? ""));
  if (!question.image) {
    if (mentionsFigure) fail(`${question.id} 的题干提到「如图」却没有配图，请补图或改写题干`);
    continue;
  }
  const relative = String(question.image).replace(/^\/illustrations\//, "");
  try {
    await readFile(join(root, "public/illustrations", relative), "utf8");
  } catch {
    fail(`${question.id} 的配图文件不存在：${question.image}`);
  }
}

// 15. 措辞合规：静态库题目必须声明未逐题人工复核
for (const question of bank) {
  if (!String(question.sourceScope ?? "").includes("未人工逐题复核")) fail(`${question.id} 的使用范围必须声明「未人工逐题复核」`);
  if (!String(question.reviewNote ?? "").includes("未经逐题人工复核")) fail(`${question.id} 的审核说明必须声明「未经逐题人工复核」`);
}

// 15b. 选择题答案分布：同一单元的字母答案不能全部相同，否则选项位置会泄露答案。
const letterAnswers = new Map();
for (const question of bank) {
  const answer = String(question.answer ?? "").trim();
  if (!/^[A-D]$/.test(answer)) continue;
  const unit = String(question.knowledgeId).split("-").slice(0, 3).join("-");
  const list = letterAnswers.get(unit) ?? [];
  list.push(answer);
  letterAnswers.set(unit, list);
}
for (const [unit, answers] of letterAnswers) {
  if (answers.length >= 2 && new Set(answers).size === 1) fail(`${unit} 的 ${answers.length} 道选择题答案全是 ${answers[0]}，选项位置会泄露答案`);
}

// 15c. 选择题本身：选项要能被生产代码解析出来，答案与选项必须对得上。
// 两种合法写法：
//   1) 答案是字母（A—D）—— 学生选字母，判分只认这一个字母；
//   2) 答案是选项内容（如英语选词题答 "tall"）—— 学生提交的仍是字母，
//      判分器会把字母映射回选项内容再比较。
// 两种之外的情况（题干有选项、答案却是别的东西）会渲染成单选却永远判错，必须改。
// 直接调用 lib/choice.ts —— 学生端与手机端用的是同一个解析器，这里过了才说明卷面能渲染成单选。
for (const question of bank) {
  const answer = String(question.answer ?? "").trim();
  const choices = parseChoices(String(question.text ?? ""));
  const letterAnswer = /^[A-D]$/.test(answer);
  if (!letterAnswer) {
    if (choices.length < 2) continue;
    // 答案是选项内容之一：判分器会把字母映射回来，必须能对上。
    const matched = choices.some(choice => gradeAnswer(choice.text, question) && !/^[A-D]$/i.test(choice.text));
    if (!matched) fail(`${question.id} 的题干里有 ${choices.length} 个选项，但参考答案既不是字母也不等于任何一个选项，卷面会渲染成单选却永远判错`);
    continue;
  }
  if (choices.length < 2) fail(`${question.id} 的答案是选项字母，但题干里解析不出选项`);
  if (!choices.some(choice => choice.key === answer)) fail(`${question.id} 的正确答案 ${answer} 不在解析出的选项里`);
  // 判分器只能认这一个字母：选错任何一个字母都要判错。
  for (const choice of choices) {
    const judged = gradeAnswer(choice.key, question);
    if (judged !== (choice.key === answer)) fail(`${question.id} 的选项 ${choice.key} 判分结果不对（正确答案 ${answer}）`);
  }
}

// 16. 端到端：按学科切成 ≤200 题的内容包，逐包走生产代码的解析与校验
const courseScopeByFile = {
  "chinese.json": { grade: "四年级", course: "语文" },
  "math.json": { grade: "四年级", course: "数学" },
  "english.json": { grade: "四年级", course: "英语" },
  "junior-math.json": { grade: "九年级", course: "数学" },
  "senior-math.json": { grade: "高三", course: "数学" },
};
for (const { file, matches } of bankFiles) {
  const items = bank.filter(question => matches(question.knowledgeId));
  if (!items.length) continue;
  const scope = courseScopeByFile[file];
  for (let index = 0; index < items.length; index += 200) {
    const slice = items.slice(index, index + 200);
    const pack = {
      schemaVersion: 1, kind: "xiaohe-content", trust: "unsigned", teachingValidation: "unvalidated-trial",
      packageId: `validate-${file.replace(".json", "")}-${index / 200 + 1}`, publisherId: "validate-bank", createdAt: "2026-11-01T00:00:00.000Z",
      courseScope: scope, items: slice, withdrawals: [], digest: "",
    };
    pack.digest = sha256(canonicalStringify({ ...pack, digest: undefined }));
    try { parseContentPackage(pack); }
    catch (error) { fail(`内容包解析失败（${file} 第 ${index / 200 + 1} 包）：${error.message}`); }
  }
}

const summary = {
  total: bank.length,
  knowledgePoints: byKnowledge.size,
  families: [...families.values()].reduce((sum, set) => sum + set.size, 0),
  problems: problems.length,
  notes: notes.length,
};
console.log(JSON.stringify(summary, null, 2));
if (problems.length) {
  // 按问题模式分组输出：多批次并行生产时，能一眼看出是某个知识点的个别问题，
  // 还是某一类规则的系统性问题。
  const groups = new Map();
  for (const problem of problems) {
    const key = problem
      .replace(/\b(chinese|math|english)-[0-9a-z-]+/g, "<知识点>")
      .replace(/bank-[a-z0-9-]+/g, "<题号>")
      .replace(/「[^」]*」/g, "「…」")
      .replace(/\d+/g, "N");
    const group = groups.get(key) ?? { count: 0, samples: [] };
    group.count += 1;
    if (group.samples.length < 3) group.samples.push(problem);
    groups.set(key, group);
  }
  console.error(`\n题库校验未通过（${problems.length} 项，${groups.size} 类）：`);
  for (const [key, group] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    console.error(`\n [${group.count} 项] ${key}`);
    for (const sample of group.samples) console.error(`    - ${sample}`);
  }
  process.exitCode = 1;
} else {
  console.log("\n题库校验通过。");
}
for (const note of notes.slice(0, 20)) console.log(` · 提示：${note}`);
