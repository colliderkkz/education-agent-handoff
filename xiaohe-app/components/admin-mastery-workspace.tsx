"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronRight, ClipboardCheck, Clock3, FilePenLine, GitBranch, History, Info, Plus, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Star } from "lucide-react";
import { reviewAvailableAt } from "@/lib/server/mastery";
import type { AppProps } from "@/lib/ui-types";
import type { ApiResult, KnowledgeId, MasteryAssessment, MasteryRule, RuleParameters, RulePreview, WorkspaceState } from "@/lib/types";
import "./admin-mastery-workspace.css";

type ParameterKey = keyof RuleParameters;
type RuleDraft = { name: string; expectedRevision: number; values: Record<ParameterKey, string> };
type Confirmation = { kind: "publish" | "activate" | "disable" | "reload"; ruleId: string } | null;
const statusLabels: Record<MasteryRule["status"], string> = { draft: "草稿", review: "待独立审核", approved: "审核通过", published: "已发布", disabled: "已停用" };
const triggerLabels: Record<MasteryAssessment["trigger"], string> = { migration: "规则迁移留档", submission: "提交作答", reevaluate: "重新评定", "rule-switch": "切换生效规则", "evidence-correction": "学习证据更正", "history-deletion": "删除历史后重新评定" };
const parameterFields: { key: ParameterKey; label: string; help: string; group: string; accuracy?: boolean }[] = [
  { key: "star1Correct", label: "一星：讲解后答对的新题族数", help: "必须实际提交并答对；只看讲解不产生星级。", group: "起步与基础" },
  { key: "star2Correct", label: "二星：提示后答对的新题族数", help: "依据提示帮助下的作答，帮助状态单独保留。", group: "起步与基础" },
  { key: "star3BasicCorrect", label: "三星：独立答对的基础题数", help: "需要符合规则的基础任务与独立新题证据。", group: "起步与基础" },
  { key: "star4ApplicationCorrect", label: "四星：独立答对的应用题数", help: "题库须已标注应用任务，不能用难度代替任务类型。", group: "多情境与稳定性" },
  { key: "star4Contexts", label: "四星：不同应用情境数", help: "由题目情境标注区分；重复同一情境不增加覆盖。", group: "多情境与稳定性" },
  { key: "stableAttempts", label: "稳定运用所需作答批次", help: "按不同已提交练习批次观察，避免以一次作答定论。", group: "多情境与稳定性" },
  { key: "stableAccuracy", label: "稳定正确率（%）", help: "针对规则采用的独立新题证据计算。", group: "多情境与稳定性", accuracy: true },
  { key: "stabilityWindowAttempts", label: "稳定性观察窗口（批次）", help: "采用最近的有效作答批次，窗口须满足稳定与降级要求。", group: "多情境与稳定性" },
  { key: "star5TransferCorrect", label: "五星：复查中独立答对迁移题数", help: "须来自关联复查计划，且是学习历史中未见的迁移题族。", group: "间隔迁移与降级保护" },
  { key: "reviewDelayDays", label: "复查间隔（天）", help: "从来源作答起计，间隔未满不能作为五星复查依据。", group: "间隔迁移与降级保护" },
  { key: "downgradeAfterAttempts", label: "降级前所需连续观察批次", help: "由后端综合后续表现判断，单次错误不会立即降星。", group: "间隔迁移与降级保护" },
];
const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const stars = (count: number | null) => count === null ? "待评估" : `${count} 星`;
const knowledgeName = (state: WorkspaceState, id: KnowledgeId) => state.knowledge.find(item => item.id === id)?.name ?? id;
const draftFor = (rule: MasteryRule): RuleDraft => ({ name: rule.name, expectedRevision: rule.revision, values: Object.fromEntries(parameterFields.map(field => [field.key, String(field.accuracy ? Number((rule.parameters[field.key] * 100).toFixed(6)) : rule.parameters[field.key])])) as RuleDraft["values"] });
const isDraftChanged = (draft: RuleDraft | undefined, rule: MasteryRule) => Boolean(draft && (draft.name !== rule.name || parameterFields.some(field => draft.values[field.key] !== draftFor(rule).values[field.key])));

