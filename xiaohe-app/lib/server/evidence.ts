import type { ApiResult, Evidence, EvidenceDecision, EvidencePatch, EvidencePreview, EvidenceProposal, EvidenceReviewState, KnowledgeId, Role, WorkspaceState } from "../types.ts";
import { effectiveAttempt, effectiveEvidence, effectiveReviewSource, originalEvidenceProblem } from "../effective-evidence.ts";
import { canonicalStringify, sha256 } from "./content.ts";
import { DomainError } from "./domain-error.ts";
import { assessKnowledge, ensureMastery, reconcileEvidenceReviewPlans } from "./mastery.ts";

type Input = Record<string, unknown>;
export type EvidenceContext = { now: string; newId: () => string; userId: string; displayName?: string; role: Role; channel?: "local" };
const knowledgeIds = ["division", "geometry", "multiplication"];
const helpLevels = ["independent", "unknown", "hint", "explanation"];
const hash = (value: unknown) => sha256(canonicalStringify(value));
const check: (ok: unknown, message: string, status?: number) => asserts ok = (ok, message, status = 400) => { if (!ok) throw new DomainError(message, status); };
const object = (value: unknown): Input => { check(value && typeof value === "object" && !Array.isArray(value), "更正记录须为对象"); return value as Input; };
const keys = (value: Input, allowed: string[]) => { check(Object.keys(value).every(key => allowed.includes(key)), "更正记录含未支持字段"); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const id = (value: unknown) => { check(identifier(value), "更正记录 ID 格式不正确"); return value; };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown, label: string, max = 1000, empty = false) => { check(typeof value === "string" && value.length <= max && (empty || value.trim().length > 0), `${label}须为${empty ? "0" : "1"}—${max}字`); return value.trim(); };

export function ensureEvidenceReviews(state: WorkspaceState): EvidenceReviewState {
  return state.evidenceReviews ?? (state.evidenceReviews = { schemaVersion: 1, proposals: [], decisions: [] });
}

function parsePatch(raw: unknown): EvidencePatch {
  const input = object(raw); keys(input, ["answer", "knowledgeId", "help", "invalidated"]);
  check(Object.keys(input).length > 0, "请至少选择一个需要更正的字段");
  const patch: EvidencePatch = {};
  if (Object.hasOwn(input, "answer")) patch.answer = text(input.answer, "原稿答案更正", 300, true);
  if (Object.hasOwn(input, "knowledgeId")) { check(knowledgeIds.includes(String(input.knowledgeId)), "请选择已有知识点"); patch.knowledgeId = input.knowledgeId as KnowledgeId; }
  if (Object.hasOwn(input, "help")) { check(helpLevels.includes(String(input.help)), "帮助标记不正确"); patch.help = input.help as EvidencePatch["help"]; }
  if (Object.hasOwn(input, "invalidated")) { check(typeof input.invalidated === "boolean", "排除证据状态不正确"); patch.invalidated = input.invalidated; }
  return patch;
}

function rawEvidence(state: WorkspaceState, value: unknown): Evidence {
  const entry = state.evidence.find(e => e.id === id(value));
  check(entry, "未找到本学习空间的已提交证据", 404);
  check(!originalEvidenceProblem(state, entry), "原证据与不可变原卷、作答不一致，不能猜测更正来源", 409);
  return entry;
}

export function evidenceSourceDigest(state: WorkspaceState, entry: Evidence): string {
  const paper = state.papers.find(p => p.id === entry.paperId);
  const q = paper?.questions.find(q => q.id === entry.questionId && q.version === entry.questionVersion);
  const answer = state.attempts.find(a => a.id === entry.attemptId)?.answers.find(a => a.questionId === entry.questionId);
  return hash({ evidence: entry, paperVersion: paper?.version, answer, question: q ? { id: q.id, version: q.version, familyId: q.familyId, text: q.text, answer: q.answer, unit: q.unit, knowledgeId: q.knowledgeId, taskType: q.taskType, contextId: q.contextId } : null });
}

