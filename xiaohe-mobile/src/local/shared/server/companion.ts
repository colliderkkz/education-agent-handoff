// Generated from xiaohe-app/lib/server/companion.ts; SHA-256: dbd32ab818d444cc47b90d7c6a7e569b3da4ebd9ed93afda736dd360c4ea81ac
// Run node scripts/sync-local-domain.mjs; do not edit the generated body.
import { cloneData as structuredClone } from '../../clone.ts';
import type { ApiResult, ChatIntent, ChatMessage, CompanionContext, CompanionDeletePreview, CompanionRequest, CompanionState, CompanionThread, HelpRequest, LearningPreference, Question, Role, UsedLearningPreference, WorkspaceState } from '../types.ts';
import { DomainError } from './domain-error.ts';
import { canonicalStringify, questionContentDigest, sha256 } from './content.ts';

type Input = Record<string, unknown>;
type Context = { now: string; newId: () => string; userId: string; role: Role; displayName?: string; channel?: 'local' };
type Expose = (state: WorkspaceState, familyId: string, level: 'hint' | 'explanation') => void;
const intents: ChatIntent[] = ['note','hint','explanation','alternative'];
const fail = (message: string, status = 400): never => { throw new DomainError(message,status); };
function check(value: unknown, message: string, status = 400): asserts value { if (!value) fail(message,status); }
function object(value: unknown): Input { check(value && typeof value === 'object' && !Array.isArray(value),'学伴记录格式无效'); return value as Input; }
function keys(value: Input, allowed: string[]): void { check(Object.keys(value).every(key => allowed.includes(key)),'学伴记录含未支持字段'); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bounded = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim());
function text(value: unknown, empty = false): string { check(bounded(value,2000,empty),'消息须为不超过 2000 字的文字'); return value; }
function intent(value: unknown): ChatIntent { check(intents.includes(value as ChatIntent),'请选择记录想法、提示、讲解或另一种解法'); return value as ChatIntent; }
function id(value: unknown): string { check(identifier(value),'学伴记录 ID 无效'); return value; }
const hash = (value: unknown) => sha256(canonicalStringify(value));
const freshDraft = (now: string) => ({text:'',intent:'note' as const,revision:0,updatedAt:now});

/** Only metadata is migrated: old messages never acquire a guessed question version. */
export function ensureCompanion(state: WorkspaceState, options: { now: string; newId: () => string; userId?: string }): CompanionState {
  if (state.companion) return state.companion;
  const companion: CompanionState = {schemaVersion:1,threads:[],preferences:[],requests:[]};
  if (state.messages.length) {
    // The authenticated viewer is not necessarily the author of the old dossier.
    const ownerId = state.access?.ownerId || state.actor.id || options.userId!;
    const thread: CompanionThread = {id:options.newId(),ownerId,context:{source:'legacy'},createdAt:options.now,updatedAt:options.now,draft:freshDraft(options.now)};
    companion.threads.push(thread);
    state.messages = state.messages.map(message => ({id:message.id,role:message.role,text:message.text,createdAt:message.createdAt,threadId:thread.id,...(message.questionId ? {questionId:message.questionId} : {})}));
  }
  state.companion = companion;
  return companion;
}

