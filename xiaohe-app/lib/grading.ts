import type { Question } from "./types.ts";
import { parseChoices } from "./choice.ts";

/**
 * 统一数学写法：数学减号 U+2212、各种破折号、≤/≥ 全角形式，
 * 学生用键盘敲出来的和参考答案里印的不一样，也要算对。
 */
function unifyMath(value: string): string {
  return value
    .replace(/[−–—―ー]/g, "-")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[﹒]/g, ".")
    // 上标与幂号写法不同（f⁻¹ 与 f^-1、x² 与 x^2）视为同一个式子。
    .replace(/\^/g, "");
}

/**
 * 常见几何术语的等价写法：中文卷里「直角」也写作 90°，「平行」写作 ∥。
 * 两边统一成同一种写法后再比较。
 */
function normalizeTerms(value: string): string {
  return value
    .replace(/直角/g, "90°")
    .replace(/(\d+)\s*度/g, "$1°")
    .replace(/平行/g, "∥")
    .replace(/垂直/g, "⊥")
    .replace(/不等于/g, "≠");
}

/** 短文本答案里可以忽略的填充字符：连接词、几何量词、点名字母。 */
const answerFillerChars = new Set([
  ..."在是的互相且或都为这那它有和与于所两三个角形直线上中点边叫作",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."∠△⊙∥∽≡∵∴°′″",
]);
/** 否定字：出现它们说明学生说的是反话，不能当成答对。 */
const answerNegations = new Set([..."不非没无否未别".split("")]);

/** 少数术语学生常写简称：相切写「切」，相交写「交」，相离写「离」。 */
const answerSynonyms: Record<string, string[]> = {
  相切: ["切"], 相交: ["交"], 相离: ["离"],
};

/**
 * 短文本答案的等价写法。
 *
 * 「平行」也常写成「互相平行」「两直线平行」，「相似」写成「相似三角形」，
 * 「第二象限」写成「在第二象限」—— 这些都算对；
 * 但「不平行」「平行且垂直」不能算成「平行」。
 */
function shortAnswerMatch(candidate: string, expected: string): boolean {
  // 只处理「答案本身就是一个短结论」的题：学生把它连同少量连接词写出来即可。
  if (expected.length > 24 || /\d/.test(expected)) return false;
  for (const needle of [expected, ...(answerSynonyms[expected] ?? [])]) {
    if (needleMatch(candidate, needle)) return true;
  }
  return false;
}

/**
 * 学生答案里出现了要点没有的否定字 —— 例如要点是「有关」而学生写「无关」。
 * 这类必须判错，不能靠二元组覆盖率蒙混过去。
 */
function extraNegation(candidate: string, point: string): boolean {
  const pointHas = new Set([...point].filter(char => answerNegations.has(char)));
  return [...candidate].some(char => answerNegations.has(char) && !pointHas.has(char));
}

/** 答案里出现了关键词，且多出来的字都是填充词 —— 就算答对。 */
function needleMatch(candidate: string, needle: string): boolean {
  const index = candidate.indexOf(needle);
  if (index < 0) return false;
  const extra = candidate.slice(0, index) + candidate.slice(index + needle.length);
  if (extra.length > 12) return false;
  let fillers = 0;
  for (const char of extra) {
    if (answerNegations.has(char)) return false;
    if (answerFillerChars.has(char)) {
      if (char.charCodeAt(0) > 255) fillers += 1;
      continue;
    }
    // 小写字母只在还夹着中文填充词时放过（点号 A、名词复数等）；
    // 一串纯字母（"is nice"）说明学生多说了一句话，不算答对。
    if (/[a-z]/.test(char)) {
      if (fillers === 0) return false;
      continue;
    }
    return false;
  }
  return extra.length <= 6 || fillers > 0;
}

