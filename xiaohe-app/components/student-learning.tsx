"use client";
import { learningDraftStillAvailable } from "@/lib/learning-cache-cleanup";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, FileCheck2, FileText, History, Lightbulb, ListChecks, LockKeyhole, Pencil, Plus, RefreshCw, Save, ShieldCheck, Sparkles, Sprout, Star, Target, X } from "lucide-react";
import { workspaceUrl } from "@/lib/client";
import { reviewAvailableAt } from "@/lib/server/mastery";
import type { AppProps, View } from "@/lib/ui-types";
import { effectiveEvidence, effectiveAttempt, effectiveMistakes, effectiveReviewSource } from "@/lib/effective-evidence";
import { EvidenceComparison, evidenceAuthorityNames } from "./evidence-review-workspace";
import { firstUnansweredIndex, practiceSection } from "@/lib/student-navigation";
import type { Answer, EffectiveEvidence, HelpLevel, KnowledgeId, Paper, Profile } from "@/lib/types";
import { curriculumCatalog } from "@/lib/curriculum-catalog";
import { exerciseByPoint } from "@/lib/curriculum-practice";
import { curriculumExplanations } from "@/lib/curriculum-explanations";
import "./student-learning.css";

const knowledgeNames: Record<KnowledgeId, string> = { division: "估商与检验", geometry: "周长与面积", multiplication: "乘法与运算" };
const curriculumDraftEvent = "xiaohe:curriculum-draft";
const subscribeCurriculumDraft = (onChange: () => void) => {
  window.addEventListener(curriculumDraftEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(curriculumDraftEvent, onChange); window.removeEventListener("storage", onChange); };
};
const helpNames: Record<HelpLevel, string> = { independent: "独立作答", hint: "使用提示", explanation: "看过讲解", unknown: "帮助情况待确认" };
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "尚未提交";
const latestAttempt = (props: AppProps, paperId: string) => [...props.state.attempts].reverse().find(a => a.paperId === paperId);

function Heading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="learn-page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{text}</p></div>{action}</div>;
}
function Stars({ count }: { count: number | null }) {
  return <div className="learn-stars" aria-label={count === null ? "暂无星级" : `${count} 星，共 5 星`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={19} fill={count !== null && index < count ? "currentColor" : "none"} className={count !== null && index < count ? "is-filled" : ""} />)}</div>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="card empty-state learn-empty"><Sprout size={40} /><h3>{title}</h3><p className="muted">{text}</p>{action}</div>;
}
function EvidenceRow({ evidence, onOpen }: { evidence: EffectiveEvidence; onOpen: () => void }) {
  return <div className="learn-evidence-row"><span className={`learn-evidence-icon ${evidence.correct ? "is-correct" : "is-pending"}`}>{evidence.correct ? <Check size={17} /> : <Pencil size={16} />}</span><div><div className="learn-meta"><span>{formatDate(evidence.createdAt)}</span><span>{evidence.kind === "review" ? "新题复查" : evidence.kind === "original" ? "原始作答" : "巩固练习"}</span><span>{helpNames[evidence.help]}</span></div><p>{evidence.questionText}</p><span className="muted">我的答案：{evidence.answer || "未作答"} · {!evidence.valid ? "已排除，不计学习结果" : evidence.correct ? "回答正确" : "待订正"}</span><p className="learn-evidence-reason">{evidenceAuthorityNames[evidence.authority]}{evidence.masteryBlockedReason ? ` · ${evidence.masteryBlockedReason}` : evidence.reason ? ` · ${evidence.reason}` : ""}</p></div><button type="button" className="btn btn-ghost learn-icon-button" aria-label="查看这次作答报告" onClick={onOpen}><ChevronRight size={19} /></button></div>;
}

function KnowledgePage(props: AppProps) {
  const { state, navigate, selectedId } = props;
  const [expanded, setExpanded] = useState<string | null>(selectedId ?? null);
  const [subjectId, setSubjectId] = useState(() => curriculumCatalog.find(subject => subject.units.some(unit => unit.points.some(point => (!!selectedId && (point.id === selectedId || point.practiceId === selectedId)))))?.id ?? props.curriculumSubjectId ?? curriculumCatalog.find(subject => subject.name === state.profile.course)?.id ?? "math");
  const subject = curriculumCatalog.find(item => item.id === subjectId)!;
  const [unitId, setUnitId] = useState(() => subject.units.find(unit => unit.points.some(point => (!!selectedId && (point.id === selectedId || point.practiceId === selectedId))))?.id ?? subject.units[0].id);
  const [pointId, setPointId] = useState<string | null>(() => subject.units.flatMap(unit => unit.points).find(point => (!!selectedId && (point.id === selectedId || point.practiceId === selectedId)))?.id ?? null);
  const switchSubject = (id: string) => {
    const next = curriculumCatalog.find(item => item.id === id);
    if (!next || next.id === subjectId) return;
    setSubjectId(next.id);
    props.onCurriculumSubjectChange?.(next.id);
    setUnitId(next.units[0].id);
    setPointId(null);
    setExpanded(null);
  };
  const unit = subject.units.find(item => item.id === unitId) ?? subject.units[0];
  const point = unit.points.find(item => item.id === pointId);
  const livePoint = point?.practiceId && state.knowledge.find(item => item.id === point.practiceId);
  const activeRule = state.mastery?.rules.find(rule => rule.id === state.mastery?.activeRuleId);
  return <div className="learn-page"><Heading eyebrow="KNOWLEDGE MAP" title="知识地图" text="选择科目和单元，学习知识点解释，再做对应练习。" />
    <section className="card learn-route"><div className="learn-section-icon"><BookOpen size={25} /></div><div className="learn-route-copy"><label className="eyebrow" htmlFor="learn-route-subject">我的课程路线 · 切换学科</label><select id="learn-route-subject" className="learn-route-subject" value={subjectId} onChange={event => switchSubject(event.target.value)} aria-label="切换学科">{curriculumCatalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="muted">{state.profile.grade} · {state.profile.semester} · {subject.edition}</p></div><span className="badge">{subject.units.length} 个单元</span></section>
    <div className="learn-section-heading"><h2>科目 · 单元 · 知识点</h2><span className="muted">四年级上册 · 按教材单元浏览</span></div>
    <div className="learn-catalog-source"><span>{subject.edition} · 按单元学习知识点</span><a href={subject.sourceUrl} target="_blank" rel="noopener noreferrer">查看版本依据 <ArrowRight size={14} /></a></div>
    <div className="learn-catalog-browser"><nav className="card learn-unit-nav" aria-label={`${subject.name}单元`}><span className="eyebrow">01 选择单元</span>{subject.units.map((item, index) => <button key={item.id} type="button" className={item.id === unit.id ? "is-active" : ""} aria-current={item.id === unit.id ? "step" : undefined} onClick={() => { setUnitId(item.id); setPointId(null); setExpanded(null); }}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}<ChevronRight size={16} /></button>)}</nav>
      <section className="card learn-point-panel"><div className="learn-point-panel-heading"><div><span className="eyebrow">02 选择知识点</span><h3>{subject.name} / {unit.name}</h3></div><span className="badge">{unit.points.length} 个知识点</span></div><div className="learn-point-list">{unit.points.map(item => <button key={item.id} type="button" className={item.id === pointId ? "is-active" : ""} aria-pressed={item.id === pointId} onClick={() => { setPointId(item.id); setExpanded(null); }}><span><strong>{item.name}</strong><small>查看知识点解释</small></span><ChevronRight size={17} /></button>)}</div>{point ? <div className="learn-point-detail"><span className="eyebrow">03 知识点解释</span><h3>{point.name}</h3><p>{curriculumExplanations[point.id]}</p><button className="btn btn-secondary" onClick={() => navigate("papers", point.id)}>去我的练习做对应题目 <ArrowRight size={16} /></button></div> : <p className="learn-point-placeholder">选择一个知识点，查看解释。</p>}</section></div>
    {livePoint && <div className="learn-section-heading"><h2>这个知识点的学习证据</h2><span className="muted">星级描述近期表现，点击查看依据</span></div>}
    {livePoint && <div className="learn-knowledge-grid">{state.knowledge.filter(item => item.id === livePoint.id).map((item, index) => {
      const evidence = effectiveEvidence(state).filter(e => e.knowledgeId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const open = expanded === item.id;
      return <section className={`card learn-knowledge-card ${open ? "is-open" : ""}`} key={item.id}>
        <div className="learn-card-top"><span className={`learn-knowledge-mark mark-${index}`}><Target size={24} /></span><span className="badge">{item.learningState === "upcoming" ? "接下来学" : "正在学习"}</span></div>
        <h3>{item.name}</h3><p className="muted learn-knowledge-description">{item.description}</p><div className="learn-star-line"><Stars count={item.stars} /><span>{item.learningState === "upcoming" ? "未学习" : item.stars === null ? "待评估" : `${item.stars} 星`}</span></div>
        <p className="learn-knowledge-reason">{item.reason}</p><div className="learn-card-bottom"><button className="btn btn-ghost" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}>{open ? "收起作答证据" : `查看 ${evidence.length} 条证据`}<ChevronDown size={16} className={open ? "learn-rotate" : ""} /></button><button className="btn btn-secondary" disabled={item.learningState === "upcoming"} onClick={() => navigate("papers", item.id)}>练一练<ArrowRight size={16} /></button></div>
        {open && <div className="learn-evidence-list"><div className="learn-evidence-caption"><ShieldCheck size={16} />相关作答（含未采用记录）· 规则 {item.ruleVersion}</div>{evidence.length ? evidence.slice(0, 8).map(e => <EvidenceRow key={e.id} evidence={e} onOpen={() => navigate("report", e.attemptId)} />) : <p className="muted">还没有足够的作答证据。完成适合当前进度的练习后，再来看看。</p>}{evidence.length > 8 && <p className="muted">此处展示最近 8 条，可在我的试卷中查看全部报告。</p>}</div>}
      </section>;
    })}</div>}
    <details className="learn-understanding"><summary>了解星级与作答证据</summary><div><p>一星：关键步骤仍需讲解；二星：提示后能够完成；三星：基础任务能够独立；四星：不同情境稳定运用；五星：间隔后独立迁移。</p><p>未学习和待评估分别显示，没有足够证据时不显示零星。只看答案不加星，重复原题和纸面自述不能替代独立新题，单次错误不会立即降星。</p>{activeRule && <p>当前规则：{activeRule.name} · V{activeRule.version}。{activeRule.mode === "legacy-pilot" ? "当前仍采用历史三星试点规则，完整五星规则需由管理员发布后生效。" : "当前已启用完整五星评定。"}这是本地试用规则，教学有效性仍待验证。历史评定保留当时的规则与依据，重新评定后另留记录。</p>}</div></details>
  </div>;
}