function owned(companion: CompanionState, value: unknown, userId: string): CompanionThread {
  const thread = companion.threads.find(thread => thread.id === id(value) && thread.ownerId === userId);
  check(thread,'对话不存在或不属于当前使用者',404); return thread;
}
function resolveContext(state: WorkspaceState, value: unknown): {context: CompanionContext; snapshot?: Question} {
  const context = object(value);
  if (context.source === 'general') { keys(context,['source']); return {context:{source:'general'}}; }
  check(context.source === 'bank' || context.source === 'paper','请选择明确的题库或原卷来源');
  keys(context,context.source === 'paper' ? ['source','paperId','questionId','questionVersion'] : ['source','questionId','questionVersion']);
  const questionId = id(context.questionId);
  check(Number.isSafeInteger(context.questionVersion) && Number(context.questionVersion)>0,'题目版本无效');
  const paper = context.source === 'paper' ? state.papers.find(p => p.id === id(context.paperId)) : undefined;
  const q = context.source === 'paper' ? paper?.questions.find(q => q.id === questionId) : state.questions.find(q => q.id === questionId && q.status === 'published' && q.reviewerId && q.reviewerId !== q.authorId);
  check(q,'没有找到该来源中的可引用题目，请返回原卷或题库核对',404);
  check(q.version === context.questionVersion,'题目版本已变化，请重新打开明确的题目版本',409);
  return {context:{source:context.source,questionId:q.id,questionVersion:q.version,questionDigest:questionContentDigest(q),questionText:q.text,familyId:q.familyId,knowledgeId:q.knowledgeId,...(paper?{paperId:paper.id}:{})},snapshot:structuredClone(q)};
}
function open(state: WorkspaceState, value: unknown, ctx: Context): {thread: CompanionThread; created: boolean} {
  const companion = ensureCompanion(state,ctx), resolved = resolveContext(state,value);
  const key = canonicalStringify(resolved.context);
  const prior = companion.threads.find(t => t.ownerId === ctx.userId && canonicalStringify(t.context) === key);
  if (prior) return {thread:prior,created:false};
  const thread: CompanionThread = {id:ctx.newId(),ownerId:ctx.userId,...resolved,createdAt:ctx.now,updatedAt:ctx.now,draft:freshDraft(ctx.now)};
  companion.threads.push(thread); return {thread,created:true};
}
function deletionPreview(state: WorkspaceState, thread: CompanionThread): CompanionDeletePreview {
  const messages = state.messages.filter(m => m.threadId === thread.id);
  const requests = state.companion!.requests.filter(r => r.threadId === thread.id);
  const retainedHelpRequestCount=state.helpRequests.filter(r=>r.sourceThreadId===thread.id&&r.ownerId===thread.ownerId).length;
  const retainedExposureCount = state.events.filter(event => {
    if (event.action !== 'learning.exposure' || !('familyId' in thread.context)) return false;
    try { const detail = JSON.parse(event.detail); return Array.isArray(detail.familyIds) && detail.familyIds.includes(thread.context.familyId); } catch { return false; }
  }).length;
  return {threadId:thread.id,sourceRevision:state.revision,messageCount:messages.length,hasDraft:!!thread.draft.text,retainedExposureCount,retainedHelpRequestCount,
    digest:hash({threadId:thread.id,sourceRevision:state.revision,messageIds:messages.map(m => m.id),draftRevision:thread.draft.revision,requestIds:requests.map(r => r.requestId)})};
}
function priorRequest(companion: CompanionState, requestId: string, ownerId: string, payloadDigest: string): CompanionRequest | undefined {
  const prior = companion.requests.find(r => r.requestId === requestId && r.ownerId === ownerId);
  if (prior) check(prior.digest === payloadDigest,'相同请求 ID 对应不同内容，拒绝重复覆盖',409);
  return prior;
}
function reply(thread: CompanionThread, requested: ChatIntent, preference?: LearningPreference): {text: string; level?: 'hint'|'explanation'; preferenceUsed?: UsedLearningPreference} {
  if (requested === 'note') return {text:'想法已记在这段对话中。当前未连接大模型，也没有自动分析内容；需要帮助时，请明确选择提示、完整讲解或另一种解法。'};
  const q = thread.snapshot;
  check(q && (thread.context.source === 'paper' || thread.context.source === 'bank'),'这段对话没有明确题目版本。请从原卷或题库打开一道题；历史对话版本未知，不能推测解法。');
  const pieces = requested === 'hint' ? [q.hint] : requested === 'alternative' ? [q.alternative] : q.steps;
  check(pieces.length>0 && pieces.every(part => typeof part === 'string' && !!part.trim()),requested === 'hint' ? '该版本没有可引用的提示，未生成回复，也未记录帮助曝光。' : requested === 'alternative' ? '该版本没有另一种解法，未生成回复，也未记录帮助曝光。' : '该版本没有完整教学解法，未生成回复，也未记录帮助曝光。');
  const used = preference ? {key:preference.key,value:preference.value,source:preference.source} : undefined;
  const body = preference?.value === 'compact' ? pieces.map(p=>p.trim()).join('；') : pieces.map((p,i)=>`${i+1}. ${p.trim()}`).join('\n');
  const setting = preference ? `本次使用本人设置的${preference.value === 'compact'?'紧凑呈现':'分步骤呈现'}偏好。` : '本次采用默认分步骤呈现；未保存推断偏好。';
  return {text:`【已保存题目解法引用 · 非大模型生成】\n${body}\n引用：${q.source}，题目版本 v${q.version}。${setting}`,level:requested === 'hint'?'hint':'explanation',...(used?{preferenceUsed:used}:{})};
}

