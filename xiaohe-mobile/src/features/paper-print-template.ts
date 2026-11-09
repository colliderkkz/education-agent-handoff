import type { Paper, Question } from '../local/shared/types.ts';

export type PaperPrintMode = 'student' | 'solutions' | 'both';
export type PaperPrintKind = Exclude<PaperPrintMode, 'both'>;
export interface PaperPrintOptions { showIdentityFields?: boolean; }
export interface PaperPrintDocument {
  kind: PaperPrintKind;
  html: string;
  fileName: string;
  title: string;
  paperId: string;
  paperVersion: number;
  questionCount: number;
}
export type PaperPrintErrorCode = 'INVALID_PAPER' | 'MISSING_SOLUTIONS' | 'INVALID_MODE';

export class PaperPrintTemplateError extends Error {
  readonly code: PaperPrintErrorCode;
  readonly questionNumbers: readonly number[];
  constructor(code: PaperPrintErrorCode, message: string, questionNumbers: readonly number[] = []) {
    super(message);
    this.name = 'PaperPrintTemplateError';
    this.code = code;
    this.questionNumbers = Object.freeze([...questionNumbers]);
  }
}

const kindLabels: Record<PaperPrintKind, string> = { student: '学生卷', solutions: '答案解析卷' };
const verificationGuidance = [
  '重新核对题目条件、数字和问题，检查每一步是否回答了题意。',
  '检查计算过程及单位；适合时将结果代回题意，或用逆运算再次检查。',
  '这是一组通用检查建议，并不表示系统已完成本题的逐题自动核验。',
] as const;

function invalidPaper(): never {
  throw new PaperPrintTemplateError('INVALID_PAPER', '试卷快照不完整或题目编号不一致，暂时无法导出。请重新读取原试卷后再试。');
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** questionIds is the frozen order; extra, duplicate or missing snapshots are errors. */
function orderedQuestions(paper: Readonly<Paper>): readonly Question[] {
  if (!paper || !nonempty(paper.id) || !nonempty(paper.title) || !validVersion(paper.version)
      || (paper.parentId !== undefined && !nonempty(paper.parentId))
      || !Array.isArray(paper.questionIds) || !paper.questionIds.length || !Array.isArray(paper.questions)
      || paper.questionIds.length !== paper.questions.length) invalidPaper();
  const snapshots = new Map<string, Question>();
  for (const question of paper.questions) {
    if (!question || !nonempty(question.id) || !nonempty(question.text) || !validVersion(question.version)
        || typeof question.source !== 'string' || snapshots.has(question.id)) invalidPaper();
    snapshots.set(question.id, question);
  }
  const seen = new Set<string>();
  return paper.questionIds.map(id => {
    if (!nonempty(id) || seen.has(id)) invalidPaper();
    const question = snapshots.get(id);
    if (!question) invalidPaper();
    seen.add(id);
    return question;
  });
}

function requireSolutions(questions: readonly Question[]): void {
  const missing = questions.flatMap((question, index) =>
    !nonempty(question.answer) || typeof question.unit !== 'string' || typeof question.alternative !== 'string'
      || !Array.isArray(question.steps) || !question.steps.length || question.steps.some(step => !nonempty(step))
      ? [index + 1] : []);
  if (missing.length) throw new PaperPrintTemplateError('MISSING_SOLUTIONS', `第 ${missing.join('、')} 题的答案或解析尚未完整取得，未生成解析文件。请重新读取试卷并打开完整解析后重试。`, missing);
}

/** Text is always inserted as escaped text, never trusted markup or attributes. */
function htmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function abbreviate(value: string, length: number): string {
  const characters = Array.from(value.replace(/\s+/g, ' '));
  return characters.length > length ? `${characters.slice(0, length - 1).join('')}…` : characters.join('');
}
/** CSS strings need their own escaping; hex escapes also prevent a closing style tag. */
function cssText(value: string): string {
  return `"${Array.from(value, character => `\\${character.codePointAt(0)!.toString(16)} `).join('')}"`;
}
function filePart(value: string, length: number): string {
  return Array.from(value.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '')).slice(0, length).join('') || 'paper';
}