function PapersPage(props: AppProps) {
  const paper = props.state.papers.find(p => p.id === props.selectedId);
  return paper ? <PaperPreview {...props} paper={paper} key={paper.id} /> : <PaperList {...props} key={props.selectedId ?? "all-papers"} />;
}
function CurriculumPractice({ selectedId, preferredSubjectId, onSubjectChange, workspaceId, actorId, navigate }: { navigate: AppProps["navigate"]; selectedId?: string; preferredSubjectId?: string; onSubjectChange?: (id: string) => void; workspaceId?: string; actorId: string }) {
  const initial = curriculumCatalog.flatMap(subject => subject.units.flatMap(unit => unit.points.map(point => ({ subject, unit, point })))).find(item => item.point.id === selectedId);
  const [subjectId, setSubjectId] = useState(initial?.subject.id ?? preferredSubjectId ?? "math");
  const subject = curriculumCatalog.find(item => item.id === subjectId)!;
  const [unitId, setUnitId] = useState(initial?.unit.id ?? subject.units[0].id);
  const unit = subject.units.find(item => item.id === unitId) ?? subject.units[0];
  const [pointId, setPointId] = useState(initial?.point.id ?? unit.points[0].id);
  const point = unit.points.find(item => item.id === pointId) ?? unit.points[0];
  const exercise = exerciseByPoint.get(point.id);
  const [revealedPoint, setRevealedPoint] = useState<string | null>(null);
  const [memoryAnswers, setMemoryAnswers] = useState<Record<string, string>>({});
  const draftKey = `xiaohe:curriculum:${workspaceId ?? "local"}:${actorId}:${point.id}`;
  const persistedAnswer = useSyncExternalStore(subscribeCurriculumDraft, () => { try { return window.localStorage.getItem(draftKey) ?? ""; } catch { return ""; } }, () => "");
  const answer = memoryAnswers[point.id] ?? persistedAnswer;
  const saveAnswer = (value: string) => { setMemoryAnswers(previous => ({ ...previous, [point.id]: value })); try { window.localStorage.setItem(draftKey, value); window.dispatchEvent(new Event(curriculumDraftEvent)); setStorageFailed(false); } catch { setStorageFailed(true); } };
  const revealed = revealedPoint === point.id;
  const orderedPoints = subject.units.flatMap(item => item.points.map(p => ({ unitId: item.id, point: p })));
  const next = orderedPoints[orderedPoints.findIndex(item => item.point.id === point.id) + 1];
  const [storageFailed, setStorageFailed] = useState(false);
  return <section className="card learn-curriculum-practice" aria-label="按教材知识点练习">
    <div className="learn-section-heading"><div><span className="eyebrow">教材知识点练习</span><h2>选一个知识点，做一道对应练习</h2></div><span className="badge">原创自练题</span></div>
    <div className="learn-curriculum-picker"><label className="field">科目<select className="select" value={subject.id} onChange={event => { const next = curriculumCatalog.find(item => item.id === event.target.value)!; setSubjectId(next.id); onSubjectChange?.(next.id); setUnitId(next.units[0].id); setPointId(next.units[0].points[0].id); }}>{curriculumCatalog.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field">单元<select className="select" value={unit.id} onChange={event => { const next = subject.units.find(item => item.id === event.target.value)!; setUnitId(next.id); setPointId(next.points[0].id); }}>{subject.units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field">知识点<select className="select" value={point.id} onChange={event => setPointId(event.target.value)}>{unit.points.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
    {exercise && <div className="learn-curriculum-question"><span className="eyebrow">{point.name}</span><h3>{exercise.question}</h3><label className="field">我的答案<textarea className="textarea" rows={3} maxLength={1000} value={answer} onChange={event => saveAnswer(event.target.value)} placeholder="先独立想一想，再写下答案" /></label><button className="btn btn-secondary" type="button" onClick={() => setRevealedPoint(revealed ? null : point.id)}>{revealed ? "收起参考解答" : "查看参考解答"}<ChevronDown size={16} /></button>{revealed && <div className="learn-curriculum-reference"><strong>参考解答</strong><p>{exercise.reference}</p></div>}<div className="practice-next"><button className="text-link" onClick={() => navigate("knowledge", point.id)}><BookOpen size={16}/>回看知识点讲解</button>{next ? <button className="btn btn-secondary" onClick={() => { setUnitId(next.unitId); setPointId(next.point.id); setRevealedPoint(null); }}>下一知识点<ArrowRight size={16}/></button> : <span className="muted">已到本科目最后一个知识点</span>}</div><p className="learn-small-note" role="status">{storageFailed ? "浏览器无法保存，当前答案仅保留到离开页面前。" : "答案草稿保存在当前浏览器。"}自练题不计入正式学习报告。</p></div>}
  </section>;
}
function PaperList(props: AppProps) {
  const { state, mutate, navigate, busy, selectedId } = props;
  const mode = practiceSection(selectedId);
  const scoped = state.knowledge.some(k => k.id === selectedId) ? selectedId as KnowledgeId : null;
  const [configOpen, setConfigOpen] = useState(Boolean(scoped) || selectedId === "configure");
  const [count, setCount] = useState(scoped ? 3 : 6);
  const [difficulty, setDifficulty] = useState("基础");
  const [selected, setSelected] = useState<KnowledgeId[]>(scoped ? [scoped] : state.knowledge.filter(k => k.learningState === "current").map(k => k.id));
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const create = async () => {
    if (!selected.length || creating) return;
    setCreating(true);
    try { const result = await mutate("paper.create", { count, knowledgeIds: selected, difficulty, kind: "practice" }); if (result?.result?.id) navigate("papers", result.result.id); } finally { setCreating(false); }
  };
  const papers = [...state.papers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(p => filter === "all" || (filter === "completed" ? p.status === "completed" : p.status !== "completed"));
  return <div className="learn-page"><Heading eyebrow="PRACTICE" title="我的练习" text="单题巩固、试卷训练与练习记录，各有一个清楚的入口。" />
    <nav className="task-tabs" aria-label="练习方式">{[{id:"points",label:"知识点练习"},{id:"sets",label:"组卷训练"},{id:"history",label:"练习记录"}].map(tab => <button key={tab.id} aria-current={mode === tab.id ? "page" : undefined} className={mode === tab.id ? "active" : ""} onClick={() => navigate("papers",tab.id === "points" ? undefined : tab.id)}>{tab.label}</button>)}<button onClick={() => navigate("camera")}>拍照与回传</button></nav>
    {mode === "points" && <CurriculumPractice navigate={navigate} selectedId={selectedId} preferredSubjectId={props.curriculumSubjectId ?? curriculumCatalog.find(subject => subject.name === state.profile.course)?.id} onSubjectChange={props.onCurriculumSubjectChange} workspaceId={state.access?.workspaceId} actorId={state.actor.id} />}
    {mode === "sets" && <>{selectedId === "reviews" && <ReviewPlanList state={state} mutate={mutate} navigate={navigate} busy={busy} knowledgeId={scoped} />}<section className="card practice-intro"><div><h2>数学组卷训练</h2><p className="muted">从已审核的演示题库组卷，支持保存、打印、提交报告和错题订正。</p></div><button className="btn btn-primary" onClick={() => setConfigOpen(!configOpen)} aria-expanded={configOpen}><Plus size={18}/>{configOpen ? "收起配置" : "新建试卷"}</button></section>
    {configOpen && <section className="card learn-config"><div className="learn-section-heading"><h2>这次想练什么？</h2><button className="btn btn-ghost learn-icon-button" onClick={() => setConfigOpen(false)} aria-label="关闭出题配置"><X size={20} /></button></div><div className="learn-config-grid"><div className="field"><span className="learn-field-label">练习知识点</span><div className="learn-choice-stack">{state.knowledge.map(k => <label className={`learn-check-choice ${selected.includes(k.id) ? "is-selected" : ""}`} key={k.id}><input type="checkbox" checked={selected.includes(k.id)} disabled={creating || k.learningState === "upcoming"} onChange={() => setSelected(previous => previous.includes(k.id) ? previous.filter(id => id !== k.id) : [...previous, k.id])} /><span>{k.name}</span>{k.learningState === "upcoming" && <small>尚未学习</small>}</label>)}</div></div><div className="learn-config-settings"><fieldset><legend>题量</legend><div className="learn-segmented">{[3, 6, 9].map(n => <button key={n} className={count === n ? "is-selected" : ""} type="button" disabled={creating} aria-pressed={count === n} onClick={() => setCount(n)}>{n} 题</button>)}</div></fieldset><label className="field">难度<select className="select" value={difficulty} disabled={creating} onChange={e => setDifficulty(e.target.value)}><option value="综合">综合难度</option><option>基础</option><option>巩固</option><option>挑战</option></select></label><div className="field"><span>练习目标</span><p className="muted">针对知识点巩固。间隔新题复查请从下方已有计划开始。</p></div></div></div><div className="notice"><ShieldCheck size={17} /><span>只使用已审核题目，避开未学知识和近期作答。若当前范围题量不足，会说明缺口。</span></div><div className="learn-config-footer"><span className="muted" role="status">{selected.length ? `已选 ${selected.length} 个知识点 · ${count} 题 · 约 ${count * 2} 分钟` : "请至少选择一个已学知识点。"}</span><button className="btn btn-primary" disabled={!selected.length || busy || creating} onClick={create}>{creating ? "正在准备题目…" : "确认范围并出题"}<ArrowRight size={17} /></button></div></section>}
    {selectedId !== "reviews" && <ReviewPlanList state={state} mutate={mutate} navigate={navigate} busy={busy} knowledgeId={scoped} />}</>}
    {mode === "history" && <><div className="learn-section-heading"><div><h2>我的试卷 <span className="learn-count">{state.papers.length}</span></h2><p className="muted">练习和每一次修改，都替你保存好了。</p></div><div className="learn-filter-tabs">{[{ id: "all", title: "全部" }, { id: "pending", title: "待完成" }, { id: "completed", title: "已完成" }].map(f => <button type="button" key={f.id} className={filter === f.id ? "is-active" : ""} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.title}</button>)}</div></div>
    <div className="learn-papers-grid">{papers.map(p => <button className="card learn-paper-card" key={p.id} onClick={() => navigate("papers", p.id)}><div className="learn-card-top"><span className="learn-file-icon"><FileText size={25} /></span><span className={`badge ${p.status === "completed" ? "learn-badge-completed" : ""}`}>{p.status === "completed" ? "已完成" : p.status === "in_progress" ? "继续练习" : "待开始"}</span></div><h3>{p.title}</h3><p className="muted">{p.questionIds.length} 道题 · 约 {p.estimatedMinutes} 分钟</p><div className="learn-paper-tags"><span>{p.kind === "review" ? "新题复查" : p.kind === "whole" ? "整卷练习" : "知识点巩固"}</span>{p.parentId && <span>替换版本 v{p.version}</span>}</div><div className="learn-card-bottom"><span className="muted">{formatDate(p.createdAt)} 创建</span><span className="learn-open-label">查看试卷<ArrowRight size={16} /></span></div></button>)}</div>
    {!papers.length && <Empty title={filter === "all" ? "第一份练习，准备开始" : "这里暂时没有试卷"} text={filter === "all" ? "选择当前正在学习的知识点，小禾会为你准备一份适合的练习。" : "换一个筛选条件，或给自己准备一份新练习。"} action={<button className="btn btn-primary" onClick={() => navigate("papers", "configure")}>准备新练习<Plus size={16} /></button>} />}</>}
  </div>;
}
function ReviewPlanList({ state, mutate, navigate, busy, knowledgeId }: Pick<AppProps, "state" | "mutate" | "navigate" | "busy"> & { knowledgeId: KnowledgeId | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const plans = [...(state.mastery?.reviewPlans ?? [])].filter(plan => !knowledgeId || plan.knowledgeId === knowledgeId)
    .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || a.dueAt.localeCompare(b.dueAt));
  const dateTime = (value: string) => !Number.isFinite(Date.parse(value)) ? "日期待核对" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));
  const start = async (planId: string) => {
    if (lock.current || busy) return;
    const plan = state.mastery?.reviewPlans.find(item => item.id === planId);
    if (!plan) { setError({ id: planId, message: "未找到这份复查计划，请重新打开我的试卷后再试。" }); return; }
    try {
      const currentTime = Date.now();
      setNow(currentTime);
      if (!plan.paperId && currentTime < Date.parse(reviewAvailableAt(state, plan))) {
        setError({ id: planId, message: "复查间隔还未满，请按当前显示的可开始时间再来。" }); return;
      }
      lock.current = true; setStarting(planId); setError(null);
      const result = await mutate("review.start", { planId });
      if (result?.result?.id) navigate("papers", result.result.id);
      else setError({ id: planId, message: "这次未确认生成成功，请查看上方原因后重试；已有计划会继续使用同一份复查卷。" });
    } catch (caught) { setError({ id: planId, message: caught instanceof Error ? caught.message : "暂时无法开始复查，请稍后重试。" }); }
    finally { lock.current = false; setStarting(null); }
  };
  return <section className="learn-review-plans" aria-labelledby="learn-review-plan-heading">
    <div className="learn-section-heading"><div><h2 id="learn-review-plan-heading">间隔新题复查 <span className="learn-count">{plans.length}</span></h2><p className="muted">真实作答提交后生成计划。到期时重新核对间隔，并从全历史未见的已审核迁移题中选题。</p></div></div>
    {!plans.length ? <div className="card learn-review-empty"><Clock3 size={21} /><p>还没有复查计划。完成并提交练习后，计划会在这里保留来源与可开始时间。</p></div> : <div className="learn-review-plan-list">{plans.map(plan => {
      const sourcePaper = state.papers.find(paper => paper.id === plan.sourcePaperId);
      const reviewPaper = state.papers.find(paper => paper.id === plan.paperId && paper.reviewPlanId === plan.id);
      const attempt = [...state.attempts].reverse().find(item => item.paperId === reviewPaper?.id);
      const completed = plan.status === "completed" || attempt?.status === "submitted";
      const source = effectiveReviewSource(state, plan);
      let availableAt: string | undefined;
      let issue: string | undefined;
      if (!reviewPaper && !completed) {
        try { availableAt = reviewAvailableAt(state, plan); }
        catch (caught) { issue = caught instanceof Error ? caught.message : "复查时间暂时无法核对，请重新载入记录。"; }
      }
      if (!source.valid && !issue) issue = source.reason;
      const due = Boolean(availableAt && now >= Date.parse(availableAt));
      const delayed = Boolean(availableAt && Date.parse(availableAt) > Date.parse(plan.dueAt));
      const reportId = attempt?.status === "submitted" ? attempt.id : state.attempts.find(item => item.id === plan.attemptId && item.status === "submitted")?.id;
      return <article className="card learn-review-plan" key={plan.id}>
        <div className="learn-review-plan-copy"><div className="learn-card-top"><h3>{state.knowledge.find(item => item.id === plan.knowledgeId)?.name || knowledgeNames[plan.knowledgeId]}</h3><span className="badge">{completed ? "已完成" : reviewPaper ? "复查进行中" : issue ? "待核对计划" : due ? "间隔已满" : "等待间隔"}</span></div>
          <p>来源：{sourcePaper?.title || "原始提交"}<button type="button" className="learn-text-link" onClick={() => navigate("report", plan.sourceAttemptId)}>查看原始报告<ChevronRight size={14} /></button></p>
          <p className="muted">原计划：{dateTime(plan.dueAt)}（间隔 {plan.delayDays} 天）</p>
          {delayed && <p className="learn-review-delay">当前规则延长了间隔，最早可开始：{dateTime(availableAt!)}。原计划日期保留不变。</p>}
          {!delayed && availableAt && <p className="muted">可开始时间：{dateTime(availableAt)}</p>}
          <p className="muted">{plan.reason}</p>
          {issue && <p className="learn-review-error" role="alert">{issue}</p>}
          {error?.id === plan.id && <p className="learn-review-error" role="alert">{error.message}</p>}
        </div>
        <div className="learn-review-plan-action">{completed ? <button type="button" className="btn btn-secondary" disabled={!reportId} onClick={() => reportId && navigate("report", reportId)}>{reportId ? "查看复查报告" : "报告待核对"}<FileCheck2 size={16} /></button> : reviewPaper ? <button type="button" className="btn btn-primary" disabled={busy || Boolean(starting)} onClick={() => navigate("practice", reviewPaper.id)}>继续复查<ArrowRight size={16} /></button> : <button type="button" className="btn btn-primary" disabled={busy || Boolean(starting) || !due || Boolean(issue)} onClick={() => void start(plan.id)}>{starting === plan.id ? "正在准备新题…" : issue ? "计划待核对" : due ? "开始新题复查" : "尚未到期"}<ArrowRight size={16} /></button>}
          {due && !reviewPaper && !completed && <small>题库不足时会说明缺口，计划仍保留。</small>}
        </div>
      </article>;
    })}</div>}
  </section>;
}

