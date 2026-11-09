"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck, FileImage, History, LockKeyhole, ShieldCheck } from "lucide-react";
import { ApiError, workspaceUrl } from "@/lib/client";
import { effectiveEvidence } from "@/lib/effective-evidence";
import type { AppProps } from "@/lib/ui-types";
import type { EffectiveEvidence, Evidence, EvidencePatch, EvidencePreview, EvidenceProposal, HelpLevel, KnowledgeId, WorkspaceState } from "@/lib/types";
import "./evidence-review-workspace.css";

export const evidenceHelpNames: Record<HelpLevel, string> = { independent: "独立作答", hint: "使用提示", explanation: "看过讲解", unknown: "帮助情况待确认" };
export const evidenceAuthorityNames = { original: "原始记录", "local-unverified": "本机更正 · 未经教师核实", "teacher-verified": "授权教师已复核" };
const fieldNames: Record<keyof EvidencePatch, string> = { answer: "答案文字", knowledgeId: "知识点", help: "帮助情况", invalidated: "记录有效性" };
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const knowledgeName = (state: WorkspaceState, id: KnowledgeId) => state.knowledge.find(item => item.id === id)?.name ?? id;
const stars = (count: number | null) => count === null ? "待评估" : `${count} 星`;
const confirmedFailure = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;
const errorText = (error: unknown) => error instanceof Error ? error.message : "未能确认保存结果，请保留当前内容后重试。";

export function evidenceProposalPayload(evidence: EffectiveEvidence, fields: { answer: string; knowledgeId: KnowledgeId; help: HelpLevel; invalidated: boolean }, reason: string, uploadIds: string[], state: WorkspaceState, requestId: string, verifyFields: (keyof EvidencePatch)[] = []) {
  const patch: EvidencePatch = {};
  if (fields.answer !== evidence.answer) patch.answer = fields.answer;
  if (fields.knowledgeId !== evidence.knowledgeId) patch.knowledgeId = fields.knowledgeId;
  if (fields.help !== evidence.help) patch.help = fields.help;
  if (fields.invalidated !== !evidence.valid) patch.invalidated = fields.invalidated;
  for (const key of verifyFields) {
    if (!evidence.unverifiedFields?.includes(key)) throw new Error("请选择当前仍待教师核实的字段。");
    if (key === "answer") patch.answer = fields.answer;
    else if (key === "knowledgeId") patch.knowledgeId = fields.knowledgeId;
    else if (key === "help") patch.help = fields.help;
    else patch.invalidated = fields.invalidated;
  }
  if (!Object.keys(patch).length) throw new Error("请至少修改一项需要复核的记录。");
  if (!reason.trim()) throw new Error("请说明原记录哪里不准确，以及更正的依据。");
  if (new Set(uploadIds).size > 10) throw new Error("一次申请最多选择 10 张图片。");
  if (uploadIds.some(id => !state.uploads.some(upload => upload.id === id))) throw new Error("所选材料不在当前工作区，请重新选择。");
  return { evidenceId: evidence.id, patch, reason: reason.trim(), uploadIds: [...new Set(uploadIds)], sourceRevision: state.revision, requestId };
}

export function evidenceReviewPayload(state: WorkspaceState, proposal: EvidenceProposal, preview: EvidencePreview, reason: string, requestId: string) {
  if ((state.access?.role ?? state.actor.role) !== "teacher" || proposal.requestedBy === state.actor.id || proposal.delivery !== "workspace") throw new Error("须由另一位已授权教师复核，管理员不能代替教师身份。");
  if (state.evidenceReviews?.decisions.some(item => item.proposalId === proposal.id)) throw new Error("这份申请已有复核结论，请重新查看记录。");
  if (preview.proposalId !== proposal.id || preview.evidenceId !== proposal.evidenceId || preview.authority !== "teacher-verified" || preview.sourceRevision !== state.revision) throw new Error("预览与当前记录不匹配，请重新预览影响。复核理由仍保留。");
  if (!reason.trim()) throw new Error("请填写复核理由。");
  return { proposalId: proposal.id, outcome: preview.outcome, sourceRevision: preview.sourceRevision, digest: preview.digest, reason: reason.trim(), requestId };
}