/** 「或」列举的多个答案，顺序不同也算对（1 或 -3 = -3 或 1）。 */
function alternativeSetMatch(candidate: string, expected: string): boolean {
  if (!expected.includes("或") || !candidate.includes("或")) return false;
  const parts = (value: string) => value.split("或").map(part => part.trim()).filter(Boolean).sort();
  const left = parts(candidate), right = parts(expected);
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function normalize(value: string): string {
  return normalizeTerms(unifyMath(value.normalize("NFKC"))).toLowerCase().replace(/\s+/g, "").replace(/^答[:：]?/, "").replace(/[。.]$/, "").replace(/，/g, ",");
}
const unitAliases: Record<string, string[]> = {
  厘米: ["厘米", "cm"], 米: ["米", "m"], 分米: ["分米", "dm"], 千米: ["千米", "公里", "km"],
  平方厘米: ["平方厘米", "cm2", "cm^2"], 平方米: ["平方米", "m2", "m^2"], 平方分米: ["平方分米", "dm2", "dm^2"],
  千克: ["千克", "公斤", "kg"], 克: ["克", "g"], 度: ["度", "°"], 元: ["元", "块"],
};

/** 英文数词：英语题的答案常用 Six / Eight 这类写法。 */
const numberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const numericText = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const fractionText = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/;

/** 把「6」「六」「six」「Six」「twenty three」「15/8」都转成同一个数值；不是数值时返回 null。 */
function toNumber(value: string): number | null {
  const text = value.trim();
  if (numericText.test(text)) return Number(text);
  // 分数与小数等价：学生写 15/8 或 1.875 都算对。
  const fraction = fractionText.exec(text);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  const words = text.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (!words.length || !words.every(word => word in numberWords)) return null;
  let total = 0;
  for (const word of words) total += numberWords[word];
  return total;
}

/** 只描述答案形态、不含实质信息的词，不作为要点参与判分。 */
const metaWords = new Set(["示例", "例如", "如", "答案", "要点", "参考", "即", "说明", "答题要点", "一种写法", "示例答案"]);

/**
 * 把参考答案拆成可逐条命中的要点。
 *
 * 几何证明题的答案按全角「｜」连接各步论证，这是作者标注的得分点边界，
 * 优先按它切；没有「｜」的题目再按标点切分。
 */
function splitPoints(value: string): { points: string[]; byBar: boolean } {
  const withoutPrefix = value.replace(/^(示例|例如|参考答案|答题要点)\s*[:：]\s*/, "");
  const byBar = withoutPrefix.split("｜")
    .map(part => part.trim())
    .filter(part => part.length >= 2 && !metaWords.has(part));
  if (byBar.length >= 2) return { points: byBar, byBar: true };
  const points = withoutPrefix.split(/[，。；！？、,;!?]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 2 && !metaWords.has(part));
  return { points, byBar: false };
}

/** 字符二元组：用于判断两段中文是否说的是同一件事，而不是逐字相同。 */
function bigrams(value: string): Set<string> {
  const text = value.replace(/[^a-z0-9一-鿿]/g, "");
  const set = new Set<string>();
  for (let index = 0; index + 2 <= text.length; index += 1) set.add(text.slice(index, index + 2));
  return set;
}

/** 抽取答案里的数值（负号也带上），坐标、向量这类答案靠数字比对最稳。 */
function numbersIn(value: string): string[] {
  const text = value.replace(/[−–—]/g, "-");
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => match[0]);
}

/** 一个要点是否被学生的答案覆盖到（整条命中，或数字对得上，或字符二元组覆盖过半）。 */
function pointHit(candidate: string, candidateGrams: Set<string>, point: string): boolean {
  // 先看否定：要点说「有关」而学生写「无关」，再像也不能算命中。
  if (extraNegation(candidate, point)) return false;
  if (candidate.includes(point)) return true;
  // 坐标、向量、函数值这类答案：只要数字基本一致就算命中（书写形式可以不同）。
  const pointNumbers = numbersIn(point);
  if (pointNumbers.length >= 2) {
    const candidateNumbers = new Set(numbersIn(candidate));
    const matched = pointNumbers.filter(number => candidateNumbers.has(number)).length;
    if (matched / pointNumbers.length >= 0.8) return true;
  }
  const pointGrams = bigrams(point);
  if (!pointGrams.size) return false;
  let shared = 0;
  for (const gram of pointGrams) if (candidateGrams.has(gram)) shared += 1;
  return shared / pointGrams.size >= 0.6;
}

/**
 * 开放题要点判分：学生答案命中足够比例的参考答案要点即算对。
 * 没有逐字复述不会被判错，随便写也不会蒙对。
 *
 * 「｜」分开的证明步骤是作者标注的得分点，命中一半即可算对；
 * 标点分开的普通要点要求命中六成。
 */
