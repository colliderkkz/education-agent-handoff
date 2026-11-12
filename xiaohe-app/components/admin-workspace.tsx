"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, ClipboardCheck, Database, FileCheck2, FilePenLine, FileText, GitBranch, GraduationCap, Layers3, Leaf, ListChecks, MessageSquare, MoreHorizontal, PencilLine, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, Upload, X } from "lucide-react";
import type { AppProps } from "@/lib/ui-types";
import type { ApiResult, ContentBatch, ContentVersion, KnowledgeId, Question, QuestionStatus, WorkspaceState } from "@/lib/types";
import { effectiveEvidence } from "@/lib/effective-evidence";
import { evidenceAuthorityNames } from "./evidence-review-workspace";
import { exportContentPackage } from "@/lib/server/content";
import { AdminMasteryWorkspace } from "./admin-mastery-workspace";
import { curriculumCatalog } from "@/lib/curriculum-catalog";
import "./admin-workspace.css";

type AdminSection = "library" | "extraction" | "solutions" | "review" | "curriculum" | "evidence" | "datasets" | "evaluation" | "support";
type FormDraft = { text: string; answer: string; unit: string; knowledgeId: KnowledgeId; difficulty: Question["difficulty"]; source: string; sourceScope: string; steps: string; hint: string; alternative: string; prerequisites: string; taskType: NonNullable<Question["taskType"]> | ""; contextId: string };
const sectionItems = [
  { id: "library", label: "试卷知识库", icon: BookOpen, title: "让每一道题，都有可靠的来源", description: "管理题目、来源与使用范围，让经过审核的好内容进入学习。" },
  { id: "extraction", label: "提取与校对", icon: FileCheck2, title: "从原始材料，到结构化题目", description: "核对题干、答案和来源，再交给教研审核。" },
  { id: "solutions", label: "教学解法", icon: FilePenLine, title: "把思考的方法，讲给孩子听", description: "入手角度、分层提示与适龄解法，和题目一起保留版本。" },
  { id: "review", label: "审核与版本", icon: ShieldCheck, title: "认真复核，安心发布", description: "标注与审核由不同人员完成，题目修订号与已生成试卷快照可追溯。" },
  { id: "curriculum", label: "课程知识点", icon: GraduationCap, title: "从课程边界，走向学习路线", description: "区分课程要求与掌握情况，未学内容不进入默认练习范围。" },
  { id: "evidence", label: "熟练度与证据", icon: ListChecks, title: "每一点成长，都有迹可循", description: "配置与复核五星规则，保留版本；按授权查看评定历史、间隔复查与原始证据。" },
  { id: "datasets", label: "数据版本", icon: Layers3, title: "内容有版本，来源可追溯", description: "题库、教学解法与学习记录各自管理，学生材料不默认用于训练。" },
  { id: "evaluation", label: "评估与发布", icon: ClipboardCheck, title: "看见真实结果，再向前一步", description: "核对内容完整性和审核记录，区分产品功能与待验证的模型能力。" },
  { id: "support", label: "学习求助", icon: MessageSquare, title: "孩子的困惑，有人认真回应", description: "查看学习求助并回复，处理结果同步到学生端。" },
] as const;
const statusNames: Record<QuestionStatus, string> = { draft: "草稿", review: "待审核", approved: "已通过", published: "已发布", disabled: "已停用" };
const taskNames = { basic: "基础任务", application: "应用任务", transfer: "迁移任务" };
const helpNames = { independent: "独立完成", hint: "使用提示", explanation: "看过讲解", unknown: "帮助待确认" };
const kindNames = { original: "原始作业", practice: "针对练习", review: "间隔复查" };
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const qName = (state: WorkspaceState, id: KnowledgeId) => state.knowledge.find((item) => item.id === id)?.name || id;
const emptyDraft = (): FormDraft => ({ text: "", answer: "", unit: "", knowledgeId: "division", difficulty: "基础", source: "教研自编", sourceScope: "演示教学", steps: "", hint: "", alternative: "", prerequisites: "", taskType: "", contextId: "" });
const toDraft = (q: Question): FormDraft => ({ text: q.text, answer: q.answer, unit: q.unit, knowledgeId: q.knowledgeId, difficulty: q.difficulty, source: q.source, sourceScope: q.sourceScope, steps: q.steps.join("\n"), hint: q.hint, alternative: q.alternative, prerequisites: q.prerequisites.join("、"), taskType: q.taskType ?? "", contextId: q.contextId ?? "" });

function StatusBadge({ status }: { status: QuestionStatus }) { return <span className={`admin-status admin-status-${status}`}><span />{statusNames[status]}</span>; }
function Empty({ title, description }: { title: string; description: string }) { return <div className="admin-empty"><FileText size={30} strokeWidth={1.4} /><h3>{title}</h3><p>{description}</p></div>; }
function Metric({ label, value, detail, icon: Icon, accent = false }: { label: string; value: number | string; detail: string; icon: typeof BookOpen; accent?: boolean }) { return <div className={`admin-metric ${accent ? "admin-metric-accent" : ""}`}><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><div className="admin-metric-icon"><Icon size={21} strokeWidth={1.6} /></div></div>; }