function head(state: WorkspaceState, evidenceId: string, asOf = state.revision): EvidenceDecision | undefined {
  return (state.evidenceReviews?.decisions ?? []).filter(d => d.evidenceId === evidenceId && d.outcome === "accept" && d.appliedRevision <= asOf).sort((a, b) => a.appliedRevision - b.appliedRevision).at(-1);
}
function proposalDigest(p: Pick<EvidenceProposal, "evidenceId" | "patch" | "reason" | "uploadIds" | "delivery">) {
  return hash({ action: "evidence.propose", evidenceId: p.evidenceId, patch: p.patch, reason: p.reason, uploadIds: p.uploadIds, delivery: p.delivery });
}
function decisionDigest(p: Pick<EvidenceDecision, "proposalId" | "outcome" | "reason" | "authority">) {
  return hash({ action: p.authority === "local-unverified" ? "local.evidence.confirm" : "evidence.review", proposalId: p.proposalId, outcome: p.outcome, reason: p.reason });
}
function assertHelpFloor(state: WorkspaceState, entry: Evidence, patch: EvidencePatch): void {
  if (patch.help === undefined) return;
  const rank = (help: unknown) => help === "explanation" ? 2 : help === "hint" ? 1 : 0;
  let floor = entry.provenance === "online" ? rank(entry.help) : 0;
  for (const event of state.events) if (event.action === "learning.exposure" && event.createdAt <= entry.createdAt) {
    try { const detail = JSON.parse(event.detail); if (Array.isArray(detail.familyIds) && detail.familyIds.includes(entry.familyId || entry.questionId)) floor = Math.max(floor, rank(detail.level)); } catch { /* Legacy prose is not a verified machine fact. */ }
  }
  check(rank(patch.help) >= floor, "已记录的真实提示/讲解不能通过更正降低或改为未知；曝光事实仍保留", 409);
}

function authority(ctx: EvidenceContext): EvidenceDecision["authority"] {
  if (ctx.channel === "local") { check(ctx.role === "student" || ctx.role === "owner", "只有本机学习者能确认未核实更正", 403); return "local-unverified"; }
  check(ctx.role === "teacher", "只有当前工作区已授权教师能核实更正；所有者或学生不能冒充教师", 403);
  return "teacher-verified";
}
function reviewable(state: WorkspaceState, proposalId: unknown, outcome: unknown, ctx: EvidenceContext): { proposal: EvidenceProposal; authority: EvidenceDecision["authority"]; outcome: EvidenceDecision["outcome"] } {
  check(outcome === "accept" || outcome === "reject", "请选择接受或驳回申请");
  const kind = authority(ctx), proposal = state.evidenceReviews?.proposals.find(p => p.id === id(proposalId));
  check(proposal, "更正申请不存在或不属于当前空间", 404);
  check(kind === "local-unverified" ? proposal.delivery === "local-only" && proposal.requestedBy === ctx.userId : proposal.delivery === "workspace" && proposal.requestedBy !== ctx.userId, "不能核实自己的申请或未向本空间教师共享的本机申请", 403);
  check(!state.evidenceReviews?.decisions.some(d => d.proposalId === proposal.id), "该申请已有审议结果，请查看历史；继续修改须提交新申请", 409);
  const entry = rawEvidence(state, proposal.evidenceId);
  check(evidenceSourceDigest(state, entry) === proposal.sourceDigest, "原证据版本摘要不一致，停止更正", 409);
  if (outcome === "accept") { check(proposal.baseDecisionId === head(state, entry.id)?.id, "这份证据已有新的更正，请按当前结果重新提交申请", 409); assertHelpFloor(state, entry, proposal.patch); }
  return { proposal, authority: kind, outcome };
}

function commitDecision(state: WorkspaceState, proposal: EvidenceProposal, outcome: EvidenceDecision["outcome"], kind: EvidenceDecision["authority"], reason: string, requestId: string, ctx: EvidenceContext): EvidenceDecision {
  const reviews = ensureEvidenceReviews(state), prior = head(state, proposal.evidenceId);
  const decision: EvidenceDecision = { id: ctx.newId(), proposalId: proposal.id, evidenceId: proposal.evidenceId, ...(prior ? { priorDecisionId: prior.id } : {}), outcome, authority: kind,
    actorId: ctx.userId, reason, createdAt: ctx.now, appliedRevision: state.revision + 1, requestId, requestDigest: decisionDigest({ proposalId: proposal.id, outcome, reason, authority: kind }) };
  reviews.decisions.push(decision); state.revision++;
  if (outcome === "accept") {
    ensureMastery(state, ctx);
    reconcileEvidenceReviewPlans(state, ctx);
    const ids = assessKnowledge(state, ctx, "evidence-correction");
    for (const assessment of state.mastery!.assessments) if (ids.includes(assessment.id)) assessment.evidenceRevisionId = decision.id;
  }
  return decision;
}

