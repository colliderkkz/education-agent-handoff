// Generated from xiaohe-app/lib/server/content.ts; SHA-256: 823fb9ea55a1fdbbbe5d4e7dc92d544fc5f5954409dc97144b9634e77a62fabe
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import { cloneData as structuredClone } from '../../clone.ts';
import { allowedGrades, allKnowledgeIds, mergedQuestions, stageOfKnowledge, subjectIds, subjectNames, subjectOfKnowledge, type ApiResult, type ContentBank, type ContentBatch, type ContentCatalogEntry, type ContentPackage, type ContentPointer, type ContentPreview, type ContentState, type ContentVersion, type KnowledgeId, type Question, type QuestionStatus, type StageId, type SubjectId, type WorkspaceState } from '../types.ts';
import { DomainError } from './domain-error.ts';
import { curriculumCatalog } from '../curriculum-catalog.ts';
import { shanghaiCatalog } from '../curriculum-catalog-shanghai.ts';

/**
 * 当前生效规则的标签，与 server/mastery.ts 的 activeRuleLabel 保持一致。
 *
 * 这里单独实现而不是从 mastery.ts 引入：mastery.ts 依赖 effective-evidence.ts，
 * 而 effective-evidence.ts 又从本文件取 sha256 —— 直接引入会形成
 * content → mastery → effective-evidence → content 的循环导入。
 */
function activeRuleLabel(state: WorkspaceState): string {
  const active = state.mastery?.rules.find(rule => rule.id === state.mastery?.activeRuleId);
  return active ? (active.mode === "legacy-pilot" ? "pilot-v2-max3" : `${active.id}/v${active.version}`) : "pilot-v2-max3";
}

/** 知识点目录里的名称与说明（小学四年级 + 上海初高中）。 */
function catalogPointById(knowledgeId: string): { name: string; description: string } | undefined {
  for (const subject of [...curriculumCatalog, ...shanghaiCatalog]) {
    for (const unit of subject.units) {
      const point = unit.points.find(item => item.id === knowledgeId);
      if (point) return { name: point.name, description: point.description };
    }
  }
  return undefined;
}