/** Pure transactional entry point. The caller commits before exposing the returned reply. */
export function companionAction(current: WorkspaceState, action: string, input: Input, ctx: Context, expose: Expose): ApiResult {
  check(ctx.role === 'student' || ctx.role === 'owner','当前身份不能查看或操作私人学伴记录',403);
  validateCompanionState(current);
  const state = structuredClone(current), migrated = !state.companion;
  const companion = ensureCompanion(state,ctx);
  let result: NonNullable<ApiResult['result']> = {}, audit: Input = {};
  if (action === 'chat.open') {
    keys(input,['action','context']);
    const {thread,created} = open(state,input.context,ctx); result = {id:thread.id};
    if (!created && !migrated) return {state:current,result};
    audit = {threadId:thread.id};
  } else if (action === 'chat.draft.save') {
    keys(input,['action','threadId','text','intent','expectedDraftRevision']);
    const thread = owned(companion,input.threadId,ctx.userId), value = text(input.text,true), requested = intent(input.intent);
    check(input.expectedDraftRevision === thread.draft.revision,'草稿已变化，请重读后核对，未覆盖新草稿',409);
    if (thread.draft.text === value && thread.draft.intent === requested) return {state:current,result:{id:thread.id,draftRevision:thread.draft.revision}};
    thread.draft = {text:value,intent:requested,revision:thread.draft.revision+1,updatedAt:ctx.now}; thread.updatedAt=ctx.now;
    result={id:thread.id,draftRevision:thread.draft.revision}; audit={threadId:thread.id};
  } else if (action === 'chat.send') {
    keys(input,['action','threadId','text','intent','requestId','expectedDraftRevision','questionId']);
    const requested = intent(input.intent ?? 'note'), value = text(input.text ?? '',requested !== 'note');
    check(input.threadId===undefined || input.requestId!==undefined,'发送会话消息需要稳定的请求 ID');
    const requestId = input.requestId === undefined ? ctx.newId() : id(input.requestId);
    // Old callers have no reliable paper/version context. Their ordinary text is
    // preserved as a general note; explicit help requires a newly bound thread.
    check(input.threadId !== undefined || requested === 'note','请先从明确的原卷或题库版本打开对话，再请求帮助');
    const threadId = input.threadId === undefined ? open(state,{source:'general'},ctx).thread.id : id(input.threadId);
    if (input.threadId!==undefined && input.questionId!==undefined) {
      const bound=owned(companion,threadId,ctx.userId).context;
      check('questionId' in bound && bound.questionId===input.questionId,'兼容题号与已绑定对话不一致，请返回原卷重新打开');
    }
    const payloadDigest=hash({action,threadId,text:value,intent:requested});
    const prior=priorRequest(companion,requestId,ctx.userId,payloadDigest);
    if (prior) { check(prior.status !== 'deleted','该请求所属对话已删除，不能通过重放恢复',410); return {state:current,result:{id:prior.threadId,messageId:prior.messageId}}; }
    const thread=owned(companion,threadId,ctx.userId);
    if (input.expectedDraftRevision !== undefined) check(input.expectedDraftRevision === thread.draft.revision,'草稿已变化，请先核对再发送',409);
    const preference=companion.preferences.find(p=>p.ownerId===ctx.userId && p.key==='presentation'), response=reply(thread,requested,preference);
    const qid='questionId' in thread.context ? thread.context.questionId : undefined;
    const user: ChatMessage={id:ctx.newId(),role:'user',text:value,createdAt:ctx.now,threadId,requestId,intent:requested,...(qid?{questionId:qid}:{})};
    const assistant: ChatMessage={id:ctx.newId(),role:'assistant',text:response.text,createdAt:ctx.now,threadId,requestId,intent:requested,...(qid?{questionId:qid}:{}),...(response.preferenceUsed?{preferenceUsed:response.preferenceUsed}:{})};
    if (response.level) expose(state,thread.snapshot!.familyId,response.level);
    state.messages.push(user,assistant);
    if (thread.draft.text === value && thread.draft.intent === requested) thread.draft={...freshDraft(ctx.now),revision:thread.draft.revision+1};
    thread.updatedAt=ctx.now;
    companion.requests.push({requestId,ownerId:ctx.userId,threadId,action:'chat.send',digest:payloadDigest,status:'completed',createdAt:ctx.now,messageId:assistant.id});
    result={id:threadId,messageId:assistant.id,message:requested==='note'?'想法已保存，未请求题目帮助。':'已保存引用回复和帮助记录。'}; audit={threadId,requestId,intent:requested};
  } else if (action === 'chat.delete.preview') {
    keys(input,['action','threadId']); const thread=owned(companion,input.threadId,ctx.userId);
    return {state:current,result:{preview:deletionPreview(state,thread)}};
  } else if (action === 'chat.delete') {
    keys(input,['action','threadId','sourceRevision','digest','requestId']);
    const threadId=id(input.threadId),requestId=id(input.requestId),payloadDigest=hash({action,threadId,sourceRevision:input.sourceRevision,digest:input.digest});
    const prior=priorRequest(companion,requestId,ctx.userId,payloadDigest);
    if (prior) return {state:current,result:{id:threadId,deleted:true}};
    const thread=owned(companion,threadId,ctx.userId),preview=deletionPreview(state,thread);
    check(input.sourceRevision===current.revision && input.digest===preview.digest,'删除预览已过期，请重新核对影响后确认',409);
    state.messages=state.messages.filter(m=>m.threadId!==threadId);
    companion.threads=companion.threads.filter(t=>t.id!==threadId);
    for (const request of companion.requests.filter(r=>r.threadId===threadId)) { request.status='deleted'; delete request.messageId; }
    companion.requests.push({requestId,ownerId:ctx.userId,threadId,action:'chat.delete',digest:payloadDigest,status:'deleted',createdAt:ctx.now});
    result={id:threadId,deleted:true,message:'当前档案中的这段对话、消息和草稿已删除；单独保存的求助摘要、帮助曝光、原作答和评定历史继续保留。'}; audit={threadId,requestId};
  } else if (action === 'memory.preference.set' || action === 'memory.preference.delete') {
    keys(input,action==='memory.preference.set'?['action','key','value','sourceRevision']:['action','key','sourceRevision']);
    check(input.key==='presentation','只支持本人设置的讲解呈现偏好');
    check(input.sourceRevision===current.revision,'学习偏好或档案已变化，请重新核对',409);
    const prior=companion.preferences.find(p=>p.ownerId===ctx.userId && p.key==='presentation');
    if (action==='memory.preference.delete') {
      if (!prior) return {state:current,result:{message:'当前没有保存这项偏好。'}};
      companion.preferences=companion.preferences.filter(p=>p.id!==prior.id); result={id:prior.id,message:'已删除本人设置的偏好，后续采用默认呈现；历史回复和帮助记录不变。'};
    } else {
      check(input.value==='stepwise'||input.value==='compact','请选择分步骤或紧凑呈现');
      if (prior?.value===input.value) return {state:current,result:{id:prior.id}};
      const preference: LearningPreference={id:prior?.id || ctx.newId(),ownerId:ctx.userId,key:'presentation',value:input.value,source:'self',createdAt:prior?.createdAt || ctx.now,updatedAt:ctx.now};
      if (prior) companion.preferences[companion.preferences.indexOf(prior)]=preference; else companion.preferences.push(preference);
      result={id:preference.id,message:'已保存本人主动选择的讲解呈现偏好。'};
    }
    audit={key:'presentation'};
  } else fail('不支持的学伴操作');
  state.actor={id:ctx.userId,name:ctx.displayName || current.actor.name,role:ctx.role};
  state.revision=current.revision+1;
  state.events.unshift({id:ctx.newId(),action,label:action,actorId:ctx.userId,createdAt:ctx.now,detail:JSON.stringify(audit)});
  validateCompanionState(state);
  return {state,result};
}

