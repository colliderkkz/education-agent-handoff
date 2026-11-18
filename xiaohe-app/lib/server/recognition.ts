import { mergedQuestions, type ApiResult, type ContentBank, type Paper, type Question, type RecognitionCandidate, type RecognitionCapture, type RecognitionEntry, type RecognitionLine, type RecognitionMatch, type RecognitionState, type Role, type WorkspaceState } from '../types.ts';
import { historyDeletedUpload, historyFileIdentity } from '../history-deletion.ts';
import { canonicalStringify, ensureContent, questionContentDigest, sha256 } from './content.ts';
import { DomainError } from './domain-error.ts';

type Input = Record<string, unknown>;
type Context = { userId: string; displayName: string; role: Role; channel?: 'local'; now: string; newId: () => string; bank?: ContentBank };
type Submit = (state: WorkspaceState, paper: Paper, entries: RecognitionEntry[]) => string;
const hash = (value: unknown) => sha256(canonicalStringify(value));
function check(value: unknown, message: string, status = 400): asserts value { if (!value) throw new DomainError(message, status); }
function object(value: unknown): Input { check(value && typeof value === 'object' && !Array.isArray(value), '识别记录格式无效'); return value as Input; }
function keys(value: object, allowed: string[]) { check(Object.keys(object(value)).every(k => allowed.includes(k)), '识别记录含未支持字段'); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
function text(value: unknown, max: number, empty = false): string { check(typeof value === 'string' && value.length <= max && (empty || value.trim()), '识别或核对文字为空或超过长度限制'); return value; }
function ids(value: unknown, max = 300): string[] { check(Array.isArray(value) && value.length <= max && value.every(identifier) && new Set(value).size === value.length, '识别条目标识无效或重复'); return value.slice(); }
const unchecked = () => ({ stem: false, answer: false, match: false, unit: false });
function flags(value: unknown): RecognitionEntry['checked'] { const v = object(value); keys(v, ['stem','answer','match','unit']); check(['stem','answer','match','unit'].every(k => typeof v[k] === 'boolean'), '请分别核对题干、答案、同题和单位'); return { stem: v.stem as boolean, answer: v.answer as boolean, match: v.match as boolean, unit: v.unit as boolean }; }
function candidate(value: unknown): RecognitionCandidate | null {
  if (value === null) return null;
  const v = object(value); keys(v, ['questionId','questionVersion','contentDigest']);
  check(identifier(v.questionId) && revision(v.questionVersion) && v.questionVersion > 0 && digest(v.contentDigest), '候选题版本或摘要无效');
  return { questionId: v.questionId, questionVersion: v.questionVersion, contentDigest: v.contentDigest };
}
function lines(value: unknown): RecognitionLine[] {
  check(Array.isArray(value) && value.length <= 300, '单次识别最多保存 300 行');
  const seen = new Set<string>();
  let length = 0;
  return value.map(raw => {
    const v = object(raw); keys(v, ['id','text','confidence','box']);
    check(identifier(v.id) && !seen.has(v.id), '识别行 ID 无效或重复'); seen.add(v.id);
    check(v.confidence === null || typeof v.confidence === 'number' && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1, '置信度必须为引擎实际值或 null');
    const b = object(v.box); keys(b, ['x','y','width','height']);
    check(['x','y','width','height'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k]) && Number(b[k]) >= 0 && Number(b[k]) <= 1) && Number(b.width) > 0 && Number(b.height) > 0 && Number(b.x) + Number(b.width) <= 1.000001 && Number(b.y) + Number(b.height) <= 1.000001, '识别框必须使用定向原图左上角为原点的归一坐标');
    const body = text(v.text, 2000); length += body.length; check(length <= 30000, '单次识别文字超过 30000 字符，不能截断保存');
    return { id: v.id, text: body, confidence: v.confidence as number | null, box: { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number } };
  });
}
export function ensureRecognition(state: WorkspaceState): RecognitionState { return state.recognition ?? (state.recognition = { schemaVersion: 1, captures: [], runs: [], entries: [], requests: [] }); }
/** A late device result must not cross any committed history deletion. */
export function recognitionHistoryRevision(state: WorkspaceState): number { return Math.max(0, ...(state.historyDeletion?.operations.map(o => o.appliedRevision) ?? [])); }
function ownCapture(state: WorkspaceState, id: unknown, userId: string): RecognitionCapture {
  check(identifier(id), '识别档案标识无效'); const c = state.recognition?.captures.find(c => c.id === id && c.ownerId === userId);
  check(c, '识别档案不存在或不属于本人', 404); return c;
}
function writableCapture(state: WorkspaceState, id: unknown, userId: string): RecognitionCapture {
  const c = ownCapture(state, id, userId); check(!c.redactedAt, '这张照片的识别文字已随学习历史删除，不能重新扫描或恢复核对草稿', 410);
  const u = state.uploads.find(u => u.id === c.uploadId);
  check(u && !historyDeletedUpload(state, u.id, u.url), '识别原图已移除，不能恢复草稿', 410); return c;
}
function eligible(q: Question) { return q.status === 'published' && Boolean(q.reviewerId) && q.reviewerId !== q.authorId; }
/** Returns public candidate metadata only; retrieval never establishes same-question identity. */
export function recognitionMatches(state: WorkspaceState, query: string, bank?: ContentBank): RecognitionMatch[] {
  text(query, 2000);
  const normalized = query.normalize('NFKC').replace(/\s+/g, '');
  const terms = [...new Set(normalized.match(/\d+(?:\.\d+)?|[\u4e00-\u9fff]|[A-Za-z]+/g) ?? [normalized])];
  return mergedQuestions(state, bank).filter(eligible).map(q => ({ q, score: terms.reduce((sum, term) => sum + (q.text.normalize('NFKC').includes(term) ? term.length : 0), 0) }))
    .filter(v => v.score > 0).sort((a,b) => b.score - a.score || a.q.id.localeCompare(b.q.id)).slice(0, 8)
    .map(({q}) => ({ questionId: q.id, questionVersion: q.version, contentDigest: questionContentDigest(q), text: q.text, unit: q.unit, knowledgeId: q.knowledgeId }));
}
function selectionBody(e: Pick<RecognitionEntry,'runId'|'sourceLineIds'|'originalNumber'|'stem'|'answer'|'working'|'candidate'>) {
  return { runId: e.runId, sourceLineIds: e.sourceLineIds, originalNumber: e.originalNumber, stem: e.stem, answer: e.answer, working: e.working, candidate: e.candidate };
}