export function previewEvidenceReview(state: WorkspaceState, proposalId: unknown, outcome: unknown, ctx: EvidenceContext): EvidencePreview {
  validateEvidenceReviews(state);
  const checked = reviewable(state, proposalId, outcome, ctx), { proposal } = checked;
  const before = effectiveEvidence(state).find(e => e.id === proposal.evidenceId)!;
  const priorReport = effectiveAttempt(state, before.attemptId)!;
  const simulated = structuredClone(state); let serial = 0;
  commitDecision(simulated, proposal, checked.outcome, checked.authority, "影响预览，不写入档案", `preview-${proposal.id}`, { ...ctx, newId: () => `preview-evidence-${++serial}` });
  const after = effectiveEvidence(simulated).find(e => e.id === proposal.evidenceId)!;
  const report = effectiveAttempt(simulated, before.attemptId)!;
  const digest = hash({ proposalId: proposal.id, sourceRevision: state.revision, sourceDigest: proposal.sourceDigest, baseDecisionId: head(state, proposal.evidenceId)?.id ?? null, outcome: checked.outcome, authority: checked.authority });
  return { proposalId: proposal.id, evidenceId: proposal.evidenceId, sourceRevision: state.revision, digest, outcome: checked.outcome, authority: checked.authority, before, after,
    report: { attemptId: before.attemptId, beforeCorrect: priorReport.correctCount, afterCorrect: report.correctCount, beforeIndependent: priorReport.independentCorrect, afterIndependent: report.independentCorrect, invalidatedCount: report.invalidatedCount },
    mistake: { beforeActive: before.valid && !before.correct, afterActive: after.valid && !after.correct },
    knowledge: simulated.knowledge.map(k => ({ knowledgeId: k.id, beforeStars: state.knowledge.find(old => old.id === k.id)?.stars ?? null, afterStars: k.stars, reason: k.reason })),
    reviewPlans: (simulated.mastery?.reviewPlans ?? []).map(plan => {
      const existing = state.mastery?.reviewPlans.find(p => p.id === plan.id), next = effectiveReviewSource(simulated, plan);
      return { planId: plan.id, knowledgeId: plan.knowledgeId, beforeValid: existing ? effectiveReviewSource(state, existing).valid : false, afterValid: next.valid, reason: next.reason };
    }),
    warnings: ["原始作答、原证据、原卷及历史评定保留；排除证据不是删除历史。", "真实帮助曝光与已见题族保留，更正不恢复新题资格。", checked.authority === "local-unverified" ? "本人确认但未经教师核实：会更新当前报告与错题，受影响记录不计掌握证据。照片仅保存在本机，未送达教师。" : "教师须根据所见原稿与其他核对依据填写审议原因；系统不会自动验证原稿真实性。", ...(checked.authority === "teacher-verified" && after.unverifiedFields?.length ? [`仍有未在本次申请中明确核实的本人更正字段：${after.unverifiedFields.join("、")}；该记录继续不计掌握证据。`] : [])] };
}