/** A separately confirmed summary may be shared; it never copies a conversation. */
export function createCompanionHelpRequest(current: WorkspaceState, input: Input, ctx: Context): ApiResult {
  check(ctx.role==='student'||ctx.role==='owner','当前身份不能创建学习者求助摘要',403);
  keys(input,['action','topic','summary','threadId','requestId']);
  check(bounded(input.topic,120),'求助主题须为 1—120 字'); check(bounded(input.summary,2000),'求助摘要须为 1—2000 字');
  const topic=input.topic.trim(),summary=input.summary.trim(),threadId=input.threadId===undefined?undefined:id(input.threadId),requestId=input.requestId===undefined?undefined:id(input.requestId);
  check(!threadId||requestId,'从会话保存求助摘要需要稳定的请求 ID');
  const requestDigest=hash({topic,summary,threadId:threadId??null});
  const prior=requestId?current.helpRequests.find(r=>r.ownerId===ctx.userId&&r.requestId===requestId):undefined;
  if (prior) { check(prior.requestDigest===requestDigest,'相同求助请求 ID 对应不同摘要，拒绝重复覆盖',409); return {state:current,result:{id:prior.id,message:prior.delivery==='local-only'?'求助摘要已记在本机，尚未发送给教师。':'该求助摘要已保存在共享教师收件箱。'}}; }
  validateCompanionState(current);
  const thread=threadId?owned(current.companion || {schemaVersion:1,threads:[],preferences:[],requests:[]},threadId,ctx.userId):undefined;
  const delivery=ctx.channel==='local'?'local-only':'workspace';
  const request: HelpRequest={id:ctx.newId(),topic,summary,status:'waiting',createdAt:ctx.now,ownerId:ctx.userId,delivery,...(requestId?{requestId,requestDigest}:{}),...(thread?{sourceThreadId:thread.id,context:structuredClone(thread.context)}:{})};
  const state=structuredClone(current);state.helpRequests.unshift(request);state.revision=current.revision+1;
  state.actor={id:ctx.userId,name:ctx.displayName || current.actor.name,role:ctx.role};
  state.events.unshift({id:ctx.newId(),action:'help.create',label:delivery==='local-only'?'保存本机求助摘要':'保存共享求助摘要',actorId:ctx.userId,createdAt:ctx.now,detail:JSON.stringify({id:request.id,delivery,...(threadId?{threadId}:{})})});
  validateCompanionState(state);
  return {state,result:{id:request.id,message:delivery==='local-only'?'求助摘要已记在本机，尚未发送给教师。':'求助摘要已保存到共享教师收件箱，已授权教师可登录查看；未发送外部通知。'}};
}