export function recognitionAction(current: WorkspaceState, action: string, input: Input, ctx: Context, submit: Submit): ApiResult {
  check(ctx.channel === 'local' && (ctx.role === 'student' || ctx.role === 'owner'), '照片识别核对仅限本人在本机使用', 403);
  validateRecognitionState(current);
  const common = ['action','captureId','expectedRevision','requestId'];
  const fields: Record<string,string[]> = {
    'recognition.open': ['action','uploadId','imageDigest','historyRevision','requestId'],
    'recognition.match': ['action','captureId','text'],
    'recognition.run.save': [...common,'historyRevision','runId','imageDigest','engine','platform','engineVersion','width','height','lines'],
    'recognition.entry.save': [...common,'entryId','runId','sourceLineIds','originalNumber','stem','answer','working','candidate','checked'],
    'recognition.submit': [...common,'entryIds'],
  };
  check(fields[action], '不支持的识别操作'); keys(input, fields[action]);
  if (action === 'recognition.match') { writableCapture(current, input.captureId, ctx.userId); return { state: current, result: { candidates: recognitionMatches(current, text(input.text, 2000), ctx.bank), message: '仅为文字检索候选；请对照原图确认题干、数值和单位完全一致。' } }; }
  check(identifier(input.requestId), '识别请求标识无效');
  const fingerprint = hash(input), previous = current.recognition?.requests.find(r => r.ownerId === ctx.userId && r.requestId === input.requestId);
  if (previous) {
    check(previous.status !== 'deleted', '此识别请求关联的学习历史已删除，不能重放', 410);
    check(previous.digest === fingerprint && previous.action === action, '同一识别请求 ID 对应不同内容', 409);
    const c = ownCapture(current, previous.captureId, ctx.userId);
    return { state: current, result: { id: previous.resultId, captureId: c.id, captureRevision: c.revision, historyRevision: recognitionHistoryRevision(current) } };
  }
  const state = structuredClone(current), data = ensureRecognition(state);
  ensureContent(state);
  state.actor = { id: ctx.userId, name: ctx.displayName, role: ctx.role };
  let capture: RecognitionCapture, resultId: string;
  if (action === 'recognition.open') {
    check(identifier(input.uploadId) && digest(input.imageDigest), '图片标识或原文件摘要无效');
    check(input.historyRevision === recognitionHistoryRevision(current), '识别期间学习历史已变化，请重新读取本机记录', 409);
    const upload = state.uploads.find(u => u.id === input.uploadId);
    check(upload && !historyDeletedUpload(state, upload.id, upload.url), '原图不存在或已删除', 404);
    const identity = historyFileIdentity(upload.url), aliases = new Set(state.uploads.filter(u => historyFileIdentity(u.url) === identity).map(u => u.id));
    const existing = data.captures.find(c => aliases.has(c.uploadId) || c.imageDigest === input.imageDigest);
    if (existing) {
      check(existing.ownerId === ctx.userId, '原图已绑定其他人的识别档案', 403);
      check(!existing.redactedAt, '该原图的识别文字已删除，不能重新扫描', 410);
      check(existing.imageDigest === input.imageDigest && aliases.has(existing.uploadId), '图片内容或登记已变化，请继续原识别档案', 409);
      capture = existing;
    } else {
      check(upload.status === 'pending' && !state.paperReturns?.some(r => r.uploadIds.some(id => aliases.has(id))), '原图已用于其他纸面核对，请继续原记录', 409);
      check(data.captures.length < 100, '本机识别档案已达 100 份上限');
      capture = { id: ctx.newId(), ownerId: ctx.userId, uploadId: upload.id, imageDigest: input.imageDigest, revision: 0, createdAt: ctx.now, updatedAt: ctx.now };
      data.captures.push(capture);
    }
    resultId = capture.id;
  } else {
    capture = writableCapture(state, input.captureId, ctx.userId);
    check(input.expectedRevision === capture.revision, '核对草稿已变化，请重新读取后再保存', 409);
    if (action === 'recognition.run.save') {
      check(input.historyRevision === recognitionHistoryRevision(current), '识别期间学习历史已变化，过期结果未保存', 409);
      check(identifier(input.runId) && !data.runs.some(r => r.id === input.runId), '识别运行 ID 无效或已使用', 409);
      check(input.imageDigest === capture.imageDigest, '识别结果与原文件摘要不一致', 409);
      check(input.platform === 'android' && input.engine === 'mlkit-chinese' || input.platform === 'ios' && input.engine === 'apple-vision', '识别引擎与设备平台不匹配');
      check(['width','height'].every(k => Number.isSafeInteger(input[k]) && Number(input[k]) > 0 && Number(input[k]) <= 50000), '识别图片尺寸无效');
      check(data.runs.filter(r => r.captureId === capture.id).length < 5, '同图最多保留 5 次识别原结果');
      const rawLines = lines(input.lines);
      check(input.engine !== 'mlkit-chinese' || rawLines.every(l => l.confidence === null), '当前中文识别引擎未提供行置信度，必须记录为 null');
      data.runs.push({ id: input.runId, captureId: capture.id, imageDigest: capture.imageDigest, engine: input.engine as 'mlkit-chinese'|'apple-vision', platform: input.platform as 'android'|'ios', engineVersion: text(input.engineVersion, 100), width: input.width as number, height: input.height as number, lines: rawLines, createdAt: ctx.now });
      resultId = input.runId;
    } else if (action === 'recognition.entry.save') {
      check(identifier(input.entryId), '核对条目标识无效');
      const existing = data.entries.find(e => e.id === input.entryId);
      check(!existing || existing.captureId === capture.id && existing.status === 'draft', '此核对条目已提交、移除或属于其他原图', 409);
      const run = data.runs.find(r => r.id === input.runId && r.captureId === capture.id && !r.redactedAt);
      check(run, '请先保存此图的设备识别原结果', 409);
      const sourceLineIds = ids(input.sourceLineIds); check(sourceLineIds.every(id => run.lines.some(l => l.id === id)), '核对条目引用了其他原图或不存在的识别行');
      const pin = candidate(input.candidate);
      let snapshot: Question | undefined;
      if (pin) {
        if (existing?.snapshot && canonicalStringify(existing.candidate) === canonicalStringify(pin)) snapshot = existing.snapshot;
        else { const q = mergedQuestions(state, ctx.bank).find(q => q.id === pin.questionId && q.version === pin.questionVersion && eligible(q)); check(q && questionContentDigest(q) === pin.contentDigest, '候选题版本已变化，请重新检索并核对，不能替换为新版题目', 409); snapshot = structuredClone(q); }
      }
      const entry: RecognitionEntry = { id: input.entryId, captureId: capture.id, runId: run.id, sourceLineIds, originalNumber: text(input.originalNumber, 50, true), stem: text(input.stem, 2000, true), answer: text(input.answer, 300, true), working: text(input.working, 3000, true), candidate: pin, checked: flags(input.checked), status: 'draft', createdAt: existing?.createdAt ?? ctx.now, updatedAt: ctx.now, ...(snapshot ? { snapshot } : {}) };
      if (!existing || canonicalStringify(selectionBody(existing)) !== canonicalStringify(selectionBody(entry))) entry.checked = unchecked();
      check(!entry.checked.match || pin, '尚未选择同题候选，不能确认匹配');
      if (existing) data.entries[data.entries.indexOf(existing)] = entry;
      else { check(data.entries.filter(e => e.captureId === capture.id).length < 20, '每张照片最多核对 20 道题'); data.entries.push(entry); }
      resultId = entry.id;
    } else {
      const entryIds = ids(input.entryIds, 20); check(entryIds.length, '请选择已核对的题目');
      const entries = entryIds.map(id => { const e = data.entries.find(e => e.id === id && e.captureId === capture.id); check(e?.status === 'draft' && e.candidate && e.snapshot && e.stem.trim() && e.answer.trim() && Object.values(e.checked).every(Boolean), '所选题目尚未完成题干、原答案、同题与单位核对，未匹配条目只能保留草稿', 409); check(questionContentDigest(e.snapshot) === e.candidate.contentDigest && e.snapshot.id === e.candidate.questionId && e.snapshot.version === e.candidate.questionVersion, '冻结候选版本摘要不一致', 409); return e; });
      check(new Set(entries.map(e => e.candidate!.questionId)).size === entries.length, '同一批报告不能重复选择同一题库题；请分批核对', 409);
      const paper: Paper = { id: ctx.newId(), title: '照片作业 · 已核对题目', version: 1, createdAt: ctx.now, questionIds: entries.map(e => e.candidate!.questionId), questions: entries.map(e => structuredClone(e.snapshot!)), status: 'ready', kind: 'whole', reason: '设备识别文字经本人对照原图逐题核对并选择固定题库版本；仅已核对条目入档，独立程度未经验证。', estimatedMinutes: entries.length * 2 };
      state.papers.unshift(paper); const attemptId = submit(state, paper, entries);
      for (const e of entries) { const evidence = state.evidence.find(v => v.attemptId === attemptId && v.questionId === e.candidate!.questionId); check(evidence, '照片作答缺少入档凭据'); e.status = 'submitted'; e.paperId = paper.id; e.attemptId = attemptId; e.evidenceId = evidence.id; e.submittedAt = ctx.now; e.updatedAt = ctx.now; }
      state.uploads.find(u => u.id === capture.uploadId)!.status = 'confirmed'; resultId = paper.id;
    }
    capture.revision++; capture.updatedAt = ctx.now;
  }
  data.requests.push({ ownerId: ctx.userId, requestId: input.requestId, action, digest: fingerprint, captureId: capture.id, resultId, status: 'completed', createdAt: ctx.now });
  state.revision = current.revision + 1;
  state.events.unshift({ id: ctx.newId(), action, label: '本机照片识别核对', actorId: ctx.userId, createdAt: ctx.now, detail: JSON.stringify({ captureId: capture.id, resultId }) });
  validateRecognitionState(state);
  return { state, result: { id: resultId, captureId: capture.id, captureRevision: capture.revision, historyRevision: recognitionHistoryRevision(state), message: action === 'recognition.submit' ? '已核对题目已入档；其余条目保留草稿，不计分、不计独立星级。' : '已保存在本机。' } };
}