function stylesheet(paper: Readonly<Paper>, kind: PaperPrintKind): string {
  const footer = `${abbreviate(paper.title, 14)} · ${kindLabels[kind]} · V${paper.version} · ${abbreviate(paper.id, 18)}`;
  return `
    @page {
      size: A4 portrait;
      margin: 15mm 13mm 18mm;
      @bottom-left { content: ${cssText(footer)}; font-family: sans-serif; font-size: 7pt; color: #526252; }
      @bottom-right { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-family: sans-serif; font-size: 7pt; color: #526252; }
    }
    * { box-sizing: border-box; }
    html { color: #1d2b20; background: #fff; font-size: 11pt; }
    body { margin: 0 auto; max-width: 184mm; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; line-height: 1.75; }
    h1, h2, h3, p, li, dd, dt { overflow-wrap: anywhere; word-break: break-word; }
    h1 { font-size: 21pt; line-height: 1.4; margin: 1mm 0 4mm; font-weight: 700; }
    h2 { font-size: 12pt; margin: 0 0 2mm; break-after: avoid; page-break-after: avoid; }
    h3 { font-size: 10.5pt; margin: 4mm 0 1mm; break-after: avoid; page-break-after: avoid; }
    p { margin: 0 0 2mm; orphans: 3; widows: 3; }
    .brand { font-size: 9pt; letter-spacing: 1pt; color: #42644b; margin: 0 0 2mm; }
    .document-kind { font-size: 12pt; font-weight: 600; margin-bottom: 3mm; }
    .document-header { border-bottom: 0.4mm solid #46664c; padding-bottom: 5mm; margin-bottom: 6mm; }
    .metadata, .question-source, .document-end { font-size: 8.5pt; color: #526252; }
    .metadata p { margin-bottom: 1mm; }
    .identity { margin-top: 5mm; font-size: 10pt; }
    .identity span { display: inline-block; margin: 0 8mm 3mm 0; }
    .blank { display: inline-block; width: 38mm; min-height: 6mm; border-bottom: 0.25mm solid #7d8a7c; }
    .instructions { font-size: 9pt; margin-top: 3mm; }
    /* Keep a short question and its work together. Oversized blocks may still
       fragment naturally: no fixed height, clipping or unbreakable wrapper. */
    .question { margin-bottom: 7mm; padding-bottom: 4mm; break-inside: avoid; page-break-inside: avoid; }
    .question-text, .step-text, .answer-text, .alternative-text { white-space: pre-wrap; }
    .question-text { font-size: 12pt; line-height: 1.85; margin: 2mm 0 3mm; }
    .question-source { border-bottom: 0.2mm solid #dce3da; padding-bottom: 2mm; margin-bottom: 4mm; }
    .writing-space { break-inside: avoid; page-break-inside: avoid; margin-top: 4mm; min-height: 49mm; }
    .writing-label { font-size: 9pt; color: #697368; margin: 0; }
    .writing-line { min-height: 13mm; border-bottom: 0.2mm solid #dce3da; }
    .answer { margin: 4mm 0; border-left: 0.8mm solid #6e866e; padding: 1mm 0 1mm 4mm; }
    .answer-text { font-size: 12pt; font-weight: 600; }
    .steps { margin: 0; padding-left: 7mm; }
    .steps li { padding-left: 1mm; margin-bottom: 3mm; orphans: 3; widows: 3; }
    .verification { border-top: 0.2mm solid #dce3da; margin-top: 5mm; padding-top: 2mm; font-size: 9pt; }
    .verification p:last-child { color: #526252; font-size: 8.5pt; }
    .document-end { border-top: 0.3mm solid #b8c6b5; padding-top: 3mm; margin-top: 7mm; }
    @media screen { body { padding: 8mm; } }
  `;
}

function questionHeader(question: Question, number: number): string {
  return `<h2>第 ${number} 题</h2>
    <p class="question-text">${htmlText(question.text)}</p>
    <p class="question-source">题目来源：${htmlText(question.source.trim() ? question.source : '来源未标注')}<br>题目编号：${htmlText(question.id)} · 题目版本：V${question.version}</p>`;
}