export function EvidenceComparison({ evidence, state, title = "原始记录与当前结果", asOfRevision }: { evidence: EffectiveEvidence; state: WorkspaceState; title?: string; asOfRevision?: number }) {
  const values = (item: Evidence, valid = true) => [item.answer || "未作答", knowledgeName(state, item.knowledgeId), evidenceHelpNames[item.help], valid ? item.correct ? "答对" : "待订正" : "已排除，不计学习结果"];
  return <section className="evidence-comparison"><h3>{title}</h3><div className="evidence-table-wrap"><table><thead><tr><th>记录</th><th>答案文字</th><th>知识点</th><th>帮助情况</th><th>结果</th></tr></thead><tbody><tr><th>首次保存</th>{values(evidence.original).map((value, index) => <td key={index}>{value}</td>)}</tr><tr><th>{asOfRevision === undefined ? "当前有效" : "当时有效"}</th>{values(evidence, evidence.valid).map((value, index) => <td key={index}>{value}</td>)}</tr></tbody></table></div><p className="muted">{evidenceAuthorityNames[evidence.authority]}。原始记录不会覆盖，订正练习另行保存。</p>{Boolean(evidence.unverifiedFields?.length) && <p className="muted">仍待教师核实的字段：{evidence.unverifiedFields!.map(key => fieldNames[key]).join("、")}。其他字段的复核不会一并核实这些内容。</p>}{evidence.masteryBlockedReason && <p className="notice">星级采用限制：{evidence.masteryBlockedReason}</p>}</section>;
}

export function EvidenceSharingPreview({ evidence, patch, reason, uploads }: { evidence: EffectiveEvidence; patch: EvidencePatch; reason: string; uploads: { id: string; name: string }[] }) {
  return <section className="evidence-sharing-preview"><h3><ShieldCheck size={18} />确认这次共享范围</h3><p>向当前工作区已授权教师共享这一条作答证据、拟更正内容、你填写的原因，以及下方主动选择的图片。私人对话、其他照片和未提交作答不会附带。</p><blockquote>{evidence.questionText}</blockquote><ul>{Object.entries(patch).map(([key, value]) => <li key={key}>{{ answer: "答案文字", knowledgeId: "知识点", help: "帮助情况", invalidated: "排除记录" }[key]}：{key === "help" ? evidenceHelpNames[value as HelpLevel] : typeof value === "boolean" ? value ? "申请排除" : "申请恢复" : String(value)}</li>)}</ul><p><strong>申请原因：</strong>{reason}</p><p><strong>所选图片：</strong>{uploads.length ? uploads.map(item => item.name).join("、") : "未选择图片"}</p><p className="muted">提交申请不会改变成绩。教师复核后另存结论；已共享的材料不会随私人会话删除而撤回。</p></section>;
}

export function EvidenceImpactPreview({ preview, state }: { preview: EvidencePreview; state: WorkspaceState }) {
  return <section className="evidence-impact"><h3>{preview.outcome === "accept" ? "接受更正后的影响预览" : "拒绝申请的影响预览"}</h3><p className="muted">依据工作区 r{preview.sourceRevision}，确认时会重新核对同一份预览。</p><div className="evidence-impact-stats"><p>报告答对<strong>{preview.report.beforeCorrect} → {preview.report.afterCorrect}</strong></p><p>独立答对<strong>{preview.report.beforeIndependent} → {preview.report.afterIndependent}</strong></p><p>当前错题<strong>{preview.mistake.beforeActive ? "需巩固" : "不在当前错题"} → {preview.mistake.afterActive ? "需巩固" : "不在当前错题"}</strong></p></div><p>排除后不计成绩的记录：{preview.report.invalidatedCount} 条。独立答对数量不等于符合升星条件的证据数量。</p>{preview.knowledge.map(item => <div className="evidence-impact-row" key={item.knowledgeId}><strong>{knowledgeName(state, item.knowledgeId)}：{stars(item.beforeStars)} → {stars(item.afterStars)}</strong><p>{item.reason}</p></div>)}{preview.reviewPlans.map(plan => <div className="evidence-impact-row" key={plan.planId}><strong>{knowledgeName(state, plan.knowledgeId)}复查计划：{plan.beforeValid ? "来源有效" : "来源无效"} → {plan.afterValid ? "来源有效" : "来源无效"}</strong><p>{plan.reason}</p></div>)}{preview.warnings.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}<p className="muted">原稿、历史评定和已查看的帮助记录仍保留。该复核不是对试用星级规则教学有效性的验证。</p></section>;
}