function validateHelpMetadata(state: WorkspaceState): void {
  const requests=new Set<string>();
  for (const request of state.helpRequests) {
    keys(object(request),['id','topic','summary','status','reply','createdAt','ownerId','requestId','requestDigest','sourceThreadId','context','delivery']);
    check(identifier(request.id)&&bounded(request.topic,120)&&bounded(request.summary,2000)&&['waiting','received','replied'].includes(request.status)&&date(request.createdAt)&&(request.reply===undefined||bounded(request.reply,3000)),'求助摘要结构无效');
    if (request.ownerId===undefined && request.delivery===undefined && request.requestId===undefined && request.requestDigest===undefined && request.context===undefined && request.sourceThreadId===undefined) continue;
    check(identifier(request.ownerId)&&['local-only','workspace'].includes(String(request.delivery)),'求助来源或保存范围无效');
    if (request.requestId!==undefined) {
      check(identifier(request.requestId)&&digest(request.requestDigest),'求助请求标识或摘要无效');
      const key=JSON.stringify([request.ownerId,request.requestId]);check(!requests.has(key),'求助请求 ID 重复');requests.add(key);
      check(request.requestDigest===hash({topic:request.topic,summary:request.summary,threadId:request.sourceThreadId??null}),'求助摘要与请求指纹不一致');
    } else check(request.requestDigest===undefined,'求助摘要指纹缺少请求 ID');
    if (request.sourceThreadId!==undefined) {
      check(identifier(request.sourceThreadId)&&request.requestId&&request.context,'求助缺少明确会话上下文');
      const c=object(request.context);
      if (c.source==='general'||c.source==='legacy') keys(c,['source']);
      else {
        check(c.source==='bank'||c.source==='paper','求助上下文来源无效');
        keys(c,c.source==='paper'?['source','paperId','questionId','questionVersion','questionDigest','questionText','familyId','knowledgeId']:['source','questionId','questionVersion','questionDigest','questionText','familyId','knowledgeId']);
        check(identifier(c.questionId)&&identifier(c.familyId)&&Number.isSafeInteger(c.questionVersion)&&Number(c.questionVersion)>0&&digest(c.questionDigest)&&bounded(c.questionText,2000)&&['division','geometry','multiplication'].includes(String(c.knowledgeId))&&(c.source!=='paper'||identifier(c.paperId)),'求助题目上下文无效');
      }
      const thread=state.companion?.threads.find(t=>t.id===request.sourceThreadId);
      if (thread) check(thread.ownerId===request.ownerId&&canonicalStringify(thread.context)===canonicalStringify(c),'求助上下文与会话不一致');
      else check(state.companion?.requests.some(r=>r.action==='chat.delete'&&r.status==='deleted'&&r.threadId===request.sourceThreadId&&r.ownerId===request.ownerId),'求助引用未知的会话');
    } else check(request.context===undefined,'求助上下文缺少来源会话');
  }
}

