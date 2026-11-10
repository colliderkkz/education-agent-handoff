// Generated from xiaohe-app/lib/choice.ts; SHA-256: 069bd1d0e32563c3db0ca7076c259c6fecabe4895050278174be1445f9471f22
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
/**
 * 选择题选项解析。
 *
 * 初中与高中的卷子里选择题是主要题型，选项直接写在题干里
 * （「……下列做法中不可行的是（　　）。A．… B．… C．… D．…」）。
 * 解析出选项后，作答界面可以渲染成单选，提交的答案也只是一个字母。
 */

export interface Choice {
  key: string;
  text: string;
}

/**
 * 选项字母前面必须是「非字母数字」——题干里的「。」「（　　）」都要能接上；
 * 后面必须紧跟选项分隔符，这样正文里的英文缩写不会被误判成选项。
 */
const optionPattern = /(?:^|[^A-Za-z0-9])([A-D])[．.、）)]\s*/g;

/**
 * 从题干里解析选项。识别不到两个以上从 A 开始的连续选项时返回空数组 ——
 * 此时按普通文本题作答，不强行当选择题处理。
 */
export function parseChoices(text: string): Choice[] {
  const source = String(text ?? "");
  const matches = [...source.matchAll(optionPattern)];
  if (matches.length < 2) return [];
  const choices: Choice[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : source.length;
    const body = source.slice(start, end).trim();
    if (!body) continue;
    choices.push({ key: match[1], text: body });
  }
  // 选项必须是从 A 开始的连续序列，否则更可能是正文里的字母，不是选项。
  const expected = choices.map((choice, index) => String.fromCharCode(65 + index));
  if (choices.length < 2 || choices.map(choice => choice.key).join("") !== expected.join("")) return [];
  return choices;
}

/** 题干里的选项部分（用于展示「题干 + 选项」的分离排版）。 */
export function splitQuestionText(text: string): { stem: string; choices: Choice[] } {
  const source = String(text ?? "");
  const choices = parseChoices(source);
  if (!choices.length) return { stem: source, choices };
  const first = /(?:^|[^A-Za-z0-9])([A-D])[．.、）)]\s*/.exec(source);
  const stem = first ? source.slice(0, first.index).trim() : source;
  return { stem, choices };
}