function FiveStarDefinitions({ rule }: { rule?: MasteryRule }) {
  const p = rule?.mode === "five-star" ? rule.parameters : undefined;
  const definitions = [
    ["关键步骤仍需讲解", p ? `讲解后提交答对 ${p.star1Correct} 个新题族。` : "实际作答体现讲解帮助下的理解。"],
    ["提示后能够完成", p ? `提示后提交答对 ${p.star2Correct} 个新题族。` : "实际作答体现提示帮助下的完成情况。"],
    ["基础任务能够独立", p ? `独立答对 ${p.star3BasicCorrect} 道基础新题。` : "采用独立完成基础新题的证据。"],
    ["不同情境稳定运用", p ? `在三星基础上：${p.star4ApplicationCorrect} 道应用题、${p.star4Contexts} 类情境；${p.stableAttempts} 批次，正确率至少 ${Number((p.stableAccuracy * 100).toFixed(4))}%。` : "观察多类应用任务与多次稳定表现。"],
    ["间隔后独立迁移", p ? `在四星基础上：间隔 ${p.reviewDelayDays} 天后，在关联复查中独立答对 ${p.star5TransferCorrect} 道全新迁移题。` : "通过关联计划完成间隔后的全新迁移任务。"],
  ];
  return <div className="admin-mastery-definitions">{definitions.map(([title, detail], index) => <article className="admin-mastery-definition" key={title}><span><Star size={14} fill="currentColor" />{index + 1} 星</span><h3>{title}</h3><p>{detail}</p></article>)}</div>;
}

