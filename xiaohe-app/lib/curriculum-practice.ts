/** 原创知识点练习；与教材主题对应，不标作课后原题或正式测评。 */
export interface CurriculumExercise {
  /** Stable across edits; the original question uses its point ID to preserve existing drafts. */
  id: string;
  pointId: string;
  question: string;
  reference: string;
  image?: { src: string; alt: string; credit?: string; sourceUrl?: string };
  source?: { title: string; url: string; license: string; adaptation?: string };
}
export const curriculumExercises: CurriculumExercise[] = [];

// Openly licensed source questions are kept separate from the original practice set.
const openMathSource = { title: "Open Up Resources K–5 Math，四年级第 7 单元 C 节，练习 2–3", url: "https://access.openupresources.org/curricula/our-k5-math/en/grade-4/unit-7/section-c/student_practice_problems.html", license: "CC BY 4.0", adaptation: "译为中文，配图重新绘制" };
curriculumExercises.push(
  { id: "akshara-2012-revision-1", pointId: "english-1-read", question: "写出下列大写字母对应的小写字母：K I B D E M G C H L J A F。", reference: "k i b d e m g c h l j a f", source: { title: "Akshara Foundation，Basic English Workbook – IV Std（2012），Revision 1，第 1 页", url: "https://www.scribd.com/document/189498279/Hello-English-1-Basic-English-workbook-Std-4", license: "CC BY 4.0", adaptation: "题目说明译为中文" } },
  { id: "open-angle-twelfths", pointId: "math-2-angle", question: "图中的圆被平均分成 12 份。标有问号的角是多少度？说明你的思路。", reference: "30°。一周是 360°，360÷12＝30。", image: { src: "/exercises/circle-12.svg", alt: "圆被平均分成 12 个扇形，其中一个圆心角标有问号。", credit: "依据 Open Up Resources 题目重新绘制" }, source: openMathSource },
  { id: "open-angle-eighths", pointId: "math-2-angle", question: "图中的圆被平均分成 8 份。标有问号的角是多少度？", reference: "45°。360÷8＝45。", image: { src: "/exercises/circle-8.svg", alt: "圆被平均分成 8 个扇形，其中一个圆心角标有问号。", credit: "依据 Open Up Resources 题目重新绘制" }, source: openMathSource },
  { id: "open-angle-fifths", pointId: "math-2-angle", question: "图中的圆被平均分成 5 份。标有问号的角是多少度？", reference: "72°。360÷5＝72。", image: { src: "/exercises/circle-5.svg", alt: "圆被平均分成 5 个扇形，其中一个圆心角标有问号。", credit: "依据 Open Up Resources 题目重新绘制" }, source: openMathSource },
);

export function groupExercisesByPoint(exercises: CurriculumExercise[]) {
  const grouped = new Map<string, CurriculumExercise[]>();
  for (const exercise of exercises) {
    const group = grouped.get(exercise.pointId) ?? [];
    group.push(exercise);
    grouped.set(exercise.pointId, group);
  }
  return grouped;
}
export const exercisesByPoint = groupExercisesByPoint(curriculumExercises);