export default function EvidenceReviewWorkspace(props: AppProps) {
  const { state, selectedId, navigate } = props;
  const role = state.access?.role ?? state.actor.role;
  const [filter, setFilter] = useState("pending");
  if (!["owner", "student", "teacher", "parent"].includes(role)) return <div className="card empty-state"><LockKeyhole /><h2>当前身份不能查看学习证据复核</h2></div>;
  const visibleProposals = (state.evidenceReviews?.proposals ?? []).filter(item => role === "teacher" ? item.delivery === "workspace" : (role === "student" || role === "owner") && item.requestedBy === state.actor.id);
  const proposal = visibleProposals.find(item => item.id === selectedId);
  const evidence = effectiveEvidence(state).find(item => item.id === (proposal?.evidenceId ?? selectedId));
  const proposals = [...visibleProposals].filter(item => !evidence || item.evidenceId === evidence.id).reverse();
  const canPropose = role === "student" || role === "owner";
  return <div className="evidence-page"><div className="evidence-heading"><div><p className="eyebrow">EVIDENCE, WITH A TRACEABLE HISTORY</p><h1>{role === "teacher" ? "学习证据复核" : "记录更正与复核"}</h1><p className="muted">先核对原记录，再留下有原因、可追溯的更正。</p></div>{selectedId && <button className="btn btn-secondary" onClick={() => navigate("evidence-review")}><ArrowLeft size={16} />全部复核记录</button>}</div>
    <div className="notice"><ShieldCheck size={19} /><span>{role === "teacher" ? "仅当前工作区获授权的教师角色可复核他人申请。工作区角色不代表额外的专业资质认证。" : "申请与更正记录各自保留；仅教师角色可确认教师复核，管理员不会代替教师身份。"} 本机未核实的历史更正会明确标识，不冒充教师复核。</span></div>
    {selectedId && !evidence && <section className="card empty-state"><h2>这条记录暂不可查看</h2><p>记录不存在、尚未提交，或不在当前授权范围内。请重新打开所属报告。</p></section>}
    {evidence && <><section className="card evidence-card"><div className="row"><span className="badge">题目 v{evidence.questionVersion}</span><span className="badge">{evidenceAuthorityNames[evidence.authority]}</span></div><h2>{evidence.questionText}</h2><p className="muted">{date(evidence.createdAt)} · 证据 {evidence.id}</p><EvidenceComparison evidence={evidence} state={state} /><button className="btn btn-secondary" onClick={() => navigate("report", evidence.attemptId)}>查看原卷与作答过程<ArrowRight size={16} /></button></section>{canPropose && !proposal && <EvidenceProposalForm {...props} evidence={evidence} key={`${state.access?.workspaceId ?? state.actor.id}:${state.actor.id}:${evidence.id}`} />}</>}
    <div className="evidence-heading"><h2>{evidence ? "这条证据的复核历史" : "复核队列"}</h2><div className="row">{["pending", "all"].map(value => <button className={`btn ${filter === value ? "btn-primary" : "btn-secondary"}`} key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "pending" ? "待复核" : "全部记录"}</button>)}</div></div>
    {proposal ? <EvidenceProposalDetail {...props} proposal={proposal} key={`${state.actor.id}:${proposal.id}`} /> : proposals.filter(item => filter === "all" || !state.evidenceReviews?.decisions.some(decision => decision.proposalId === item.id)).map(item => { const decision = state.evidenceReviews?.decisions.find(entry => entry.proposalId === item.id); const source = state.evidence.find(entry => entry.id === item.evidenceId); return <button className="card evidence-list-item" key={item.id} onClick={() => navigate("evidence-review", item.id)}><ClipboardCheck size={23} /><div><h3>{source?.questionText ?? "作答证据"}</h3><p>{item.reason}</p><small>{date(item.createdAt)} · {item.uploadIds.length} 张主动选择的图片</small></div><span className="badge">{decision ? decision.outcome === "accept" ? "已接受更正" : "已拒绝" : "待复核"}</span><ArrowRight size={16} /></button>; })}
    {!proposal && !proposals.some(item => filter === "all" || !state.evidenceReviews?.decisions.some(decision => decision.proposalId === item.id)) && <div className="card empty-state"><History size={30} /><h3>暂时没有{filter === "pending" ? "待复核的申请" : "复核记录"}</h3><p>{canPropose ? "在学习报告中选择一条已提交的证据，填写需要核对的内容。" : "学生主动申请后，会在这里形成带原始依据的复核记录。"}</p><button className="btn btn-secondary" onClick={() => navigate("home")}>查看学习报告</button></div>}
  </div>;
}

