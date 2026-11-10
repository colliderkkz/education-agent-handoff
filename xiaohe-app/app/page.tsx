"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Camera, Check, ChevronRight, CircleHelp, ClipboardList, GraduationCap, Home, MessageCircle, ShieldCheck, Sprout, Sun, Target, UsersRound, X } from "lucide-react";
import { act, ApiError, currentWorkspaceId, fetchWorkspace, workspaceUrl } from "@/lib/client";
import type { ApiResult, StageId, WorkspaceState } from "@/lib/types";
import { stageOfKnowledge } from "@/lib/types";
import type { AppProps, ChatEntryContext, View } from "@/lib/ui-types";
import { readChatEntryContext, writeChatEntryContext } from "@/lib/chat-navigation";
import StudentLearning from "@/components/student-learning";
import { AdminWorkspace } from "@/components/admin-workspace";
import CameraWorkspace from "@/components/camera-workspace";
import CompanionChat from "@/components/companion-chat";
import AccessWorkspace, { roleNames } from "@/components/access-workspace";
import EvidenceReviewWorkspace from "@/components/evidence-review-workspace";
import { effectiveAttempt, effectiveMistakes } from "@/lib/effective-evidence";
import SharedLearning from "@/components/shared-learning";
import HistoryDeletionWorkspace from "@/components/history-deletion-workspace";
import { curriculumCatalog } from "@/lib/curriculum-catalog";
import { shanghaiCatalog } from "@/lib/curriculum-catalog-shanghai";
import { studentSection } from "@/lib/student-navigation";
import { pruneLearningCaches } from "@/lib/learning-cache-cleanup";
import "@/components/interface-refresh.css";