export function evidenceAction(current: WorkspaceState, action: string, input: Input, ctx: EvidenceContext): ApiResult {
  validateEvidenceReviews(current);
  if (action === "evidence.preview") { keys(input, ["action", "proposalId", "outcome"]); return { state: current, result: { preview: previewEvidenceReview(current, input.proposalId, input.outcome, ctx) } }; }
  if (action === "evidence.propose") {
    keys(input, ["action", "evidenceId", "patch", "reason", "uploadIds", "sourceRevision", "requestId"]);
    check(ctx.role === "student" || ctx.role === "owner", "只有学习者或档案所有者能提出更正申请", 403);
    const evidenceId = id(input.evidenceId), patch = parsePatch(input.patch), reason = text(input.reason, "更正原因"), requestId = id(input.requestId);
    check(Array.isArray(input.uploadIds) && input.uploadIds.length <= 10 && input.uploadIds.every(identifier) && new Set(input.uploadIds).size === input.uploadIds.length, "请显式选择最多10份不重复的本空间原稿");
    const uploadIds = [...input.uploadIds] as string[], delivery = ctx.channel === "local" ? "local-only" : "workspace";
    const digest = proposalDigest({ evidenceId, patch, reason, uploadIds, delivery });
    const prior = current.evidenceReviews?.proposals.find(p => p.requestedBy === ctx.userId && p.requestId === requestId);
    check(!current.evidenceReviews?.decisions.some(d => d.actorId === ctx.userId && d.requestId === requestId), "请求 ID 已用于其他更正操作", 409);
    if (prior) { check(prior.requestDigest === digest, "相同请求 ID 对应不同申请内容", 409); return { state: current, result: { id: prior.id, message: "更正申请已保存；未重复创建" } }; }
    check(integer(input.sourceRevision) && input.sourceRevision === current.revision, "档案已变化，请重新核对后提交申请", 409);
    const entry = rawEvidence(current, evidenceId);
    check(uploadIds.every(id => current.uploads.some(upload => upload.id === id)), "原稿不属于当前学习空间或已不可用", 404);
    assertHelpFloor(current, entry, patch);
    const state = structuredClone(current), reviews = ensureEvidenceReviews(state), base = head(state, evidenceId);
    state.actor = { id: ctx.userId, name: ctx.displayName ?? current.actor.name, role: ctx.role };
    const proposal: EvidenceProposal = { id: ctx.newId(), evidenceId, sourceDigest: evidenceSourceDigest(current, entry), ...(base ? { baseDecisionId: base.id } : {}), patch, reason, uploadIds,
      requestedBy: ctx.userId, createdAt: ctx.now, createdRevision: current.revision + 1, delivery, requestId, requestDigest: digest };
    reviews.proposals.push(proposal); state.revision++;
    state.events.unshift({ id: ctx.newId(), action, label: "保存证据更正申请", actorId: ctx.userId, createdAt: ctx.now, detail: JSON.stringify({ proposalId: proposal.id, evidenceId, delivery, uploadIds }) });
    return { state, result: { id: proposal.id, message: delivery === "local-only" ? "申请已保存在本机，尚未发送给教师；当前结果未改变。" : "更正申请和主动选择的原稿已保存供本工作区教师复核；尚未改变学习结果。" } };
  }
  check(action === "evidence.review" || action === "local.evidence.confirm", "不支持的证据更正操作");
  keys(input, ["action", "proposalId", "outcome", "sourceRevision", "digest", "reason", "requestId"]);
  const kind = authority(ctx);
  check(action === (kind === "local-unverified" ? "local.evidence.confirm" : "evidence.review"), "当前运行环境不能执行此核实操作", 403);
  const proposalId = id(input.proposalId), requestId = id(input.requestId), reason = text(input.reason, "审议原因与核对依据");
  check(input.outcome === "accept" || input.outcome === "reject", "请选择接受或驳回申请");
  const digest = decisionDigest({ proposalId, outcome: input.outcome, authority: kind, reason });
  const prior = current.evidenceReviews?.decisions.find(d => d.actorId === ctx.userId && d.requestId === requestId);
  check(!current.evidenceReviews?.proposals.some(p => p.requestedBy === ctx.userId && p.requestId === requestId), "请求 ID 已用于其他更正操作", 409);
  if (prior) { check(prior.requestDigest === digest, "相同请求 ID 对应不同审议内容", 409); return { state: current, result: { id: prior.id, message: "这次审议已保存；未重复更改结果" } }; }
  check(integer(input.sourceRevision) && input.sourceRevision === current.revision, "影响预览已过期，请重新核对；未覆盖其他更改", 409);
  const preview = previewEvidenceReview(current, proposalId, input.outcome, ctx);
  check(input.digest === preview.digest, "影响预览与当前更正申请不一致，请重新预览", 409);
  const state = structuredClone(current), proposal = state.evidenceReviews!.proposals.find(p => p.id === proposalId)!;
  state.actor = { id: ctx.userId, name: ctx.displayName ?? current.actor.name, role: ctx.role };
  const decision = commitDecision(state, proposal, input.outcome, kind, reason, requestId, ctx);
  state.events.unshift({ id: ctx.newId(), action, label: input.outcome === "reject" ? "驳回证据更正申请" : kind === "local-unverified" ? "本人确认未核实更正" : "教师核实证据更正", actorId: ctx.userId, createdAt: ctx.now,
    detail: JSON.stringify({ decisionId: decision.id, proposalId, evidenceId: proposal.evidenceId, outcome: decision.outcome, authority: kind }) });
  validateEvidenceReviews(state);
  return { state, result: { id: decision.id, message: input.outcome === "reject" ? "驳回原因已保存，原有效结果未改变。" : kind === "local-unverified" ? "已按本人未核实更正更新报告、错题与评定依据；未冒充教师核实，原始记录保留。" : "教师审议已保存，当前报告、错题、评定及复查来源已统一更新；原始记录保留。" } };
}