export function AdminMasteryWorkspace({ state, mutate, busy, navigate }: AppProps) {
  const mastery = state.mastery;
  const rules = mastery?.rules ?? [];
  const active = rules.find(rule => rule.id === mastery?.activeRuleId);
  const role = state.actor.role;
  const isOwner = role === "owner";
  const canEdit = isOwner || role === "editor";
  const canReview = isOwner || role === "reviewer";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rules" | "history" | "plans">("rules");
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [newDraft, setNewDraft] = useState(false);
  const [newName, setNewName] = useState("");
  const [baseId, setBaseId] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewChecks, setReviewChecks] = useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [pending, setPending] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const inFlight = useRef(false);
  const selected = rules.find(rule => rule.id === selectedId) ?? active ?? rules[0];
  const canEditSelected = Boolean(selected && canEdit && (isOwner || selected.authorId === state.actor.id));
  const reviewCheckKey = selected ? `${selected.id}:${selected.revision}` : "";
  const cachedDraft = selected ? drafts[selected.id] : undefined;
  const draft = selected ? isDraftChanged(cachedDraft, selected) ? cachedDraft! : draftFor(selected) : undefined;
  const dirty = Boolean(selected?.status === "draft" && canEditSelected && isDraftChanged(draft, selected));
  const stale = Boolean(selected?.status === "draft" && canEditSelected && draft && draft.expectedRevision !== selected.revision);
  const locked = busy || Boolean(pending);
  const previews = mastery?.previews ?? [];
  const preview = selected ? [...previews].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find(item => item.ruleId === selected.id && item.actorId === state.actor.id) : undefined;
  const previewMatches = Boolean(selected && preview && preview.ruleRevision === selected.revision);
  const previewFresh = Boolean(preview && preview.sourceRevision === state.revision);
  const canPublishPreview = Boolean(previewMatches && previewFresh && preview?.learnerVisible && preview.issues.length === 0 && !dirty);

  const run = async (action: string, payload: Record<string, unknown>, message: string): Promise<ApiResult | undefined> => {
    if (busy || inFlight.current) return undefined;
    inFlight.current = true; setPending(action); setFeedback(null);
    try {
      const result = await mutate(action, payload);
      if (!result) { setFeedback({ error: true, message: "本次操作未确认成功。当前输入仍保留，请查看页面错误原因后重试。" }); return undefined; }
      setFeedback({ error: false, message: typeof result.result?.message === "string" ? result.result.message : message });
      return result;
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : "操作未成功，输入已保留，请重试。" });
      return undefined;
    } finally { inFlight.current = false; setPending(""); }
  };
  const updateDraft = (change: Partial<RuleDraft>) => {
    if (!selected || !draft || locked) return;
    setDrafts(current => ({ ...current, [selected.id]: { ...draft, ...change } }));
    setConfirmation(null);
  };
  const selectRule = (id: string) => { if (locked) return; setSelectedId(id); setNewDraft(false); setConfirmation(null); setFeedback(null); };
  const save = async () => {
    if (!selected || !draft || locked) return;
    const parameters = {} as RuleParameters;
    for (const field of parameterFields) {
      const raw = draft.values[field.key].trim(); const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value <= 0 || (!field.accuracy && !Number.isInteger(value)) || (field.accuracy && value > 100)) {
        setFeedback({ error: true, message: `请检查“${field.label}”：${field.accuracy ? "填写大于 0 且不超过 100 的百分比。" : "填写正整数。"}` }); return;
      }
      parameters[field.key] = field.accuracy ? value / 100 : value;
    }
    if (!draft.name.trim()) { setFeedback({ error: true, message: "请填写规则名称。" }); return; }
    const result = await run("rule.update", { id: selected.id, expectedRevision: draft.expectedRevision, name: draft.name.trim(), parameters }, "规则草稿已保存，请重新校验并试算。");
    const saved = result?.state.mastery?.rules.find(rule => rule.id === selected.id);
    if (saved) {
      setDrafts(current => ({ ...current, [saved.id]: draftFor(saved) }));
      const issues = result?.result?.issues;
      if (Array.isArray(issues) && issues.length) setFeedback({ error: true, message: `草稿已保存，但尚不能提交：${issues.filter(issue => typeof issue === "string").join("；")} 请调整参数后再次校验。` });
    }
  };
  const create = async () => {
    if (!newName.trim()) { setFeedback({ error: true, message: "请填写新版本的规则名称。" }); return; }
    const result = await run("rule.create", { name: newName.trim(), ...(baseId ? { baseRuleId: baseId } : {}) }, "新草稿已创建，可以继续调整参数。");
    if (!result) return;
    const created = result.state.mastery?.rules.find(rule => rule.id === result.result?.id);
    if (created) { setDrafts(current => ({ ...current, [created.id]: draftFor(created) })); setSelectedId(created.id); setNewDraft(false); setNewName(""); }
  };
  const finishConfirmation = async () => {
    if (!selected || confirmation?.ruleId !== selected.id || locked) return;
    if (confirmation.kind === "reload") {
      setDrafts(current => ({ ...current, [selected.id]: draftFor(selected) })); setConfirmation(null); setFeedback(null); return;
    }
    const result = confirmation.kind === "disable"
      ? await run("rule.disable", { id: selected.id }, "备用规则已停用，历史评定继续保留。")
      : await run(`rule.${confirmation.kind}`, { id: selected.id, previewId: preview?.id }, "生效规则已更新，原评定历史继续保留。");
    if (result) setConfirmation(null);
  };

  if (!["owner", "editor", "reviewer"].includes(role)) return null;
  return <div className="admin-mastery">
    <section className="admin-mastery-summary"><div><span className="admin-kicker">MASTERY · RULE WORKSPACE</span><h2>{active ? `当前生效 · ${active.name}` : "五星规则工作台"}</h2><p>{active ? `V${active.version} · ${active.id} · ${active.mode === "five-star" ? "完整五星规则" : "历史试点规则（最高三星）"}` : "当前工作区还没有可用规则，请刷新工作区完成规则迁移。"}</p><p>{active && !active.reviewerId && "当前内置试用配置尚未经过人工独立复核。"}未学习与待评估分别显示。没有证据不显示零星；看过答案、重复原题和纸面自述都不能替代独立新题证据。</p></div><span className="admin-mastery-pill is-trial"><Info size={13} />本地试用 · 教学有效性未验证</span></section>
    <FiveStarDefinitions rule={active} />
    <div className="admin-mastery-tabs" aria-label="熟练度规则视图"><button type="button" aria-pressed={tab === "rules"} onClick={() => setTab("rules")}><SlidersHorizontal size={15} />规则版本</button>{isOwner && <><button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}><History size={15} />评定历史</button><button type="button" aria-pressed={tab === "plans"} onClick={() => setTab("plans")}><Clock3 size={15} />复查计划</button></>}</div>
    {feedback && <div role={feedback.error ? "alert" : "status"} className={`admin-mastery-callout ${feedback.error ? "is-error" : "is-success"}`}>{feedback.error ? <AlertCircle size={17} /> : <Check size={17} />}<span>{feedback.message}</span></div>}
    <div hidden={tab !== "rules"}>
      <div className="admin-mastery-grid">
        <aside className="admin-mastery-versions"><h3>规则版本 <span className="muted">{rules.length}</span></h3>{canEdit && <button className="btn btn-primary" type="button" disabled={locked || !active} onClick={() => { setNewDraft(true); setBaseId(selected?.id ?? active?.id ?? ""); if (!newName) setNewName(`${selected?.name ?? "五星规则"} · 新版本`); setConfirmation(null); setFeedback(null); }}><Plus size={15} />新建规则草稿</button>}<div className="admin-mastery-version-list">{[...rules].sort((a, b) => b.version - a.version).map(rule => <button key={rule.id} className={`admin-mastery-version ${!newDraft && selected?.id === rule.id ? "active" : ""}`} type="button" disabled={locked} aria-pressed={!newDraft && selected?.id === rule.id} onClick={() => selectRule(rule.id)}><span>V{rule.version}<span>{rule.id === active?.id ? "正在生效" : statusLabels[rule.status]}</span></span><strong>{rule.name}</strong><small>修订 {rule.revision} · {dateTime(rule.updatedAt)}</small>{isDraftChanged(drafts[rule.id], rule) && <em>当前页面有未保存输入</em>}</button>)}</div>{!isOwner && <p className="admin-mastery-description" style={{ marginTop: 15, marginBottom: 0 }}>当前身份可查看规则与校验状态。学生证据、试算个体差异和评定历史不在授权范围内。</p>}</aside>
        <section className="admin-mastery-detail">
          {newDraft ? <><div className="admin-mastery-detail-heading"><div><span className="admin-kicker">NEW VERSION</span><h3>从现有规则创建新草稿</h3><p>现有版本的参数和评定记录会保留，新规则经过独立审核后方可发布。</p></div><FilePenLine size={23} /></div><form onSubmit={event => { event.preventDefault(); void create(); }}><div className="admin-mastery-fields"><label className="admin-mastery-field is-wide">规则名称<input required maxLength={100} value={newName} disabled={locked} onChange={event => setNewName(event.target.value)} /></label><label className="admin-mastery-field is-wide">复制参数的版本<select value={baseId} disabled={locked} onChange={event => setBaseId(event.target.value)}>{rules.map(rule => <option value={rule.id} key={rule.id}>V{rule.version} · {rule.name} · {statusLabels[rule.status]}</option>)}</select><small>创建成功后可在新草稿中逐项编辑参数。</small></label></div><div className="admin-mastery-form-actions"><button className="btn btn-primary" disabled={locked || !newName.trim()} type="submit"><Plus size={15} />{pending === "rule.create" ? "正在创建…" : "创建草稿"}</button><button className="btn btn-ghost" type="button" disabled={locked} onClick={() => setNewDraft(false)}>返回版本详情</button></div></form></> : selected && draft ? <>
            <div className="admin-mastery-detail-heading"><div><span className="admin-kicker">V{selected.version} · REVISION {selected.revision}</span><h3>{selected.name}</h3><p>作者 {selected.authorId} · {selected.reviewerId ? `独立审核 ${selected.reviewerId}` : "尚未独立审核"}</p><div className="admin-mastery-labels"><span className={`admin-mastery-pill ${selected.id === active?.id ? "is-active" : ""}`}>{selected.id === active?.id ? "当前生效" : statusLabels[selected.status]}</span>{selected.status === "published" && !selected.reviewerId && <span className="admin-mastery-pill is-trial">未人工复核</span>}<span className="admin-mastery-pill is-trial">教学有效性未验证</span></div></div><GitBranch size={23} /></div>
            {selected.mode === "legacy-pilot" && <div className="admin-mastery-callout"><Info size={17} /><span>这是保留的旧三星试点算法。下方五星参数不改变旧算法的含义；若要使用完整五星规则，请创建新草稿。切回此版本会保留历史并重新记录规则切换的评定。</span></div>}
            {selected.status === "draft" && canEditSelected ? <form className="admin-mastery-form" onSubmit={event => { event.preventDefault(); void save(); }}><label className="admin-mastery-field">规则名称<input value={draft.name} maxLength={100} required disabled={locked} onChange={event => updateDraft({ name: event.target.value })} /></label>{[...new Set(parameterFields.map(field => field.group))].map(group => <fieldset key={group} disabled={locked}><legend>{group}</legend><div className="admin-mastery-fields">{parameterFields.filter(field => field.group === group).map(field => <label className="admin-mastery-field" key={field.key}>{field.label}<input type="number" inputMode={field.accuracy ? "decimal" : "numeric"} step={field.accuracy ? "any" : 1} min={field.accuracy ? "0.000001" : 1} max={field.accuracy ? 100 : undefined} required value={draft.values[field.key]} onChange={event => updateDraft({ values: { ...draft.values, [field.key]: event.target.value } })} /><small>{field.help}</small></label>)}</div></fieldset>)}<div className="admin-mastery-form-actions"><button className="btn btn-primary" type="submit" disabled={locked || !dirty || stale}><Save size={15} />{pending === "rule.update" ? "正在保存…" : "保存草稿"}</button><span className="admin-mastery-save-state">{dirty ? "尚有未保存输入，保存后才能试算或提交。" : "参数与已保存草稿一致。"}</span>{(dirty || stale) && <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => setConfirmation({ kind: "reload", ruleId: selected.id })}><RotateCcw size={14} />重新载入已保存内容</button>}</div></form> : <><p className="admin-mastery-description">{selected.status === "draft" ? "当前身份可查看此草稿；仅作者或管理员可编辑和提交。需要独立修改时，可复制为自己的新草稿。" : "本版本参数只读。需要调整时，请创建新的规则草稿，保留当前版本。"}</p><dl className="admin-mastery-parameter-summary">{parameterFields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.accuracy ? `${Number((selected.parameters[field.key] * 100).toFixed(4))}%` : selected.parameters[field.key]}</dd></div>)}</dl></>}
            {stale && <div className="admin-mastery-callout is-error" role="alert"><AlertCircle size={17} /><span>服务器中的规则修订已变更。你的输入仍保留在当前页面；请先核对新修订，再决定是否重新载入。旧修订不能覆盖新内容。</span></div>}
            <div className="admin-mastery-callout"><ShieldCheck size={17} /><div><strong>参数校验与教学验证是两件事</strong><p>校验检查数值范围、参数之间的约束和可执行性；试算仅说明这组参数会如何解释当前记录。两者都不证明教学效度，独立审核通过也不代表已完成真实教学验证。</p></div></div>
            <div className="admin-mastery-form-actions"><button className="btn btn-secondary" disabled={locked || dirty || stale || selected.status === "disabled"} onClick={() => void run("rule.preview", { id: selected.id }, "参数校验与试算已完成；尚未切换生效规则。")}><ClipboardCheck size={15} />{pending === "rule.preview" ? "正在校验…" : isOwner ? "校验并试算差异" : "校验已保存参数"}</button>{selected.status === "draft" && canEditSelected && <button className="btn btn-secondary" disabled={locked || dirty || stale} onClick={() => void run("rule.submit", { id: selected.id, expectedRevision: selected.revision }, "已提交独立审核，需由非作者复核。")}><ArrowRight size={15} />提交独立审核</button>}</div>
            {preview && <RulePreviewPanel preview={preview} matches={previewMatches && !dirty} fresh={previewFresh} state={state} isOwner={isOwner} />}
            {selected.reviewNote && <div className="admin-mastery-callout"><Info size={17} /><div><strong>独立审核意见</strong><p>{selected.reviewNote}</p></div></div>}
            {selected.status === "review" && <section className="admin-mastery-review"><h4>独立复核</h4>{selected.authorId === state.actor.id ? <p className="admin-mastery-description">你是本版本作者，不能审核自己的规则。请由已获授权的另一位审核人员使用独立账号复核。</p> : !canReview ? <p className="admin-mastery-description">规则已提交。审核结论需由独立审核角色或管理员填写。</p> : <><label className="admin-mastery-field">审核意见<textarea rows={4} maxLength={2000} disabled={locked} value={reviewNotes[selected.id] ?? ""} onChange={event => setReviewNotes(current => ({ ...current, [selected.id]: event.target.value }))} placeholder="说明参数边界、适用情境与仍待教学验证的事项；退回时写明修改原因。" /></label><label className="admin-mastery-callout"><input type="checkbox" disabled={locked} checked={reviewChecks[reviewCheckKey] ?? false} onChange={event => setReviewChecks(current => ({ ...current, [reviewCheckKey]: event.target.checked }))} /><span>我已核对规则、校验说明与适用范围，理解当前规则仍未经真实教学效度验证。</span></label><div className="admin-mastery-form-actions"><button className="btn btn-primary" disabled={locked || !reviewChecks[reviewCheckKey] || !reviewNotes[selected.id]?.trim()} onClick={() => void run("rule.review", { id: selected.id, expectedRevision: selected.revision, decision: "approve", note: reviewNotes[selected.id]?.trim() }, "独立审核已通过，等待管理员试算并发布。")}><ShieldCheck size={15} />审核通过</button><button className="btn btn-secondary" disabled={locked || !reviewNotes[selected.id]?.trim()} onClick={() => void run("rule.review", { id: selected.id, expectedRevision: selected.revision, decision: "reject", note: reviewNotes[selected.id]?.trim() }, "已退回草稿，审核意见已保留。")}>退回修改</button></div></>}</section>}
            {isOwner && (selected.status === "approved" || selected.status === "published" && selected.id !== active?.id) && <section className="admin-mastery-review"><h4>{selected.status === "approved" ? "发布到当前工作区" : "切回这个已发布版本"}</h4><p className="admin-mastery-description">先由当前管理员针对最新记录完成试算，再确认切换。若学习记录或规则已变化，服务器会拒绝过期试算，需重新试算。</p><div className="admin-mastery-form-actions"><button className="btn btn-primary" disabled={locked || !canPublishPreview} onClick={() => setConfirmation({ kind: selected.status === "approved" ? "publish" : "activate", ruleId: selected.id })}>{selected.status === "approved" ? "发布规则" : "切回此版本"}<ArrowRight size={15} /></button>{selected.status === "published" && <button className="btn btn-ghost admin-danger" disabled={locked} onClick={() => setConfirmation({ kind: "disable", ruleId: selected.id })}>停用备用版本</button>}</div>{!canPublishPreview && <p className="admin-mastery-description" style={{ marginTop: 10 }}>请先完成本修订的管理员校验与试算，并处理发现的问题。</p>}</section>}
            {selected.status === "approved" && !isOwner && <div className="admin-mastery-callout"><Info size={17} /><span>审核已通过。发布和切回规则由管理员完成，当前身份没有发布权限。</span></div>}
            {selected.id === active?.id && <p className="admin-mastery-description" style={{ marginTop: 17 }}>当前生效版本不能直接停用。管理员可先试算并切换到另一已发布版本，之后再停用备用版本。</p>}
            {confirmation?.ruleId === selected.id && <div className="admin-mastery-confirm" role="group" aria-label="确认规则操作"><p><strong>{confirmation.kind === "reload" ? "重新载入会替换当前页面中这个版本的未保存输入。" : confirmation.kind === "disable" ? "停用后，此备用版本不能再作为生效规则启用。" : `确认以 V${selected.version}「${selected.name}」替换当前生效规则？`}</strong>{confirmation.kind === "publish" || confirmation.kind === "activate" ? " 既有评定历史会保留，本次切换另行留档；这不会将规则标记为教学验证通过。" : confirmation.kind === "disable" ? " 历史版本及评定记录继续保留。" : " 其他版本的本地草稿不受影响。"}</p><div className="admin-mastery-form-actions"><button className="btn btn-primary" disabled={locked || ((confirmation.kind === "publish" || confirmation.kind === "activate") && !canPublishPreview)} onClick={() => void finishConfirmation()}>{locked ? "正在处理…" : confirmation.kind === "reload" ? "替换为已保存内容" : confirmation.kind === "disable" ? "确认停用备用版本" : "确认切换规则"}</button><button className="btn btn-secondary" disabled={locked} onClick={() => setConfirmation(null)}>取消</button></div></div>}
          </> : <div className="admin-mastery-empty"><SlidersHorizontal size={28} /><strong>暂无规则版本</strong>当前工作区尚未载入规则，请刷新后重试。</div>}
        </section>
      </div>
    </div>
    {isOwner && <><div hidden={tab !== "history"}><AssessmentHistory state={state} navigate={navigate} /></div><div hidden={tab !== "plans"}><ReviewPlans state={state} navigate={navigate} /></div></>}
  </div>;
}