function studentQuestion(question: Question, number: number): string {
  // Deliberately no access to answer, unit, steps, hint, alternative, review data,
  // paper status/reason, attempts or any other learning history in this branch.
  return `<section class="question" data-question-number="${number}">
    ${questionHeader(question, number)}
    <div class="writing-space"><p class="writing-label">第 ${number} 题作答区</p><div class="writing-line"></div><div class="writing-line"></div><div class="writing-line"></div></div>
  </section>`;
}

function solutionQuestion(question: Question, number: number): string {
  const answer = question.unit.trim() ? `${question.answer} ${question.unit}` : question.answer;
  return `<section class="question" data-question-number="${number}">
    ${questionHeader(question, number)}
    <div class="answer"><h3>参考答案</h3><p class="answer-text">${htmlText(answer)}</p></div>
    <h3>解题方法与步骤</h3>
    <ol class="steps">${question.steps.map(step => `<li><p class="step-text">${htmlText(step)}</p></li>`).join('')}</ol>
    ${question.alternative.trim() ? `<h3>另一种思路</h3><p class="alternative-text">${htmlText(question.alternative)}</p>` : ''}
    <aside class="verification"><h3>通用核验提示</h3>${verificationGuidance.map(line => `<p>${line}</p>`).join('')}</aside>
  </section>`;
}

function buildDocument(paper: Readonly<Paper>, questions: readonly Question[], kind: PaperPrintKind, options: PaperPrintOptions): PaperPrintDocument {
  const label = kindLabels[kind];
  const title = `${paper.title} · ${label} · V${paper.version}`;
  const identity = kind === 'student' && options.showIdentityFields !== false
    ? '<div class="identity"><span>姓名：<i class="blank"></i></span><span>班级：<i class="blank"></i></span></div>' : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no,email=no,address=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${htmlText(title)}</title><style>${stylesheet(paper, kind)}</style></head>
<body>
  <header class="document-header">
    <p class="brand">小禾学伴 · 本机试卷</p><h1>${htmlText(paper.title)}</h1><p class="document-kind">${label}</p>
    <div class="metadata"><p>试卷编号：${htmlText(paper.id)}</p><p>试卷版本：V${paper.version} · 共 ${questions.length} 题 · A4</p>${paper.parentId ? `<p>上版试卷编号：${htmlText(paper.parentId)}</p>` : ''}</div>
    ${identity}
    <p class="instructions">${kind === 'student' ? '按题号独立作答，写出必要的计算与思考过程。' : '按与学生卷相同的题号阅读。核验提示为通用检查建议，未增加题目快照之外的答案。'}</p>
  </header>
  <main>${questions.map((question, index) => kind === 'student' ? studentQuestion(question, index + 1) : solutionQuestion(question, index + 1)).join('\n')}</main>
  <footer class="document-end"><p>${htmlText(paper.title)} · ${label} · V${paper.version}</p><p>试卷编号：${htmlText(paper.id)} · 全卷 ${questions.length} 题结束</p></footer>
</body></html>`;
  return { kind, html, fileName: `${filePart(paper.title, 32)}_V${paper.version}_${filePart(paper.id, 40)}_${label}.pdf`, title, paperId: paper.id, paperVersion: paper.version, questionCount: questions.length };
}

/**
 * Pure snapshot-to-HTML conversion. `both` returns two standalone documents, never
 * a combined answer-bearing file. The caller must record solution exposure and
 * obtain the corresponding authorized snapshot before requesting solutions.
 * Native print engines vary in @page margin-box support; the flowing end footer
 * keeps complete identity metadata even when page counters are unavailable.
 */
export function buildPaperPrintDocuments(paper: Readonly<Paper>, mode: PaperPrintMode, options: PaperPrintOptions = {}): PaperPrintDocument[] {
  if (mode !== 'student' && mode !== 'solutions' && mode !== 'both') throw new PaperPrintTemplateError('INVALID_MODE', '请选择学生卷、答案解析卷或两份一起导出。');
  const questions = orderedQuestions(paper);
  if (mode !== 'student') requireSolutions(questions);
  const kinds: PaperPrintKind[] = mode === 'both' ? ['student', 'solutions'] : [mode];
  return kinds.map(kind => buildDocument(paper, questions, kind, options));
}
