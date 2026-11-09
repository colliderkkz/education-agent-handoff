import type { Question } from './types';

/**
 * Opt-in content for an unsigned, unvalidated local trial package. Nothing here
 * seeds a learner workspace. These machine identifiers do not identify people
 * or certify independent human teaching review. See content-trial-notes.md.
 * Nine items comprise eight new task structures and one basic subtask of an
 * existing family; they are not nine independent new families.
 */
const source = '小禾原创本地试用样题 · AI 起草与机器样例数学校核 · 未经人工教研验证';
const sourceScope = '仅供已学所列前置知识的四年级数学本地试用；非教材授权题库，教学有效性未验证';
const machineReview = '独立测试脚本仅检查样例算术、答案及结构清单；未经人工教研验证，不证明适龄性或教学有效性。';
type TrialItem = Pick<Question, 'id' | 'familyId' | 'knowledgeId' | 'contextId' | 'text' | 'answer' | 'unit' | 'hint' | 'steps' | 'alternative' | 'prerequisites'> & { reviewScope: string };

const items: TrialItem[] = [
  {
    id: 'trial-division-quotient-place', familyId: 'trial-family-div-quotient-place', knowledgeId: 'division', contextId: 'quotient-place-judgement',
    text: '计算 684 ÷ 36，不用求出完整的商，先判断商是几位数。请填写位数。', answer: '2', unit: '位',
    hint: '先比较被除数的前两位与除数，想想商的第一位应该写在哪一位。',
    steps: ['被除数的前两位是 68，68 大于 36，可以先除。', '因此商的第一位写在十位，商是两位数。', '答：2 位。'],
    alternative: '36 × 10 = 360，36 × 100 = 3600；684 在两者之间，所以商至少是 10、不到 100，是两位数。',
    prerequisites: ['整数位值与十位', '两位数除法中商首位的定位'],
    reviewScope: '考查商的位数判断，不等同于独立完成完整除法。旧 seed 除法题要求最终商，本题未按换数另造同类求商题族。',
  },
  {
    id: 'trial-division-remainder-bound', familyId: 'trial-family-div-remainder-bound', knowledgeId: 'division', contextId: 'remainder-bound-judgement',
    text: '一道有余数的整数除法题，除数是 28。余数最大可以是多少？', answer: '27', unit: '',
    hint: '如果余数已经够再分出一组，除法就还没有分完。余数应与除数有什么大小关系？',
    steps: ['有余数的整数除法中，余数必须小于除数。', '除数是 28，小于 28 的最大非负整数是 27。', '答：余数最大是 27。'],
    alternative: '若余下 28，就还能分出一组，不能作为最终余数；余下 27 时不够一组。例如 55 ÷ 28 = 1……27。',
    prerequisites: ['有余数整数除法的含义', '余数小于除数'],
    reviewScope: '只考查余数边界。旧 seed 除法任务均未单独考查余数约束；未学有余数除法时不可作为基础任务。',
  },
  {
    id: 'trial-division-inverse-check', familyId: 'trial-family-div-inverse-dividend', knowledgeId: 'division', contextId: 'inverse-dividend-check',
    text: '一道整数除法题的除数是 24，商是 13，余数是 5。被除数是多少？', answer: '317', unit: '',
    hint: '先求已经分成整组的总数，再把剩下的部分加回去。',
    steps: ['被除数 = 除数 × 商 + 余数。', '24 × 13 = 312；312 + 5 = 317。', '核对：317 ÷ 24 = 13……5，且 5 小于 24。', '答：被除数是 317。'],
    alternative: '13 个 24 是 312，再加上剩余的 5，合起来是 317。',
    prerequisites: ['有余数整数除法的含义', '被除数等于除数乘商加余数', '两位数乘两位数'],
    reviewScope: '直接使用已学验算关系反求被除数，未知量位置不同于旧 seed 的求商题；未学该关系时不可作为基础任务。',
  },
  {
    id: 'trial-geometry-formula-recognition', familyId: 'trial-family-geo-boundary-formula', knowledgeId: 'geometry', contextId: 'perimeter-formula-recognition',
    text: '要给长方形画框的四条边装上边条，下面哪个算式表示所需边条的总长度？1：长 × 宽；2：（长 + 宽）× 2。只填 1 或 2。', answer: '2', unit: '',
    hint: '先想一想，边条沿着图形的边界，还是铺满图形的内部？长方形有几条长、几条宽？',
    steps: ['边条沿着四条边，要求的是周长。', '长方形有两条长和两条宽，总长度是（长 + 宽）× 2。', '所以选择算式 2，填写 2。'],
    alternative: '也可以把四条边写成长 + 宽 + 长 + 宽，再合并为（长 + 宽）× 2；长 × 宽计算的是面积。',
    prerequisites: ['长方形相对的边相等', '周长与面积的含义', '长方形周长与面积公式'],
    reviewScope: '数值 2 是选项编号，只记录公式对象辨认，不证明周长计算稳定。旧 seed 几何 1/2 指定量后要求计算，本题要求选择公式。',
  },
  {
    id: 'trial-geometry-unit-recognition', familyId: 'trial-family-geo-area-unit', knowledgeId: 'geometry', contextId: 'area-unit-recognition',
    text: '记录长方形教室地面的面积，应选哪个单位？1：米；2：平方米。只填 1 或 2。', answer: '2', unit: '',
    hint: '想想要记录的是一条线的长度，还是一整块地面的大小。对应单位各表示什么？',
    steps: ['教室地面的面积表示面的大小。', '米是长度单位；平方米是面积单位。', '应选择单位 2，填写 2。'],
    alternative: '可以想象用边长 1 米的正方形铺地，每一块占 1 平方米；记录这些面的大小要用平方米。',
    prerequisites: ['长度与面积的区别', '米和平方米的含义'],
    reviewScope: '数值 2 是选项编号，只记录面积单位辨认，不证明面积计算稳定。旧 seed 在题干中直接给定所需单位，本题单独考查单位选择。',
  },
  {
    id: 'trial-geometry-inverse-side', familyId: 'family-geometry-6', knowledgeId: 'geometry', contextId: 'square-side-from-perimeter',
    text: '一个正方形的周长是 28 厘米，边长是多少厘米？', answer: '7', unit: '厘米',
    hint: '正方形的四条边一样长，把一圈的总长度平均分成四份。',
    steps: ['正方形四条边相等，边长 = 周长 ÷ 4。', '28 ÷ 4 = 7 厘米。', '核对：7 × 4 = 28 厘米。', '答：边长是 7 厘米。'],
    alternative: '四条相等的边合起来是 28 厘米，想 4 乘几等于 28，就得到每条边长 7 厘米。',
    prerequisites: ['正方形四边相等', '周长的含义', '平均分与除法'],
    reviewScope: '反求边长与旧 seed 几何 6 周长转面积的第一步完全相同，保守沿用 family-geometry-6。它是旧族的基础子任务；旧题已见或帮助记录应同族处理，不能称为独立新族或跨情境迁移。',
  },
  {
    id: 'trial-multiplication-partial-place', familyId: 'trial-family-mul-partial-product-place', knowledgeId: 'multiplication', contextId: 'tens-partial-product-value',
    text: '计算 124 × 23 时，十位上的“2”表示 20。与这个 20 对应的部分积实际是多少？', answer: '2480', unit: '',
    hint: '这个部分积计算的是 124 乘几个十，不能把十位上的数字当成个位数。',
    steps: ['23 的十位上的 2 表示 20。', '十位部分积是 124 × 20 = 2480。', '竖式中的 248 从十位写起，实际表示 2480。', '答：2480。'],
    alternative: '先算 124 × 2 = 248，再乘 10，得到 2480。',
    prerequisites: ['十进位与十位的含义', '三位数乘两位数竖式', '整数乘整十数'],
    reviewScope: '单独检验部分积位值，不把给定十位含义算成学生独立推断。旧 seed 乘法任务均要求总积，部分积诊断是不同任务操作。',
  },
  {
    id: 'trial-multiplication-estimation', familyId: 'trial-family-mul-product-estimation', knowledgeId: 'multiplication', contextId: 'product-order-estimation',
    text: '不用计算精确的积，估一估 198 × 31 最接近下面哪个数：600、6000、60000？请直接填写选中的数值。', answer: '6000', unit: '',
    hint: '把两个因数分别看作附近容易计算的整百数、整十数，先判断积的大致大小。',
    steps: ['198 接近 200，31 接近 30。', '200 × 30 = 6000，因此应选择 6000。', '精算核对：198 × 31 = 6138，与 6000 的差最小。'],
    alternative: '198 × 30 已接近 6000，再加一份 198，结果仍接近 6000，远离 600 和 60000。',
    prerequisites: ['接近整百数与整十数的估算', '整数乘整十数', '积的数量级'],
    reviewScope: '记录数量级选择，不能由选对推断学生实际采用了估算。旧 seed 乘法均要求精确总积；此题不作为完整竖式计算证据。',
  },
  {
    id: 'trial-multiplication-factor-scaling', familyId: 'trial-family-mul-factor-scaling', knowledgeId: 'multiplication', contextId: 'one-factor-doubled',
    text: '已知 123 × 12 = 1476。第一个因数不变，把第二个因数变成 24，123 × 24 等于多少？', answer: '2952', unit: '',
    hint: '比较 24 与 12 的关系，再想积会怎样变化。',
    steps: ['24 是 12 的 2 倍，第一个因数 123 不变。', '因此新的积是原来积的 2 倍：1476 × 2 = 2952。', '答：2952。'],
    alternative: '把 24 拆成 12 + 12，123 × 24 = 1476 + 1476 = 2952。',
    prerequisites: ['一个因数不变时积随另一个因数变化的规律', '倍数的含义', '整数加倍'],
    reviewScope: '条件性基础任务，需已学积的变化规律；给定旧积后使用关系，不等同旧 seed 的从头求积，也不是多步购买挑战题。',
  },
];

/** Return fresh question values for explicit export; importing this module has no side effects. */
export function trialQuestions(): Question[] {
  return items.map(({ reviewScope, ...item }) => ({
    ...item, steps: [...item.steps], prerequisites: [...item.prerequisites],
    version: 1, difficulty: '基础', taskType: 'basic', source, sourceScope,
    authorId: 'xiaohe-trial-draft', reviewerId: 'xiaohe-arithmetic-check',
    status: 'published', reviewNote: `${machineReview}${reviewScope}`,
    createdAt: '2026-10-27T00:00:00.000Z',
  }));
}