function RulePreviewPanel({ preview, matches, fresh, state, isOwner }: { preview: RulePreview; matches: boolean; fresh: boolean; state: WorkspaceState; isOwner: boolean }) {
  return <section className="admin-mastery-preview"><h4>{isOwner ? "参数校验与试算结果" : "参数校验结果"}</h4><p>{dateTime(preview.createdAt)} · 规则修订 {preview.ruleRevision} · 依据工作区 r{preview.sourceRevision}</p>{!matches && <p role="status">参数已变化，这份结果仅供追溯；请保存并重新校验。</p>}{isOwner && matches && !fresh && <p role="status">工作区记录已更新，这份试算不再是最新结果。发布或切回前，请重新试算。</p>}<span className={`admin-mastery-pill ${preview.issues.length ? "is-trial" : "is-active"}`}>{preview.issues.length ? `${preview.issues.length} 项需处理` : "数值与规则约束检查通过"}</span>{preview.issues.length > 0 && <ul>{preview.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}<p>数值检查通过不代表教学有效性已验证。试算不会直接改变当前评定。</p>{isOwner && preview.learnerVisible ? preview.changes.length > 0 ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>知识点</th><th>当前 → 试算</th><th>试算依据</th></tr></thead><tbody>{preview.changes.map(change => <tr key={change.knowledgeId}><td>{knowledgeName(state, change.knowledgeId)}</td><td>{state.knowledge.find(item => item.id === change.knowledgeId)?.learningState === "upcoming" ? "未学习 → 未学习" : `${stars(change.beforeStars)} → ${stars(change.afterStars)}`}</td><td className="admin-wide-cell">{change.reason}</td></tr>)}</tbody></table></div> : <p>本次试算没有返回知识点差异；不代表规则已通过教学验证。</p> : <p>当前结果不包含学生个体差异，仅展示规则校验状态。</p>}</section>;
}

function AssessmentHistory({ state, navigate }: Pick<AppProps, "state" | "navigate">) {
  const [knowledge, setKnowledge] = useState("all");
  const [all, setAll] = useState(false);
  const records = [...(state.mastery?.assessments ?? [])].filter(record => knowledge === "all" || record.knowledgeId === knowledge).reverse();
  const latest = state.knowledge;
  const openEvidence = (id: string, revision: number) => { const evidence = state.evidence.find(item => item.id === id); if (evidence) navigate("report", evidence.attemptId, undefined, revision); };
  return <><div className="admin-mastery-history-heading"><div><h3>知识点评定与历史</h3><p>每条评定保留当时的规则、采用与排除的证据。旧结论不会被新规则覆盖。</p></div><select aria-label="筛选评定知识点" value={knowledge} onChange={event => { setKnowledge(event.target.value); setAll(false); }}><option value="all">全部知识点</option>{latest.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="admin-mastery-records">{(all ? records : records.slice(0, 20)).map(record => <details className="admin-mastery-record" key={record.id}><summary><span><strong>{knowledgeName(state, record.knowledgeId)} · {record.state === "unlearned" ? "未学习" : `${stars(record.beforeStars)} → ${stars(record.afterStars)}`}</strong><small>{dateTime(record.createdAt)} · {triggerLabels[record.trigger]} · {record.ruleVersion}{record.legacy ? " · 历史试点记录" : ""}</small></span>{latest.some(item => item.assessmentId === record.id) && <span className="admin-mastery-pill is-active">当前评定</span>}<ChevronRight size={16} /></summary><div className="admin-mastery-record-body"><p>{record.reason}</p><dl><div><dt>评定编号</dt><dd>{record.id}</dd></div><div><dt>规则版本 / 状态</dt><dd>{record.ruleVersion} · {{ unlearned: "未学习", insufficient: "证据不足，待评估", assessed: "已评定近期表现" }[record.state]}</dd></div><div><dt>证据修订</dt><dd>{record.evidenceAsOfRevision === undefined ? "历史原始记录，未记录修订号" : `r${record.evidenceAsOfRevision}`}</dd></div><div><dt>采用证据</dt><dd>{record.adoptedEvidenceIds.length} 条</dd></div><div><dt>排除证据</dt><dd>{record.excludedEvidence.length} 条</dd></div></dl>{record.conditions.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>条件</th><th>实际 / 要求</th><th>结论</th></tr></thead><tbody>{record.conditions.map(condition => <tr key={condition.key}><td>{condition.label}</td><td>{/accuracy/i.test(condition.key) ? `${Number((condition.actual * 100).toFixed(2))}% / ${Number((condition.required * 100).toFixed(2))}%` : `${condition.actual} / ${condition.required}`}</td><td>{condition.key === "downgrade" ? condition.met ? "已达到降级观察门槛" : "未达降级门槛" : condition.met ? "已满足" : "待积累"}</td></tr>)}</tbody></table></div>}{record.gaps.length > 0 && <p><strong>还需积累：</strong>{record.gaps.join("；")}</p>}{record.adoptedEvidenceIds.length > 0 && <><p><strong>采用的证据（评定当时）</strong></p><div className="admin-mastery-evidence-links">{record.adoptedEvidenceIds.map(id => <button key={id} disabled={!state.evidence.some(item => item.id === id)} onClick={() => openEvidence(id, record.evidenceAsOfRevision ?? 0)}>{id}<ChevronRight size={11} /></button>)}</div></>}{record.excludedEvidence.length > 0 && <><p><strong>排除原因</strong></p>{record.excludedEvidence.map((entry, index) => <p key={`${entry.evidenceId}-${index}`}>{entry.evidenceId}：{entry.reason}</p>)}</>}{record.attemptId && <button className="btn btn-secondary" onClick={() => navigate("report", record.attemptId, undefined, record.evidenceAsOfRevision ?? 0)}>查看触发作答的报告<ArrowRight size={14} /></button>}</div></details>)}</div>{!records.length && <div className="admin-mastery-empty"><History size={28} /><strong>还没有符合条件的评定历史</strong>规则迁移、提交作答和后续重新评定后，会形成可追溯记录。</div>}{records.length > 20 && <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setAll(value => !value)}>{all ? "收起较早记录" : `查看全部 ${records.length} 条评定`}</button>}</>;
}

function ReviewPlans({ state, navigate }: Pick<AppProps, "state" | "navigate">) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const plans = [...(state.mastery?.reviewPlans ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <><div className="admin-mastery-history-heading"><div><h3>逐知识点的间隔复查</h3><p>每项计划关联来源作答、规则与到期时间。没有合适的全新迁移题时，不用旧题或基础题冒充迁移证据。</p></div></div><div className="admin-mastery-plan-grid">{plans.map(plan => {
    let availableAt = plan.dueAt;
    let issue = "";
    if (plan.status === "scheduled") {
      try { availableAt = reviewAvailableAt(state, plan); }
      catch (caught) { issue = caught instanceof Error ? caught.message : "复查时间待核对"; }
    }
    const delayed = Date.parse(availableAt) > Date.parse(plan.dueAt);
    return <article key={plan.id} className="admin-mastery-plan"><span className={`admin-mastery-pill ${plan.status === "completed" ? "is-active" : ""}`}>{plan.status === "completed" ? "已完成" : plan.status === "started" ? "复查进行中" : issue ? "计划待核对" : Date.parse(availableAt) <= now ? "间隔已满，待安排" : "等待复查间隔"}</span><h4>{knowledgeName(state, plan.knowledgeId)}</h4><p>{plan.reason}</p><p>原计划到期：{dateTime(plan.dueAt)}<br />原间隔：{plan.delayDays} 天 · 来源规则：{plan.ruleId}</p>{delayed && <p>当前规则延长间隔，可开始时间为 {dateTime(availableAt)}；原计划日期保留。</p>}{issue && <p role="alert">{issue}</p>}<div className="admin-mastery-form-actions"><button className="btn btn-secondary" onClick={() => navigate("report", plan.sourceAttemptId)}>来源作答<ChevronRight size={13} /></button>{plan.attemptId ? <button className="btn btn-secondary" onClick={() => navigate("report", plan.attemptId)}>复查报告<ChevronRight size={13} /></button> : plan.paperId ? <button className="btn btn-secondary" onClick={() => navigate("papers", plan.paperId)}>查看复查卷<ChevronRight size={13} /></button> : null}</div><small>{plan.id} · 创建于 {dateTime(plan.createdAt)}{plan.completedAt ? ` · 完成于 ${dateTime(plan.completedAt)}` : ""}</small></article>; })}</div>{!plans.length && <div className="admin-mastery-empty"><Clock3 size={28} /><strong>尚无间隔复查计划</strong>符合规则的作答会形成对应知识点的复查计划，当前不会生成虚构计划。</div>}</>;
}