/** Strict raw persistence validator. Role projections must not be persisted as raw state. */
export function validateEvidenceReviews(state: WorkspaceState): void {
  if (state.evidenceReviews === undefined) return;
  const reviews = object(state.evidenceReviews); keys(reviews, ["schemaVersion", "proposals", "decisions"]);
  check(reviews.schemaVersion === 1 && Array.isArray(reviews.proposals) && Array.isArray(reviews.decisions), "证据更正档案结构不正确");
  const proposalIds = new Set<string>(), decisionIds = new Set<string>(), requestKeys = new Set<string>(), revisions = new Set<number>();
  const proposals = new Map<string, EvidenceProposal>();
  let previousRevision = 0;
  for (const raw of reviews.proposals) {
    const p = object(raw); keys(p, ["id", "evidenceId", "sourceDigest", "baseDecisionId", "patch", "reason", "uploadIds", "requestedBy", "createdAt", "createdRevision", "delivery", "requestId", "requestDigest"]);
    check(identifier(p.id) && identifier(p.requestedBy) && identifier(p.requestId) && !proposalIds.has(p.id), "更正申请 ID/申请人无效或重复");
    check(integer(p.createdRevision) && p.createdRevision > previousRevision && p.createdRevision <= state.revision && timestamp(p.createdAt), "更正申请时间或版本顺序无效");
    previousRevision = p.createdRevision; revisions.add(p.createdRevision); proposalIds.add(p.id);
    check(p.delivery === "local-only" || p.delivery === "workspace", "更正申请保存范围无效");
    const entry = rawEvidence(state, p.evidenceId), patch = parsePatch(p.patch);
    check(canonicalStringify(patch) === canonicalStringify(p.patch), "更正字段未规范化");
    check(typeof p.reason === "string" && p.reason === text(p.reason, "更正原因"), "更正原因无效");
    check(Array.isArray(p.uploadIds) && p.uploadIds.length <= 10 && p.uploadIds.every(identifier) && new Set(p.uploadIds).size === p.uploadIds.length && p.uploadIds.every(id => state.uploads.some(u => u.id === id)), "更正原稿引用无效");
    check(p.sourceDigest === evidenceSourceDigest(state, entry), "更正原证据摘要不一致");
    check(p.baseDecisionId === undefined || identifier(p.baseDecisionId), "更正基线引用无效");
    const key = JSON.stringify([p.requestedBy, p.requestId]); check(!requestKeys.has(key), "更正请求 ID 重复"); requestKeys.add(key);
    const typed = p as unknown as EvidenceProposal; check(p.requestDigest === proposalDigest(typed), "更正申请请求摘要不一致"); proposals.set(typed.id, typed);
  }
  const decided = new Set<string>(), heads = new Map<string, EvidenceDecision>(); previousRevision = 0;
  for (const raw of reviews.decisions) {
    const d = object(raw); keys(d, ["id", "proposalId", "evidenceId", "priorDecisionId", "outcome", "authority", "actorId", "reason", "createdAt", "appliedRevision", "requestId", "requestDigest"]);
    check(identifier(d.id) && identifier(d.actorId) && identifier(d.requestId) && !decisionIds.has(d.id) && !proposalIds.has(d.id), "审议 ID/身份无效或重复");
    const proposal = proposals.get(String(d.proposalId)); check(proposal && d.evidenceId === proposal.evidenceId && !decided.has(proposal.id), "审议申请引用无效或重复");
    check(integer(d.appliedRevision) && d.appliedRevision > previousRevision && d.appliedRevision > proposal.createdRevision && d.appliedRevision <= state.revision && !revisions.has(d.appliedRevision) && timestamp(d.createdAt) && d.createdAt >= proposal.createdAt, "审议时间或版本顺序无效");
    previousRevision = d.appliedRevision; revisions.add(d.appliedRevision); decisionIds.add(d.id); decided.add(proposal.id);
    check(d.outcome === "accept" || d.outcome === "reject", "审议结果无效");
    check(d.authority === "local-unverified" ? proposal.delivery === "local-only" && d.actorId === proposal.requestedBy : d.authority === "teacher-verified" && proposal.delivery === "workspace" && d.actorId !== proposal.requestedBy, "审议身份与申请范围不一致");
    check(typeof d.reason === "string" && d.reason === text(d.reason, "审议原因"), "审议原因无效");
    const key = JSON.stringify([d.actorId, d.requestId]); check(!requestKeys.has(key), "更正请求 ID 重复"); requestKeys.add(key);
    const typed = d as unknown as EvidenceDecision; check(d.requestDigest === decisionDigest(typed), "审议请求摘要不一致");
    check(d.priorDecisionId === heads.get(proposal.evidenceId)?.id, "审议前序引用断裂");
    if (d.outcome === "accept") { check(proposal.baseDecisionId === d.priorDecisionId, "更正接受了已过期的申请基线"); assertHelpFloor(state, state.evidence.find(e => e.id === proposal.evidenceId)!, proposal.patch); heads.set(proposal.evidenceId, typed); }
  }
  for (const proposal of proposals.values()) check(proposal.baseDecisionId === head(state, proposal.evidenceId, proposal.createdRevision - 1)?.id, "申请基线与历史生效版本不一致");
}

