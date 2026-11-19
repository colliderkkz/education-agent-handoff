// Generated from xiaohe-app/lib/curriculum-catalog.ts; SHA-256: a45db15ef85f51972720991f69e31e85683e65cc57c218ba6cc7679e4a94faa2
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
/** 四年级上册教材目录对照；知识点说明为教研整理，不是课文或课后题原文。 */
import type { StageId } from "./types.ts";

export interface CatalogPoint { id: string; name: string; description: string; practiceId?: "division" | "geometry" | "multiplication" }
export interface CatalogUnit { id: string; name: string; points: CatalogPoint[] }
export interface CatalogSubject { id: string; name: string; edition: string; sourceUrl: string; stage?: StageId; units: CatalogUnit[] }
const p = (id: string, name: string, description: string, practiceId?: CatalogPoint["practiceId"]): CatalogPoint => ({ id, name, description, ...(practiceId ? { practiceId } : {}) });
const u = (id: string, name: string, points: CatalogPoint[]): CatalogUnit => ({ id, name, points });

export const curriculumCatalog: CatalogSubject[] = [
  { id: "chinese", name: "语文", edition: "统编版 · 四年级上册", sourceUrl: "https://www.pep.com.cn/products/zhytu/gjshnj/csxp/tbzc/202306/t20230628_1984166.shtml", units: [
    u("chinese-1", "第一单元 · 自然景观", [p("chinese-1-imagery", "边读边想象画面", "结合《观潮》《走月亮》等课文描述景象"), p("chinese-1-order", "观察与描写顺序", "辨认景物变化的先后与观察角度"), p("chinese-1-write", "写一处自然景观", "按观察顺序写清印象深刻的画面")]),
    u("chinese-2", "第二单元 · 阅读与提问", [p("chinese-2-question", "从不同角度提问", "围绕内容、写法和启发提出问题"), p("chinese-2-evidence", "依据文本解决问题", "筛选信息并说明答案依据"), p("chinese-2-science", "理解科普表达", "梳理《夜间飞行的秘密》等课文的信息")]),
    u("chinese-3", "第三单元 · 连续观察", [p("chinese-3-observe", "连续观察", "记录事物随时间发生的变化"), p("chinese-3-diary", "观察日记", "按时间顺序写观察过程和发现")]),
    u("chinese-4", "第四单元 · 神话故事", [p("chinese-4-plot", "故事起因经过结果", "梳理神话主要情节"), p("chinese-4-character", "感受人物形象", "结合行为与语言说明人物特点"), p("chinese-4-retell", "按顺序复述", "抓住关键情节讲清故事")]),
    u("chinese-5", "第五单元 · 把事情写清楚", [p("chinese-5-sequence", "事情的发展顺序", "梳理《麻雀》《爬天都峰》的事件过程"), p("chinese-5-details", "重点情节描写", "抓住动作、语言和感受写清关键过程")]),
    u("chinese-6", "第六单元 · 成长故事", [p("chinese-6-feelings", "人物心情变化", "从语言、动作和事件推断心情"), p("chinese-6-narrative", "记一次游戏", "写清游戏过程与自己的感受")]),
    u("chinese-7", "第七单元 · 家国情怀", [p("chinese-7-event", "关注人物和事件", "借助关键事实概括文章内容"), p("chinese-7-context", "联系背景理解表达", "结合背景理解人物选择与情感")]),
    u("chinese-8", "第八单元 · 历史故事", [p("chinese-8-brief", "简要复述", "删去次要细节并保持故事完整"), p("chinese-8-classical", "文言故事理解", "借助注释理解《王戎不取道旁李》")]),
  ] },
  { id: "math", name: "数学", edition: "人教版修订版 · 四年级上册", sourceUrl: "https://www.pep.com.cn/xw/zt/hd/12/xjcjs/xx/202409/t20240920_1995566.html", units: [
    u("math-1", "第一单元 · 万以上数的认识", [p("math-1-place", "亿以内数的读写", "理解万级、个级数位与计数单位"), p("math-1-billion", "亿以上数的认识", "按数级读写亿以上的数"), p("math-1-compare", "大数比较与改写", "比较大小，用万或亿作单位表示"), p("math-1-round", "近似数", "按要求用四舍五入法求近似数")]),
    u("math-2", "第二单元 · 角的度量", [p("math-2-angle", "角的再认识", "认识角的特征与常见角"), p("math-2-measure", "量角与画角", "用量角器测量并画出指定度数的角")]),
    u("math-3", "第三单元 · 多位数乘两位数", [p("math-3-mental", "口算乘法", "运用乘法规律进行口算"), p("math-3-written", "笔算乘法", "理解竖式部分积与位值", "multiplication"), p("math-3-pattern", "积的变化规律", "根据因数变化推断积的变化")]),
    u("math-4", "第四单元 · 加法模型和乘法模型", [p("math-4-add", "加法模型", "用总量和分量描述数量关系"), p("math-4-multiply", "乘法模型", "用每份量与份数描述数量关系"), p("math-4-apply", "模型解决问题", "选择合适模型并解释算式意义")]),
    u("math-5", "第五单元 · 平行四边形和梯形", [p("math-5-lines", "平行与垂直", "识别和画出平行线、垂线"), p("math-5-quads", "平行四边形与梯形", "辨认图形特征和高"), p("math-5-mobius", "神奇的莫比乌斯带", "通过操作观察图形的特征"), p("math-5-review", "周长与面积复习", "关联原有演示练习；周长面积并非本单元新授内容", "geometry")]),
    u("math-6", "第六单元 · 条形统计图", [p("math-6-single", "单式条形统计图", "读取并绘制单式条形统计图"), p("math-6-double", "复式条形统计图", "比较两组数据并解释图表"), p("math-6-project", "寻找宝藏", "在综合实践中记录与分析信息")]),
    u("math-7", "第七单元 · 复习与关联", [p("math-7-organize", "整理与复习", "关联本册数与运算、图形和统计知识"), p("math-7-apply", "应用提升", "综合运用本册知识解决问题"), p("math-7-rabbits", "鸡兔同笼", "通过假设和调整推理数量关系")]),
  ] },
  { id: "english", name: "英语", edition: "人教版 PEP 修订版 · 四年级上册", sourceUrl: "https://www.pep.com.cn/zslth/yyptzy/xypep/4s/", units: [
    u("english-1", "Unit 1 · Helping at home", [p("english-1-listen", "听懂家务情境", "听取人物、活动和简单指令"), p("english-1-talk", "交流家庭分工", "表达自己能做的事"), p("english-1-read", "阅读与书写", "提取短文信息并写简短句子")]),
    u("english-2", "Unit 2 · My friends", [p("english-2-describe", "介绍朋友", "描述朋友的特点和共同活动"), p("english-2-dialogue", "朋友话题对话", "听懂问答并作出恰当回应")]),
    u("english-3", "Unit 3 · Places we live in", [p("english-3-place", "居住场所词汇", "在场景中理解地点表达"), p("english-3-question", "询问地点", "用问答交流位置和场所")]),
    u("english-4", "Unit 4 · Helping in the community", [p("english-4-actions", "社区帮助活动", "理解常见社区活动与帮助行为"), p("english-4-talk", "表达如何帮忙", "结合情境提出或回应帮助请求")]),
    u("english-5", "Unit 5 · The weather and us", [p("english-5-weather", "天气表达", "听懂并描述常见天气"), p("english-5-plan", "天气与活动", "根据天气选择适宜活动并说明")]),
    u("english-6", "Unit 6 · Changing for the seasons", [p("english-6-seasons", "季节与变化", "描述不同季节的自然变化"), p("english-6-actions", "季节活动", "交流季节中的衣着和活动")]),
    u("english-review", "Revision · Let's help!", [p("english-review-read", "阅读与表演", "结合前六单元内容朗读并表演"), p("english-review-plan", "听力与计划", "听取信息并完成计划"), p("english-review-write", "读写与交流", "阅读、书写并交流单元主题")]),
  ] },
];