/** Raw-state validation. Projections without internal snapshots cannot be persisted. */
export function validateCompanionState(state: WorkspaceState): void {
  validateHelpMetadata(state);
  if (state.companion===undefined) return;
  const c=object(state.companion); keys(c,['schemaVersion','threads','preferences','requests']);
  check(c.schemaVersion===1 && Array.isArray(c.threads) && Array.isArray(c.preferences) && Array.isArray(c.requests),'学伴档案结构无效');
  const threads=new Map<string,CompanionThread>(), contexts=new Set<string>(), preferenceKeys=new Set<string>(), preferenceIds=new Set<string>(), requests=new Map<string,CompanionRequest>(), messageIds=new Set<string>();
  const requestMessages=new Map<string,ChatMessage[]>(), requestKey=(ownerId: string,requestId: string)=>JSON.stringify([ownerId,requestId]);
  for (const raw of c.threads) {
    const t=object(raw); keys(t,['id','ownerId','context','createdAt','updatedAt','draft','snapshot']);
    check(identifier(t.id)&&identifier(t.ownerId)&&!threads.has(t.id)&&date(t.createdAt)&&date(t.updatedAt),'对话身份或时间无效');
    const context=object(t.context),d=object(t.draft); keys(d,['text','intent','revision','updatedAt']);
    check(bounded(d.text,2000,true)&&intents.includes(d.intent as ChatIntent)&&Number.isSafeInteger(d.revision)&&Number(d.revision)>=0&&date(d.updatedAt),'对话草稿无效');
    if (context.source==='general'||context.source==='legacy') { keys(context,['source']); check(t.snapshot===undefined,'普通或旧对话不得推测题目快照'); }
    else {
      check(context.source==='bank'||context.source==='paper','对话来源无效');
      keys(context,context.source==='paper'?['source','paperId','questionId','questionVersion','questionDigest','questionText','familyId','knowledgeId']:['source','questionId','questionVersion','questionDigest','questionText','familyId','knowledgeId']);
      if (context.source==='paper') check(identifier(context.paperId),'原卷引用无效');
      const q=object(t.snapshot);
      keys(q,['id','familyId','version','text','answer','unit','knowledgeId','difficulty','source','sourceScope','steps','hint','alternative','prerequisites','status','authorId','reviewerId','reviewNote','createdAt','taskType','contextId']);
      check(identifier(q.id)&&identifier(q.familyId)&&Number.isSafeInteger(q.version)&&Number(q.version)>0&&bounded(q.text,2000)&&bounded(q.answer,300)&&bounded(q.unit,30,true)&&['division','geometry','multiplication'].includes(String(q.knowledgeId)),'题目快照身份无效');
      check(['基础','巩固','挑战'].includes(String(q.difficulty))&&['draft','review','approved','published','disabled'].includes(String(q.status))&&bounded(q.source,300)&&bounded(q.sourceScope,300,true)&&bounded(q.hint,1000,true)&&bounded(q.alternative,2000,true)&&bounded(q.authorId,150)&&date(q.createdAt),'题目快照内容无效');
      for (const name of ['steps','prerequisites']) check(Array.isArray(q[name])&&(q[name] as unknown[]).length<=20&&(q[name] as unknown[]).every(s=>bounded(s,1500,true)),'题目快照步骤无效');
      check(q.reviewerId===undefined||bounded(q.reviewerId,150),'快照审核标识无效'); check(q.reviewNote===undefined||bounded(q.reviewNote,2000,true),'快照审核备注无效');
      check(q.taskType===undefined&&q.contextId===undefined||['basic','application','transfer'].includes(String(q.taskType))&&bounded(q.contextId,100),'快照任务标签无效');
      check(context.questionId===q.id&&context.questionVersion===q.version&&context.questionText===q.text&&context.familyId===q.familyId&&context.knowledgeId===q.knowledgeId&&digest(context.questionDigest)&&context.questionDigest===questionContentDigest(q as unknown as Question),'对话快照摘要或版本不一致');
      if (context.source==='paper') check(state.papers.some(p=>p.id===context.paperId&&p.questions.some(pq=>pq.id===q.id&&questionContentDigest(pq)===context.questionDigest)),'对话未绑定原卷中的冻结版本');
    }
    const contextKey=hash({ownerId:t.ownerId,context}); check(!contexts.has(contextKey),'同一使用者存在重复上下文对话'); contexts.add(contextKey);
    threads.set(t.id,raw as CompanionThread);
  }
  for (const raw of c.preferences) {
    const p=object(raw); keys(p,['id','ownerId','key','value','source','createdAt','updatedAt']);
    check(identifier(p.id)&&identifier(p.ownerId)&&p.key==='presentation'&&['stepwise','compact'].includes(String(p.value))&&p.source==='self'&&date(p.createdAt)&&date(p.updatedAt),'偏好只能来自本人主动设置');
    const key=`${p.ownerId}:${p.key}`; check(!preferenceKeys.has(key)&&!preferenceIds.has(p.id),'偏好重复'); preferenceKeys.add(key); preferenceIds.add(p.id);
  }
  for (const raw of c.requests) {
    const r=object(raw); keys(r,['requestId','ownerId','threadId','action','digest','status','createdAt','messageId']);
    check(identifier(r.requestId)&&identifier(r.ownerId)&&identifier(r.threadId)&&['chat.send','chat.delete'].includes(String(r.action))&&digest(r.digest)&&['completed','deleted'].includes(String(r.status))&&date(r.createdAt),'请求记录无效');
    const key=requestKey(r.ownerId,r.requestId); check(!requests.has(key),'请求 ID 重复');
    if (r.status==='deleted') check(r.messageId===undefined&&!threads.has(r.threadId),'已删除请求不得保留消息或活动对话');
    else check(r.action==='chat.send'&&identifier(r.messageId)&&threads.get(r.threadId)?.ownerId===r.ownerId,'请求关联的对话无效');
    requests.set(key,raw as CompanionRequest);
  }
  for (const raw of state.messages) {
    const m=object(raw); keys(m,['id','role','text','questionId','createdAt','threadId','requestId','intent','preferenceUsed']);
    check(identifier(m.id)&&!messageIds.has(m.id)&&['user','assistant'].includes(String(m.role))&&bounded(m.text,m.role==='user'?2000:40000,true)&&date(m.createdAt)&&identifier(m.threadId),'消息格式或归属无效'); messageIds.add(m.id);
    const thread=threads.get(m.threadId); check(thread,'消息引用已删除或不存在的对话');
    if (m.questionId!==undefined) check(identifier(m.questionId),'消息题号无效');
    if (thread.context.source==='legacy' && m.requestId===undefined) { check(m.intent===undefined&&m.preferenceUsed===undefined,'旧消息不得猜造请求或意图'); continue; }
    if (thread.context.source==='legacy') check(m.intent==='note','旧对话不能推测题目帮助');
    check(identifier(m.requestId)&&intents.includes(m.intent as ChatIntent),'消息缺少明确请求或意图');
    const key=requestKey(thread.ownerId,m.requestId),request=requests.get(key); check(request?.status==='completed'&&request.threadId===thread.id,'消息缺少有效请求');
    const pair=requestMessages.get(key); if (pair) pair.push(raw); else requestMessages.set(key,[raw]);
    check(m.questionId===('questionId' in thread.context?thread.context.questionId:undefined),'消息引用与会话版本不一致');
    if (m.preferenceUsed!==undefined) { const p=object(m.preferenceUsed); keys(p,['key','value','source']); check(m.role==='assistant'&&m.intent!=='note'&&p.key==='presentation'&&['stepwise','compact'].includes(String(p.value))&&p.source==='self','消息不得推测偏好'); }
  }
  for (const request of requests.values()) if (request.status==='completed') {
    const messages=requestMessages.get(requestKey(request.ownerId,request.requestId)) || [];
    const user=messages.find(m=>m.role==='user'),assistant=messages.find(m=>m.role==='assistant');
    check(messages.length===2&&user&&assistant&&assistant.id===request.messageId&&user.intent===assistant.intent,'请求消息对不完整');
    check(request.digest===hash({action:'chat.send',threadId:request.threadId,text:user.text,intent:user.intent}),'请求内容摘要不一致');
  }
}