/** Private OCR text is never implicitly shared with a parent, teacher or editor. */
export function projectRecognition(state: WorkspaceState, role: Role): void {
  state.events = state.events.filter(e => !e.action.startsWith('recognition.') || (role === 'owner' || role === 'student') && e.actorId === state.actor.id);
  if (!state.recognition) return;
  if (role !== 'owner' && role !== 'student') { delete state.recognition; return; }
  const data = state.recognition;
  data.captures = data.captures.filter(c => c.ownerId === state.actor.id);
  const visible = new Set(data.captures.map(c => c.id));
  data.runs = data.runs.filter(r => visible.has(r.captureId));
  data.entries = data.entries.filter(e => visible.has(e.captureId)).map(e => {
    const visible = { ...e }; delete visible.snapshot; delete visible.candidateSummary;
    if (e.snapshot) visible.candidateSummary = { questionId: e.snapshot.id, questionVersion: e.snapshot.version, text: e.snapshot.text, unit: e.snapshot.unit };
    return visible;
  });
  data.requests = data.requests.filter(r => r.ownerId === state.actor.id && visible.has(r.captureId));
}

export function recognitionDeletionScope(state: WorkspaceState, evidenceIds: string[], deletedUploadIds: string[] = []) {
  const data = state.recognition;
  const captures = new Set((data?.entries ?? []).filter(e => e.evidenceId && evidenceIds.includes(e.evidenceId)).map(e => e.captureId));
  for (const c of data?.captures ?? []) if (deletedUploadIds.includes(c.uploadId)) captures.add(c.id);
  return { captureIds: [...captures], runCount: (data?.runs ?? []).filter(r => captures.has(r.captureId) && !r.redactedAt).length,
    draftIds: (data?.entries ?? []).filter(e => captures.has(e.captureId) && e.status === 'draft').map(e => e.id) };
}
export function recognitionPhotoReferences(state: WorkspaceState, uploadIds: Set<string>, evidenceIds: string[]): number {
  return (state.recognition?.captures ?? []).filter(c => uploadIds.has(c.uploadId)).reduce((count, c) => count + (state.recognition?.entries ?? []).filter(e => e.captureId === c.id && e.status !== 'redacted' && !(e.evidenceId && evidenceIds.includes(e.evidenceId)) && !(e.status === 'draft' && recognitionDeletionScope(state, evidenceIds).captureIds.includes(c.id))).length, 0);
}
/** Redact all raw page text and drafts: line selection cannot prove an answer has no other OCR copy. */
export function redactRecognitionHistory(state: WorkspaceState, evidenceIds: string[], deletedUploadIds: Set<string>, operationId: string, now: string): void {
  if (!state.recognition) return;
  const data = state.recognition, affected = new Set(recognitionDeletionScope(state, evidenceIds).captureIds);
  for (const c of data.captures) if (deletedUploadIds.has(c.uploadId)) affected.add(c.id);
  for (const c of data.captures) if (affected.has(c.id)) { if (!c.redactedAt) { c.redactedAt = now; c.redactionOperationId = operationId; } c.revision++; c.updatedAt = now; }
  for (const r of data.runs) if (affected.has(r.captureId)) { r.lines = []; r.redactedAt ??= now; }
  for (const e of data.entries) if (affected.has(e.captureId) && (e.status === 'draft' || e.evidenceId && evidenceIds.includes(e.evidenceId))) {
    e.status = 'redacted'; e.sourceLineIds = []; e.originalNumber = ''; e.stem = ''; e.answer = ''; e.working = ''; e.candidate = null; e.checked = unchecked(); delete e.snapshot; e.redactedAt = now; e.redactionOperationId = operationId; e.updatedAt = now;
  }
  for (const r of data.requests) if (affected.has(r.captureId)) r.status = 'deleted';
}