function PaperPreview({ paper, state, mutate, navigate, busy }: AppProps & { paper: Paper }) {
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const attempt = [...state.attempts].reverse().find(a => a.paperId === paper.id);
  const replace = async () => { if (!replaceId) return; setReplacing(true); try { const result = await mutate("paper.replace", { paperId: paper.id, questionId: replaceId }); if (result?.result?.id) navigate("papers", result.result.id); } finally { setReplacing(false); } };
  return <div className="learn-page"><button className="btn btn-ghost learn-back" onClick={() => navigate("papers", "history")}><ArrowLeft size={17} />我的试卷</button><Heading eyebrow="YOUR PRACTICE" title={paper.title} text={`${paper.questionIds.length} 道题 · 预计 ${paper.estimatedMinutes} 分钟 · 版本 ${paper.version}`} action={<span className="badge"><CheckCircle2 size={14} />已保存</span>} />
    <div className="learn-preview-layout"><div className="learn-question-list">{paper.questions.map((q, index) => <section key={q.id} className={`card learn-preview-question ${replaceId === q.id ? "is-selected" : ""}`}><div className="learn-question-header"><span className="learn-number">{String(index + 1).padStart(2, "0")}</span><div className="learn-meta"><span>{knowledgeNames[q.knowledgeId]}</span><span>{q.difficulty}</span></div>{paper.kind !== "review" && <button className="btn btn-ghost" onClick={() => setReplaceId(replaceId === q.id ? null : q.id)} aria-pressed={replaceId === q.id}><RefreshCw size={15} />换一题</button>}</div><h3>{q.text}</h3><p className="learn-source">来源：{q.source} · 题目 v{q.version}</p>{replaceId === q.id && <div className="learn-replace-confirm"><p>替换这道题会另存一份新试卷，其余题目和原卷记录保留。</p><div className="row"><button className="btn btn-primary" disabled={busy || replacing} onClick={replace}>{replacing ? "正在寻找同类题…" : "确认替换并另存"}</button><button className="btn btn-ghost" onClick={() => setReplaceId(null)}>取消</button></div></div>}</section>)}</div><aside className="learn-preview-aside"><section className="card learn-summary-card"><span className="learn-section-icon"><ListChecks size={24} /></span><h2>练习之前，心里有数</h2><p className="muted">{paper.reason}</p>{paper.kind === "review" && <p className="muted">这份复查卷与原计划绑定，题目固定；返回后可继续同一份作答。</p>}<div className="learn-summary-item"><span>课程范围</span><strong>数学演示题库</strong></div><div className="learn-summary-item"><span>题目来源</span><strong>已审核题库</strong></div>{paper.parentId && <button className="learn-text-link" onClick={() => navigate("papers", paper.parentId)}>查看替换前的试卷<History size={15} /></button>}<button className="btn btn-primary learn-full-width" onClick={() => navigate(attempt?.status === "submitted" ? "report" : "practice", paper.id)}>{attempt?.status === "submitted" ? "查看练习报告" : attempt ? "继续我的练习" : "开始在线练习"}<ArrowRight size={17} /></button><div className="learn-print-links"><a className="btn btn-secondary" href={workspaceUrl(`/print/${encodeURIComponent(paper.id)}`)} target="_blank" rel="noopener noreferrer"><FileText size={14} />打印学生卷</a><a className="btn btn-secondary" href={workspaceUrl(`/print/${encodeURIComponent(paper.id)}?answers=1`)} target="_blank" rel="noopener noreferrer"><BookOpen size={14} />打印解析卷</a></div><p className="learn-small-note"><LockKeyhole size={13} />预览只展示题目，留给自己独立思考的机会。</p></section></aside></div>
  </div>;
}

