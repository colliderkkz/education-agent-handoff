"use client";
import { useRef, useState } from "react";
import { ArrowLeft, FileCheck2, History, ImageIcon, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { AppProps } from "@/lib/ui-types";
import type { HistoryDeletionPreview, WorkspaceState } from "@/lib/types";
import { effectiveEvidence } from "@/lib/effective-evidence";
import { ApiError } from "@/lib/client";
import "./history-deletion-workspace.css";

export function historyDeletionPayload(preview: HistoryDeletionPreview, requestId: string) {
  return { evidenceIds: [...preview.selection.evidenceIds], uploadIds: [...preview.selection.uploadIds], sourceRevision: preview.sourceRevision, digest: preview.digest, requestId };
}
export function currentHistoryPreview(preview: HistoryDeletionPreview, state: WorkspaceState, evidenceIds: string[], uploadIds: string[]): boolean {
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return preview.sourceRevision === state.revision && same(preview.selection.evidenceIds, evidenceIds) && same(preview.selection.uploadIds, uploadIds);
}
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const knowledgeName = (state: WorkspaceState, id: string) => state.knowledge.find(item => item.id === id)?.name ?? id;
const stars = (value: number | null) => value === null ? "待评估" : `${value} 星`;

export function HistoryDeletionImpact({ preview, state }: { preview: HistoryDeletionPreview; state: WorkspaceState }) {
  return <div className="history-impact"><div className="history-counts">{[
    ["作答证据", preview.evidenceCount], ["错题记录", preview.mistakeCount], ["复核申请 / 决议", `${preview.proposalCount} / ${preview.decisionCount}`],
    ["本人关联会话", preview.threadCount], ["消息 / 草稿", `${preview.messageCount} / ${preview.draftCount}`], ["求助摘要（含已共享）", `${preview.helpRequestCount}（${preview.sharedHelpRequestCount}）`],
  ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <h3>哪些报告会改变</h3>{preview.reports.map(report => <div className="history-impact-row" key={report.attemptId}><strong>{state.papers.find(paper => paper.id === report.paperId)?.title ?? "学习报告"}</strong><p>删除 {report.selectedCount} 条，剩余 {report.remainingCount} 条；有效答对 {report.beforeCorrect} → {report.afterCorrect}。已删除记录不再计入报告分母。</p></div>)}
    <h3>知识点与复查计划</h3>{preview.knowledge.map(item => <div className="history-impact-row" key={item.knowledgeId}><strong>{knowledgeName(state, item.knowledgeId)}：{stars(item.beforeStars)} → {stars(item.afterStars)}</strong><p>{item.reason}</p></div>)}
    <p>{preview.assessmentCount} 条关联旧评定会撤去详细依据，仅留下无作答正文的删除标记。</p>{preview.reviewPlans.map(plan => <p key={plan.planId}>{knowledgeName(state, plan.knowledgeId)} · 计划 {plan.planId}：{plan.sourceWillBeUnavailable ? "来源证据将不可用，需重新积累" : "来源仍可用"}</p>)}
    <p>同时移除 {preview.auditEventCount} 条现存学习操作日志和 {preview.rulePreviewCount} 份规则试算，避免旧汇总与自由文字继续保留已删除内容。结构化曝光和教学内容管理日志保留。</p>
    <h3>照片逐张核对</h3>{preview.photos.filter(photo => photo.selected).map(photo => <div className="history-impact-row" key={photo.uploadId}><strong>{photo.name} · {photo.willDelete ? "撤销访问并回收" : "保留"}</strong><p>{photo.reason}{photo.retainedReferenceCount > 0 ? `（还有 ${photo.retainedReferenceCount} 处保留引用）` : ""}</p></div>)}{!preview.photos.some(photo => photo.selected) && <p>未选择照片，照片文件保留。</p>}
    {preview.retainedOtherThreadCount > 0 && <p>另有 {preview.retainedOtherThreadCount} 份其他人的私人会话保留；此操作无权删除其内容。</p>}
    {preview.warnings.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}
  </div>;
}

export default function HistoryDeletionWorkspace({ state, mutate, navigate, selectedId, busy, reload }: AppProps) {
  const [selected, setSelected] = useState<string[]>(state.evidence.some(item => item.id === selectedId) ? [selectedId!] : []);
  const [photos, setPhotos] = useState<string[]>([]);
  const [paperId, setPaperId] = useState("all");
  const [preview, setPreview] = useState<HistoryDeletionPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string>();
  const [unknown, setUnknown] = useState(false);
  const [fileFeedback, setFileFeedback] = useState("");
  const [pendingUploads, setPendingUploads] = useState(0);
  const lock = useRef(false);
  const retry = useRef<ReturnType<typeof historyDeletionPayload> | null>(null);
  const role = state.access?.role ?? state.actor.role;
  const all = effectiveEvidence(state).filter(item => state.attempts.some(attempt => attempt.id === item.attemptId && attempt.status === "submitted"));
  const visible = all.filter(item => paperId === "all" || item.paperId === paperId);
  const locked = busy || Boolean(pending) || unknown;
  const tasks = state.historyDeletion?.fileTasks ?? [];
  const awaitingFiles = tasks.filter(task => task.status === "pending");
  const operations = state.historyDeletion?.operations.filter(operation => operation.actorId === state.actor.id) ?? [];
  const previewCurrent = preview && currentHistoryPreview(preview, state, selected, photos);
  const toggle = (id: string, current: string[], setter: (value: string[]) => void) => { if (locked || lock.current) return; setter(current.includes(id) ? current.filter(item => item !== id) : [...current, id]); setPreview(null); setAccepted(false); retry.current = null; };
  const previewDeletion = async () => {
    if (lock.current || busy || !selected.length || unknown) return;
    lock.current = true; setPending("preview"); setError("");
    try { const result = await mutate("history.delete.preview", { evidenceIds: selected, uploadIds: photos }); if (!result?.result?.preview) throw new Error("影响预览未确认，请重试。尚未删除记录。"); const next = result.result.preview as HistoryDeletionPreview; setPreview(next); setAccepted(false); retry.current = historyDeletionPayload(next, crypto.randomUUID()); }
    catch (error) { setError(error instanceof Error ? error.message : "暂时无法核对删除影响。"); }
    finally { lock.current = false; setPending(""); }
  };
  const confirmDeletion = async () => {
    if (lock.current || busy || !retry.current || !preview || !accepted || (!unknown && !previewCurrent)) return;
    lock.current = true; setPending("delete"); setError("");
    try { const result = await mutate("history.delete.confirm", retry.current); if (!result?.result?.deleted || !result.result.id) throw new Error("删除结果尚未确认，请用原请求重试，或重读记录核对结果。"); setPendingUploads(Number(result.result.pendingUploads) || 0); setReceipt(result.result.id); setUnknown(false); retry.current = null; setPreview(null); setSelected([]); setPhotos([]); setAccepted(false); }
    catch (error) { const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500; setUnknown(!rejected); if (rejected) { setPreview(null); setAccepted(false); retry.current = null; } setError(error instanceof Error ? error.message : "删除结果尚未确认。原请求已保留，可安全重试。"); }
    finally { lock.current = false; setPending(""); }
  };
  const retryFiles = async () => {
    if (lock.current || busy) return; lock.current = true; setPending("files"); setError("");
    try { const result = await mutate("history.files.retry"); if (!result) throw new Error("文件回收结果未确认，请重读记录后重试。"); setPendingUploads(Number(result.result?.pendingUploads) || 0); setFileFeedback(String(result.result?.message ?? "已核对本次文件回收状态。")); }
    catch (error) { setError(error instanceof Error ? error.message : "图片回收暂未完成。"); }
    finally { lock.current = false; setPending(""); }
  };
  const reread = async () => { if (!reload || lock.current) return; setPending("reload"); try { await reload(); } finally { setPending(""); } };
  if (role !== "owner" && role !== "student") return <div className="card empty-state"><ShieldCheck size={30} /><h2>当前角色不能删除学习历史</h2><p>家长、教师和教研角色没有删除学生记录的权限。</p></div>;
  return <div className="history-page"><button className="btn btn-ghost" onClick={() => navigate("profile")}><ArrowLeft size={17} />我的学习空间</button><div className="page-heading"><div><p className="eyebrow"><History size={16} />管理已保存的学习历史</p><h1>先看影响，再决定删除</h1><p className="muted">逐条选择已提交作答。题库、试卷题目与未选择的学习记录继续保留。</p></div></div>
    <div className="notice"><ShieldCheck size={18} /><span>删除不可恢复。已见题族和帮助使用只保留防止重复计为新题所需的最小标记。已下载的 PDF、截图及他人保存的副本无法从这里撤回。</span></div>
    {error && <div className="notice history-error" role="alert"><span>{error}</span>{reload && <button className="btn btn-secondary" disabled={Boolean(pending)} onClick={reread}><RefreshCw size={15} />重读已保存记录</button>}</div>}
    {receipt && <div className="notice" role="status"><FileCheck2 size={20} /><span>删除已确认，操作编号 {receipt}。{awaitingFiles.length || pendingUploads ? "图片访问已撤销，仍有文件等待回收。" : "所选文件回收已确认。"}</span></div>}
    {(operations.length > 0 || awaitingFiles.length > 0) && <section className="card history-file-status"><div><h2>{awaitingFiles.length + pendingUploads ? `${awaitingFiles.length + pendingUploads} 个图片文件等待回收` : "图片存储回收"}</h2><p>已删除图片的旧链接已失效。可核对并重试尚未回收的文件，以及删除期间被阻断的暂存上传。未选择的已保存照片保留。</p>{fileFeedback && <p role="status">{fileFeedback}</p>}</div><button className="btn btn-secondary" disabled={busy || Boolean(pending)} onClick={retryFiles}><RefreshCw size={16} />核对并重试文件回收</button></section>}
    <section className="card history-selection"><div className="history-section-heading"><div><h2>1. 选择已提交的作答证据</h2><p>当前已选 {selected.length} 条。选择照片与删除影响将在下一步单独核对。</p></div><label className="field">筛选原卷<select className="select" value={paperId} disabled={locked} onChange={event => setPaperId(event.target.value)}><option value="all">全部已提交报告</option>{state.papers.filter(paper => all.some(item => item.paperId === paper.id)).map(paper => <option value={paper.id} key={paper.id}>{paper.title}</option>)}</select></label></div><button className="btn btn-ghost" disabled={locked || !visible.length} onClick={() => { setSelected([...new Set([...selected, ...visible.map(item => item.id)])]); setPreview(null); setAccepted(false); }}>选择当前列表</button>
      <div className="history-evidence-list">{visible.map(item => <label className="history-choice" key={item.id}><input type="checkbox" disabled={locked} checked={selected.includes(item.id)} onChange={() => toggle(item.id, selected, setSelected)} /><span><strong>{item.questionText}</strong><small>{state.papers.find(paper => paper.id === item.paperId)?.title} · {knowledgeName(state, item.knowledgeId)} · {date(item.createdAt)}</small><span>当前答案：{item.answer || "未填写"} · {item.valid ? item.correct ? "答对" : "待订正" : "已排除"}</span><small>证据编号 {item.id}</small></span></label>)}</div>{!visible.length && <p className="empty-state">没有可选择的已提交作答证据。</p>}
    </section>
    <section className="card history-selection"><h2>2. 是否同时删除照片</h2><p>只处理你明确选择的图片。不从试卷说明或求助文字猜测关联；仍有保留记录引用的图片会在预览中说明并保留。</p><div className="history-photos">{state.uploads.map(upload => <label className="history-choice" key={upload.id}><input type="checkbox" disabled={locked} checked={photos.includes(upload.id)} onChange={() => toggle(upload.id, photos, setPhotos)} /><ImageIcon size={20} /><span><strong>{upload.name}</strong><small>{date(upload.createdAt)}</small></span></label>)}</div>{!state.uploads.length && <p className="muted">没有已登记图片。</p>}<button className="btn btn-primary" disabled={locked || !selected.length} onClick={previewDeletion}>{pending === "preview" ? "正在核对影响…" : "预览删除影响"}</button></section>
    {preview && <section className="card history-selection" aria-labelledby="history-preview-title"><h2 id="history-preview-title">3. 核对这一次删除</h2><p>以工作区修订 r{preview.sourceRevision} 为准，预览后任何更新都需要重新核对。</p>{previewCurrent ? <HistoryDeletionImpact preview={preview} state={state} /> : <p className="notice">当前选择或工作区记录已变化，旧预览不再作为照片去留或成绩变化的结论。{unknown ? "可用同一请求核对上次确认结果。" : "请重新预览后再确认。"}</p>}<label className="history-choice"><input type="checkbox" checked={accepted} disabled={locked} onChange={event => setAccepted(event.target.checked)} /><span>我已核对报告、星级、关联会话/摘要及照片范围，知道删除无法恢复。</span></label><div className="row"><button className="btn btn-secondary" disabled={locked} onClick={() => { setPreview(null); setAccepted(false); retry.current = null; }}>返回调整选择</button>{!previewCurrent && !unknown && <button className="btn btn-secondary" disabled={locked} onClick={previewDeletion}>重新预览影响</button>}{unknown ? <button className="btn btn-primary" disabled={busy || Boolean(pending)} onClick={confirmDeletion}><RefreshCw size={16} />用同一请求重试确认</button> : <button className="btn btn-primary" disabled={busy || Boolean(pending) || !accepted || !previewCurrent} onClick={confirmDeletion}><Trash2 size={16} />{pending === "delete" ? "正在确认删除…" : "确认删除这些记录"}</button>}</div></section>}
    {operations.length > 0 && <section className="card history-selection"><h2>已确认的删除记录</h2><p>只保留操作与删除数量，不保留已删除答案、过程和消息正文。</p>{operations.slice().reverse().map(operation => <div className="history-impact-row" key={operation.id}><strong>{date(operation.createdAt)} · 删除 {operation.evidenceIds.length} 条作答、{operation.deletedUploadIds.length} 张照片</strong><small>{operation.id}</small><p>关联本人会话 {operation.deletedThreadIds.length} 份、摘要 {operation.deletedHelpRequestIds.length} 份；待回收图片 {tasks.filter(task => task.operationId === operation.id && task.status === "pending").length} 张。</p></div>)}</section>}
  </div>;
}