type ProposalPayload = ReturnType<typeof evidenceProposalPayload>;
export function EvidenceProposalForm({ state, mutate, busy, navigate, evidence }: AppProps & { evidence: EffectiveEvidence }) {
  const [base, setBase] = useState(evidence);
  const baseChanged = JSON.stringify([base.answer, base.help, base.knowledgeId, base.valid, base.decisionId]) !== JSON.stringify([evidence.answer, evidence.help, evidence.knowledgeId, evidence.valid, evidence.decisionId]);
  const [fields, setFields] = useState({ answer: evidence.answer, knowledgeId: evidence.knowledgeId, help: evidence.help, invalidated: !evidence.valid });
  const [reason, setReason] = useState("");
  const [verifyFields, setVerifyFields] = useState<(keyof EvidencePatch)[]>([]);
  const [uploadIds, setUploadIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<ProposalPayload | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const retry = useRef<ProposalPayload | null>(null);
  const locked = busy || saving || uncertain;
  const prepare = () => { if (locked || lock.current) return; try { setError(""); if (baseChanged) throw new Error("这条证据已有新的复核结论，请先对照当前记录；填写内容仍保留。"); setPreview(evidenceProposalPayload(base, fields, reason, uploadIds, state, crypto.randomUUID(), verifyFields)); } catch (caught) { setError(errorText(caught)); } };
  const submit = async () => {
    if (lock.current || busy || (!preview && !retry.current)) return;
    const payload = retry.current ?? preview!;
    if (!retry.current && payload.sourceRevision !== state.revision) { setError("记录已更新，请重新预览共享范围后提交；填写内容仍保留。"); return; }
    lock.current = true; retry.current = payload; setSaving(true); setError("");
    try { const result = await mutate("evidence.propose", payload); if (!result?.result?.id) throw new Error("暂未确认申请是否已保存，请按原内容重试。"); retry.current = null; setUncertain(false); navigate("evidence-review", result.result.id); }
    catch (caught) { setError(errorText(caught)); if (confirmedFailure(caught)) { retry.current = null; setUncertain(false); setPreview(null); } else setUncertain(true); }
    finally { lock.current = false; setSaving(false); }
  };
  return <section className="card evidence-card"><h2>申请核对这条记录</h2><p className="muted">只填写原记录中不准确的部分。后来重新做对的题，请使用“错题订正”，不能改写首次作答。</p>{baseChanged && <div className="notice"><span>当前证据已更新，请对照上方结果后重新核对。你的输入保留。</span><button className="btn btn-secondary" disabled={locked} onClick={() => { setBase(evidence); setVerifyFields(previous => previous.filter(key => evidence.unverifiedFields?.includes(key))); setPreview(null); }}>已核对，保留输入继续</button></div>}<fieldset className="evidence-form" disabled={locked || Boolean(preview)}><label className="field">原稿中的答案文字<input className="input" value={fields.answer} maxLength={300} onChange={event => setFields(previous => ({ ...previous, answer: event.target.value }))} /></label><label className="field">对应知识点<select className="select" value={fields.knowledgeId} onChange={event => setFields(previous => ({ ...previous, knowledgeId: event.target.value as KnowledgeId }))}>{state.knowledge.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">当次作答的帮助情况<small className="muted">已记录的真实提示或讲解不能降低，查看事实仍保留。</small><select className="select" value={fields.help} onChange={event => setFields(previous => ({ ...previous, help: event.target.value as HelpLevel }))}>{Object.entries(evidenceHelpNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="evidence-check"><input type="checkbox" checked={fields.invalidated} onChange={event => setFields(previous => ({ ...previous, invalidated: event.target.checked }))} />申请排除本条记录（原记录仍保留）</label>{Boolean(evidence.unverifiedFields?.length) && <div className="evidence-full"><h3>申请核实已有的本机更正（选填）</h3><p className="muted">如果现有内容正确，可选择需要教师核对的字段，不必改成另一个答案。</p>{evidence.unverifiedFields!.map(key => <label className="evidence-check" key={key}><input type="checkbox" checked={verifyFields.includes(key)} onChange={() => setVerifyFields(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])} />核实{fieldNames[key]}</label>)}</div>}<label className="field evidence-full">更正原因与依据<textarea className="textarea" value={reason} maxLength={1000} rows={4} placeholder="例如：原稿写的是 8，录入成了 3；请按所选原稿核对。" onChange={event => setReason(event.target.value)} /></label><div className="evidence-full"><h3>选择这次要共享的原稿图片（选填）</h3><p className="muted">只列出当前工作区已上传的图片；不会自动选择，最多 10 张。</p><div className="evidence-upload-options">{state.uploads.map(upload => <label className="evidence-check" key={upload.id}><input type="checkbox" disabled={uploadIds.length >= 10 && !uploadIds.includes(upload.id)} checked={uploadIds.includes(upload.id)} onChange={() => setUploadIds(previous => previous.includes(upload.id) ? previous.filter(id => id !== upload.id) : [...previous, upload.id])} /><FileImage size={17} /><span>{upload.name}<small>{date(upload.createdAt)}</small></span><a href={workspaceUrl(upload.url, state.access?.workspaceId ?? state.actor.id)} target="_blank" rel="noopener noreferrer">查看图片</a></label>)}</div>{!state.uploads.length && <p className="muted">还没有已上传的图片。可以仅填写原因提交，或稍后先到拍照学习上传原稿。</p>}</div></fieldset>
    {preview && <EvidenceSharingPreview evidence={evidence} patch={preview.patch} reason={preview.reason} uploads={state.uploads.filter(item => preview.uploadIds.includes(item.id))} />}
    {error && <p className="evidence-error" role="alert">{error}</p>}{uncertain && <p className="notice">保存结果尚未确认。保留这次内容和请求编号，重试不会主动创建另一份申请。</p>}
    <div className="row">{!preview ? <button className="btn btn-primary" disabled={locked} onClick={prepare}>预览共享范围<ArrowRight size={16} /></button> : <><button className="btn btn-primary" disabled={busy || saving || (!uncertain && preview.sourceRevision !== state.revision)} onClick={() => void submit()}>{saving ? "正在提交…" : uncertain ? "按原内容重试提交" : "确认共享并申请复核"}</button><button className="btn btn-secondary" disabled={locked} onClick={() => setPreview(null)}>返回编辑</button></>}{preview && preview.sourceRevision !== state.revision && !uncertain && <span className="muted">记录已更新，返回编辑后重新预览即可，内容保留。</span>}</div>
  </section>;
}

export function EvidenceProposalDetail({ state, mutate, busy, proposal }: AppProps & { proposal: EvidenceProposal }) {
  const role = state.access?.role ?? state.actor.role;
  const [outcome, setOutcome] = useState<"accept" | "reject">("accept");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const retry = useRef<Record<string, unknown> | null>(null);
  const decision = state.evidenceReviews?.decisions.find(item => item.proposalId === proposal.id);
  const evidence = effectiveEvidence(state).find(item => item.id === proposal.evidenceId);
  const canReview = role === "teacher" && proposal.delivery === "workspace" && proposal.requestedBy !== state.actor.id && !decision;
  const getPreview = async () => {
    if (busy || lock.current || uncertain || !canReview) return;
    if (!reason.trim()) { setError("请先填写复核理由，说明核对了哪些依据。"); return; }
    lock.current = true; setSaving(true); setError("");
    try { const result = await mutate("evidence.preview", { proposalId: proposal.id, outcome }); const value = result?.result?.preview as EvidencePreview | undefined; if (!value || value.proposalId !== proposal.id || value.outcome !== outcome) throw new Error("未取得匹配的影响预览，请重试。"); setPreview(value); }
    catch (caught) { setError(errorText(caught)); }
    finally { lock.current = false; setSaving(false); }
  };
  const confirm = async () => {
    if (busy || lock.current || !canReview || (!preview && !retry.current)) return;
    if (!retry.current && preview!.sourceRevision !== state.revision) { setError("预览后记录已更新，请重新预览影响。复核理由仍保留。"); return; }
    let payload: Record<string, unknown>;
    try { payload = retry.current ?? evidenceReviewPayload(state, proposal, preview!, reason, crypto.randomUUID()); } catch (caught) { setError(errorText(caught)); return; }
    retry.current = payload; lock.current = true; setSaving(true); setError("");
    try { const result = await mutate("evidence.review", payload); if (!result?.result?.id) throw new Error("尚未确认复核结果，请按原结论重试。"); retry.current = null; setUncertain(false); setPreview(null); }
    catch (caught) { setError(errorText(caught)); if (confirmedFailure(caught)) { retry.current = null; setUncertain(false); setPreview(null); } else setUncertain(true); }
    finally { lock.current = false; setSaving(false); }
  };
  if (!evidence) return <div className="card empty-state">当前授权范围内没有对应证据，不能复核。</div>;
  return <section className="card evidence-card"><div className="evidence-heading"><h2>申请详情</h2><span className="badge">{decision ? decision.outcome === "accept" ? "已接受更正" : "已拒绝" : "待复核"}</span></div><p className="muted">{date(proposal.createdAt)} · {proposal.delivery === "local-only" ? "本机保存，未向教师发送" : "已共享至本工作区教师复核队列"}</p><p><strong>申请原因：</strong>{proposal.reason}</p><div className="evidence-impact-row"><h3>拟更正内容</h3><dl>{Object.entries(proposal.patch).map(([key, value]) => <div key={key}><dt>{{ answer: "答案文字", knowledgeId: "知识点", help: "帮助情况", invalidated: "记录有效性" }[key]}</dt><dd>{key === "help" ? evidenceHelpNames[value as HelpLevel] : key === "knowledgeId" ? knowledgeName(state, value as KnowledgeId) : typeof value === "boolean" ? value ? "排除" : "恢复" : String(value)}</dd></div>)}</dl></div>
    <section><h3>申请人主动选择的材料</h3><div className="evidence-materials">{(proposal.materials ?? []).map(material => <a key={material.id} className="btn btn-secondary" href={workspaceUrl(material.url ?? `/api/evidence/${encodeURIComponent(proposal.id)}/images/${encodeURIComponent(material.id)}`, state.access?.workspaceId ?? state.actor.id)} target="_blank" rel="noopener noreferrer"><FileImage size={18} />{material.name}<ArrowRight size={15} /></a>)}</div>{!proposal.uploadIds.length ? <p className="muted">未选择原稿图片，请根据已有记录和申请说明复核，不能声称看过未提供的原稿。</p> : !proposal.materials?.length && <p className="muted">有 {proposal.uploadIds.length} 张所选材料；当前身份未获图片访问权限，不能据此声称已核对原稿。</p>}<p className="muted">仅开放这份申请明确关联的图片，不开放其他照片或私人会话。图片内容是复核材料，不代表更正理由已获证实。</p></section>
    {decision ? <div className="evidence-decision"><h3>{decision.outcome === "accept" ? "接受更正" : "拒绝申请"} · {evidenceAuthorityNames[decision.authority]}</h3><p>{decision.reason}</p><small>{date(decision.createdAt)} · 生效修订 r{decision.appliedRevision} · 复核记录 {decision.id}</small></div> : canReview ? <><fieldset disabled={busy || saving || uncertain || Boolean(preview)} className="evidence-review-form"><label className="field">复核结论<select className="select" value={outcome} onChange={event => setOutcome(event.target.value as "accept" | "reject")}><option value="accept">接受拟更正内容</option><option value="reject">拒绝申请，保留当前结果</option></select></label><label className="field">复核理由（必填）<textarea className="textarea" maxLength={1000} rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="说明核对依据与接受或拒绝的具体原因；只陈述实际查阅的材料。" /></label></fieldset>{preview && <EvidenceImpactPreview preview={preview} state={state} />}{error && <p className="evidence-error" role="alert">{error}</p>}{uncertain && <p className="notice">复核保存结果尚未确认。请按原结论重试，原记录和本次理由仍保留。</p>}<div className="row">{!preview ? <button className="btn btn-primary" disabled={busy || saving || uncertain} onClick={() => void getPreview()}>{saving ? "正在核对影响…" : "预览更正影响"}</button> : <><button className="btn btn-primary" disabled={busy || saving || (!uncertain && preview.sourceRevision !== state.revision)} onClick={() => void confirm()}>{saving ? "正在确认…" : uncertain ? "按原结论重试" : `确认${preview.outcome === "accept" ? "接受更正" : "拒绝申请"}`}</button><button className="btn btn-secondary" disabled={busy || saving || uncertain} onClick={() => setPreview(null)}>返回复核</button></>}{preview && preview.sourceRevision !== state.revision && !uncertain && <span className="muted">预览已过期，请返回复核后重新预览。理由保留。</span>}</div></> : <p className="notice">{role === "teacher" ? "申请人与复核人须为不同账号，请由另一位已授权教师复核。" : "这份申请等待已授权教师复核，当前身份不能确认教师核实。"}</p>}
  </section>;
}