/** Selected metadata only. Existing general teacher uploads remain empty. */
export function projectEvidenceReviews(state: WorkspaceState, role: Role): void {
  const reviews = state.evidenceReviews; if (!reviews) return;
  if (role === "editor" || role === "reviewer") { delete state.evidenceReviews; return; }
  const accepted = new Set(reviews.decisions.filter(d => d.outcome === "accept").map(d => d.proposalId));
  const visible = reviews.proposals.filter(p => role === "teacher" ? p.delivery === "workspace" || accepted.has(p.id) : role === "parent" ? accepted.has(p.id) : p.requestedBy === state.actor.id || accepted.has(p.id));
  const ids = new Set(visible.map(p => p.id));
  const workspaceId = state.access?.workspaceId || state.actor.id;
  reviews.proposals = visible.map(p => {
    const full = role === "teacher" && p.delivery === "workspace" || (role === "owner" || role === "student") && p.requestedBy === state.actor.id;
    if (!full) return { ...p, reason: "", uploadIds: [], materials: [], requestId: "", requestDigest: "" };
    return { ...p, materials: p.uploadIds.flatMap(id => {
    const upload = state.uploads.find(u => u.id === id); if (!upload) return [];
    return [{ id, name: upload.name, ...(p.delivery === "workspace" ? { url: `/api/evidence/${encodeURIComponent(p.id)}/images/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}` } : {}) }];
    }) };
  });
  reviews.decisions = reviews.decisions.filter(d => ids.has(d.proposalId) && (role !== "parent" || d.outcome === "accept")).map(d => {
    const p = visible.find(p => p.id === d.proposalId)!;
    return role === "teacher" && p.delivery === "workspace" || (role === "owner" || role === "student") && p.requestedBy === state.actor.id ? d : { ...d, reason: "", requestId: "", requestDigest: "" };
  });
}