export const MAX_CONTENT_PACKAGE_BYTES = 500 * 1024;
export const MAX_CONTENT_PACKAGE_ITEMS = 200;
const TRUST_WARNING = '本地试用内容包未签名；作者与审核标识原样保留，身份和教学有效性未经核验。';
const statuses: QuestionStatus[] = ['draft', 'review', 'approved', 'published', 'disabled'];
const questionKeys = ['id', 'familyId', 'version', 'text', 'answer', 'unit', 'knowledgeId', 'difficulty', 'source', 'sourceScope', 'steps', 'hint', 'alternative', 'prerequisites', 'status', 'authorId', 'reviewerId', 'reviewNote', 'createdAt', 'taskType', 'contextId', 'image', 'examRef'];
const fail = (message: string, status = 400): never => { throw new DomainError(message, status); };
function check(ok: unknown, message: string): asserts ok { if (!ok) fail(message); }
const object = (value: unknown, label: string): Record<string, unknown> => {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label}须为对象`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, allowed: string[], label: string) => {
  for (const key of Object.keys(value)) check(allowed.includes(key), `${label}包含不允许的字段：${key}`);
};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const digestValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function bounded(value: unknown, max: number, empty = false): value is string { return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0); }

/** Stable JSON for hashing; object key order and insignificant input JSON whitespace do not matter. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return fail('内容含不可序列化的值');
}
function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) c = 0x10000 + ((c - 0xd800) << 10) + text.charCodeAt(++i) - 0xdc00;
    else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | c >>> 6, 128 | c & 63);
    else if (c < 65536) out.push(224 | c >>> 12, 128 | c >>> 6 & 63, 128 | c & 63);
    else out.push(240 | c >>> 18, 128 | c >>> 12 & 63, 128 | c >>> 6 & 63, 128 | c & 63);
  }
  return out;
}
/** Synchronous SHA-256 with no Node/native dependency, shared by browser and Hermes. */
export function sha256(text: string): string {
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = utf8(text), bits = bytes.length * 8;
  bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? Math.floor(bits / 2 ** (i * 8)) & 255 : bits >>> (i * 8) & 255);
  const r = (n: number, s: number) => n >>> s | n << 32 - s;
  for (let off = 0; off < bytes.length; off += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) w[i] = bytes[off+i*4] << 24 | bytes[off+i*4+1] << 16 | bytes[off+i*4+2] << 8 | bytes[off+i*4+3];
    for (let i = 16; i < 64; i++) w[i] = (w[i-16] + (r(w[i-15],7)^r(w[i-15],18)^w[i-15]>>>3) + w[i-7] + (r(w[i-2],17)^r(w[i-2],19)^w[i-2]>>>10)) | 0;
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e,6)^r(e,11)^r(e,25)) + (e&f^~e&g) + k[i] + w[i]) | 0;
      const t2 = ((r(a,2)^r(a,13)^r(a,22)) + (a&b^a&c^b&c)) | 0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    for (const [i, n] of [a,b,c,d,e,f,g,hh].entries()) h[i] = (h[i]+n)|0;
  }
  return h.map(n => (n>>>0).toString(16).padStart(8,'0')).join('');
}

/** Review workflow flags are mutable; a version's teaching content and author are not. */
export function questionContentDigest(question: Question): string {
  const body = Object.fromEntries(questionKeys.filter(key => !['status', 'reviewerId', 'reviewNote'].includes(key)).map(key => [key, question[key as keyof Question]]));
  return sha256(canonicalStringify(body));
}
export function questionFingerprint(question: Pick<Question, 'text' | 'answer'>): string {
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return sha256(normalize(question.text));
}
type QuestionIdentity = { digest: string; versionId: string; fingerprint: string; shape: string };
/** Lifetime is one exported operation. Cloned copies reuse their body hash, with no
 * process-global cache retaining private teaching content or stale identities. */
class ContentOperation {
  private identities = new WeakMap<Question, QuestionIdentity>();
  private bodyIdentities = new Map<string, QuestionIdentity>();
  identity(q: Question): QuestionIdentity {
    const existing = this.identities.get(q); if (existing) return existing;
    const body = canonicalStringify(Object.fromEntries(questionKeys.filter(key => !['status','reviewerId','reviewNote'].includes(key)).map(key => [key,q[key as keyof Question]])));
    const cloned = this.bodyIdentities.get(body);
    if (cloned) { this.identities.set(q,cloned); return cloned; }
    const digest = sha256(body);
    // Equality indexes use normalized strings directly, avoiding a second hash and
    // retaining exactly the existing full-width/whitespace/number-family semantics.
    const fingerprint = q.text.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
    const identity = {digest,versionId:`${q.id}@${q.version}:${digest}`,fingerprint,shape:fingerprint.replace(/[+-]?\d+(?:\.\d+)?/g,'#')};
    this.identities.set(q,identity); this.bodyIdentities.set(body,identity); return identity;
  }
}
function appendIndex<T>(map: Map<string,T[]>, key: string, value: T): void {
  const entries = map.get(key); if (entries) entries.push(value); else map.set(key,[value]);
}
function archiveIndex(content: ContentState, op: ContentOperation) {
  const byId = new Map<string,ContentVersion>(), byQuestion = new Map<string,ContentVersion[]>(), byFingerprint = new Map<string,ContentVersion[]>(), byShape = new Map<string,ContentVersion[]>();
  for (const v of content.versions) {
    const identity = op.identity(v.question);
    byId.set(v.id,v); appendIndex(byQuestion,v.questionId,v); appendIndex(byFingerprint,identity.fingerprint,v); appendIndex(byShape,identity.shape,v);
  }
  return {byId,byQuestion,byFingerprint,byShape};
}

function validateQuestion(value: unknown, published = false): asserts value is Question {
  const q = object(value, '题目'), label = `题目 ${String(q.id ?? '(缺少ID)')}`;
  exactKeys(q, questionKeys, label);
  check(identifier(q.id) && identifier(q.familyId) && positive(q.version), `${label} 的 ID、题族或版本无效`);
  for (const [key, max, empty] of [['text',2000,false],['answer',300,false],['unit',30,true],['source',300,false],['sourceScope',300,!published],['hint',1000,false],['alternative',2000,true],['authorId',150,false]] as const) check(bounded(q[key], max, empty), `${label} 的 ${key} 缺失或超限`);
  // 配图是可选字段；放在长度数组外校验，否则没有配图的存量题目会被误判为无效。
  if (q.image !== undefined) check(bounded(q.image, 300), `${label} 的配图路径缺失或超限`);
  if (q.examRef !== undefined) { const ref = q.examRef as Record<string, unknown>; check(typeof ref === "object" && ref !== null && !Array.isArray(ref), `${label} 的考点对应格式不正确`); check(Object.keys(ref).every(key => ["topicKey", "label", "sourceUrl", "sourceTier", "sourceTitle"].includes(key)), `${label} 的考点对应含有未知字段`); check(bounded(String(ref.topicKey ?? ""), 60) && bounded(String(ref.label ?? ""), 200) && bounded(String(ref.sourceUrl ?? ""), 300) && bounded(String(ref.sourceTitle ?? ""), 200), `${label} 的考点对应字段缺失或超限`); check(["official-commentary", "official-policy", "third-party"].includes(String(ref.sourceTier)), `${label} 的考点对应来源分级无效`); }
  check((allKnowledgeIds as readonly string[]).includes(String(q.knowledgeId)) && ['基础','巩固','挑战'].includes(String(q.difficulty)) && statuses.includes(q.status as QuestionStatus) && date(q.createdAt), `${label} 的课程、难度、状态或时间无效`);
  for (const key of ['steps','prerequisites']) check(Array.isArray(q[key]) && (q[key] as unknown[]).length <= 20 && (q[key] as unknown[]).every(v => bounded(v,1500)) && (key !== 'steps' || (q[key] as unknown[]).length > 0), `${label} 的 ${key} 无效`);
  check(q.reviewerId === undefined || bounded(q.reviewerId,150), `${label} 的审核标识无效`);
  check(q.reviewNote === undefined || bounded(q.reviewNote,2000,true), `${label} 的审核说明无效`);
  check(q.taskType === undefined && q.contextId === undefined || ['basic','application','transfer'].includes(String(q.taskType)) && bounded(q.contextId,100), `${label} 的任务类型与情境须同时有效`);
  if (published) check(q.status === 'published' && bounded(q.reviewerId,150) && q.reviewerId !== q.authorId && q.taskType && q.contextId && bounded(q.sourceScope,300), `${label} 缺少独立审核、发布状态或完整任务／情境／来源范围标注`);
}
function packageDigest(pack: Omit<ContentPackage, 'digest'> | ContentPackage): string {
  return sha256(canonicalStringify({ ...pack, digest: undefined }));
}
export function parseContentPackage(input: unknown): ContentPackage { return parsePackage(input,new ContentOperation()); }
function parsePackage(input: unknown, op: ContentOperation): ContentPackage {
  let value: unknown;
  try {
    const encoded = typeof input === 'string' ? input : JSON.stringify(input);
    check(typeof encoded === 'string' && encoded.length <= MAX_CONTENT_PACKAGE_BYTES && utf8(encoded).length <= MAX_CONTENT_PACKAGE_BYTES, '内容包超过 500 KiB 或不是有效 JSON');
    value = JSON.parse(encoded);
  } catch (error) { if (error instanceof DomainError) throw error; return fail('内容包不是有效的 JSON'); }
  const p = object(value, '内容包');
  exactKeys(p, ['schemaVersion','kind','trust','teachingValidation','packageId','publisherId','createdAt','courseScope','items','withdrawals','digest'], '内容包');
  check(p.schemaVersion === 1 && p.kind === 'xiaohe-content' && p.trust === 'unsigned' && p.teachingValidation === 'unvalidated-trial', '不支持的内容包版本、信任类型或教学验证声明');
  check(identifier(p.packageId) && identifier(p.publisherId) && date(p.createdAt), '内容包 ID、发行标识或时间无效');
  const scope = object(p.courseScope, '课程范围'); exactKeys(scope,['grade','course','subjects'],'课程范围');
  // course 保持中文科目名（与既有内容包一致），subjects 用教材目录的学科 id。
  const scopeCourseId = subjectIds.find(id => subjectNames[id] === String(scope.course));
  check(allowedGrades.includes(String(scope.grade)) && scopeCourseId, '内容包须声明受支持的年级与学科');
  // subjects 是可选键：缺省时视为只含 course，老内容包不需要改动即可继续解析。
  const scopeSubjects = scope.subjects === undefined ? [scopeCourseId] : (Array.isArray(scope.subjects) ? scope.subjects.map(String) : null);
  check(scopeSubjects !== null && scopeSubjects.length > 0 && scopeSubjects.every(s => subjectIds.includes(s as SubjectId)), '内容包学科范围无效');
  check(Array.isArray(p.items) && Array.isArray(p.withdrawals) && p.items.length + p.withdrawals.length > 0 && p.items.length + p.withdrawals.length <= MAX_CONTENT_PACKAGE_ITEMS, '内容包须包含 1—200 项题目或撤回');
  const ids = new Set<string>(), fingerprints = new Map<string, string>(), shapes = new Map<string, string>();
  for (const item of p.items) {
    validateQuestion(item, true); check(!ids.has(item.id), `内容包重复题号：${item.id}`); ids.add(item.id);
    const identity = op.identity(item), fp = identity.fingerprint, prior = fingerprints.get(fp);
    check(!prior || prior === item.id, `题目 ${item.id} 与 ${prior} 的规范化题干相同，不能换 ID 或答案作为新题`); fingerprints.set(fp,item.id);
    const shape = identity.shape, family = shapes.get(shape);
    check(!family || family === item.familyId, `题目 ${item.id} 仅数字有别的题干须沿用同一题族`); shapes.set(shape,item.familyId);
  }
  for (const item of p.withdrawals) {
    const w = object(item,'撤回条目'); exactKeys(w,['questionId','familyId','version'],'撤回条目');
    check(identifier(w.questionId) && identifier(w.familyId) && positive(w.version), '撤回条目须锁定题号、题族和版本');
    check(!ids.has(w.questionId), `内容包重复或同时发布／撤回题号：${w.questionId}`); ids.add(w.questionId);
  }
  check(digestValid(p.digest) && packageDigest(p as unknown as ContentPackage) === p.digest, '内容包摘要不匹配，内容可能已变化');
  return p as unknown as ContentPackage;
}
function versionId(q: Question, op: ContentOperation): string { return op.identity(q).versionId; }
function addVersion(content: ContentState, q: Question, source: ContentVersion['source'], sourceBatchId: string | undefined, op: ContentOperation): ContentVersion {
  const id = versionId(q,op), existing = content.versions.find(v => v.id === id);
  if (existing) {
    // Only review metadata can advance before publication; published snapshots stay frozen.
    if (source === 'editorial' && ['draft','review','approved'].includes(existing.question.status)) existing.question = structuredClone(q);
    return existing;
  }
  const record: ContentVersion = { id, questionId:q.id, version:q.version, digest:op.identity(q).digest, question:structuredClone(q), source, ...(sourceBatchId ? {sourceBatchId} : {}) };
  content.versions.push(record); return record;
}
/** First migration archives only records actually present, including conflicting legacy paper snapshots. */
export function ensureContent(state: WorkspaceState): ContentState { return ensureContentWithOperation(state,new ContentOperation()); }
function ensureContentWithOperation(state: WorkspaceState, op: ContentOperation): ContentState {
  if (state.content) return state.content;
  const content: ContentState = {schemaVersion:1, versions:[], batches:[]}; state.content = content;
  for (const q of state.questions) addVersion(content,q,'baseline',undefined,op);
  for (const paper of state.papers) for (const q of paper.questions) addVersion(content,q,'paper',undefined,op);
  return content;
}
export function recordQuestionVersion(state: WorkspaceState, q: Question): void {
  const op = new ContentOperation(), content = ensureContentWithOperation(state,op), known = content.versions.filter(v => v.questionId === q.id);
  // Legacy paper snapshots can disagree with the current bank at the same
  // version. Updating review/status metadata for an exact archived body must
  // still work, especially when disabling that current question.
  if (known.some(v => v.id === versionId(q,op))) {
    addVersion(content,q,'editorial',undefined,op);
    return;
  }
  check(known.every(v => v.question.familyId === q.familyId), `题目 ${q.id} 的题族身份冲突，不能覆盖历史`);
  check(known.filter(v => v.version === q.version).every(v => v.digest === op.identity(q).digest), `题目 ${q.id} v${q.version} 正文已归档，不能原地覆盖`);
  addVersion(content,q,'editorial',undefined,op);
}
const pointer = (q: Question | undefined, op: ContentOperation): ContentPointer | null => q ? {versionId:versionId(q,op),status:q.status} : null;
const samePointer = (a: ContentPointer|null, b: ContentPointer|null) => a?.versionId === b?.versionId && a?.status === b?.status;
const summary = (q: Question, op: ContentOperation): ContentCatalogEntry => ({questionId:q.id,familyId:q.familyId,version:q.version,knowledgeId:q.knowledgeId,status:q.status,...(q.taskType?{taskType:q.taskType}:{}),digest:op.identity(q).digest});
export function contentCatalog(state: WorkspaceState, bank?: ContentBank): ContentCatalogEntry[] { const op = new ContentOperation(); return mergedQuestions(state, bank).map(q => summary(q,op)); }
function compatible(index: ReturnType<typeof archiveIndex>, q: Question, op: ContentOperation): void {
  const known = index.byQuestion.get(q.id) || [], identity = op.identity(q);
  check(known.every(v => v.question.familyId === q.familyId), `题目 ${q.id} 不能更换已登记题族`);
  const same = known.filter(v => v.version === q.version);
  check(same.every(v => v.digest === identity.digest), `题目 ${q.id} v${q.version} 与归档正文冲突`);
  // Preserve known legacy aliases without allowing newly registered aliases.
  const duplicate = known.some(v => op.identity(v.question).fingerprint === identity.fingerprint) ? undefined : index.byFingerprint.get(identity.fingerprint)?.find(v => v.questionId !== q.id);
  check(!duplicate, `题目 ${q.id} 与历史题目 ${duplicate?.questionId} 的规范化题干相同，不能改 ID 或答案重置已见记录`);
  const sameShape = known.some(v => op.identity(v.question).shape === identity.shape) ? undefined : index.byShape.get(identity.shape)?.find(v => v.question.familyId !== q.familyId);
  check(!sameShape, `题目 ${q.id} 与 ${sameShape?.questionId} 仅数字有别，必须沿用已登记题族`);
}
function previewParsed(state: WorkspaceState, pack: ContentPackage, op: ContentOperation): ContentPreview {
  const copy = state.content ? state : structuredClone(state), content = ensureContentWithOperation(copy,op);
  validateContentWithOperation(copy,op);
  const index = archiveIndex(content,op), currentById = new Map(copy.questions.map(q => [q.id,q]));
  const prior = content.batches.find(b => b.packageId === pack.packageId);
  if (prior && prior.digest !== pack.digest) fail('相同内容包 ID 对应不同摘要，拒绝覆盖原批次',409);
  const preview: ContentPreview = {packageId:pack.packageId,publisherId:pack.publisherId,createdAt:pack.createdAt,digest:pack.digest,sourceRevision:state.revision,alreadyApplied:!!prior,rolledBack:prior?.status === 'rolled-back',warnings:[TRUST_WARNING],counts:{added:0,updated:0,withdrawn:0,unchanged:0},changes:[]};
  if (prior) return preview;
  for (const q of pack.items) {
    compatible(index,q,op);
    const current = currentById.get(q.id);
    check(!current || ['published','disabled'].includes(current.status), `题目 ${q.id} 有未发布编辑，不能由内容包覆盖`);
    const highest = Math.max(0,...(index.byQuestion.get(q.id) || []).map(v => v.version));
    check(q.version >= highest, `题目 ${q.id} v${q.version} 低于历史最高版本 ${highest}；请使用显式批次回退`);
    const archived = index.byId.get(versionId(q,op));
    if (archived) {
      try { validateQuestion({...archived.question,status:'published'},true); }
      catch { fail(`题目 ${q.id} v${q.version} 的归档未完成独立审核或标注，内容包不能替换原审核记录；请完成原审核流程或发布新版本。`); }
    }
    const action = !current ? 'add' : current.version === q.version && current.status === 'published' ? 'unchanged' : 'update';
    preview.counts[action === 'add' ? 'added' : action === 'update' ? 'updated' : 'unchanged']++;
    preview.changes.push({...summary(q,op),action,...(current?{previousVersion:current.version}:{})});
  }
  for (const w of pack.withdrawals) {
    const current = currentById.get(w.questionId);
    check(current && current.familyId === w.familyId && current.version === w.version && ['published','disabled'].includes(current.status), `撤回 ${w.questionId} 的当前题族、版本或状态不匹配`);
    const action = current.status === 'disabled' ? 'unchanged' : 'withdraw';
    preview.counts[action === 'withdraw' ? 'withdrawn' : 'unchanged']++;
    preview.changes.push({...summary(current,op),status:'disabled',action,previousVersion:current.version});
  }
  return preview;
}
export function previewContentPackage(state: WorkspaceState, input: unknown): ContentPreview { const op = new ContentOperation(); return previewParsed(state,parsePackage(input,op),op); }
export interface ContentContext { now: string; newId: () => string; userId: string; reason?: string; }
function audit(state: WorkspaceState, action: string, detail: string, ctx: ContentContext): void {
  state.events.unshift({id:ctx.newId(),action,label:action === 'content.apply' ? '应用本地内容包' : '回退本地内容批次',actorId:ctx.userId,createdAt:ctx.now,detail});
}
export function applyContentPackage(current: WorkspaceState, input: unknown, binding: Pick<ContentPreview,'sourceRevision'|'digest'>, ctx: ContentContext): ApiResult {
  const op = new ContentOperation(), pack = parsePackage(input,op), preview = previewParsed(current,pack,op);
  if (preview.alreadyApplied) return {state:current,result:{id:pack.packageId,preview,message:preview.rolledBack?'该内容包已回退，重复导入不会重新激活。':'该内容包已应用，未重复写入。'}};
  check(binding.sourceRevision === current.revision && binding.digest === pack.digest,'预览已过期或内容变化，请重新预览后应用');
  const state = structuredClone(current), content = ensureContentWithOperation(state,op), batchId = ctx.newId();
  const batch: ContentBatch = {id:batchId,packageId:pack.packageId,digest:pack.digest,publisherId:pack.publisherId,appliedAt:ctx.now,appliedRevision:current.revision+1,status:'applied',changes:[]};
  for (const q of pack.items) {
    const index = state.questions.findIndex(item => item.id === q.id), before = pointer(state.questions[index],op);
    // Equal content/version is a true no-op: do not replace its original approval
    // metadata with unverified incoming reviewer labels outside a tracked change.
    if (preview.changes.find(change => change.questionId === q.id)?.action === 'unchanged') continue;
    const archived = addVersion(content,q,'package',batchId,op);
    // Reactivating a retained version preserves that version's original approval.
    const selected = {...structuredClone(archived.question),status:'published' as const};
    validateQuestion(selected,true);
    if (index >= 0) state.questions[index] = selected; else state.questions.push(selected);
    const after = pointer(selected,op); if (!samePointer(before,after)) batch.changes.push({questionId:q.id,before,after});
  }
  for (const w of pack.withdrawals) {
    const q = state.questions.find(item => item.id === w.questionId)!; const before = pointer(q,op); q.status = 'disabled';
    const after = pointer(q,op); if (!samePointer(before,after)) batch.changes.push({questionId:q.id,before,after});
  }
  // 内容包带来的知识点，在学习空间里建立条目 ——
  // 否则题目进了题库却没有可练的知识点（组卷只认已解锁的知识点）。
  const ruleLabel = activeRuleLabel(state);
  for (const knowledgeId of new Set(pack.items.map(item => item.knowledgeId))) {
    if (state.knowledge.some(knowledge => knowledge.id === knowledgeId)) continue;
    const point = catalogPointById(knowledgeId);
    state.knowledge.push({
      id: knowledgeId as KnowledgeId, name: point?.name ?? knowledgeId, description: point?.description ?? '随内容包加入的知识点',
      learningState: 'current', stars: null, evidenceIds: [],
      reason: `随内容包加入学习范围，尚无本规则下的独立新题证据。${ruleLabel}`,
      ruleVersion: ruleLabel, assessmentState: 'insufficient',
    });
  }
  content.batches.push(batch); audit(state,'content.apply',JSON.stringify({packageId:pack.packageId,batchId,digest:pack.digest}),ctx); state.revision++;
  validateContentWithOperation(state,op);
  return {state,result:{id:batchId,preview,message:`内容包已应用。${TRUST_WARNING}`}};
}
export function rollbackContentBatch(current: WorkspaceState, batchId: string, expectedRevision: number, ctx: ContentContext): ApiResult {
  const op = new ContentOperation();
  validateContentWithOperation(current,op);
  check(bounded(ctx.reason,1000),'请填写本次回退原因');
  const existing = current.content?.batches.find(b => b.id === batchId);
  check(existing,'内容批次不存在');
  if (existing.status === 'rolled-back') return {state:current,result:{id:batchId,message:'该批次已回退，未重复写入。'}};
  check(expectedRevision === current.revision,'题库或学习记录已变化，请重读批次后再回退');
  check(current.content!.batches.filter(b => b.status === 'applied').at(-1)?.id === batchId,'仅能回退最近一个仍有效的批次');
  const state = structuredClone(current), content = ensureContentWithOperation(state,op), batch = content.batches.find(b => b.id === batchId)!;
  for (const change of batch.changes) {
    const index = state.questions.findIndex(q => q.id === change.questionId);
    check(samePointer(pointer(state.questions[index],op),change.after),`题目 ${change.questionId} 已被后续编辑，不能覆盖回退`);
    if (change.before) {
      const archived = content.versions.find(v => v.id === change.before!.versionId); check(archived,'批次原版本引用缺失，不能回退');
      state.questions[index] = {...structuredClone(archived.question),status:change.before.status};
    } else if (index >= 0) state.questions.splice(index,1);
  }
  batch.status = 'rolled-back'; batch.rolledBackAt = ctx.now; batch.rolledBackRevision = current.revision+1; batch.reason = ctx.reason!.trim();
  audit(state,'content.rollback',JSON.stringify({batchId,reason:batch.reason}),ctx); state.revision++;
  validateContentWithOperation(state,op);
  return {state,result:{id:batchId,message:'已回退题库可用版本；历史原卷、作答与已见题族记录保持保留。'}};
}
export function exportContentPackage(state: WorkspaceState, options: {packageId:string;publisherId:string;createdAt:string;questionIds?:string[];withdrawals?:string[];bank?:ContentBank;grade?:string}): ContentPackage {
  check(allowedGrades.includes(String(state.profile.grade)),'档案年级不在支持的范围内，请先核对课程范围');
  // 静态库题也可被显式导出；默认集仍只取工作区已发布题，避免默认导出超过内容包条目上限。
  const pool = mergedQuestions(state, options.bank);
  const requested = options.questionIds ?? state.questions.filter(q => q.status === 'published').map(q => q.id);
  check(Array.isArray(requested) && new Set(requested).size === requested.length,'导出题号重复或无效');
  const items = requested.map(id => { const q = pool.find(q => q.id === id); check(q,`导出题目不存在：${id}`); validateQuestion(q,true); return structuredClone(q); });
  check(options.withdrawals === undefined || Array.isArray(options.withdrawals),'撤回题号须为数组');
  const withdrawals = (options.withdrawals ?? []).map(id => { const q = state.questions.find(q => q.id === id); check(q && q.status === 'disabled',`撤回导出仅接受当前已停用题目：${id}`); return {questionId:q.id,familyId:q.familyId,version:q.version}; });
  // 课程范围绑定「被导出的内容」，而不是档案的主科字符串：
  // 导出的题目属于哪个学科就声明哪个学科，属于哪个学段就声明那个学段的年级。
  const subjects = [...new Set(items.map(q => subjectOfKnowledge(q.knowledgeId)).filter((id): id is SubjectId => Boolean(id)))];
  const stages = [...new Set(items.map(q => stageOfKnowledge(q.knowledgeId)))];
  check(stages.length <= 1,'一个内容包不能跨学段导出，请按学段分别导出');
  const stageGrades: Record<StageId, string> = { primary: '四年级', junior: '九年级', senior: '高三' };
  const courseScope: ContentPackage["courseScope"] = {
    grade: options.grade ?? (stages.length === 1 ? stageGrades[stages[0]] : state.profile.grade),
    course: subjects.length ? subjectNames[subjects[0]] : state.profile.course,
    ...(subjects.length > 1 ? { subjects } : {}),
  };
  const pack: ContentPackage = {schemaVersion:1,kind:'xiaohe-content',trust:'unsigned',teachingValidation:'unvalidated-trial',packageId:options.packageId,publisherId:options.publisherId,createdAt:options.createdAt,courseScope,items,withdrawals,digest:''};
  pack.digest = packageDigest(pack); return parseContentPackage(pack);
}

/** Raw persistence validation. Projection-only catalog and dangling/edited archive references are refused. */
export function validateContentState(state: WorkspaceState): void { validateContentWithOperation(state,new ContentOperation()); }
function validateContentWithOperation(state: WorkspaceState, op: ContentOperation): void {
  if (state.content === undefined) return;
  const content = object(state.content,'内容档案'); exactKeys(content,['schemaVersion','versions','batches'],'内容档案');
  check(content.schemaVersion === 1 && Array.isArray(content.versions) && Array.isArray(content.batches),'内容档案结构无效');
  const versionIds = new Set<string>(), batchIds = new Set<string>(), packages = new Set<string>();
  const versions = content.versions as ContentVersion[], batches = content.batches as ContentBatch[];
  check(new Set(state.questions.map(q => q.id)).size === state.questions.length,'当前题库题号重复');
  for (const raw of versions) {
    const v = object(raw,'题目版本'); exactKeys(v,['id','questionId','version','digest','question','source','sourceBatchId'],'题目版本'); validateQuestion(v.question);
    const q = v.question; check(v.id === versionId(q,op) && v.questionId === q.id && v.version === q.version && v.digest === op.identity(q).digest && !versionIds.has(String(v.id)),'题目版本身份、摘要或唯一性不符'); versionIds.add(String(v.id));
    check(['baseline','paper','editorial','package'].includes(String(v.source)) && (v.sourceBatchId === undefined || typeof v.sourceBatchId === 'string'),'题目版本来源无效');
  }
  const index = archiveIndex(state.content,op), batchesById = new Map<string,ContentBatch>(), currentById = new Map(state.questions.map(q => [q.id,q]));
  const validatePointer = (value: unknown, qid: unknown) => {
    if (value === null) return;
    const p = object(value,'版本指针'); exactKeys(p,['versionId','status'],'版本指针');
    check(statuses.includes(p.status as QuestionStatus) && index.byId.get(String(p.versionId))?.questionId === qid,'内容批次包含孤儿或跨题目指针');
  };
  for (const raw of batches) {
    const b = object(raw,'内容批次'); exactKeys(b,['id','packageId','digest','publisherId','appliedAt','appliedRevision','status','rolledBackAt','rolledBackRevision','reason','changes'],'内容批次');
    check(identifier(b.id) && !batchIds.has(b.id) && identifier(b.packageId) && !packages.has(b.packageId) && digestValid(b.digest) && identifier(b.publisherId) && date(b.appliedAt),'内容批次身份或摘要无效'); batchIds.add(b.id); packages.add(b.packageId);
    check(positive(b.appliedRevision) && b.appliedRevision <= state.revision,'内容批次应用修订号无效');
    check(['applied','rolled-back'].includes(String(b.status)) && (b.status === 'rolled-back' ? date(b.rolledBackAt) && positive(b.rolledBackRevision) && b.rolledBackRevision > b.appliedRevision && b.rolledBackRevision <= state.revision && bounded(b.reason,1000) : b.rolledBackAt === undefined && b.rolledBackRevision === undefined && b.reason === undefined),'内容批次回退状态无效');
    check(Array.isArray(b.changes) && b.changes.length <= MAX_CONTENT_PACKAGE_ITEMS,'内容批次变更无效'); const qids = new Set<string>();
    for (const rawChange of b.changes) {
      const c = object(rawChange,'批次变更'); exactKeys(c,['questionId','before','after'],'批次变更');
      check(identifier(c.questionId) && !qids.has(c.questionId),'内容批次题号重复或无效'); qids.add(c.questionId); validatePointer(c.before,c.questionId); validatePointer(c.after,c.questionId);
      check(c.after !== null && !samePointer(c.before as ContentPointer|null,c.after as ContentPointer|null),'内容批次包含空变更');
    }
    batchesById.set(raw.id,raw);
  }
  for (const v of versions) {
    if (v.source === 'package') check(v.sourceBatchId && batchIds.has(v.sourceBatchId) && batchesById.get(v.sourceBatchId)!.changes.some(c => c.after?.versionId === v.id),'版本引用未知或无关联来源批次');
    else check(v.sourceBatchId === undefined,'非内容包版本不能关联导入批次');
  }
  for (const group of index.byQuestion.values()) {
    if (new Set(group.map(v => v.question.familyId)).size > 1) check(group.every(v => ['baseline','paper'].includes(v.source)),'非历史版本存在题族身份冲突');
    const byVersion = new Map<string,ContentVersion[]>();
    for (const v of group) appendIndex(byVersion,String(v.version),v);
    for (const same of byVersion.values()) if (new Set(same.map(v => v.digest)).size > 1) check(same.every(v => ['baseline','paper'].includes(v.source)),'非历史版本存在正文身份冲突');
  }
  for (const q of state.questions) {
    validateQuestion(q);
    check(versionIds.has(versionId(q,op)),`当前题目 ${q.id} 未引用已归档正文`);
    const archived = index.byId.get(versionId(q,op))!;
    if (archived.question.status === 'published') check(q.reviewerId === archived.question.reviewerId && q.reviewNote === archived.question.reviewNote,`当前题目 ${q.id} 的已发布审核记录与归档不符`);
  }
  for (const p of state.papers) for (const q of p.questions) check(versionIds.has(versionId(q,op)),`原卷 ${p.id} 的冻结题目未归档`);
  check(batches.every((b,i) => i === 0 || b.appliedRevision > batches[i-1].appliedRevision),'内容批次应用顺序不符');
  const timeline = batches.flatMap(b => [{revision:b.appliedRevision,batch:b,rollback:false},...(b.rolledBackRevision ? [{revision:b.rolledBackRevision,batch:b,rollback:true}]:[])]).sort((a,b) => a.revision-b.revision);
  check(new Set(timeline.map(event => event.revision)).size === timeline.length,'内容批次重复使用同一修订号');
  const stack: string[] = [];
  for (const event of timeline) {
    if (!event.rollback) stack.push(event.batch.id);
    else { check(stack.at(-1) === event.batch.id,'内容批次回退顺序不符合最近有效批次约束'); stack.pop(); }
  }
  // Per-question chains for still-active batches must connect. An intervening
  // editorial body or explicit status change can supersede a batch and is then
  // preserved by the exact-pointer check at rollback time.
  const editorialTransition = (from: ContentPointer|null, to: ContentPointer|null) => {
    if (!to) return false;
    if (from?.versionId === to.versionId && (from.status === 'disabled' || to.status === 'disabled')) return true;
    return index.byId.get(to.versionId)?.source === 'editorial';
  };
  const last = new Map<string, ContentPointer|null>();
  for (const batch of batches.filter(b => b.status === 'applied')) for (const c of batch.changes) {
    const prior = last.get(c.questionId);
    if (last.has(c.questionId) && !samePointer(prior!,c.before)) {
      check(editorialTransition(prior!,c.before),'有效内容批次的版本指针顺序不连续');
    }
    last.set(c.questionId,c.after);
  }
  for (const [qid, expected] of last) {
    const actual = pointer(currentById.get(qid),op);
    check(samePointer(expected,actual) || editorialTransition(expected,actual),`当前题目 ${qid} 与有效批次指针不符`);
  }
}