/** Private conversation records are scoped even when the viewer owns the workspace. */
export function projectCompanion(state: WorkspaceState, role: Role): void {
  if (role==='student'||role==='owner') state.events=state.events.filter(event=>!(event.action.startsWith('chat.')||event.action.startsWith('memory.preference.'))||event.actorId===state.actor.id);
  state.helpRequests=state.helpRequests.filter(request=>request.delivery!=='local-only'||(role==='student'||role==='owner')&&request.ownerId===state.actor.id);
  if (!state.companion) {
    // Legacy text has no author field. A newly invited student must not inherit
    // the workspace owner's pre-migration private conversations on a GET.
    if (role==='student' && state.access && state.access.ownerId!==state.actor.id) state.messages=[];
    return;
  }
  if (role!=='student'&&role!=='owner') { delete state.companion; state.messages=[]; return; }
  const ownerId=state.actor.id;
  state.companion.threads=state.companion.threads.filter(t=>t.ownerId===ownerId).map(t=>{ const visible={...t}; delete visible.snapshot; return visible; });
  const ids=new Set(state.companion.threads.map(t=>t.id));
  state.messages=state.messages.filter(m=>!!m.threadId&&ids.has(m.threadId));
  state.companion.preferences=state.companion.preferences.filter(p=>p.ownerId===ownerId);
  // Tombstones and transport fingerprints are persistence details, not learning memory.
  state.companion.requests=[];
}