export function AdminWorkspace({ state, mutate, busy, navigate }: AppProps) {
  const [section, setSection] = useState<AdminSection>("library");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [knowledge, setKnowledge] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Question | "new" | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [evidenceHelp, setEvidenceHelp] = useState("all");
  const [evidenceResult, setEvidenceResult] = useState("all");
  const [solutionId, setSolutionId] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const current = sectionItems.find((item) => item.id === section)!;
  const isOwner = state.actor.role === "owner";
  const canEdit = state.actor.role === "owner" || state.actor.role === "editor";
  const canReview = state.actor.role === "owner" || state.actor.role === "reviewer";
  const counts = useMemo(() => ({ published: state.questions.filter((q) => q.status === "published").length, review: state.questions.filter((q) => q.status === "review").length, draft: state.questions.filter((q) => q.status === "draft").length, approved: state.questions.filter((q) => q.status === "approved").length }), [state.questions]);
  const selected = state.questions.find((q) => q.id === selectedId);
  const archived = state.content?.versions.find(version => version.id === archiveId);
  const openArchive = (id: string) => { setSelectedId(null); setArchiveId(id); };
  const reviewQuestion = state.questions.find((q) => q.id === reviewId);
  const solution = state.questions.find((q) => q.id === solutionId) || state.questions.find((q) => q.status === "published") || state.questions[0];
  const filtered = state.questions.filter((q) => (status === "all" || q.status === status) && (knowledge === "all" || q.knowledgeId === knowledge) && `${q.text} ${q.id} ${q.source} ${q.answer}`.toLowerCase().includes(search.toLowerCase().trim()));
  const evidence = effectiveEvidence(state).filter((item) => (knowledge === "all" || item.knowledgeId === knowledge) && (evidenceHelp === "all" || item.help === evidenceHelp) && (evidenceResult === "all" || String(item.correct) === evidenceResult));
  const pendingHelp = state.helpRequests.filter((item) => item.status !== "replied").length;
  const execute = async (action: string, payload: Record<string, unknown>, success: string) => {
    setFeedback("");
    const result = await mutate(action, payload);
    if (result) setFeedback(result.result?.message || success);
    return result;
  };
  const moveTo = (next: AdminSection) => { setSection(next); setFeedback(""); setStatus("all"); setKnowledge("all"); setSearch(""); };
  const afterSave = (result: ApiResult) => {
    setEditor(null);
    setSelectedId(typeof result.result?.id === "string" ? result.result.id : null);
    setFeedback(result.result?.message || "题目草稿已保存，可继续提交审核。");
  };
  const openReview = (q: Question) => { setSelectedId(null); setReviewId(q.id); };
  const actions = (q: Question, compact = false) => <div className="admin-actions">
    {!compact && canEdit && <button className="btn btn-secondary" disabled={busy || !canEdit || q.status === "review"} onClick={() => { setSelectedId(null); setEditor(q); }}><PencilLine size={15} />{q.status === "draft" ? "编辑草稿" : "修订并重新送审"}</button>}
    {q.status === "draft" && canEdit && <button className="btn btn-primary" disabled={busy || !canEdit} onClick={() => execute("question.submit", { id: q.id }, "已提交，请其他教研人员复核。")}><ArrowRight size={15} />提交审核</button>}
    {q.status === "review" && canReview && <button className="btn btn-primary" disabled={busy || !canReview || q.authorId === state.actor.id} title={q.authorId === state.actor.id ? "标注人与审核人须分离，请由另一位审核人员复核" : "核对内容并填写审核结论"} onClick={() => openReview(q)}><ShieldCheck size={15} />开始审核</button>}
    {q.status === "approved" && canReview && <button className="btn btn-primary" disabled={busy || !canReview} onClick={() => execute("question.publish", { id: q.id }, "题目已发布，学生可以在组卷中使用。")}><CheckCheck size={15} />发布题目</button>}
    {q.status === "published" && !compact && canReview && <button className="btn btn-ghost admin-danger" disabled={busy || !canReview} onClick={() => execute("question.disable", { id: q.id }, "已停用，原学习记录继续保留。")} >停用题目</button>}
  </div>;
  const filters = <div className="admin-filters"><label className="admin-search"><Search size={17} /><input aria-label="搜索题干、题号或来源" placeholder="搜索题干、题号或来源…" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label className="admin-filter-select"><SlidersHorizontal size={15} /><select aria-label="筛选知识点" value={knowledge} onChange={(e) => setKnowledge(e.target.value)}><option value="all">全部知识点</option>{state.knowledge.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><select className="admin-filter-select" aria-label="筛选内容状态" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部状态</option>{Object.entries(statusNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>;
  const questionTable = (items: Question[]) => items.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>题目 / 版本</th><th>知识点</th><th>难度</th><th>内容状态</th><th>来源 / 使用范围</th><th className="admin-cell-right">操作</th></tr></thead><tbody>{items.map((q) => <tr key={q.id}><td className="admin-question-cell"><button className="admin-text-button" onClick={() => setSelectedId(q.id)}>{q.text}</button><small>{q.id} <span>· v{q.version}</span></small></td><td><span className="admin-knowledge-tag">{qName(state, q.knowledgeId)}</span><small>{q.taskType ? taskNames[q.taskType] : "任务未标注"}{q.contextId ? ` · ${q.contextId}` : ""}</small></td><td><span className={`admin-difficulty admin-difficulty-${q.difficulty === "挑战" ? "hard" : "normal"}`}>{q.difficulty}</span></td><td><StatusBadge status={q.status} /></td><td className="admin-source-cell">{q.source}<small>{q.sourceScope}</small></td><td className="admin-cell-right"><button className="admin-row-action" aria-label={`查看题目 ${q.id}`} onClick={() => setSelectedId(q.id)}>查看<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <Empty title="暂时没有符合条件的题目" description="调整筛选范围，或录入第一道教研题目。" />;

  return <div className="admin-workspace">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span><Leaf size={24} /></span><div><strong>小禾教研</strong><small>教学内容工作台</small></div></div>
      <div className="admin-nav-label">内容与教学</div>
      <nav aria-label="教研模块">{[
        { title: "内容制作", ids: ["library", "extraction", "solutions"] },
        { title: "审核发布", ids: ["review", "datasets", "evaluation"] },
        { title: "课程与评价", ids: ["curriculum", "evidence"] },
      ].map(group => <div key={group.title}><div className="admin-nav-group-title">{group.title}</div>{group.ids.map(id => sectionItems.find(item => item.id === id)!).map(({ id, label, icon: Icon }) => <button key={id} className={`admin-nav-item ${section === id ? "active" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => moveTo(id)}><Icon size={18} strokeWidth={1.7} /><span>{id === "evidence" && !isOwner ? "熟练度规则" : label}</span>{id === "review" && counts.review > 0 && <b>{counts.review}</b>}</button>)}</div>)}</nav>
      {isOwner && <><div className="admin-nav-divider" /><button className={`admin-nav-item ${section === "support" ? "active" : ""}`} onClick={() => moveTo("support")}><MessageSquare size={18} strokeWidth={1.7} /><span>学习求助</span>{pendingHelp > 0 && <b>{pendingHelp}</b>}</button></>}
      <div className="admin-sidebar-note"><div><ShieldCheck size={17} />认真教研，安心学习</div><p>教研新内容经过独立审核后发布，来源与试卷快照可追溯。</p><span>演示课程 · 真实保存</span></div>
      <div className="admin-account"><div className="admin-avatar">{state.actor.name.slice(0, 1)}</div><div><strong>{state.actor.name}</strong><small>{{ owner: "工作区管理员", editor: "教研标注人员", reviewer: "独立审核人员", student: "学生", parent: "家长", teacher: "教师" }[state.actor.role]}</small></div><MoreHorizontal size={18} /></div>
    </aside>
    <main className="admin-main">
      <div className="admin-breadcrumb">教研工作台<ChevronRight size={12} /><span>{current.label}</span><span className="admin-environment"><span />演示课程</span></div>
      <header className="admin-header"><div><div className="admin-kicker">XIAOHE · CONTENT STUDIO</div><h1>{current.label}</h1><p>{current.description}</p></div>{canEdit && ["library", "extraction", "solutions"].includes(section) && <button className="btn btn-primary" disabled={!canEdit || busy} onClick={() => setEditor("new")}><Plus size={17} />新建题目</button>}</header>
      {feedback && <div className="admin-feedback" role="status"><Check size={17} /><span>{feedback}</span><button aria-label="关闭提示" onClick={() => setFeedback("")}><X size={16} /></button></div>}

      {section === "library" && <>
        <div className="admin-metrics"><Metric label="已发布题目" value={counts.published} detail="可用于学生组卷" icon={BookOpen} accent /><Metric label="等待独立审核" value={counts.review} detail="复核后方可发布" icon={ShieldCheck} /><Metric label="编辑中的草稿" value={counts.draft} detail="内容随时保存" icon={FilePenLine} /><Metric label="已通过待发布" value={counts.approved} detail="保留完整审核记录" icon={CheckCheck} /></div>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>题目内容库 <span>{state.questions.length}</span></h2><p>课程、题目、解法，让教学内容井然有序。</p></div><span className="admin-subtle-label"><Database size={14} />工作区 r{state.revision}</span></div>{filters}{questionTable(filtered)}<footer className="admin-table-footer"><span>共 {filtered.length} 条当前题库内容</span><span><ShieldCheck size={13} />仅已发布题目进入学生练习</span></footer></section>
        <div className="admin-bottom-note"><Leaf size={17} /><span>好内容，先有好来源。录入时请填写使用范围，演示课程不能替代学校教材授权。</span><button onClick={() => moveTo("extraction")}>了解入库流程<ArrowRight size={14} /></button></div>
      </>}

      {section === "extraction" && <>
        <div className="admin-process"><div><span>01</span><h3>保留来源</h3><p>录入原卷名称、题目定位与授权范围</p></div><ChevronRight size={20} /><div><span>02</span><h3>逐项校对</h3><p>核对题干、单位、答案与知识点</p></div><ChevronRight size={20} /><div><span>03</span><h3>完善教学解法</h3><p>补齐提示与步骤，再提交独立审核</p></div></div>
        <div className="admin-two-columns"><section className="admin-panel admin-padded"><div className="admin-feature-icon"><Upload size={24} /></div><h2>从人工校对开始</h2><p className="admin-body-copy">将已获授权的题目手动录入，核对答案与解法。每次保存通过后端写入工作区。修改题目会增加修订号并回到草稿，既有试卷中的题目快照保持不变。</p><div className="admin-info-line"><span className={`admin-capability-dot ${state.capabilities.ocr ? "connected" : ""}`} /><span>{state.capabilities.ocr ? "作业识别服务已接入；内容入库仍需人工核对。" : "OCR 尚未接入，可先通过人工录入完成内容入库。"}</span></div><button className="btn btn-primary" onClick={() => setEditor("new")} disabled={!canEdit || busy}><Plus size={16} />人工录入并校对</button></section><section className="admin-panel admin-padded"><h2>发布前，核对这 4 件事</h2><div className="admin-checklist">{["题干中的数字、公式、图形描述和单位准确", "参考答案与分步解法一致，没有答案冲突", "知识点、难度与前置知识符合当前课程", "来源名称、原页位置与使用范围清楚"].map((item, i) => <div key={item}><span>{i + 1}</span><p>{item}</p></div>)}</div></section></div>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>待完善内容</h2><p>草稿尚未开放给学生，可继续校对并补充解法。</p></div><button className="admin-text-link" onClick={() => moveTo("solutions")}>进入教学解法<ArrowRight size={14} /></button></div>{questionTable(state.questions.filter((q) => q.status === "draft"))}</section><p className="admin-footnote">学生作业的识别更正保留在学习证据中，与题库内容校对分开管理。批量原卷提取与图形题切块能力待接入。</p>
      </>}

      {section === "solutions" && <section className="admin-panel admin-solution-layout"><aside className="admin-solution-list"><h2>选择教学内容</h2><p>题目与解法共同版本化</p>{state.questions.length ? state.questions.map((q) => <button key={q.id} className={solution?.id === q.id ? "active" : ""} onClick={() => setSolutionId(q.id)}><span>{q.text}</span><small>{qName(state, q.knowledgeId)} · v{q.version}</small><StatusBadge status={q.status} /></button>) : <p>先录入一道题目。</p>}</aside><div className="admin-solution-body">{solution ? <><div className="admin-detail-title"><span className="admin-kicker">{solution.id} · v{solution.version}</span><StatusBadge status={solution.status} /></div><h2>{solution.text}</h2><div className="admin-answer">参考答案 <strong>{solution.answer}{solution.unit && ` ${solution.unit}`}</strong></div><div className="admin-solution-section"><h3><Sparkles size={17} />先给一点提示</h3><blockquote>{solution.hint || "尚未填写提示"}</blockquote></div><div className="admin-solution-section"><h3><ListChecks size={17} />分步讲解</h3><ol className="admin-step-list">{solution.steps.map((step, i) => <li key={`${solution.id}-${i}`}><span>{i + 1}</span><p>{step}</p></li>)}</ol>{!solution.steps.length && <p className="muted">尚未补充分步讲解。</p>}</div><div className="admin-solution-section"><h3><GitBranch size={17} />换一种思路</h3><p>{solution.alternative || "本题尚未标注其他方法。"}</p></div><div className="admin-prerequisites"><h4>使用方法前，先确认已学</h4><div>{solution.prerequisites.length ? solution.prerequisites.map((p) => <span key={p}>{p}</span>) : <span>未设置额外前置知识</span>}</div></div>{actions(solution)}<p className="admin-footnote">保存教学解法不等于发布；修改已发布题目会增加修订号并回到草稿，需要重新独立复核；既有试卷快照不变。</p></> : <Empty title="教学内容从第一道题开始" description="录入题目、分层提示与讲解，让孩子知道从哪里想。" />}</div></section>}

      {section === "review" && <>
        <div className="admin-banner"><div className="admin-feature-icon"><ShieldCheck size={25} /></div><div><h2>先独立复核，再发布内容</h2><p>待审 {counts.review} 题 · 已通过待发布 {counts.approved} 题。作者不能审核自己标注的内容。</p></div><span className="admin-banner-pill">试卷快照保留</span></div>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>审核与发布队列</h2><p>查看详情核对题目；审核通过后，单独执行发布。</p></div></div>{questionTable(state.questions.filter((q) => q.status === "review" || q.status === "approved"))}</section>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>当前题库修订</h2><p>编辑后的内容需重新审核；归档版本与既有试卷快照保留，早期未曾保存的修订不会补造。</p></div></div>{filters}{questionTable(filtered)}</section>
        <ContentArchivePanel state={state} onSelect={openArchive} />
        <EventLog events={state.events.filter((event) => /question|题目|审核|发布|停用/.test(`${event.action} ${event.label}`))} />
      </>}

      {section === "curriculum" && <>
        <section className="admin-panel admin-padded"><h2>四年级上册教材知识地图</h2><p className="admin-body-copy">学生端按科目、单元、知识点浏览。以下为目录与教研解释；对应原创自练题在“我的练习”，尚未进入正式审核组卷流程。</p><div className="admin-curriculum-overview">{curriculumCatalog.map(subject => <details key={subject.id}><summary><strong>{subject.name}</strong><span>{subject.units.length} 个单元 · {subject.units.reduce((count, unit) => count + unit.points.length, 0)} 个知识点</span></summary><div>{subject.units.map(unit => <p key={unit.id}><strong>{unit.name}</strong><br />{unit.points.map(point => point.name).join(" · ")}</p>)}</div></details>)}</div></section>
        <section className="admin-course-card"><div><span className="admin-kicker">CURRENT LEARNING CONTEXT</span><h2>{state.profile.course}</h2><p>{state.profile.grade} · {state.profile.semester}</p><span className="admin-course-tag">演示课程</span></div><BookOpen size={90} strokeWidth={1} /><dl><div><dt>教材</dt><dd>{state.profile.textbook || "待学校确认"}</dd></div><div><dt>学校</dt><dd>{state.profile.school || "未配置"}</dd></div><div><dt>学习档案</dt><dd>{state.profile.name}</dd></div></dl></section>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>数学演示题库知识点</h2><p>此表只统计演示题库的正式题目和作答证据，与上方三科自练目录分别管理。</p></div>{isOwner && <button className="admin-text-link" onClick={() => navigate("knowledge")}>学生课程地图<ArrowRight size={14} /></button>}</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>知识点</th><th>教学说明</th><th>课程状态</th><th>已发布题目</th><th>掌握情况</th></tr></thead><tbody>{state.knowledge.map((k) => <tr key={k.id}><td><strong>{k.name}</strong><small>{k.id}</small></td><td className="admin-wide-cell">{k.description}</td><td><span className={`admin-status ${k.learningState === "current" ? "admin-status-published" : "admin-status-draft"}`}><span />{k.learningState === "current" ? "当前学习" : "后续学习"}</span></td><td>{state.questions.filter((q) => q.knowledgeId === k.id && q.status === "published").length} 道</td><td>{!isOwner ? "未授权查看学习记录" : k.learningState === "upcoming" ? "未学习" : k.stars === null ? "待评估" : <span className="admin-stars" aria-label={`${k.stars} 星`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} size={14} fill={i < (k.stars || 0) ? "currentColor" : "none"} />)}</span>}</td></tr>)}</tbody></table></div></section>
        <div className="admin-two-columns"><section className="admin-panel admin-padded"><h2>从课程范围开始练习</h2><p className="admin-body-copy">组卷优先选择当前学习范围内、审核发布的题目。未学项目不赋星，也不作为默认薄弱点。</p><p className="admin-body-copy">当前支持数学样例课程。真实教材映射、学校课程配置及跨学科任务模板需要进一步配置与教研验证。</p></section><section className="admin-panel admin-padded"><h2>前置知识来自教学标注</h2><div className="admin-tag-cloud">{Array.from(new Set(state.questions.flatMap((q) => q.prerequisites))).map((p) => <span key={p}>{p}</span>)}</div><p className="admin-footnote">题目的拓展方法必须说明前置知识，避免向未学习的孩子直接展示超纲推导。</p></section></div>
      </>}

      <div hidden={section !== "evidence"}><AdminMasteryWorkspace state={state} mutate={mutate} busy={busy} navigate={navigate} /></div>
      {section === "evidence" && isOwner && <>
        <div className="admin-metrics"><Metric label="累计学习证据" value={state.evidence.length} detail="按题目与知识点关联" icon={ListChecks} accent /><Metric label="独立答对" value={effectiveEvidence(state).filter((e) => e.valid && e.correct && e.help === "independent").length} detail="当前有效结果，原始状态保留" icon={CheckCheck} /><Metric label="使用过帮助" value={effectiveEvidence(state).filter((e) => e.valid && (e.help === "hint" || e.help === "explanation")).length} detail="提示与讲解分别保存" icon={MessageSquare} /><Metric label="间隔复查证据" value={effectiveEvidence(state).filter((e) => e.valid && e.kind === "review").length} detail="逐知识点复查" icon={GitBranch} /></div>
        <div className="admin-evidence-cards">{state.knowledge.map((k) => <button className={`admin-knowledge-card ${knowledge === k.id ? "active" : ""}`} key={k.id} onClick={() => setKnowledge(knowledge === k.id ? "all" : k.id)}><div><strong>{k.name}</strong><span>{k.learningState === "upcoming" ? "未学习" : k.stars === null ? "待评估" : `${k.stars} 星`}</span></div><p>{k.reason}</p><small>{k.evidenceIds.length} 条关联证据 · {k.ruleVersion}</small></button>)}</div>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>学习证据明细 <span>{evidence.length}</span></h2><p>原始作答与订正分开保存。看过答案后完成，不能视为独立完成。</p></div></div><div className="admin-filters"><select className="admin-filter-select" aria-label="证据知识点" value={knowledge} onChange={(e) => setKnowledge(e.target.value)}><option value="all">全部知识点</option>{state.knowledge.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select><select className="admin-filter-select" aria-label="证据帮助状态" value={evidenceHelp} onChange={(e) => setEvidenceHelp(e.target.value)}><option value="all">全部帮助状态</option>{Object.entries(helpNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select className="admin-filter-select" aria-label="证据作答结果" value={evidenceResult} onChange={(e) => setEvidenceResult(e.target.value)}><option value="all">全部作答结果</option><option value="true">答对</option><option value="false">待订正</option></select></div>{evidence.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>题目与证据</th><th>知识点</th><th>原始 / 当前回答</th><th>帮助状态</th><th>结果</th><th>记录时间</th></tr></thead><tbody>{evidence.map((e) => <tr key={e.id}><td className="admin-question-cell"><strong>{e.questionText}</strong><small>{kindNames[e.kind]} · 题目 v{e.questionVersion}</small><small>{e.id}</small></td><td>{qName(state, e.knowledgeId)}{e.original.knowledgeId !== e.knowledgeId && <small>原始：{qName(state, e.original.knowledgeId)}</small>}</td><td><small>原始：{e.original.answer || "未作答"}</small>当前：{e.answer || "未作答"}<small>参考：{e.expected}</small></td><td><span className={`admin-help-tag admin-help-${e.help}`}>{helpNames[e.help]}</span>{e.original.help !== e.help && <small>原始：{helpNames[e.original.help]}</small>}</td><td><span className={e.correct ? "admin-result-correct" : "admin-result-review"}>{!e.valid ? "已排除" : e.correct ? "答对" : "待订正"}</span><small>原始：{e.original.correct ? "答对" : "待订正"}</small><small>{evidenceAuthorityNames[e.authority]}</small><button className="admin-text-button" onClick={() => navigate("evidence-review", e.id)}>复核历史</button></td><td className="admin-nowrap">{time(e.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="还没有符合条件的证据" description="学生完成并提交练习后，会在这里形成可追溯的作答记录。" />}</section>
        <div className="admin-rule-note"><ShieldCheck size={20} /><div><strong>当前是可解释的试点规则</strong><p>按知识点区分新题、帮助状态和间隔复查。规则版本保存在知识点记录中，教学有效性仍需教研验证，不能仅凭一次作答判断能力。</p></div></div><EventLog events={state.events} />
      </>}

      <div hidden={section !== "datasets"}><ContentPackagePanel state={state} busy={busy} /></div>
      {section === "datasets" && <>
        <div className="admin-banner"><div className="admin-feature-icon"><Layers3 size={25} /></div><div><h2>工作区内容快照 <span>r{state.revision}</span></h2><p>这是当前持久化数据的修订编号，非已冻结的训练或评估数据集版本。</p></div><span className="admin-banner-pill">可追溯</span></div>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>按用途管理数据</h2><p>内容入库、学习证据和模型训练各有边界。</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>数据类别</th><th>当前数量</th><th>用途</th><th>当前状态</th></tr></thead><tbody><tr><td><strong>题库内容</strong></td><td>{state.questions.length} 个当前条目</td><td>审核、检索与组卷</td><td>{counts.published} 题已发布</td></tr><tr><td><strong>教学解法</strong></td><td>{state.questions.filter((q) => q.steps.length > 0).length} 个当前解法</td><td>分层提示与适龄讲解</td><td>随题目独立审核</td></tr><tr><td><strong>学生学习证据</strong></td><td>{isOwner ? `${state.evidence.length} 条` : "未授权查看"}</td><td>个体反馈与复查</td><td>不默认用于训练</td></tr><tr><td><strong>模型训练样本</strong></td><td>未建立</td><td>需独立授权、整理与划分</td><td><span className="admin-pending">待接入</span></td></tr><tr><td><strong>独立评估样本</strong></td><td>未建立</td><td>冻结题组验证教学表现</td><td><span className="admin-pending">待验证</span></td></tr></tbody></table></div></section>
        <ContentBatchHistory state={state} onSelect={openArchive} />
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>当前已发布候选</h2><p>以下是整包校验的候选题目；状态为已发布，不代表已通过本次导出校验。</p></div></div>{questionTable(state.questions.filter((q) => q.status === "published"))}</section>
        <div className="admin-rule-note"><GitBranch size={20} /><div><strong>训练与评估需要独立建立版本</strong><p>后续应按来源与同题族分组，冻结评估样本并检查集合交叉。当前没有训练启动、训练结果或模型准确率。</p></div></div>
      </>}

      {section === "evaluation" && <>
        <section className="admin-panel"><div className="admin-panel-heading"><div><h2>内容结构检查</h2><p>基于当前工作区计算；字段完整不代表答案正确，仍需人工审核。</p></div><span className="admin-subtle-label">r{state.revision}</span></div><div className="admin-check-rows">{[
          { title: "来源与使用范围", detail: "检查每个题目版本是否记录来源与使用范围", count: state.questions.filter((q) => !q.source.trim() || !q.sourceScope.trim()).length },
          { title: "参考答案与分步解法", detail: "检查答案是否填写，至少包含一个讲解步骤", count: state.questions.filter((q) => !q.answer.trim() || !q.steps.length).length },
          { title: "分层提示", detail: "检查题目是否有独立于完整讲解的提示", count: state.questions.filter((q) => !q.hint.trim()).length },
          { title: "发布审核记录", detail: "检查已发布题目是否有审核人，并与作者分离", count: state.questions.filter((q) => q.status === "published" && (!q.reviewerId || q.reviewerId === q.authorId)).length },
          { title: "知识点映射", detail: "检查题目关联知识点是否存在于当前课程", count: state.questions.filter((q) => !state.knowledge.some((k) => k.id === q.knowledgeId)).length },
        ].map((check) => <div key={check.title}><div className={`admin-check-icon ${check.count > 0 ? "needs-attention" : ""}`}>{check.count > 0 ? <FilePenLine size={17} /> : <Check size={17} />}</div><div><h3>{check.title}</h3><p>{check.detail}</p></div><span className={check.count > 0 ? "admin-result-review" : "admin-result-correct"}>{check.count > 0 ? `${check.count} 项待完善` : state.questions.length ? "未发现字段缺失" : "暂无内容可检查"}</span></div>)}</div></section>
        <div className="admin-two-columns"><section className="admin-panel admin-padded"><h2>服务能力状态</h2><div className="admin-service-list">{[{ label: "作业图片识别", enabled: state.capabilities.ocr }, { label: "AI 对话服务", enabled: state.capabilities.ai }, { label: "语音能力", enabled: state.capabilities.speech }, { label: "文件持久存储", enabled: state.capabilities.storage }].map((item) => <div key={item.label}><span>{item.label}</span><span className={item.enabled ? "admin-result-correct" : "admin-pending"}>{item.enabled ? "已配置" : "待接入"}</span></div>)}</div></section><section className="admin-panel admin-padded"><h2>发布前的人工判断</h2><p className="admin-body-copy">答案是否正确、讲解是否适龄、方法是否匹配课程，需要独立教研审核。当前没有独立评估集，不显示模型准确率。</p><button className="btn btn-secondary" onClick={() => moveTo("review")}>查看审核与发布队列<ArrowRight size={15} /></button><p className="admin-footnote">已发布题目可停用；停用后不再组卷推荐，历史学习记录保留。</p></section></div><EventLog events={state.events.filter((e) => /publish|disable|review/.test(e.action))} />
      </>}

      {section === "support" && <section className="admin-panel"><div className="admin-panel-heading"><div><h2>学习求助 <span>{state.helpRequests.length}</span></h2><p>{pendingHelp} 条待处理。回复将保存在工作区，并同步给学生。</p></div></div>{state.helpRequests.length ? <div className="admin-support-list">{state.helpRequests.map((item) => <article key={item.id}><div className="admin-support-heading"><div><h3>{item.topic}</h3><small>{time(item.createdAt)} · {item.id}</small></div><span className={`admin-status ${item.status === "replied" ? "admin-status-published" : "admin-status-review"}`}><span />{{ waiting: "等待回应", received: "已接收", replied: "已回复" }[item.status]}</span></div><p>{item.summary}</p>{item.reply && <div className="admin-support-reply"><strong>教研回复</strong><p>{item.reply}</p></div>}{replyId === item.id ? <form onSubmit={async (e) => { e.preventDefault(); const result = await execute("help.reply", { id: item.id, reply: reply.trim() }, "回复已送达学生端。"); if (result) { setReplyId(null); setReply(""); } }}><label className="field">回复内容<textarea className="textarea" rows={4} required minLength={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="先回应具体困惑，再给出孩子可以尝试的一小步…" /></label><div className="admin-actions"><button className="btn btn-primary" disabled={busy || !reply.trim()} type="submit"><MessageSquare size={15} />发送回复</button><button type="button" className="btn btn-ghost" onClick={() => setReplyId(null)}>取消</button></div></form> : <button className="btn btn-secondary" disabled={busy} onClick={() => { setReplyId(item.id); setReply(item.reply || ""); }}>{item.reply ? "补充回复" : "回复求助"}<ArrowRight size={15} /></button>}</article>)}</div> : <Empty title="暂时没有学习求助" description="学生从学伴页提交的求助会出现在这里。" />}</section>}
    </main>

    {selected && <Modal title="题目详情" onClose={() => setSelectedId(null)}><div className="admin-detail-title"><span className="admin-kicker">{selected.id} · v{selected.version}</span><StatusBadge status={selected.status} /></div><h2 className="admin-question-heading">{selected.text}</h2><div className="admin-detail-tags"><span>{qName(state, selected.knowledgeId)}</span><span>{selected.difficulty}</span></div><div className="admin-answer">参考答案<strong>{selected.answer} {selected.unit}</strong></div><dl className="admin-detail-meta"><div><dt>内容来源</dt><dd>{selected.source}</dd></div><div><dt>教学任务类型</dt><dd>{selected.taskType ? taskNames[selected.taskType] : "未标注，不根据难度推断"}</dd></div><div><dt>情境标识</dt><dd>{selected.contextId || "未标注"}</dd></div><div><dt>使用范围</dt><dd>{selected.sourceScope}</dd></div><div><dt>作者</dt><dd>{selected.authorId}</dd></div><div><dt>审核人</dt><dd>{selected.reviewerId || "尚未审核"}</dd></div></dl><div className="admin-solution-section"><h3>先给提示</h3><blockquote>{selected.hint || "未填写"}</blockquote><h3>分步讲解</h3><ol className="admin-step-list">{selected.steps.map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol><h3>其他方法</h3><p>{selected.alternative || "未标注其他方法"}</p><h3>前置知识</h3><p>{selected.prerequisites.join("、") || "未设置"}</p></div>{selected.reviewNote && <div className="admin-review-note"><strong>审核意见</strong><p>{selected.reviewNote}</p></div>}<div className="admin-version-list"><h3><GitBranch size={16} />已保存的题目归档</h3><p className="admin-footnote">按题目编号查看只读快照；同题族的不同题目另列在下方，早期未保存的修订不补造。</p>{(state.content?.versions ?? []).filter(version => version.questionId === selected.id).sort((a, b) => b.version - a.version).map(version => <button key={version.id} onClick={() => openArchive(version.id)}><span>v{version.version} · {contentSourceNames[version.source]}</span><ChevronRight size={14} /></button>)}{!(state.content?.versions ?? []).some(version => version.questionId === selected.id) && <p className="admin-footnote">当前没有已持久化的归档记录。</p>}<h3>当前题库中的同题族条目</h3>{state.questions.filter((q) => q.familyId === selected.familyId).sort((a, b) => b.version - a.version).map((q) => <button key={q.id} className={q.id === selected.id ? "active" : ""} onClick={() => setSelectedId(q.id)}><span>v{q.version} · {q.id}</span><StatusBadge status={q.status} /></button>)}</div>{selected.status === "review" && selected.authorId === state.actor.id && <p className="admin-footnote">这道题由你标注，需另一位审核人员复核。请使用独立审核身份处理。</p>}<div className="admin-modal-footer">{actions(selected)}</div></Modal>}
    {archived && <Modal title="只读题目归档" onClose={() => setArchiveId(null)}><ContentVersionDetail version={archived} state={state} /></Modal>}
    {editor && <QuestionEditor key={editor === "new" ? "new" : editor.id} question={editor === "new" ? undefined : editor} state={state} busy={busy} mutate={mutate} onSave={afterSave} onClose={() => setEditor(null)} />}
    {reviewQuestion && <ReviewDialog question={reviewQuestion} state={state} busy={busy} mutate={mutate} onClose={() => setReviewId(null)} onDone={(result) => { setReviewId(null); setFeedback(result.result?.message || "审核结果已保存。"); }} />}
  </div>;
}

const contentSourceNames: Record<ContentVersion["source"], string> = { baseline: "原有题库", paper: "历史试卷快照", editorial: "教研修订", package: "本地内容包" };
const canReadTeachingContent = (state: WorkspaceState) => ["owner", "editor", "reviewer"].includes(state.actor.role);

/** The UI always validates every published candidate; it never drops invalid questions. */
export function buildAdminContentPackage(state: WorkspaceState, options: Pick<Parameters<typeof exportContentPackage>[1], "packageId" | "publisherId" | "createdAt" | "withdrawals">) {
  if (!canReadTeachingContent(state)) throw new Error("当前身份无权导出教研内容包。");
  return exportContentPackage(state, { packageId: options.packageId, publisherId: options.publisherId, createdAt: options.createdAt, withdrawals: options.withdrawals });
}

export function ContentPackagePanel({ state, busy }: Pick<AppProps, "state" | "busy">) {
  const [publisherId, setPublisherId] = useState("xiaohe-local-trial");
  const [withdrawals, setWithdrawals] = useState<string[]>([]);
  const [error, setError] = useState<{ message: string; phase: "validation" | "download" } | null>(null);
  const [download, setDownload] = useState<{ packageId: string; digest: string; count: number; withdrawals: number; createdAt: string } | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => { const active = urls.current; return () => { for (const url of active) URL.revokeObjectURL(url); active.clear(); }; }, []);
  if (!canReadTeachingContent(state)) return null;
  const published = state.questions.filter(question => question.status === "published");
  const disabled = state.questions.filter(question => question.status === "disabled");
  const staleWithdrawals = withdrawals.filter(id => !disabled.some(question => question.id === id));
  const create = (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError(null); setDownload(null);
    let validated = false;
    try {
      const contentPackage = buildAdminContentPackage(state, { packageId: `local-${crypto.randomUUID()}`, publisherId: publisherId.trim(), createdAt: new Date().toISOString(), withdrawals });
      validated = true;
      const url = URL.createObjectURL(new Blob([JSON.stringify(contentPackage, null, 2)], { type: "application/json;charset=utf-8" }));
      urls.current.add(url);
      const link = document.createElement("a");
      link.href = url; link.download = `xiaohe-content-${contentPackage.packageId}.json`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      setDownload({ packageId: contentPackage.packageId, digest: contentPackage.digest, count: contentPackage.items.length, withdrawals: contentPackage.withdrawals.length, createdAt: contentPackage.createdAt });
      window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 60_000);
    } catch (caught) { setError({ message: caught instanceof Error ? caught.message : "未能生成内容包，请重新检查题目与导出设置。", phase: validated ? "download" : "validation" }); }
  };
  return <section className="admin-panel admin-content-export" aria-labelledby="admin-content-export-heading">
    <div className="admin-panel-heading"><div><h2 id="admin-content-export-heading">本地试用内容包</h2><p>{published.length} 道已发布候选；所有候选均须通过完整字段与独立审核校验，不静默跳过问题题目。</p></div><span className="admin-status admin-status-review"><span />未签名 · 仅本地试用</span></div>
    <form onSubmit={create} className="admin-content-export-form"><p className="admin-body-copy">仅包含四年级数学题目、教学标注和明确选中的撤回题号，不包含学生档案、试卷、作答、照片或私人对话。摘要用于检查内容一致性，不能验证发行人身份或代替教材授权、教学有效性验证。</p>
      <label className="field">本地发行标识<input className="input" value={publisherId} disabled={busy} required maxLength={150} pattern="[A-Za-z0-9_.:-]+" title="使用英文字母、数字、下划线、点、冒号或连字符，最多150个字符" onChange={event => { setPublisherId(event.target.value); setDownload(null); }} /></label><p className="admin-footnote">用于区分本地来源；不是经过认证的机构名称。不自动使用学习档案或个人账号作为标识。</p>
      <details className="admin-content-withdrawals"><summary>选择撤回题号（可选，当前 {disabled.length} 道已停用）</summary><p className="admin-footnote">只有明确勾选的题号会进入撤回清单。接收端确认导入后才会停用对应题目；导出不会修改任何设备题库或删除旧卷。</p>{disabled.length ? disabled.map(question => <label key={question.id}><input type="checkbox" checked={withdrawals.includes(question.id)} disabled={busy} onChange={event => { setWithdrawals(previous => event.target.checked ? [...previous, question.id] : previous.filter(id => id !== question.id)); setDownload(null); }} /><span>{question.text}<small>{question.id} · v{question.version}</small></span></label>) : <p className="admin-footnote">暂无可选择的已停用题目。</p>}{staleWithdrawals.length > 0 && <div className="admin-form-error"><p>以下已选题目的状态发生变化，请确认后取消选择，或恢复其已停用状态再导出：</p>{staleWithdrawals.map(id => <button type="button" className="btn btn-ghost" key={id} onClick={() => setWithdrawals(previous => previous.filter(value => value !== id))}>取消选择 {id}</button>)}</div>}</details>
      {error && <div className="admin-form-error" role="alert"><strong>{error.phase === "validation" ? "校验未通过，未生成内容包" : "校验已通过，下载尚未确认"}</strong><p>{error.message}</p><p>{error.phase === "validation" ? "没有跳过问题题目或导出部分内容；当前设置仍保留，请修正后重试。" : "请检查浏览器下载目录与权限后重试，当前设置仍保留。"}</p></div>}
      {download && <div className="admin-content-download" role="status"><strong>已发起本地文件下载</strong><p>{download.count} 道题 · {download.withdrawals} 条撤回指令 · {time(download.createdAt)}。请在浏览器下载目录确认文件；尚未安装到手机，也没有云发布。</p><dl className="admin-detail-meta"><div><dt>包编号</dt><dd>{download.packageId}</dd></div><div><dt>内容摘要</dt><dd>{download.digest}</dd></div></dl></div>}
      <div className="admin-content-export-actions"><span className="admin-footnote">全量校验 {published.length} 道已发布候选 · 已选 {withdrawals.length} 条撤回</span><button className="btn btn-primary" disabled={busy} type="submit"><ArrowDownToLine size={16} />校验并下载内容包</button></div>
    </form>
  </section>;
}

export function ContentArchivePanel({ state, onSelect }: { state: WorkspaceState; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  if (!canReadTeachingContent(state)) return null;
  const versions = [...(state.content?.versions ?? [])].filter(version => (source === "all" || version.source === source) && `${version.questionId} ${version.question.familyId} ${version.question.text}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.questionId.localeCompare(b.questionId) || b.version - a.version);
  return <section className="admin-panel" aria-labelledby="admin-content-archives-heading"><div className="admin-panel-heading"><div><h2 id="admin-content-archives-heading">不可变题目归档 <span>{state.content?.versions.length ?? 0}</span></h2><p>只读查看已持久化的题目与解法快照。早期未保存的修订不会补造，归档状态也不表示当前仍可组卷。</p></div></div><div className="admin-filters"><label className="admin-search"><Search size={17} /><input aria-label="搜索归档题号、题族或题干" placeholder="搜索题号、题族或题干…" value={query} onChange={event => setQuery(event.target.value)} /></label><select className="admin-filter-select" aria-label="筛选归档来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部归档来源</option>{Object.entries(contentSourceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{versions.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>题目 / 归档版本</th><th>归档来源</th><th>快照中的状态</th><th>内容摘要</th><th>操作</th></tr></thead><tbody>{versions.map(version => <tr key={version.id}><td className="admin-question-cell"><strong>{version.question.text}</strong><small>{version.questionId} · v{version.version}</small></td><td>{contentSourceNames[version.source]}<small>{version.sourceBatchId || "无内容包批次"}</small></td><td><StatusBadge status={version.question.status} /></td><td><code title={version.digest}>{version.digest.slice(0, 16)}…</code></td><td><button className="admin-row-action" onClick={() => onSelect(version.id)}>查看归档<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <Empty title="暂无符合条件的归档" description="这里只显示已保存的版本记录；不会根据当前题目推测缺失的历史内容。" />}</section>;
}

export function ContentVersionDetail({ version, state }: { version: ContentVersion; state: WorkspaceState }) {
  if (!canReadTeachingContent(state)) return null;
  const question = version.question;
  return <div className="admin-content-version-detail"><div className="admin-detail-title"><span className="admin-kicker">{version.questionId} · v{version.version}</span><span className="admin-status admin-status-draft"><span />只读归档</span></div><h2 className="admin-question-heading">{question.text}</h2><p className="admin-footnote">这是保存时的内容快照。修改当前题目、停用或回退批次均不在此处改写归档；是否参与新组卷以当前题库状态为准。</p><div className="admin-answer">参考答案<strong>{question.answer} {question.unit}</strong></div><dl className="admin-detail-meta"><div><dt>知识点 / 任务类型</dt><dd>{qName(state, question.knowledgeId)} · {question.taskType ? taskNames[question.taskType] : "旧记录未标注"}</dd></div><div><dt>题族 / 情境</dt><dd>{question.familyId} · {question.contextId || "旧记录未标注"}</dd></div><div><dt>内容来源 / 使用范围</dt><dd>{question.source} · {question.sourceScope}</dd></div><div><dt>作者 / 审核人</dt><dd>{question.authorId} / {question.reviewerId || "未记录审核人"}</dd></div><div><dt>归档来源 / 批次</dt><dd>{contentSourceNames[version.source]} / {version.sourceBatchId || "无内容包批次"}</dd></div><div><dt>快照状态</dt><dd>{statusNames[question.status]}</dd></div><div><dt>归档编号</dt><dd>{version.id}</dd></div><div><dt>内容摘要</dt><dd>{version.digest}</dd></div></dl><div className="admin-solution-section"><h3>分层提示</h3><blockquote>{question.hint || "旧记录未填写"}</blockquote><h3>分步讲解</h3><ol className="admin-step-list">{question.steps.map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol><h3>其他方法</h3><p>{question.alternative || "未标注其他方法"}</p><h3>前置知识</h3><p>{question.prerequisites.join("、") || "未设置"}</p>{question.reviewNote && <><h3>保存时的审核意见</h3><p>{question.reviewNote}</p></>}</div></div>;
}

export function ContentBatchHistory({ state, onSelect }: { state: WorkspaceState; onSelect: (id: string) => void }) {
  if (!canReadTeachingContent(state)) return null;
  const batches = [...(state.content?.batches ?? [])].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  const pointer = (value: ContentBatch["changes"][number]["before"]) => {
    if (!value) return <span className="admin-footnote">无当前条目</span>;
    const version = state.content?.versions.find(item => item.id === value.versionId);
    return <div className="admin-content-pointer"><span>{version ? `v${version.version}` : "版本记录未提供"} · {statusNames[value.status]}</span>{version ? <button className="admin-text-link" onClick={() => onSelect(version.id)}>查看只读归档<ChevronRight size={13} /></button> : <small>{value.versionId}</small>}</div>;
  };
  return <section className="admin-panel" aria-labelledby="admin-content-batches-heading"><div className="admin-panel-heading"><div><h2 id="admin-content-batches-heading">本工作区内容批次 <span>{batches.length}</span></h2><p>展示实际保存的应用、停用与回退记录。这里只读查看；手机端本地导入的记录不会自动同步到本工作区。</p></div></div>{batches.length ? <div className="admin-content-batches">{batches.map(batch => <details key={batch.id}><summary><span><strong>{batch.packageId}</strong><small>{time(batch.appliedAt)} · 本地发行标识 {batch.publisherId}</small></span><span className={`admin-status ${batch.status === "rolled-back" ? "admin-status-disabled" : "admin-status-published"}`}><span />{batch.status === "rolled-back" ? "已回退" : "已应用"}</span><ChevronRight size={16} /></summary><div className="admin-content-batch-body"><dl className="admin-detail-meta"><div><dt>批次编号</dt><dd>{batch.id}</dd></div><div><dt>包摘要</dt><dd>{batch.digest}</dd></div></dl>{batch.status === "rolled-back" && <p className="admin-body-copy">回退时间：{batch.rolledBackAt ? time(batch.rolledBackAt) : "未记录"}；原因：{batch.reason || "未记录"}。下表保留原应用时的变化，当前题库以现有状态为准。</p>}<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>题目编号</th><th>应用前</th><th>应用后</th></tr></thead><tbody>{batch.changes.map((change, index) => <tr key={`${change.questionId}-${index}`}><td>{change.questionId}</td><td>{pointer(change.before)}</td><td>{pointer(change.after)}</td></tr>)}</tbody></table></div></div></details>)}</div> : <Empty title="暂无已保存的内容批次" description="导出文件不会生成导入批次。收到并确认应用内容包后，目标设备才会保存对应记录。" />}</section>;
}

function EventLog({ events }: { events: WorkspaceState["events"] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>操作记录 <span>{events.length}</span></h2><p>保留操作人、时间与具体变化。</p></div>{events.length > 8 && <button className="admin-text-link" onClick={() => setExpanded(!expanded)}>{expanded ? "收起记录" : "查看全部"}<ChevronRight size={14} /></button>}</div>{sorted.length ? <div className="admin-event-list">{(expanded ? sorted : sorted.slice(0, 8)).map((event) => <div key={event.id}><span className="admin-event-dot" /><div><strong>{event.label}</strong><p>{event.detail}</p><small>{event.actorId} · {time(event.createdAt)}</small></div></div>)}</div> : <div className="admin-small-empty">内容录入、审核与学习操作会留下可追溯的记录。</div>}</section>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="admin-modal-backdrop"><div className="admin-modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}><header className="admin-modal-header"><h2>{title}</h2><button ref={closeRef} onClick={onClose} className="admin-icon-button" aria-label="关闭对话框"><X size={20} /></button></header><div className="admin-modal-body">{children}</div></div></div>;
}

function QuestionEditor({ question, state, busy, mutate, onSave, onClose }: { question?: Question; state: WorkspaceState; busy: boolean; mutate: AppProps["mutate"]; onSave: (result: ApiResult) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<FormDraft>(question ? toDraft(question) : emptyDraft());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const locked = busy || saving;
  const contexts = [...new Set(state.questions.filter(item => item.knowledgeId === draft.knowledgeId && item.contextId).map(item => item.contextId!))];
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || savingRef.current) return; setError("");
    const values = { ...draft, contextId: draft.contextId.trim(), text: draft.text.trim(), answer: draft.answer.trim(), unit: draft.unit.trim(), source: draft.source.trim(), sourceScope: draft.sourceScope.trim(), steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean), hint: draft.hint.trim(), alternative: draft.alternative.trim(), prerequisites: draft.prerequisites.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean) };
    if (!values.text || !values.answer || !values.source || !values.sourceScope || !values.steps.length || !values.hint) { setError("请补全题干、参考答案、来源、使用范围、分步讲解和提示。"); return; }
    if (!values.taskType || !values.contextId) { setError("请人工确认教学任务类型并填写情境标识；不能仅按题目难度自动推断。"); return; }
    savingRef.current = true; setSaving(true);
    try {
    const result = await mutate(question ? "question.update" : "question.create", question ? { id: question.id, question: values } : { question: values });
    if (result) onSave(result);
    else setError("保存未完成，请检查错误提示后重试，当前填写的内容仍保留。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存未成功，当前内容已保留。"); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <Modal title={question ? question.status === "draft" ? "编辑题目草稿" : "修订题目并重新送审" : "新建教研题目"} onClose={() => { if (!locked) onClose(); }}><form onSubmit={save} className="admin-editor"><p className="admin-form-intro">题目与解法一起保存。{question && question.status !== "draft" ? "本次保存会增加当前题目的修订号并回到草稿，暂时退出可组卷题库，需重新审核发布。已有题目归档、试卷与证据快照不变；早期未曾保存的修订不会补造。" : "保存后仍为草稿，提交独立审核并发布后，学生才可使用。"}</p>{error && <div className="admin-form-error" role="alert">{error}</div>}<fieldset disabled={locked}><legend><span>01</span>题目与答案</legend><label className="field">题干 <span className="admin-required">*</span><textarea className="textarea" rows={3} value={draft.text} required onChange={(e) => set("text", e.target.value)} placeholder="完整填写题目，保留数字、单位与必要条件" /></label><div className="admin-form-grid"><label className="field">参考答案 <span className="admin-required">*</span><input className="input" value={draft.answer} required onChange={(e) => set("answer", e.target.value)} placeholder="例如：400" /></label><label className="field">答案单位<input className="input" value={draft.unit} onChange={(e) => set("unit", e.target.value)} placeholder="无单位可留空" /></label><label className="field">知识点<select className="select" value={draft.knowledgeId} onChange={(e) => set("knowledgeId", e.target.value as KnowledgeId)}>{state.knowledge.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label><label className="field">难度<select className="select" value={draft.difficulty} onChange={(e) => set("difficulty", e.target.value as Question["difficulty"])}><option>基础</option><option>巩固</option><option>挑战</option></select></label></div></fieldset><fieldset disabled={locked}><legend><span>02</span>任务类型与情境标注</legend><div className="admin-form-grid"><label className="field">教学任务类型 <span className="admin-required">*</span><select className="select" required value={draft.taskType} onChange={event => set("taskType", event.target.value as FormDraft["taskType"])}><option value="">请选择，不根据难度推断</option><option value="basic">基础任务</option><option value="application">应用任务</option><option value="transfer">迁移任务</option></select></label><label className="field">情境标识 <span className="admin-required">*</span><input className="input" required maxLength={100} list="admin-question-contexts" value={draft.contextId} onChange={event => set("contextId", event.target.value)} placeholder="例如：平均分物品、长方形围栏" /><datalist id="admin-question-contexts">{contexts.map(context => <option key={context} value={context} />)}</datalist></label></div><div className="admin-teaching-labels"><p><strong>基础任务：</strong>直接运用已经学习的核心概念或方法；与题目的“基础/巩固/挑战”难度分开判断。</p><p><strong>应用任务：</strong>在具体情境中选择并运用已学方法。相同情境复用同一标识，不为每道题新建标识来扩大情境覆盖。</p><p><strong>迁移任务：</strong>在适龄的新情境中选择、组合或调整已学方法；不能用超纲知识或单纯提高计算量代替迁移。</p><p>这些是本地试用的人工教学标注，需要独立教研复核。标为迁移题并不等于学生已掌握迁移；五星还要求到期复查、全新题族及真实独立作答。旧试卷与旧证据缺少的标签不回填、不猜测。</p></div></fieldset><fieldset disabled={locked}><legend><span>03</span>来源与使用范围</legend><label className="field">内容来源 <span className="admin-required">*</span><input className="input" required value={draft.source} onChange={(e) => set("source", e.target.value)} placeholder="例如：教研自编样卷 A · 第 1 页第 5 题" /></label><label className="field">允许使用的范围 <span className="admin-required">*</span><input className="input" required value={draft.sourceScope} onChange={(e) => set("sourceScope", e.target.value)} placeholder="例如：演示教学 / 已授权校内教学" /></label><p className="admin-field-help">请根据实际授权填写；来源或授权不明的材料不要发布。</p></fieldset><fieldset disabled={locked}><legend><span>04</span>教学解法与提示</legend><label className="field">分层提示 <span className="admin-required">*</span><textarea className="textarea" rows={2} required value={draft.hint} onChange={(e) => set("hint", e.target.value)} placeholder="先引导孩子从哪里想，避免直接给出答案" /></label><label className="field">分步讲解 <span className="admin-required">*</span><textarea className="textarea" rows={5} required value={draft.steps} onChange={(e) => set("steps", e.target.value)} placeholder={"每行填写一个步骤，例如：\n先用乘法估算商的范围。\n计算后用乘法验算。"} /></label><label className="field">其他方法<textarea className="textarea" rows={3} value={draft.alternative} onChange={(e) => set("alternative", e.target.value)} placeholder="可选：补充另一种适龄思路，并注明适用条件" /></label><label className="field">前置知识<input className="input" value={draft.prerequisites} onChange={(e) => set("prerequisites", e.target.value)} placeholder="用顿号分隔，例如：整数乘法、乘法结合律" /></label></fieldset><div className="admin-modal-footer"><span className="admin-footnote">保存后可继续提交审核</span><div className="admin-actions"><button type="button" className="btn btn-secondary" disabled={locked} onClick={onClose}>取消</button><button className="btn btn-primary" type="submit" disabled={locked}><Check size={16} />{locked ? "正在保存…" : "保存草稿"}</button></div></div></form></Modal>;
}

function ReviewDialog({ question, state, busy, mutate, onClose, onDone }: { question: Question; state: WorkspaceState; busy: boolean; mutate: AppProps["mutate"]; onClose: () => void; onDone: (result: ApiResult) => void }) {
  const [checks, setChecks] = useState([false, false, false, false]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const decide = async (decision: "approve" | "reject") => {
    setError("");
    if (decision === "approve" && !checks.every(Boolean)) { setError("请先完成四项人工核对，再通过审核。"); return; }
    if (decision === "reject" && !note.trim()) { setError("请填写退回原因，帮助标注人员明确需要补充的内容。"); return; }
    const result = await mutate("question.review", { id: question.id, decision, note: note.trim() || "已核对答案、适龄性和内容来源。" });
    if (result) onDone(result);
    else setError("审核未完成，请检查错误提示后重试，审核意见仍保留。");
  };
  return <Modal title="独立教研审核" onClose={onClose}><span className="admin-kicker">{question.id} · v{question.version}</span><h2 className="admin-question-heading">{question.text}</h2><div className="admin-answer">参考答案<strong>{question.answer} {question.unit}</strong></div><div className="admin-solution-section"><h3>分步讲解</h3><ol className="admin-step-list">{question.steps.map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol><h3>提示</h3><blockquote>{question.hint}</blockquote><h3>其他方法 / 前置知识</h3><p>{question.alternative || "未标注其他方法"}</p><p className="muted">{question.prerequisites.join("、") || "未设置额外前置知识"}</p></div><dl className="admin-detail-meta"><div><dt>课程知识点</dt><dd>{qName(state, question.knowledgeId)} · {question.difficulty}</dd></div><div><dt>来源 / 范围</dt><dd>{question.source} / {question.sourceScope}</dd></div><div><dt>教学任务 / 情境</dt><dd>{question.taskType ? taskNames[question.taskType] : "任务未标注"} · {question.contextId || "情境未标注"}</dd></div><div><dt>标注人</dt><dd>{question.authorId}</dd></div><div><dt>当前审核人</dt><dd>{state.actor.name}</dd></div></dl><div className="admin-review-checks">{["参考答案与每一步计算一致", "教学方法适配当前课程及前置知识", "内容来源与允许使用范围明确", "任务类型与情境标注已人工核对；缺标注不会推断为独立等级证据"].map((label, i) => <label key={label}><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((value, j) => j === i ? e.target.checked : value))} /><span>{label}</span></label>)}</div><label className="field">审核意见<textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="说明审核结论；退回时请明确需要修正的内容" /></label>{error && <p className="admin-form-error" role="alert">{error}</p>}<div className="admin-modal-footer"><span className="admin-footnote">{checks.every(Boolean) ? "通过后还需单独发布" : `请先完成四项核对（已完成 ${checks.filter(Boolean).length}/4）；通过后还需单独发布。`}</span><div className="admin-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => decide("reject")}>退回补充</button><button className="btn btn-primary" disabled={busy || !checks.every(Boolean)} onClick={() => decide("approve")}><ShieldCheck size={16} />通过审核</button></div></div></Modal>;
}