type DraftAnswer = Pick<Answer, "questionId" | "value" | "working">;
const draftSaveQueues = new Map<string, Promise<unknown>>();
function queueDraftSave<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = draftSaveQueues.get(key) ?? Promise.resolve();
  const pending = previous.then(operation, operation);
  draftSaveQueues.set(key, pending);
  void pending.finally(() => { if (draftSaveQueues.get(key) === pending) draftSaveQueues.delete(key); }).catch(() => {});
  return pending;
}
function removeMatchingCache(key: string, answers: DraftAnswer[]): void {
  try { if (localStorage.getItem(key) === JSON.stringify(answers)) localStorage.removeItem(key); } catch { /* No cache is safer than deleting an unrelated newer snapshot. */ }
}
function PracticePage(props: AppProps) {
  const paper = props.state.papers.find(p => p.id === props.selectedId);
  if (!paper) return <Empty title="先选择一份练习" text="找到适合自己的练习，再开始慢慢思考。" action={<button className="btn btn-primary" onClick={() => props.navigate("papers", "history")}>去我的试卷<ArrowRight size={16} /></button>} />;
  const attempt = latestAttempt(props, paper.id);
  if (attempt?.status === "submitted") return <Empty title="这份练习已经完成了" text="原始作答已经保存，可以查看报告，或者用新题继续练习。" action={<button className="btn btn-primary" onClick={() => props.navigate("report", paper.id)}>查看练习报告<ArrowRight size={16} /></button>} />;
  return <PracticeForm {...props} paper={paper} key={paper.id} />;
}
function PracticeForm({ paper, state, mutate, navigate, busy }: AppProps & { paper: Paper }) {
  const savedAttempt = [...state.attempts].reverse().find(a => a.paperId === paper.id);
  const storageKey = `xiaohe-draft-${state.access?.workspaceId || state.actor.id}-${state.actor.id}-${paper.id}`;
  const [initialDraft] = useState(() => {
    const serverAnswers = paper.questions.map(q => { const existing = savedAttempt?.answers.find(a => a.questionId === q.id); return { questionId: q.id, value: existing?.value ?? "", working: existing?.working ?? "" }; });
    let recovered: DraftAnswer[] | null = null;
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      if (stored) {
        const parsed = JSON.parse(stored) as DraftAnswer[];
        if (Array.isArray(parsed) && parsed.length === paper.questions.length && parsed.every((a, index) => a && a.questionId === paper.questionIds[index] && typeof a.value === "string" && a.value.length <= 300 && typeof a.working === "string" && a.working.length <= 3000) && JSON.stringify(parsed) !== JSON.stringify(serverAnswers)) recovered = parsed;
      }
    } catch { /* Server drafts remain available when local storage is unavailable. */ }
    // A local snapshot may predate another device. Let the student choose before it can overwrite server answers.
    return { answers: serverAnswers, recovered };
  });
  const [answers, setAnswers] = useState<DraftAnswer[]>(initialDraft.answers);
  const [recovery, setRecovery] = useState<DraftAnswer[] | null>(initialDraft.recovered);
  const [activeIndex, setActiveIndex] = useState(() => firstUnansweredIndex(initialDraft.answers));
  const [saveStatus, setSaveStatus] = useState("草稿自动保存");
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [helpBusy, setHelpBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localHelp, setLocalHelp] = useState<Record<string, HelpLevel>>({});
  const dirtyRef = useRef(false);
  const cachePersistedRef = useRef(false);
  const submittedRef = useRef(false);
  const answersRef = useRef(answers);
  const mutateRef = useRef(mutate);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const submissionKey = useRef<string | null>(null);
  useEffect(() => { mutateRef.current = mutate; }, [mutate]);
  const save = useCallback(async function savePending(): Promise<boolean> {
    while (savePromise.current) await savePromise.current.catch(() => false);
    if (!learningDraftStillAvailable(state, "paper", paper.id)) { dirtyRef.current = false; return false; }
    if (!dirtyRef.current || submittedRef.current) return true;
    const pending = queueDraftSave(storageKey, async () => {
      if (!dirtyRef.current || submittedRef.current) return true;
      const snapshot = answersRef.current;
      setSaveStatus("正在保存…");
      try {
        const result = await mutateRef.current("attempt.save", { paperId: paper.id, answers: snapshot });
        if (result) {
          removeMatchingCache(storageKey, snapshot);
          if (answersRef.current === snapshot) { dirtyRef.current = false; setSaveStatus("草稿已保存"); }
          else setSaveStatus("还有新修改，等待保存…");
          return true;
        }
      } catch { /* Preserve the pending draft and show an honest recovery status. */ }
      setSaveStatus(cachePersistedRef.current ? "保存未成功，答案保留在本机" : "尚未保存，请保持本页打开并重试");
      return false;
    });
    savePromise.current = pending;
    let saved = false;
    try { saved = await pending; } finally { if (savePromise.current === pending) savePromise.current = null; }
    return saved && dirtyRef.current && !submittedRef.current ? savePending() : saved;
  }, [paper.id, storageKey, state]);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => { void saveRef.current(); }, 700);
    return () => clearTimeout(timer);
  }, [answers]);
  useEffect(() => () => { if (!submittedRef.current && dirtyRef.current) void saveRef.current(); }, []);
  // Focus refreshes and print exposure can update the server snapshot. Sync answers only while this form is clean.
  const serverAnswersKey = JSON.stringify(paper.questions.map(q => { const a = savedAttempt?.answers.find(answer => answer.questionId === q.id); return { questionId: q.id, value: a?.value ?? "", working: a?.working ?? "" }; }));
  useEffect(() => {
    if (dirtyRef.current || savePromise.current || JSON.stringify(answersRef.current) === serverAnswersKey) return;
    const incoming = JSON.parse(serverAnswersKey) as DraftAnswer[];
    answersRef.current = incoming;
    setAnswers(incoming);
  }, [serverAnswersKey]);
  const question = paper.questions[activeIndex];
  const answer = answers[activeIndex];
  const recordedHelp = savedAttempt?.answers.find(a => a.questionId === question.id)?.help ?? "independent";
  const localLevel = localHelp[question.id];
  const help = localLevel === "explanation" || recordedHelp === "explanation" ? "explanation" : localLevel === "hint" || recordedHelp === "hint" ? "hint" : recordedHelp;
  const answeredCount = answers.filter(a => a.value.trim()).length;
  const applyAnswers = (next: DraftAnswer[]) => {
    if (!learningDraftStillAvailable(state, "paper", paper.id)) return;
    dirtyRef.current = true;
    answersRef.current = next;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); cachePersistedRef.current = true; }
    catch { cachePersistedRef.current = false; }
    setAnswers(next);
    setSaveStatus(cachePersistedRef.current ? "有修改，等待保存…" : "本机缓存不可用，正在等待同步…");
  };
  const update = (field: "value" | "working", value: string) => {
    if (recovery) return;
    applyAnswers(answersRef.current.map(a => a.questionId === question.id ? { ...a, [field]: value } : a));
  };
  const resolveRecovery = (restore: boolean) => {
    if (!recovery) return;
    if (restore) { applyAnswers(recovery); setActiveIndex(firstUnansweredIndex(recovery)); }
    else removeMatchingCache(storageKey, recovery);
    setRecovery(null);
  };
  const requestHelp = async (level: "hint" | "explanation") => {
    if (helpBusy || submitting || recovery) return;
    setHelpBusy(true);
    try { await saveRef.current(); const result = await mutate("attempt.help", { paperId: paper.id, questionId: question.id, level }); if (result) setLocalHelp(previous => ({ ...previous, [question.id]: previous[question.id] === "explanation" || recordedHelp === "explanation" ? "explanation" : level })); } finally { setHelpBusy(false); }
  };
  const submit = async () => {
    if (submitting || recovery) return;
    setSubmitting(true);
    try {
      await saveRef.current();
      if (!submissionKey.current) submissionKey.current = crypto.randomUUID();
      const snapshot = answersRef.current;
      const result = await queueDraftSave(storageKey, () => mutate("attempt.submit", { paperId: paper.id, answers: snapshot, submissionKey: submissionKey.current }));
      if (result) { submittedRef.current = true; dirtyRef.current = false; removeMatchingCache(storageKey, snapshot); navigate("report", paper.id); }
    } finally { setSubmitting(false); }
  };
  return <div className="learn-page"><button className="btn btn-ghost learn-back" disabled={submitting} onClick={async () => { const saved = await saveRef.current(); if (saved || cachePersistedRef.current) navigate("papers", paper.id); }}><ArrowLeft size={17} />保存并返回试卷</button><Heading eyebrow="TIME TO FOCUS" title="慢慢想，你可以的" text={paper.title} action={<span className="learn-save-status" role="status"><Save size={14} />{saveStatus}</span>} />
    {recovery && <section className="learn-recovery-panel" role="status"><div><h3>发现一份尚未同步的本机草稿</h3><p>本机草稿已填写 {recovery.filter(a => a.value.trim()).length} 题，当前云端已填写 {answeredCount} 题。选择后再继续，避免旧草稿自动覆盖其他设备的作答。</p></div><div className="row"><button className="btn btn-secondary" onClick={() => resolveRecovery(false)}>保留云端草稿</button><button className="btn btn-primary" onClick={() => resolveRecovery(true)}>恢复本机草稿</button></div></section>}
    <div className="learn-practice-layout"><aside className="card learn-practice-nav"><div className="learn-section-heading"><h3>我的进度</h3><span className="muted">{answeredCount}/{paper.questions.length}</span></div><div className="learn-progress-track"><span style={{ width: `${answeredCount / paper.questions.length * 100}%` }} /></div><div className="learn-question-dots">{paper.questions.map((q, index) => <button key={q.id} type="button" className={`${activeIndex === index ? "is-active" : ""} ${answers[index]?.value.trim() ? "is-answered" : ""}`} aria-label={`第 ${index + 1} 题${answers[index]?.value.trim() ? "，已填写" : "，未填写"}`} aria-current={activeIndex === index ? "step" : undefined} onClick={() => setActiveIndex(index)}>{index + 1}</button>)}</div><div className="learn-practice-legend"><span><i />已填写</span><span><i />待思考</span></div><p className="muted">不用着急，可以来回检查。答案和思考过程都会保存。</p><button className="btn btn-secondary learn-full-width" disabled={busy || submitting} onClick={() => { void saveRef.current(); }}><Save size={15} />保存草稿</button></aside>
      <section className="card learn-answer-card"><div className="learn-question-header"><span className="learn-number">{String(activeIndex + 1).padStart(2, "0")}</span><span className="badge">{knowledgeNames[question.knowledgeId]}</span><span className="learn-answer-help-status">{helpNames[help]}</span></div><h2>{question.text}</h2><label className="field learn-answer-field">我的答案<div className="learn-answer-input-wrap"><input className="input" placeholder="在这里写下你的答案" maxLength={300} disabled={submitting || Boolean(recovery)} value={answer.value} onChange={e => update("value", e.target.value)} autoComplete="off" aria-label={`第 ${activeIndex + 1} 题答案`} />{question.unit && <span>{question.unit}</span>}</div></label><label className="field">我的思考过程 <span className="learn-optional">建议写一写</span><textarea className="textarea" rows={4} maxLength={3000} disabled={submitting || Boolean(recovery)} value={answer.working} placeholder="你是怎样想的？写下列式、检验或自己的发现。" onChange={e => update("working", e.target.value)} aria-label={`第 ${activeIndex + 1} 题思考过程`} /></label>
        <button className="btn btn-secondary" disabled={busy || helpBusy || submitting || Boolean(recovery)} onClick={async () => { if (await saveRef.current()) navigate("chat", undefined, { source: "paper", paperId: paper.id, questionId: question.id, questionVersion: question.version }); }}><Sparkles size={16} />带着原卷这道题问小禾</button>
        <div className="learn-help-actions"><span className="muted"><Lightbulb size={16} />卡住了？可以借一点力量</span><div className="row"><button className="btn btn-ghost" disabled={busy || helpBusy || submitting || Boolean(recovery) || help === "hint" || help === "explanation"} onClick={() => requestHelp("hint")}><Lightbulb size={16} />给我提示</button><button className="btn btn-ghost" disabled={busy || helpBusy || submitting || Boolean(recovery) || help === "explanation"} onClick={() => requestHelp("explanation")}><BookOpen size={16} />看看讲解</button></div></div>
        {(help === "hint" || help === "explanation") && <div className="learn-help-panel"><div className="learn-evidence-caption"><Lightbulb size={17} />{help === "explanation" ? "一起理一理思路" : "给你一个小提示"}</div><p>{question.hint}</p>{help === "explanation" && <><ol>{question.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><p><strong>参考答案：{question.answer}{question.unit && !question.answer.includes(question.unit) ? ` ${question.unit}` : ""}</strong></p>{question.alternative && <p className="muted">另一种想法：{question.alternative}</p>}</>}<small>这次帮助已记录，报告会与独立作答分别呈现。</small></div>}
        <div className="learn-practice-footer"><button className="btn btn-secondary" disabled={activeIndex === 0} onClick={() => setActiveIndex(i => i - 1)}><ArrowLeft size={16} />上一题</button>{activeIndex < paper.questions.length - 1 ? <button className="btn btn-primary" onClick={() => setActiveIndex(i => i + 1)}>下一题<ArrowRight size={16} /></button> : <button className="btn btn-primary" disabled={busy || helpBusy || submitting || Boolean(recovery)} onClick={() => setSubmitConfirm(true)}>检查并提交<CheckCircle2 size={17} /></button>}</div>
      </section></div>
    {submitConfirm && <div className="learn-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !submitting) setSubmitConfirm(false); }}><section className="card learn-modal" role="dialog" aria-modal="true" aria-labelledby="learn-submit-heading"><span className="learn-section-icon"><FileCheck2 size={27} /></span><h2 id="learn-submit-heading">把这次思考保存下来</h2><p>共 {paper.questions.length} 道题，已填写 {answeredCount} 道答案。{answeredCount < paper.questions.length ? `还有 ${paper.questions.length - answeredCount} 道未填写，请返回补全后再提交。` : "可以再检查一下答案和单位。"}</p><div className="notice"><ShieldCheck size={17} /><span>提交后保留本次原始作答和帮助记录。需要订正的题目会进入错题集。</span></div><div className="learn-modal-actions"><button className="btn btn-secondary" disabled={submitting} onClick={() => { if (answeredCount < paper.questions.length) setActiveIndex(firstUnansweredIndex(answers)); setSubmitConfirm(false); }}>{answeredCount < paper.questions.length ? "去填写未答题" : "再检查一下"}</button><button className="btn btn-primary" disabled={busy || submitting || answeredCount < paper.questions.length} onClick={submit}>{submitting ? "正在提交…" : "确认提交并看报告"}<ArrowRight size={16} /></button></div></section></div>}
  </div>;
}

function ReportPage(props: AppProps) {
  const { state, selectedId, navigate, evidenceRevision } = props;
  const originalAttempt = [...state.attempts].reverse().find(a => a.status === "submitted" && (a.id === selectedId || a.paperId === selectedId));
  const attempt = originalAttempt && effectiveAttempt(state, originalAttempt.id, evidenceRevision);
  const paper = state.papers.find(p => p.id === attempt?.paperId);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!attempt || !paper) return <Empty title="报告还没有生成" text="完成并提交练习后，这里会留下答案、思考过程和帮助记录。" action={<button className="btn btn-primary" onClick={() => navigate("papers", "history")}>查看我的试卷<ArrowRight size={16} /></button>} />;
  const isDemo = attempt.id.startsWith("demo-");
  const historical = evidenceRevision !== undefined;
  const allEvidence = effectiveEvidence(state, evidenceRevision);
  const hint = attempt.answers.filter(a => a.valid && a.correct && a.help === "hint").length;
  const explanation = attempt.answers.filter(a => a.valid && a.correct && a.help === "explanation").length;
  const unknown = attempt.answers.filter(a => a.valid && a.help === "unknown").length;
  const correct = attempt.correctCount;
  const validCount = Math.max(0, attempt.retainedCount - attempt.invalidatedCount);
  const noStatistics = validCount === 0;
  const emptyStatistics = attempt.deletedCount > 0 && attempt.retainedCount === 0 ? "作答已全部删除，当前无可统计作答" : "当前无有效作答，暂无有效统计";
  return <div className="learn-page"><button className="btn btn-ghost learn-back" onClick={() => navigate("papers", "history")}><ArrowLeft size={17} />我的试卷</button><Heading eyebrow="EVERY EFFORT COUNTS" title={noStatistics ? "学习记录" : "每一次认真思考，都有收获"} text={`${paper.title} · ${formatDate(attempt.submittedAt)} · ${paper.questionIds.length} 道题`} />
    {historical && <div className="notice"><History size={18} /><span>正在查看评定当时的证据：{evidenceRevision === 0 ? "原始记录（旧评定未记录修订号）" : `修订 r${evidenceRevision}`}。后续更正不会改写这份历史。</span><button className="btn btn-secondary" onClick={() => navigate("report", attempt.id)}>查看当前结果</button></div>}
    {noStatistics ? <section className="card empty-state"><History size={28} /><h2>{emptyStatistics}</h2><p>这里不记为零分。原卷题目保留；已删除作答不可恢复，已排除记录可另行申请复核。</p></section> : <section className="card learn-report-hero"><div className="learn-report-circle"><span>{correct}<small>/{attempt.retainedCount - attempt.invalidatedCount}</small></span><p>{historical ? "当时有效答对" : "当前有效答对"}</p></div><div className="learn-report-copy"><span className="learn-soft-label"><Sprout size={15} />{isDemo ? "演示历史 · 不代表你的真实学情" : "原始作答与复核结论分别保留"}</span><h2>{correct === paper.questionIds.length ? "这一份努力，值得好好记住。" : "看见困难，就找到了下一步。"}</h2><p>{attempt.originalCorrectCount === null ? "部分作答已删除，首次总分不再展示。" : `首次保存：${attempt.originalCorrectCount} 题答对。`}当前展示：{correct} 题有效答对，{attempt.invalidatedCount} 条已排除。<br />后来的订正练习不会覆盖首次答案；记录不准确可申请复核。</p></div></section>}
    {!noStatistics && <div className="learn-report-stats">{[{ label: "独立答对", value: attempt.independentCorrect, icon: <CheckCircle2 size={22} />, color: "green" }, { label: "提示后答对", value: hint, icon: <Lightbulb size={22} />, color: "yellow" }, { label: "讲解后答对", value: explanation, icon: <BookOpen size={22} />, color: "blue" }, { label: "有效错题", value: attempt.answers.filter(a => a.valid && a.correct === false).length, icon: <Pencil size={22} />, color: "orange" }].map(item => <div className={`card learn-stat ${item.color}`} key={item.label}><span>{item.icon}</span><strong>{item.value}<small>题</small></strong><p>{item.label}</p></div>)}</div>}
    {isDemo && <div className="notice"><CircleHelp size={17} /><span>这份报告用于展示学习流程，所有演示证据均不计入你的星级与最近 7 天学习小结。</span></div>}
    {attempt.deletedCount > 0 && <div className="notice"><History size={17} /><span>已删除 {attempt.deletedCount} 条作答，剩余 {attempt.retainedCount} 条；删除后无法通过历史修订查看旧答案。</span></div>}
    {unknown > 0 && <div className="notice"><CircleHelp size={17} /><span>有 {unknown} 题的帮助情况待确认，暂不计入独立答对。</span></div>}
    <div className="learn-section-heading"><h2>把每一道题看清楚</h2><span className="muted">展开对照原始记录与{historical ? "当时" : "当前"}结果</span></div><div className="learn-report-questions">{paper.questions.map((q, index) => {
      const answer = attempt.answers.find(a => a.questionId === q.id);
      if (state.historyDeletion?.evidence.some(item => item.attemptId === attempt.id && item.questionId === q.id)) return <section className="card learn-report-question" key={q.id}><div style={{ padding: 24 }}><strong>第 {index + 1} 题 · 学习记录已删除</strong><p className="muted">作答正文和过程已移除，不计入报告分母。原卷教学题目继续保留。</p></div></section>;
      const open = expanded === q.id;
      const evidence = allEvidence.find(e => e.attemptId === attempt.id && e.questionId === q.id);
      return <section className="card learn-report-question" key={q.id}><button className="learn-report-question-toggle" aria-expanded={open} onClick={() => setExpanded(open ? null : q.id)}><span className={`learn-result-symbol ${answer?.valid && answer.correct ? "is-correct" : "is-pending"}`}>{answer?.valid && answer.correct ? <Check size={19} /> : <Pencil size={17} />}</span><div><span className="learn-meta">第 {index + 1} 题 · {knowledgeNames[answer?.knowledgeId ?? q.knowledgeId]}</span><h3>{q.text}</h3><p className="muted">{historical ? "当时" : "当前"}答案：{answer?.value || "未填写"} · {answer?.valid === false ? "已排除，不计成绩" : answer?.correct ? "答对" : "待订正"}</p></div><span className="badge">{answer ? helpNames[answer.help] : "未作答"}</span><ChevronDown className={open ? "learn-rotate" : ""} size={18} /></button>{open && <div className="learn-report-detail">{evidence && <EvidenceComparison evidence={evidence} state={state} asOfRevision={evidenceRevision} title={historical ? "原始记录与当时有效结果" : undefined} />}<div><h4>原始思考过程</h4><p>{answer?.original.working || "这次没有填写过程，下次可以把想法也记下来。"}</p></div><div><h4>原卷参考答案与讲解</h4><strong>{q.answer}{q.unit && !q.answer.includes(q.unit) ? ` ${q.unit}` : ""}</strong><ol>{q.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></div>{evidence?.reason && <div className="notice"><ShieldCheck size={16} /><span>{evidence.reason}</span></div>}<p className="learn-source">来源：{q.source} · 题目版本 {q.version} · 试卷版本 {paper.version}</p><div className="row"><button className="btn btn-secondary" onClick={() => navigate("chat", undefined, { source: "paper", paperId: paper.id, questionId: q.id, questionVersion: q.version })}><Sparkles size={16} />带着这道原卷题继续</button>{evidence && !historical && <button className="btn btn-secondary" onClick={() => navigate("evidence-review", evidence.id)}><ShieldCheck size={16} />记录不准确？申请复核</button>}{evidence && !historical && <button className="btn btn-ghost" onClick={() => navigate("history-delete", evidence.id)}>删除这条学习记录</button>}</div></div>}</section>;
    })}</div>
    <section className="card learn-next-step"><div className="learn-section-icon"><Sprout size={26} /></div><div><h3>过几天，再用新题试一试</h3><p className="muted">记录更正、订正原题和新题复查分别保存。当前星级与当前有效证据关联，旧评定保留当时依据。</p></div><div className="row"><button className="btn btn-secondary" onClick={() => navigate("knowledge")}>查看知识点依据</button><button className="btn btn-primary" onClick={() => navigate("mistakes")}>整理错题<ArrowRight size={16} /></button></div></section>
  </div>;
}

function MistakesPage({ state, mutate, navigate, busy, selectedId }: AppProps) {
  const [filter, setFilter] = useState(selectedId ? "all" : "pending");
  const [expanded, setExpanded] = useState<string | null>(selectedId ?? null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const currentMistakes = effectiveMistakes(state, { includeInactive: true });
  const pending = currentMistakes.filter(m => m.active && !m.correctedAt).length;
  const mistakes = currentMistakes.filter(m => filter === "all" || (m.active && (filter === "corrected" ? Boolean(m.correctedAt) : !m.correctedAt)));
  const correct = async (id: string) => { if (!corrections[id]?.trim()) return; setSaving(id); try { const result = await mutate("mistake.correct", { id, answer: corrections[id] }); if (result) setFilter("all"); } finally { setSaving(null); } };
  return <div className="learn-page"><Heading eyebrow="GROW THROUGH PRACTICE" title="错题本" text="保留第一次的答案，也记录后来想明白的过程。每道错题都是下一步的线索。" action={<button className="btn btn-secondary" onClick={() => navigate("papers")}><Plus size={16} />练一份新题</button>} />
    <div className="learn-mistake-summary"><div><span className="learn-section-icon"><Pencil size={24} /></span><strong>{pending}<small>道待订正</small></strong></div><div><span className="learn-section-icon"><CheckCircle2 size={24} /></span><strong>{currentMistakes.filter(m => m.active && m.correctedAt).length}<small>道已订正</small></strong></div><p className="muted">看过答案与独立掌握分别记录，<br />原始作答会一直保留。</p></div>
    <div className="learn-section-heading"><h2>我的错题集</h2><div className="learn-filter-tabs">{[{ id: "pending", title: "待订正" }, { id: "corrected", title: "已订正" }, { id: "all", title: "全部" }].map(f => <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={filter === f.id ? "is-active" : ""}>{f.title}</button>)}</div></div>
    <div className="learn-mistake-list">{mistakes.map(m => { const open = expanded === m.id; return <section className="card learn-mistake-card" key={m.id}><button className="learn-mistake-toggle" onClick={() => setExpanded(open ? null : m.id)} aria-expanded={open}><span className={`learn-result-symbol ${m.correctedAt ? "is-correct" : "is-pending"}`}>{m.correctedAt ? <Check size={19} /> : <Pencil size={17} />}</span><div><span className="learn-meta">{knowledgeNames[m.knowledgeId]} · {m.question.difficulty}{m.id.startsWith("demo-") ? " · 演示记录" : ""}</span><h3>{m.question.text}</h3><p className="muted">原来的答案：<span className="learn-original-answer">{m.originalAnswer || "未作答"}</span>{m.correctedAt && <span className="learn-corrected-inline">订正：{m.correctedAnswer}</span>}</p></div><span className="badge">{!m.active ? "已更正，不在当前错题" : m.correctedAt ? "已订正" : "待订正"}</span><ChevronDown size={18} className={open ? "learn-rotate" : ""} /></button>{open && <div className="learn-mistake-detail"><EvidenceComparison evidence={m.effectiveEvidence} state={state} /><button className="btn btn-secondary" onClick={() => navigate("evidence-review", m.evidenceId)}>原记录不准确？申请复核</button><div className="learn-help-panel"><h4>一起把思路理顺</h4><p>{m.question.hint}</p><ol>{m.question.steps.map((step, i) => <li key={i}>{step}</li>)}</ol><strong>参考答案：{m.question.answer}{m.question.unit && !m.question.answer.includes(m.question.unit) ? ` ${m.question.unit}` : ""}</strong></div>{m.active && !m.correctedAt ? <div className="learn-correction-form"><label className="field" htmlFor={`correction-${m.id}`}>现在，写下订正后的答案<input className="input" id={`correction-${m.id}`} value={corrections[m.id] ?? ""} placeholder="我现在的答案是…" onChange={e => setCorrections(previous => ({ ...previous, [m.id]: e.target.value }))} /></label><button className="btn btn-primary" disabled={busy || saving === m.id || !corrections[m.id]?.trim()} onClick={() => correct(m.id)}><Check size={17} />{saving === m.id ? "正在保存…" : "保存订正"}</button></div> : m.correctedAt ? <p className="learn-corrected-note"><CheckCircle2 size={17} />{formatDate(m.correctedAt)} 已订正。第一次作答仍保留在学习记录中。</p> : <p className="muted">记录复核后已不属于当前错题，原始内容保留供追溯。</p>}<div className="learn-card-bottom"><p className="learn-small-note">订正记录不会直接算作独立完成证据。</p>{(() => { const evidence = state.evidence.find(item => item.id === m.evidenceId); const sourcePaper = state.papers.find(item => item.id === evidence?.paperId && item.questions.some(q => q.id === m.question.id && q.version === m.question.version)); return sourcePaper ? <button className="btn btn-secondary" onClick={() => navigate("chat", undefined, { source: "paper", paperId: sourcePaper.id, questionId: m.question.id, questionVersion: m.question.version })}><Sparkles size={16} />带着原题继续</button> : null; })()}<button className="btn btn-secondary" onClick={() => navigate("papers", m.question.knowledgeId)}>用同类新题练一练<ArrowRight size={16} /></button></div></div>}</section>; })}</div>
    {!mistakes.length && <Empty title={filter === "pending" ? "暂时没有待订正的题" : "这里还没有记录"} text={filter === "pending" ? "继续保持自己的节奏，试试新的练习。" : "完成练习后，需要订正的题目与订正过程会保存在这里。"} action={<button className="btn btn-primary" onClick={() => navigate("papers")}>开始新练习<ArrowRight size={16} /></button>} />}
  </div>;
}

function ProfilePage({ state, mutate, navigate, busy }: AppProps) {
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<Profile>(state.profile);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const since = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  const recent = state.attempts.filter(a => !a.id.startsWith("demo-") && a.status === "submitted" && new Date(a.submittedAt ?? a.startedAt).getTime() >= since);
  const recentEvidence = effectiveEvidence(state).filter(e => e.valid && !e.id.startsWith("demo-") && new Date(e.createdAt).getTime() >= since);
  const independent = recentEvidence.filter(e => e.correct && e.help === "independent").length;
  const save = async () => { setSaving(true); try { const result = await mutate("profile.update", { profile }); if (result) setEditing(false); } finally { setSaving(false); } };
  return <div className="learn-page"><Heading eyebrow="MY LEARNING SPACE" title="我的" text="查看学习小结，管理档案、共享与学习记录。" />
    <section className="card learn-profile-hero"><div className="learn-profile-avatar"><Sprout size={43} /></div><div><span className="eyebrow">我的学习档案</span><h2>{state.profile.name}</h2><p className="muted">{state.profile.grade} · {state.profile.semester} · {state.profile.textbook}</p><p>{state.profile.course}</p></div><button className="btn btn-secondary" onClick={() => { setProfile(state.profile); setEditing(!editing); }}><Pencil size={16} />{editing ? "收起档案编辑" : "编辑学习档案"}</button></section>
    {editing && <section className="card learn-profile-form"><h2>让学习内容更适合你</h2><form onSubmit={e => { e.preventDefault(); void save(); }}><div className="learn-form-grid">{[{ key: "name", label: "怎么称呼你", placeholder: "你的名字" }, { key: "grade", label: "年级", placeholder: "例如：四年级" }, { key: "semester", label: "学期", placeholder: "例如：上学期" }, { key: "textbook", label: "教材版本", placeholder: "例如：人教版" }, { key: "course", label: "当前课程", placeholder: "正在学习的课程范围" }, { key: "school", label: "学校（选填）", placeholder: "可以留空" }].map(item => <label className="field" key={item.key}>{item.label}<input className="input" required={item.key !== "school"} maxLength={item.key === "course" ? 100 : 40} value={profile[item.key as keyof Profile]} placeholder={item.placeholder} onChange={e => setProfile(previous => ({ ...previous, [item.key]: e.target.value }))} /></label>)}</div><div className="learn-config-footer"><p className="muted">当前示例题库覆盖四年级数学。修改档案不会自动扩充题库范围。</p><button className="btn btn-primary" disabled={busy || saving || !profile.name.trim() || !profile.grade.trim() || !profile.course.trim()} type="submit"><Save size={16} />{saving ? "正在保存…" : "保存学习档案"}</button></div></form></section>}
    <section className="card access-profile-entry"><div><h3>家长、老师与共享范围</h3><p>查看当前身份、切换工作区，或管理已授予的访问权限。</p></div><button className="btn btn-secondary" onClick={() => navigate("access")}><ShieldCheck size={17} />成员与共享<ArrowRight size={16} /></button></section>
    <div className="learn-profile-links">{[{ title: "我的练习卷", description: `${state.papers.length} 份试卷与学习报告`, icon: <FileText size={23} />, view: "papers" as View }, { title: "错题与订正", description: `${effectiveMistakes(state).filter(m => !m.correctedAt && !m.id.startsWith("demo-")).length} 道个人错题待订正`, icon: <Pencil size={23} />, view: "mistakes" as View }, { title: "记录复核", description: "申请更正不准确的作答记录", icon: <ShieldCheck size={23} />, view: "evidence-review" as View }].map(item => <button className="card learn-profile-link" key={item.view} onClick={() => navigate(item.view, item.view === "papers" ? "history" : undefined)}><span>{item.icon}</span><div><h3>{item.title}</h3><p className="muted">{item.description}</p></div><ChevronRight size={18} /></button>)}</div>
    <div className="learn-profile-tabs"><button className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")} aria-pressed={activeTab === "overview"}>最近 7 天</button><button className={activeTab === "memory" ? "is-active" : ""} onClick={() => setActiveTab("memory")} aria-pressed={activeTab === "memory"}>学习记忆</button><button className={activeTab === "privacy" ? "is-active" : ""} onClick={() => setActiveTab("privacy")} aria-pressed={activeTab === "privacy"}>隐私与分享</button></div>
    {activeTab === "overview" && <section className="card learn-weekly"><div className="learn-section-heading"><div><span className="eyebrow">一周学习小结</span><h2>用具体的记录，看见成长</h2></div><span className="badge">当前学习档案</span></div><div className="learn-weekly-stats"><div><strong>{recent.length}</strong><span>次完成练习</span></div><div><strong>{recentEvidence.length}</strong><span>条作答证据</span></div><div><strong>{independent}</strong><span>题独立答对</span></div></div><div className="learn-weekly-knowledge">{state.knowledge.filter(k => k.learningState === "current").map(k => <div key={k.id}><div><strong>{k.name}</strong><p className="muted">{k.reason}</p></div><Stars count={k.stars} /></div>)}</div><div className="notice"><Lightbulb size={18} /><span>陪伴建议：请孩子讲一讲自己的思路，给足独立思考的时间。近期记录较少时，先积累证据，再判断变化。</span></div><p className="learn-small-note">此处汇总当前工作区的学习记录。已授权家长和教师可查看报告，私人对话不进入此汇总。</p></section>}
    {activeTab === "memory" && <section className="card learn-memory"><h2>小禾记住了什么</h2><div className="learn-memory-row"><span className="learn-section-icon"><BookOpen size={21} /></span><div><h3>你填写的学习档案</h3><p className="muted">{state.profile.name} · {state.profile.grade} · {state.profile.course}</p></div><button className="btn btn-secondary" onClick={() => { setProfile(state.profile); setEditing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>修正档案</button></div><div className="learn-memory-row"><span className="learn-section-icon"><History size={21} /></span><div><h3>由作答留下的学习记录</h3><p className="muted">保留原始答案、帮助使用与题目版本，支持每个知识点的判断。</p></div><div className="row"><button className="btn btn-secondary" onClick={() => navigate("knowledge")}>查看依据</button><button className="btn btn-secondary" onClick={() => navigate("history-delete")}>管理与删除历史</button></div></div><p className="learn-small-note">学习判断描述具体任务中的表现，不保存对性格或能力的长期评价标签。</p></section>}
    {activeTab === "privacy" && <section className="card learn-privacy"><span className="learn-section-icon"><ShieldCheck size={27} /></span><h2>学习记录，清楚地留在这里</h2><div className="learn-privacy-grid"><div><LockKeyhole size={22} /><h3>私人对话</h3><p className="muted">不默认进入学习周报，也不自动分享给家长或老师。</p></div><div><FileCheck2 size={22} /><h3>可追溯的作答</h3><p className="muted">原始作答与订正分别保存。查看答案和提示会留下帮助记录。</p></div><div><ShieldCheck size={22} /><h3>数据使用</h3><p className="muted">学习材料不默认用于模型训练。当前页面没有启用训练数据提交。</p></div></div><div className="notice"><CircleHelp size={18} /><span>家长、教师与教研成员通过邮箱绑定邀请加入，并按角色访问。查看本页不会建立分享关系，请到“成员与共享”核对当前授权。</span></div></section>}
  </div>;
}

export function StudentLearning(props: AppProps & { view: View }) {
  switch (props.view) {
    case "knowledge": return <KnowledgePage {...props} key={`knowledge-${props.selectedId ?? "all"}`} />;
    case "papers": return <PapersPage {...props} />;
    case "practice": return <PracticePage {...props} />;
    case "report": return <ReportPage {...props} key={`report-${props.selectedId}`} />;
    case "mistakes": return <MistakesPage {...props} key={`mistakes-${props.selectedId ?? "all"}`} />;
    case "profile": return <ProfilePage {...props} />;
    default: return null;
  }
}
export default StudentLearning;
