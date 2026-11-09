// Generated from xiaohe-app/lib/grading.ts; SHA-256: 8122a1c1f7a376f617c190e8fd3771bf134a067fee58a79425e1641314065379
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import type { Question } from "./types.ts";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/^答[:：]?/, "").replace(/[。.]$/, "").replace(/，/g, ",");
}
const unitAliases: Record<string, string[]> = {
  厘米: ["厘米", "cm"], 米: ["米", "m"], 分米: ["分米", "dm"], 千米: ["千米", "公里", "km"],
  平方厘米: ["平方厘米", "cm2", "cm^2"], 平方米: ["平方米", "m2", "m^2"], 平方分米: ["平方分米", "dm2", "dm^2"],
  千克: ["千克", "公斤", "kg"], 克: ["克", "g"], 度: ["度", "°"], 元: ["元", "块"],
};

/** Exact numeric comparison with explicit expected-unit aliases; never parseFloat user text. */
export function gradeAnswer(value: string, question: Pick<Question, "answer" | "unit">): boolean {
  let candidate = normalize(value);
  let expected = normalize(question.answer);
  const suffixes = (unitAliases[question.unit] || [question.unit]).filter(Boolean).map(normalize).sort((a, b) => b.length - a.length);
  for (const suffix of suffixes) {
    if (candidate.endsWith(suffix)) { candidate = candidate.slice(0, -suffix.length); break; }
  }
  for (const suffix of suffixes) {
    if (expected.endsWith(suffix)) { expected = expected.slice(0, -suffix.length); break; }
  }
  if (!candidate || !expected) return false;
  const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
  if (numeric.test(candidate) && numeric.test(expected)) return Number(candidate) === Number(expected);
  return candidate === expected;
}