function pointsMatch(candidate: string, expected: string): boolean {
  const { points, byBar } = splitPoints(expected);
  const candidateGrams = bigrams(candidate);
  if (points.length === 1) {
    // 只有一个要点时不能要求逐字相符 —— 学生写「认为吸烟与患肺部疾病有关」，
    // 参考答案写「可以在犯错误的概率不超过 0.01 的前提下认为……有关」，也该算对。
    // 但必须说够分量（至少覆盖要点三成），也不能出现相反的否定词。
    const point = points[0];
    if (candidate === point) return true;
    if (extraNegation(candidate, point)) return false;
    const pointGrams = bigrams(point);
    if (!pointGrams.size || candidateGrams.size < pointGrams.size * 0.3) return false;
    let shared = 0;
    for (const gram of candidateGrams) if (pointGrams.has(gram)) shared += 1;
    return shared / candidateGrams.size >= 0.85;
  }
  if (points.length < 2) return false;
  const hits = points.filter(point => pointHit(candidate, candidateGrams, point)).length;
  const ratio = byBar ? 0.5 : 0.6;
  const need = points.length <= 2 ? 1 : Math.ceil(points.length * ratio);
  return hits >= need;
}

/** 英文实词判定里的功能词，不参与命中率计算。 */
const stopWords = new Set(["the", "and", "with", "that", "this", "they", "them", "from", "have", "will", "your", "what", "when", "where", "which", "would", "could", "should", "their", "there", "these", "those", "about", "into", "over", "after", "before", "some", "more", "than", "then", "his", "her", "its", "are", "was", "were", "for", "but", "not", "you", "our", "out", "off", "too", "very", "can", "get", "has", "had", "its", "it's", "is", "am", "be", "do", "does", "did", "go", "goes"]);

/** 英文答案按实词覆盖率判定：学生用自己的话表达，关键实词要覆盖到。 */
function englishPointsMatch(candidate: string, expected: string): boolean {
  const words = expected.split(/[^a-z0-9']+/i).map(word => word.toLowerCase()).filter(word => word.length >= 4 && !stopWords.has(word));
  if (words.length < 2) return false;
  const hits = words.filter(word => candidate.includes(word)).length;
  return hits >= Math.ceil(words.length * 0.6);
}

/** Exact numeric comparison with explicit expected-unit aliases; never parseFloat user text. */
export function gradeAnswer(value: string, question: Pick<Question, "answer" | "unit"> & { text?: string }): boolean {
  let candidate = normalize(value);
  let expected = normalize(question.answer);
  // 选择题的作答提交的是选项字母，而参考答案写的是选项内容（如英语选词题）。
  // 这时先把字母映射回选项内容再比较，否则学生怎么选都判错。
  // 参考答案本身就是字母的题不走这条（比较的是原始答案，不能用归一化后的值判断）。
  if (!/^[A-D]$/i.test(String(question.answer ?? "").trim()) && /^[A-D]$/i.test(candidate)) {
    const picked = parseChoices(question.text ?? "").find(choice => choice.key === candidate.toUpperCase());
    if (picked) candidate = normalize(picked.text);
  }
  const suffixes = (unitAliases[question.unit] || [question.unit]).filter(Boolean).map(normalize).sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (candidate.endsWith(suffix)) { candidate = candidate.slice(0, -suffix.length); break; }
  }
  for (const suffix of suffixes) {
    if (expected.endsWith(suffix)) { expected = expected.slice(0, -suffix.length); break; }
  }
  if (!candidate || !expected) return false;
  // 数值题：两边都转成数值再比较（英文数词写法也算）。
  // 先试原文（保留空格，"twenty three" 要靠词边界切分），再试剥掉单位后的形式。
  const candidateNumber = toNumber(value) ?? toNumber(candidate);
  const expectedNumber = toNumber(question.answer) ?? toNumber(expected);
  if (candidateNumber !== null && expectedNumber !== null) return candidateNumber === expectedNumber;
  if (candidate === expected) return true;
  // 短文本答案的等价写法：「互相平行」=「平行」，「或」列举换个顺序也算对。
  if (shortAnswerMatch(candidate, expected)) return true;
  if (alternativeSetMatch(candidate, expected)) return true;
  // 开放题：按参考答案要点的命中率判定（中文按标点切要点，英文按实词覆盖）。
  // 英文要用原文切词 —— normalize 会删掉空格，按实词切分需要保留词边界。
  const raw = question.answer;
  const ascii = /^[\x20-\x7E]+$/.test(raw);
  return ascii ? englishPointsMatch(candidate, raw) : pointsMatch(candidate, expected);
}