const navigation: { view: View; label: string; icon: typeof Home }[] = [
  { view: "home", label: "学习首页", icon: Home },
  { view: "knowledge", label: "知识地图", icon: BookOpen },
  { view: "papers", label: "我的练习", icon: ClipboardList },
  { view: "mistakes", label: "错题本", icon: Target },
  { view: "profile", label: "我的", icon: Sprout },
];
const validViews: View[] = ["home", "knowledge", "camera", "papers", "practice", "mistakes", "profile", "chat", "report", "access", "shared-help", "evidence-review", "history-delete", "exam"];
function belongsToRequest(incoming: WorkspaceState, requested: string | undefined): boolean {
  return currentWorkspaceId() === requested && (!requested || incoming.access?.workspaceId === requested);
}
export default function HomePage() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string>();
  const [evidenceRevision, setEvidenceRevision] = useState<number>();
  const [chatContext, setChatContext] = useState<ChatEntryContext>();
  const [chatEntryError, setChatEntryError] = useState("");
  const [admin, setAdmin] = useState(false);
  const [curriculumSubjectId, setCurriculumSubjectId] = useState<string>();
  // 当前学段：小学四年级 / 上海初中 / 上海高中。写在地址里，刷新和分享都带着，
  // 知识地图、组卷、单题练习、错题本共用这一份 —— 不用每处重选一遍。
  const [stageId, setStageId] = useState<StageId>("primary");
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptedState = useRef<WorkspaceState | null>(null);
  const mergeState = useCallback((incoming: WorkspaceState) => {
    const previous = acceptedState.current;
    if (previous?.access && incoming.access && previous.access.workspaceId !== incoming.access.workspaceId) return;
    if (previous && incoming.revision < previous.revision) return;
    acceptedState.current = incoming; pruneLearningCaches(incoming);
    setState(current => {
      if (current?.access && incoming.access && current.access.workspaceId !== incoming.access.workspaceId) return current;
      return !current || incoming.revision >= current.revision ? incoming : current;
    });
  }, []);
  useEffect(() => { if (state) pruneLearningCaches(state); }, [state]);
  const load = useCallback(async () => {
    const requested = currentWorkspaceId();
    try { const data = await fetchWorkspace(); if (!belongsToRequest(data.state, requested)) throw new Error("工作区已改变，请重新打开当前空间"); mergeState(data.state); setSignedOut(false); }
    catch (e) { if (currentWorkspaceId() !== requested) return; const text = e instanceof Error ? e.message : "暂时无法连接，请重试"; setSignedOut(e instanceof ApiError && e.status === 401); setError(text); }
    finally { if (currentWorkspaceId() === requested) setLoading(false); }
  }, [mergeState]);
  const refresh = useCallback(async () => {
    const requested = currentWorkspaceId();
    try { const data = await fetchWorkspace(); if (belongsToRequest(data.state, requested)) mergeState(data.state); }
    catch (e) { if (currentWorkspaceId() === requested && e instanceof ApiError && [401, 403, 404].includes(e.status)) { setState(null); setSignedOut(e.status === 401); setError(e.message); } }
  }, [mergeState]);
  useEffect(() => {
    let active = true;
    const requested = currentWorkspaceId();
    void fetchWorkspace().then(data => {
      if (!active || !belongsToRequest(data.state, requested)) return;
      mergeState(data.state); setSignedOut(false);
    }).catch(e => {
      if (!active || currentWorkspaceId() !== requested) return;
      setSignedOut(e instanceof ApiError && e.status === 401); setError(e instanceof Error ? e.message : "暂时无法连接，请重试");
    }).finally(() => { if (active && currentWorkspaceId() === requested) setLoading(false); });
    return () => { active = false; };
  }, [mergeState]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refreshVisible); document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.removeEventListener("focus", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [refresh]);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(location.hash.slice(1)); const requested = params.get("view") as View; if (validViews.includes(requested)) { setView(requested); setSelectedId(params.get("id") || undefined); const revision = params.get("evidenceRevision"); setEvidenceRevision(revision !== null && /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) ? Number(revision) : undefined); setChatContext(undefined); setChatEntryError(""); if (requested === "chat") { try { setChatContext(readChatEntryContext(params)); } catch (error) { setChatEntryError(error instanceof Error ? error.message : "学伴入口无效，请重新选择题目。"); } } } setAdmin(params.get("mode") === "admin"); const stage = params.get("stage"); if (stage === "junior" || stage === "senior" || stage === "primary") setStageId(stage); };
    restore(); window.addEventListener("hashchange", restore); return () => window.removeEventListener("hashchange", restore);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const navigate = useCallback((next: View, id?: string, context?: ChatEntryContext, revision?: number) => {
    setView(next); setSelectedId(id); setEvidenceRevision(revision); setChatContext(next === "chat" ? context : undefined); setChatEntryError(""); setAdmin(false);
    const params = new URLSearchParams({ view: next }); if (id) params.set("id", id);
    if (next === "chat" && context) writeChatEntryContext(params, context);
    if (revision !== undefined && Number.isSafeInteger(revision) && revision >= 0) params.set("evidenceRevision", String(revision));
    if (stageId !== "primary") params.set("stage", stageId);
    location.hash = params.toString(); window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stageId]);
  /** 切换学段：状态与地址一起改，别的地方跟着走。 */
  const changeStage = useCallback((next: StageId) => {
    setStageId(next);
    const params = new URLSearchParams(location.hash.slice(1));
    if (next === "primary") params.delete("stage"); else params.set("stage", next);
    location.hash = params.toString();
  }, []);
  const openAdmin = () => { setAdmin(true); setView("home"); location.hash = "mode=admin"; };
  const mutate = useCallback(async (action: string, payload: Record<string, unknown> = {}): Promise<ApiResult | undefined> => {
    const requested = currentWorkspaceId();
    setPending(n => n + 1); setError("");
    try { const data = await act(action, payload); if (!belongsToRequest(data.state, requested)) return undefined; mergeState(data.state);
      if (!["attempt.save", "attempt.help", "chat.send", "chat.open", "chat.draft.save", "chat.delete.preview", "evidence.preview", "history.delete.preview"].includes(action)) { setNotice(typeof data.result?.message === "string" ? data.result.message : "已保存"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNotice(""), 3500); } return data;
    } catch (e) { if (currentWorkspaceId() === requested) { setError(e instanceof Error ? e.message : "操作失败，请重试"); if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) void refresh(); } if (action.startsWith("chat.") || action.startsWith("memory.preference.") || action === "help.create" || action.startsWith("evidence.") || action.startsWith("history.")) throw e; return undefined; }
    finally { setPending(n => n - 1); }
  }, [mergeState, refresh]);
  if (loading) return <main className="welcome"><div className="brand-mark"><Sprout size={30}/></div><h1>小禾学伴</h1><p className="muted">正在打开你的学习空间…</p><span className="spinner"/></main>;
  if (!state) return <main className="welcome"><div className="welcome-panel"><div className="brand"><span className="brand-mark"><Sprout/></span><strong>小禾学伴</strong></div><img className="welcome-art" src="/illustrations/xiaohe-companion.png" alt="小禾与学伴一起学习"/><span className="eyebrow">每一次小进步，都值得被看见</span><h1>把今天要学的，<br/>变成刚好适合的练习。</h1><p className="muted">从一道题开始，找到方法，慢慢成长。</p>{signedOut ? <a className="btn btn-primary" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(workspaceUrl("/"))}`} target="_top">登录，打开学习空间<ArrowRight size={18}/></a> : <><p role="alert" className="error-text">{error}</p><button className="btn btn-primary" onClick={() => { setLoading(true); setError(""); void load(); }}>重新连接</button>{currentWorkspaceId() && <a className="btn btn-secondary" href={workspaceUrl("/#view=access", null)}>返回我的空间，查看邀请</a>}</>}<p className="welcome-note">小学四年级 · 上海中考 · 上海高考 · 语文、数学、英语学习空间</p></div></main>;
  const props: AppProps = { state, mutate, navigate, selectedId, evidenceRevision, chatContext, chatEntryError, reload: refresh, busy: pending > 0, curriculumSubjectId, onCurriculumSubjectChange: setCurriculumSubjectId, stageId, onStageChange: changeStage };
  const role = state.access?.role ?? state.actor.role;
  const learningRole = role === "owner" || role === "student";
  const contentOnly = role === "editor" || role === "reviewer";
  const observer = role === "parent" || role === "teacher";
  const canAdmin = role === "owner" || contentOnly;
  const showAdmin = view !== "access" && canAdmin && (contentOnly || admin);
  const roleNavigation = learningRole ? navigation : observer ? [{ view: "home" as View, label: "学习报告", icon: ClipboardList }, ...(role === "teacher" ? [{ view: "shared-help" as View, label: "已共享求助", icon: MessageCircle }, { view: "evidence-review" as View, label: "证据复核", icon: ShieldCheck }] : [])] : [];
  const currentLabel = view === "access" ? "成员与共享" : view === "history-delete" ? "删除学习历史" : view === "evidence-review" ? "记录更正与复核" : showAdmin ? "教研工作台" : observer ? view === "shared-help" && role === "teacher" ? "已共享求助" : "学习报告" : view === "profile" ? "我的学习空间" : view === "practice" ? "专注练习" : view === "report" ? "学习报告" : (view === "camera" ? "拍照与回传" : view === "chat" ? "学习帮助" : navigation.find(n => n.view === view)?.label);
  const actorLabel = learningRole ? state.profile.name : state.actor.name;
  const desktopHome = () => contentOnly ? openAdmin() : navigate("home");
  const mobileItems = learningRole ? navigation : [...roleNavigation, { view: "access" as View, label: "成员与空间", icon: UsersRound }];
  return <div className={`app-shell ${showAdmin ? "admin-mode" : ""}`}>
    <aside className="sidebar"><button className="brand" onClick={desktopHome} aria-label="小禾学伴首页"><span className="brand-mark"><Sprout size={26}/></span><span><strong>小禾学伴</strong><small>陪你一起，慢慢长大</small></span></button><div className="sidebar-label">{learningRole ? "我的学习空间" : "当前授权空间"}</div><nav aria-label="主导航">{roleNavigation.map(({view: tab,label,icon: Icon}) => <button key={tab} className={`nav-item ${!showAdmin && (learningRole ? studentSection(view) === tab : view === tab || observer && tab === "home" && view === "report") ? "active" : ""}`} onClick={() => navigate(tab)}><Icon size={21}/><span>{label}</span></button>)}{!learningRole && <button className={`nav-item ${view === "access" ? "active" : ""}`} onClick={() => navigate("access")}><UsersRound size={21}/><span>成员与共享</span></button>}</nav><div className="sidebar-bottom">{canAdmin && <button className={`nav-item ${showAdmin ? "active" : ""}`} onClick={openAdmin}><GraduationCap size={20}/><span>教研工作台</span><ChevronRight size={15}/></button>}<button className="profile-link" onClick={() => navigate(learningRole ? "profile" : "access")}><span className="avatar">{actorLabel?.slice(0,1) || "同"}</span><span><strong>{actorLabel}</strong><small>{learningRole ? `${state.profile.grade} · 学习档案` : roleNames[role]}</small></span><ChevronRight size={17}/></button></div></aside>
    <div className="workspace"><header className="topbar"><div className="mobile-brand"><Sprout size={25}/><strong>小禾学伴</strong></div><div className="breadcrumb"><span>{learningRole ? "学习空间" : "授权空间"}</span><ChevronRight size={14}/><strong>{currentLabel}</strong></div><div className="topbar-actions">{showAdmin && role === "owner" && <button className="text-link" onClick={()=>navigate("home")}><Home size={15}/>返回学习空间</button>}{contentOnly && view === "access" && <button className="text-link" onClick={openAdmin}><GraduationCap size={15}/>教研工作台</button>}{!learningRole && <button className="shell-access-button" onClick={() => navigate("access")} aria-label="成员、授权与切换工作区"><UsersRound size={17}/><span>成员与共享</span></button>}{learningRole ? <label className="course-badge course-badge-select" title="切换学段 —— 知识地图、组卷、错题本都会跟着走"><span/><select aria-label="切换学段" value={stageId} onChange={event => changeStage(event.target.value as StageId)}><option value="primary">小学四年级</option><option value="junior">上海初中</option><option value="senior">上海高中</option></select></label> : <span className="course-badge"><span/>{roleNames[role]}</span>}<button title={learningRole ? "我的学习档案" : "我的访问权限"} aria-label={learningRole ? "我的学习档案" : "我的访问权限"} className="avatar small" onClick={() => navigate(learningRole ? "profile" : "access")}>{actorLabel?.slice(0,1) || "同"}</button></div></header><main id="main-content" className={`main-content ${showAdmin ? "admin-content-wrap" : ""}`}>{error && <div className="error-banner" role="alert"><CircleHelp size={19}/><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError("")}><X size={17}/></button></div>}{learningRole && !showAdmin && ["camera", "chat", "evidence-review", "history-delete", "access"].includes(view) && <div className="context-back"><button className="text-link" onClick={() => navigate(studentSection(view))}>← 返回{studentSection(view) === "papers" ? "我的练习" : "我的"}</button></div>}{view === "access" ? <AccessWorkspace/> : showAdmin ? <AdminWorkspace {...props}/> : view === "evidence-review" ? <EvidenceReviewWorkspace {...props} key={`${state.access?.workspaceId ?? state.actor.id}:${state.actor.id}:${selectedId ?? "queue"}`}/> : view === "history-delete" ? <HistoryDeletionWorkspace {...props} key={`${state.access?.workspaceId ?? state.actor.id}:${state.actor.id}`} /> : observer ? <SharedLearning {...props} view={view}/> : learningRole ? view === "home" ? <Today {...props}/> : view === "camera" ? <CameraWorkspace {...props} onUploaded={refresh}/> : view === "chat" ? <CompanionChat {...props}/> : view === "shared-help" ? <div className="card empty-state"><ShieldCheck size={30}/><h2>此页面供已授权教师处理求助</h2><p>你可以在“和小禾聊聊”中查看自己提交的求助。</p><button className="btn btn-secondary" onClick={() => navigate("chat")}>查看我的求助</button></div> : <StudentLearning {...props} view={view}/> : <div className="card empty-state"><ShieldCheck size={33}/><h2>当前身份没有此页面权限</h2><button className="btn btn-secondary" onClick={() => navigate("access")}>查看成员与权限</button></div>}<footer className="workspace-footer"><Sprout size={14}/><span>学习有依据，成长有自己的节奏</span><span>小学四年级 · 上海中考 · 上海高考 · 语文 / 数学 / 英语</span></footer></main></div>
    {!showAdmin && <nav className={`mobile-nav ${!learningRole ? "restricted-mobile-nav" : ""}`} aria-label="手机导航">{mobileItems.map(({view:tab,label,icon:Icon}) => <button className={`${(learningRole ? studentSection(view) === tab : view === tab)?"active":""} ${tab==="camera"?"camera-tab":""}`} key={tab} onClick={() => navigate(tab)}><span><Icon size={22}/></span><small>{label}</small></button>)}</nav>}{notice && <div className="toast" role="status"><Check size={18}/>{notice}</div>}
  </div>;
}
function Today({state,navigate,onCurriculumSubjectChange,stageId,onStageChange}: AppProps) {
  const completed = state.attempts.filter(a => a.status === "submitted" && !a.id.startsWith("demo-"));
  const independent = completed.reduce((sum,a) => sum + (effectiveAttempt(state, a.id)?.independentCorrect ?? 0),0);
  const pendingPaper = state.papers.find(p => p.status === "in_progress");
  const openMistakes = effectiveMistakes(state).filter(m => !m.correctedAt && !m.id.startsWith("demo-"));
  const mistakes = openMistakes.length;
  const date = new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"long",day:"numeric",weekday:"long"}).format(new Date());
  // 三条学段线：小学四年级、上海初中、上海高中 —— 首页就把它们摆出来，
  // 上海内容不该只藏在知识地图的一个下拉框里。
  const stageLines = [
    { id: "primary" as const, mark: "小", title: "小学四年级", subtitle: "统编版 · 人教版 · PEP · 上册", subjects: curriculumCatalog },
    { id: "junior" as const, mark: "初", title: "上海初中", subtitle: "按上海市中考考纲编写", subjects: shanghaiCatalog.filter(item => item.stage === "junior") },
    { id: "senior" as const, mark: "高", title: "上海高中", subtitle: "按上海市高考考纲编写", subjects: shanghaiCatalog.filter(item => item.stage === "senior") },
  ];
  const stageLabel = (id: StageId) => id === "junior" ? "上海中考" : id === "senior" ? "上海高考" : "小学四年级";
  return <div className="today-view home-refresh">
    <div className="page-heading"><div><p className="eyebrow"><Sun size={16}/>{date}</p><h1>{state.profile.name}，今天从哪里开始？</h1><p className="muted">学懂一个知识点，再用练习巩固。</p></div><span className="badge">{stageLabel(stageId ?? "primary")}</span></div>
    {pendingPaper && <section className="card home-resume"><div><span className="eyebrow">上次还没完成</span><h3>{pendingPaper.title}</h3><p className="muted">答案草稿已保存，继续完成这份练习。</p></div><button className="btn btn-primary" onClick={() => navigate("practice", pendingPaper.id)}>继续练习<ArrowRight size={17}/></button></section>}
    <section className="home-start"><div><span className="eyebrow">我的课程</span><h2>三条学段线，选一条开始</h2><p>按单元找知识点，查看讲解，再做对应练习。切换后知识地图、组卷与错题本都会跟着走。</p></div><BookOpen size={44} strokeWidth={1.3}/></section>
    <div className="home-stages">{stageLines.map(line => {
      const points = line.subjects.reduce((n, subject) => n + subject.units.reduce((m, unit) => m + unit.points.length, 0), 0);
      const unlocked = state.knowledge.filter(k => stageOfKnowledge(k.id) === line.id && k.learningState === "current").length;
      const pending = openMistakes.filter(m => stageOfKnowledge(m.question?.knowledgeId ?? "") === line.id).length;
      return <section className={`home-stage stage-${line.id}`} key={line.id}>
        <div className="home-stage-head"><span className="home-stage-mark">{line.mark}</span><div><h2>{line.title}</h2><p>{line.subtitle}</p></div></div>
        <div className="home-stage-subjects">{line.subjects.map(subject => <button key={subject.id} onClick={() => { onStageChange?.(line.id); onCurriculumSubjectChange?.(subject.id); navigate("knowledge"); }}><span><strong>{subject.name}</strong><small>{subject.units.length} 个单元 · {subject.units.reduce((n,u) => n + u.points.length,0)} 个知识点</small></span><ChevronRight size={17}/></button>)}</div>
        <div className="home-stage-progress"><span>已加入学习 <strong>{unlocked}</strong> 个知识点</span><span>待订正 <strong>{pending}</strong> 道</span></div>
        <button className="home-stage-action" onClick={() => { onStageChange?.(line.id); onCurriculumSubjectChange?.(line.subjects[0].id); navigate("knowledge"); }}>进入{line.title}课程<ArrowRight size={17}/></button>
        {line.id !== "primary" && <button className="home-stage-exam" onClick={() => { onStageChange?.(line.id); navigate("exam"); }}><ClipboardList size={15}/>真题考情与出处索引<ChevronRight size={14}/></button>}
      </section>;
    })}</div>
    {pendingPaper && <section className="card home-resume"><div><span className="eyebrow">上次还没完成</span><h3>{pendingPaper.title}</h3><p className="muted">答案草稿已保存，继续完成这份练习。</p></div><button className="btn btn-primary" onClick={() => navigate("practice", pendingPaper.id)}>继续练习<ArrowRight size={17}/></button></section>}
    <div className="home-bottom"><section className="card"><div className="section-heading"><h2>学习记录</h2><button className="text-link" onClick={() => navigate("profile")}>查看学习小结<ChevronRight size={16}/></button></div><div className="home-stats"><div><strong>{completed.length}</strong><span>完成试卷</span></div><div><strong>{independent}</strong><span>独立答对</span></div><button onClick={() => navigate("mistakes")}><strong>{mistakes}</strong><span>待订正错题<ChevronRight size={13}/></span></button></div><p className="learn-small-note">统计已提交的试卷作答，知识点自练不计入。</p></section><section className="card home-tools"><h2>需要帮助时</h2><button onClick={() => navigate("camera")}><Camera size={21}/><span><strong>拍照与回传</strong><small>保存题目照片，人工核对作答</small></span><ChevronRight size={17}/></button><button onClick={() => navigate("chat")}><MessageCircle size={21}/><span><strong>学习帮助</strong><small>查看题库提示，记录学习问题</small></span><ChevronRight size={17}/></button></section></div>
  </div>;
}