/** Validate raw persistence, never the deliberately answer-stripped learner projection. */
export function validateRecognitionState(state: WorkspaceState): void {
  if (!state.recognition) return;
  const data = state.recognition; keys(data, ['schemaVersion','captures','runs','entries','requests']);
  check(data.schemaVersion === 1 && ['captures','runs','entries','requests'].every(k => Array.isArray(data[k as keyof RecognitionState])), '识别档案版本或列表无效');
  check(data.captures.length <= 100 && canonicalStringify(data).length <= 2_000_000, '识别档案超过本机保存上限');
  const captures = new Map<string, RecognitionCapture>(), uploads = new Set<string>(), imageDigests = new Set<string>();
  for (const c of data.captures) {
    keys(c, ['id','ownerId','uploadId','imageDigest','revision','createdAt','updatedAt','redactedAt','redactionOperationId']);
    check(identifier(c.id) && identifier(c.ownerId) && identifier(c.uploadId) && digest(c.imageDigest) && revision(c.revision) && date(c.createdAt) && date(c.updatedAt) && !captures.has(c.id) && !uploads.has(c.uploadId) && !imageDigests.has(c.imageDigest), '识别原图绑定或修订无效');
    const upload = state.uploads.find(u => u.id === c.uploadId), task = state.historyDeletion?.fileTasks.find(t => t.uploadId === c.uploadId);
    check(upload || c.redactedAt && task, '识别档案缺少原图登记或删除凭据');
    if (c.redactedAt) { const op = state.historyDeletion?.operations.find(o => o.id === c.redactionOperationId); check(date(c.redactedAt) && op?.createdAt === c.redactedAt && (op.deletedUploadIds.includes(c.uploadId) || data.entries.some(e => e.captureId === c.id && e.evidenceId && op.evidenceIds.includes(e.evidenceId))), '识别原图移除凭据无效'); }
    else check(c.redactionOperationId === undefined && upload && !historyDeletedUpload(state, upload.id, upload.url), '已删除原图仍可识别');
    captures.set(c.id, c); uploads.add(c.uploadId); imageDigests.add(c.imageDigest);
  }
  const runIds = new Set<string>();
  for (const r of data.runs) {
    keys(r, ['id','captureId','imageDigest','engine','platform','engineVersion','width','height','lines','createdAt','redactedAt']); const c = captures.get(r.captureId);
    check(identifier(r.id) && !runIds.has(r.id) && c && r.imageDigest === c.imageDigest && date(r.createdAt), '识别运行绑定无效'); runIds.add(r.id);
    check(r.platform === 'android' && r.engine === 'mlkit-chinese' || r.platform === 'ios' && r.engine === 'apple-vision', '识别引擎来源无效'); text(r.engineVersion, 100);
    check([r.width,r.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 50000), '识别图片尺寸无效');
    const raw = lines(r.lines); check(r.engine !== 'mlkit-chinese' || raw.every(l => l.confidence === null), '不支持的中文行置信度');
    check(c.redactedAt ? r.redactedAt === c.redactedAt && r.lines.length === 0 : r.redactedAt === undefined, '已清理的识别结果仍含原文或状态不一致');
  }
  const entryIds = new Set<string>(), evidenceIds = new Set<string>();
  for (const e of data.entries) {
    keys(e, ['id','captureId','runId','sourceLineIds','originalNumber','stem','answer','working','candidate','checked','status','createdAt','updatedAt','snapshot','paperId','attemptId','evidenceId','submittedAt','redactedAt','redactionOperationId']);
    const c = captures.get(e.captureId), run = data.runs.find(r => r.id === e.runId && r.captureId === e.captureId);
    check(identifier(e.id) && !entryIds.has(e.id) && c && run && date(e.createdAt) && date(e.updatedAt) && ['draft','submitted','redacted'].includes(e.status), '核对条目绑定无效'); entryIds.add(e.id);
    ids(e.sourceLineIds); text(e.originalNumber, 50, true); text(e.stem, 2000, true); text(e.answer, 300, true); text(e.working, 3000, true); flags(e.checked); const pin = candidate(e.candidate);
    if (!run.redactedAt) check(e.sourceLineIds.every(id => run.lines.some(l => l.id === id)), '核对条目引用未知原文行');
    if (e.status === 'redacted') {
      const op = state.historyDeletion?.operations.find(o => o.id === e.redactionOperationId);
      check(c.redactedAt && date(e.redactedAt) && op?.createdAt === e.redactedAt && e.sourceLineIds.length === 0 && !e.originalNumber && !e.stem && !e.answer && !e.working && pin === null && !e.snapshot && Object.values(e.checked).every(v => !v), '已删除识别条目仍含正文');
      if (e.evidenceId) check(op.evidenceIds.includes(e.evidenceId) && state.historyDeletion?.evidence.some(v => v.evidenceId === e.evidenceId && v.attemptId === e.attemptId && v.paperId === e.paperId), '已删除识别证据凭据不一致');
    } else {
      check(e.redactedAt === undefined && e.redactionOperationId === undefined && (e.status !== 'draft' || !c.redactedAt), '已清理原图仍存在可写草稿');
      check(pin ? e.snapshot && eligible(e.snapshot) && e.snapshot.id === pin.questionId && e.snapshot.version === pin.questionVersion && questionContentDigest(e.snapshot) === pin.contentDigest : e.snapshot === undefined && !e.checked.match, '核对候选快照无效');
      if (e.snapshot && pin) {
        keys(e.snapshot, ['id','familyId','version','text','answer','unit','knowledgeId','difficulty','source','sourceScope','steps','hint','alternative','prerequisites','status','authorId','reviewerId','reviewNote','createdAt','taskType','contextId','image']);
        check(state.content?.versions.some(v => v.questionId === pin.questionId && v.version === pin.questionVersion && v.digest === pin.contentDigest && canonicalStringify(v.question) === canonicalStringify(e.snapshot)), '核对快照缺少一致的原始教学版本归档');
      }
    }
    if (e.status === 'submitted') {
      const proof = state.evidence.find(v => v.id === e.evidenceId), attempt = state.attempts.find(a => a.id === e.attemptId), answer = attempt?.answers.find(a => a.questionId === pin?.questionId);
      check(pin && proof && !evidenceIds.has(proof.id) && proof.paperId === e.paperId && proof.attemptId === e.attemptId && proof.questionId === pin.questionId && proof.questionVersion === pin.questionVersion && proof.answer === e.answer && proof.kind === 'original' && proof.eligible === false && proof.help === 'unknown' && attempt?.status === 'submitted' && attempt.paperId === e.paperId && answer?.value === e.answer && answer.working === e.working && Object.values(e.checked).every(Boolean) && date(e.submittedAt), '识别条目与原始作答入档凭据不一致');
      const q = state.papers.find(p => p.id === e.paperId)?.questions.find(q => q.id === pin.questionId); check(q && questionContentDigest(q) === pin.contentDigest, '识别报告未保留冻结题目版本'); evidenceIds.add(proof.id);
    } else if (e.status === 'draft') check(e.paperId === undefined && e.attemptId === undefined && e.evidenceId === undefined && e.submittedAt === undefined, '未核对条目不能关联计分结果');
  }
  for (const c of data.captures) { check(data.runs.filter(r => r.captureId === c.id).length <= 5 && data.entries.filter(e => e.captureId === c.id).length <= 20, '原图识别次数或核对条目超限'); }
  const requests = new Set<string>();
  for (const r of data.requests) {
    keys(r, ['ownerId','requestId','action','digest','captureId','resultId','status','createdAt']); const c = captures.get(r.captureId), key = JSON.stringify([r.ownerId,r.requestId]);
    check(identifier(r.requestId) && identifier(r.resultId) && c?.ownerId === r.ownerId && digest(r.digest) && date(r.createdAt) && ['recognition.open','recognition.run.save','recognition.entry.save','recognition.submit'].includes(r.action) && ['completed','deleted'].includes(r.status) && !requests.has(key), '识别请求凭据无效'); requests.add(key);
    const resultExists = r.action === 'recognition.open' ? r.resultId === c.id
      : r.action === 'recognition.run.save' ? data.runs.some(run => run.id === r.resultId && run.captureId === c.id)
      : r.action === 'recognition.entry.save' ? data.entries.some(e => e.id === r.resultId && e.captureId === c.id)
      : data.entries.some(e => e.captureId === c.id && e.paperId === r.resultId && (e.status === 'submitted' || e.status === 'redacted') && state.papers.some(p => p.id === r.resultId));
    check(resultExists, '识别请求的返回结果与原图档案不一致');
    check(c.redactedAt ? r.status === 'deleted' : r.status === 'completed', '已删除识别请求仍可重放');
  }
}
export const validateRecognition = validateRecognitionState;
