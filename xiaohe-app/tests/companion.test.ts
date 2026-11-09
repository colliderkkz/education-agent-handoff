import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedWorkspace} from '../lib/seed.ts';
import {applyAction,DomainError} from '../lib/server/domain.ts';
import {projectWorkspace} from '../lib/server/access-policy.ts';
import {ensureCompanion,validateCompanionState} from '../lib/server/companion.ts';
import {applyContentPackage,exportContentPackage,previewContentPackage,rollbackContentBatch} from '../lib/server/content.ts';
import type {ChatIntent,CompanionDeletePreview,Paper,Question,Role,WorkspaceState} from '../lib/types.ts';

const NOW='2026-10-27T08:00:00.000Z';let serial=0;
const context={now:NOW,newId:()=>`companion-${++serial}`,userId:'learner-a',displayName:'本机学习者',role:'student' as Role};
const act=(s:WorkspaceState,action:string,input:Record<string,unknown>={},userId='learner-a',role:Role='student')=>applyAction(s,{action,...input},{...context,userId,role});
function base() {const s=createSeedWorkspace('learner-a','本机学习者',NOW);s.actor.role='student';s.messages=[];s.papers=[];s.attempts=[];s.evidence=[];s.events=[];s.mistakes=[];return s;}
function paper(q:Question,id='paper-a'):Paper {return {id,title:'固定练习',version:1,questionIds:[q.id],questions:[structuredClone(q)],createdAt:NOW,status:'ready',kind:'practice',reason:'测试原卷',estimatedMinutes:2};}
function open(s=base(),source:'bank'|'paper'|'general'='bank') {const q=s.questions[0];if(source==='paper'&&!s.papers.length)s.papers=[paper(q)];return act(s,'chat.open',{context:source==='general'?{source}:{source,questionId:q.id,questionVersion:q.version,...(source==='paper'?{paperId:s.papers[0].id}:{})}});}
function send(s:WorkspaceState,threadId:string,intent:ChatIntent='note',text='我的想法',requestId=`request-${++serial}`,extra={}) {return act(s,'chat.send',{threadId,intent,text,requestId,...extra});}
function preview(s:WorkspaceState,threadId:string) {return act(s,'chat.delete.preview',{threadId}).result!.preview as CompanionDeletePreview;}
function status(fn:()=>unknown,code:number) {assert.throws(fn,(e:unknown)=>e instanceof DomainError&&e.status===code);}

test('paper context binds the frozen old version while bank has a newer solution',()=>{
  const s=base(),old={...s.questions[0],steps:['OLD_V2_SOLUTION'],alternative:'OLD_V2_ALTERNATIVE'};
  s.papers=[paper(old)];s.questions[0]={...old,version:3,steps:['NEW_V3_SOLUTION'],alternative:'NEW_V3_ALTERNATIVE'};
  const opened=act(s,'chat.open',{context:{source:'paper',paperId:'paper-a',questionId:old.id,questionVersion:2}});
  const thread=opened.state.companion!.threads[0],id=opened.result!.id!;
  assert.equal(thread.context.source,'paper');assert.equal(thread.snapshot!.version,2);
  const sent=send(opened.state,id,'explanation','请讲解');assert.match(sent.state.messages.at(-1)!.text,/OLD_V2_SOLUTION/);assert.doesNotMatch(sent.state.messages.at(-1)!.text,/NEW_V3/);
  const bank=act(sent.state,'chat.open',{context:{source:'bank',questionId:old.id,questionVersion:3}});
  assert.match(send(bank.state,bank.result!.id!,'alternative','').state.messages.at(-1)!.text,/NEW_V3_ALTERNATIVE/);
  status(()=>act(s,'chat.open',{context:{source:'paper',paperId:'paper-a',questionId:old.id,questionVersion:3}}),409);
  status(()=>act(s,'chat.open',{context:{source:'paper',paperId:'missing',questionId:old.id,questionVersion:2}}),404);
});
test('opening and resuming an identical context is idempotent and does not expose a solution',()=>{
  const opened=open(),s=opened.state,q=s.questions[0];const resumed=open(s);
  assert.strictEqual(resumed.state,s);assert.equal(resumed.result!.id,opened.result!.id);assert.equal(s.companion!.threads.length,1);
  const view=projectWorkspace(s,'student');assert.equal(view.companion!.threads[0].snapshot,undefined);assert.equal(view.questions[0].answer,'');assert.deepEqual(view.questions[0].steps,[]);
  assert.equal(s.events.filter(e=>e.action==='learning.exposure').length,0);assert.equal(view.companion!.threads[0].context.source,'bank');
  assert.ok(!JSON.stringify(view.companion).includes(q.steps[0]));assert.ok(!JSON.stringify(view.companion).includes(q.alternative));
});
test('negative sentences and legacy chat calls default to notes without inferred exposure',()=>{
  const opened=open(),id=opened.result!.id!;const before=structuredClone({papers:opened.state.papers,evidence:opened.state.evidence,knowledge:opened.state.knowledge});
  const s=send(opened.state,id,'note','不要给答案，也不用讲解，我想自己试试。').state;
  assert.match(s.messages.at(-1)!.text,/未连接大模型/);assert.doesNotMatch(s.messages.at(-1)!.text,new RegExp(s.questions[0].steps[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(s.events.filter(e=>e.action==='learning.exposure').length,0);
  assert.deepEqual({papers:s.papers,evidence:s.evidence,knowledge:s.knowledge},before);
  const legacy=act(s,'chat.send',{questionId:s.questions[0].id,text:'不给我答案'}).state;
  assert.equal(legacy.events.filter(e=>e.action==='learning.exposure').length,0);assert.equal(legacy.messages.at(-1)!.intent,'note');
  assert.throws(()=>act(s,'chat.send',{questionId:s.questions[0].id,text:'请讲解',intent:'explanation'}),/明确/);
});
test('explicit help is monotonic for every active family copy but never rewrites submitted evidence or assessments',()=>{
  const s=base(),q=s.questions[0];s.papers=[paper(q,'active-a'),paper({...q,id:'family-copy'},'active-b'),{...paper(q,'completed'),status:'completed'}];
  s.attempts=[{id:'submitted',paperId:'completed',status:'submitted',startedAt:NOW,submittedAt:NOW,correctCount:1,independentCount:1,answers:[{questionId:q.id,value:q.answer,working:'old work',help:'independent',correct:true}]}];
  const opened=open(s,'paper'),before=structuredClone({submitted:opened.state.attempts[0],knowledge:opened.state.knowledge,evidence:opened.state.evidence,mastery:opened.state.mastery});
  const hinted=send(opened.state,opened.result!.id!,'hint','').state;
  assert.deepEqual(hinted.attempts.filter(a=>a.status==='draft').map(a=>a.answers[0].help),['hint','hint']);
  const full=send(hinted,opened.result!.id!,'alternative','').state;
  assert.ok(full.attempts.filter(a=>a.status==='draft').every(a=>a.answers[0].help==='explanation'));
  assert.deepEqual({submitted:full.attempts.find(a=>a.id==='submitted'),knowledge:full.knowledge,evidence:full.evidence,mastery:full.mastery},before);
  assert.equal(full.events.filter(e=>e.action==='learning.exposure').length,2);
});
test('missing source hint, steps or alternative fail atomically without fabricated help',()=>{
  for(const [intent,patch] of [['hint',{hint:''}],['explanation',{steps:[]}],['alternative',{alternative:''}]] as const) {
    const s=base();s.questions[0]={...s.questions[0],...patch,steps:'steps' in patch?[...patch.steps]:s.questions[0].steps};const opened=open(s),before=structuredClone(opened.state);
    assert.throws(()=>send(opened.state,opened.result!.id!,intent,''),/没有/);assert.deepEqual(opened.state,before);
  }
  const general=open(base(),'general');assert.throws(()=>send(general.state,general.result!.id!,'hint',''),/没有明确题目版本/);
});
test('saved drafts survive serialization and reject stale edits; request replay precedes cleared draft checks',()=>{
  const opened=open(),id=opened.result!.id!;
  const saved=act(opened.state,'chat.draft.save',{threadId:id,text:'草稿秘密',intent:'note',expectedDraftRevision:0}).state;
  const restored=JSON.parse(JSON.stringify(saved)) as WorkspaceState;validateCompanionState(restored);assert.equal(restored.companion!.threads[0].draft.text,'草稿秘密');
  status(()=>act(restored,'chat.draft.save',{threadId:id,text:'stale',intent:'note',expectedDraftRevision:0}),409);
  const sent=send(restored,id,'note','草稿秘密','stable-request',{expectedDraftRevision:1}).state;
  assert.equal(sent.companion!.threads[0].draft.text,'');assert.equal(sent.companion!.threads[0].draft.revision,2);
  assert.strictEqual(send(sent,id,'note','草稿秘密','stable-request',{expectedDraftRevision:1}).state,sent);
  status(()=>send(sent,id,'note','另一个文本','stable-request'),409);
  status(()=>send(sent,id,'hint','草稿秘密','stable-request'),409);
  assert.throws(()=>act(sent,'chat.send',{threadId:id,text:'草稿秘密',intent:'note',requestId:'stable-request',questionId:'different-question'}),/不一致/);
  assert.throws(()=>act(sent,'chat.send',{threadId:id,text:'missing key',intent:'note'}),/请求 ID/);
  const before=structuredClone(sent);status(()=>send(sent,id,'note','new note','new-request',{expectedDraftRevision:1}),409);assert.deepEqual(sent,before);
});
test('preferences are explicit enums, apply their actual format and preserve historical replies on deletion',()=>{
  const opened=open(),id=opened.result!.id!;let s=opened.state;
  s=act(s,'memory.preference.set',{key:'presentation',value:'compact',sourceRevision:s.revision}).state;
  assert.equal(s.companion!.preferences[0].source,'self');const compact=send(s,id,'explanation','').state;
  const oldReply=structuredClone(compact.messages.at(-1)!);assert.equal(oldReply.preferenceUsed!.value,'compact');assert.match(oldReply.text,/；/);assert.match(oldReply.text,/本人设置的紧凑/);
  s=act(compact,'memory.preference.set',{key:'presentation',value:'stepwise',sourceRevision:compact.revision}).state;
  s=send(s,id,'explanation','').state;assert.match(s.messages.at(-1)!.text,/\n1\..*\n2\./);assert.equal(s.messages.at(-1)!.preferenceUsed!.value,'stepwise');
  s=act(s,'memory.preference.delete',{key:'presentation',sourceRevision:s.revision}).state;assert.deepEqual(s.companion!.preferences,[]);assert.deepEqual(s.messages.find(m=>m.id===oldReply.id),oldReply);
  const defaulted=send(s,id,'hint','').state;assert.equal(defaulted.messages.at(-1)!.preferenceUsed,undefined);assert.match(defaulted.messages.at(-1)!.text,/默认/);
  assert.throws(()=>act(s,'memory.preference.set',{key:'ability',value:'聪明',sourceRevision:s.revision}),/只支持/);
  assert.throws(()=>act(s,'memory.preference.set',{key:'presentation',value:'compact',sourceRevision:s.revision,source:'teacher'}),/字段/);
  status(()=>act(s,'memory.preference.delete',{key:'presentation',sourceRevision:s.revision-1}),409);
});
test('legacy migration retains original text but never guesses a version or a different authenticated author',()=>{
  const s=base();s.messages=[{id:'legacy-message',role:'user',text:'旧记录',questionId:s.questions[0].id,createdAt:NOW}];
  s.actor.id='new-student';s.access={workspaceId:'workspace',ownerId:'old-owner',role:'student',workspaces:[]};
  assert.deepEqual(projectWorkspace(s,'student').messages,[]);
  const c=ensureCompanion(s,{...context,userId:'new-student'});assert.equal(c.threads[0].ownerId,'old-owner');assert.deepEqual(c.threads[0].context,{source:'legacy'});assert.equal(c.threads[0].snapshot,undefined);
  const before=structuredClone(s);assert.strictEqual(ensureCompanion(s,context),c);assert.deepEqual(s,before);validateCompanionState(s);
  assert.deepEqual(projectWorkspace(s,'student').messages,[]);
  assert.throws(()=>act(s,'chat.send',{threadId:c.threads[0].id,intent:'explanation',text:'',requestId:'legacy-help'},'old-owner','owner'),/版本未知/);
  const noted=act(s,'chat.send',{threadId:c.threads[0].id,intent:'note',text:'这条旧消息版本未知',requestId:'legacy-note'},'old-owner','owner').state;
  validateCompanionState(noted);assert.equal(noted.messages.length,3);
});
test('private threads and preferences remain owner-scoped for every role',()=>{
  let s=open().state;const id=s.companion!.threads[0].id;
  s=send(s,id,'note','PRIVATE_MESSAGE').state;s=act(s,'memory.preference.set',{key:'presentation',value:'compact',sourceRevision:s.revision}).state;
  const other=act(s,'chat.open',{context:{source:'general'}},'owner-b','owner').state;
  for(const role of ['teacher','parent','editor','reviewer'] as const) {
    const view=projectWorkspace(other,role);assert.equal(view.companion,undefined);assert.deepEqual(view.messages,[]);
    for(const action of ['chat.open','chat.send','chat.draft.save','chat.delete.preview','chat.delete','memory.preference.set','memory.preference.delete']) status(()=>act(other,action,{},'outsider',role),403);
  }
  const ownerView=projectWorkspace(other,'owner');assert.equal(ownerView.companion!.threads.length,1);assert.equal(ownerView.companion!.threads[0].ownerId,'owner-b');assert.deepEqual(ownerView.companion!.preferences,[]);assert.ok(!JSON.stringify(ownerView).includes('PRIVATE_MESSAGE'));
  status(()=>act(other,'chat.delete.preview',{threadId:id},'owner-b','owner'),404);
  status(()=>act(other,'chat.draft.save',{threadId:id,text:'intrusion',intent:'note',expectedDraftRevision:0},'owner-b','owner'),404);
});
test('delete preview is read-only, binds the revision, and removes current bodies while retaining exposure and tombstones',()=>{
  const opened=open(),id=opened.result!.id!;let s=send(opened.state,id,'hint','SECRET_CHAT_BODY','hint-request').state;
  s=act(s,'chat.draft.save',{threadId:id,text:'SECRET_DRAFT_BODY',intent:'note',expectedDraftRevision:0}).state;
  const before=structuredClone(s),p=preview(s,id);assert.deepEqual(s,before);assert.equal(p.messageCount,2);assert.equal(p.hasDraft,true);assert.equal(p.retainedExposureCount,1);
  const changed=act(s,'memory.preference.set',{key:'presentation',value:'compact',sourceRevision:s.revision}).state;
  status(()=>act(changed,'chat.delete',{...p,requestId:'delete-request'}),400); // No redundant preview-only fields are accepted.
  status(()=>act(changed,'chat.delete',{threadId:id,sourceRevision:p.sourceRevision,digest:p.digest,requestId:'delete-request'}),409);
  const input={threadId:id,sourceRevision:p.sourceRevision,digest:p.digest,requestId:'delete-request'};
  const deleted=act(s,'chat.delete',input).state;
  assert.equal(deleted.companion!.threads.length,0);assert.deepEqual(deleted.messages,[]);assert.doesNotMatch(JSON.stringify(deleted),/SECRET_CHAT_BODY|SECRET_DRAFT_BODY/);
  assert.deepEqual(deleted.events.filter(e=>e.action==='learning.exposure'),s.events.filter(e=>e.action==='learning.exposure'));
  assert.ok(deleted.companion!.requests.every(r=>r.status==='deleted'&&r.messageId===undefined));validateCompanionState(deleted);
  status(()=>send(deleted,id,'hint','SECRET_CHAT_BODY','hint-request'),410);
  status(()=>send(deleted,id,'hint','other body','hint-request'),409);
  assert.strictEqual(act(deleted,'chat.delete',input).state,deleted);
  const reopened=open(deleted).state;assert.equal(reopened.companion!.threads.length,1);assert.notEqual(reopened.companion!.threads[0].id,id);
  assert.equal(reopened.events.filter(e=>e.action==='learning.exposure').length,1);
});
test('bank conversation keeps its snapshot after content package rollback removes the current bank item',()=>{
  const s=base(),q={...structuredClone(s.questions[0]),id:'rollback-bank-question',familyId:'rollback-bank-family',text:'本机演示：把 840 枚邮票平均放进 12 本册子，每本多少枚？',answer:'70',steps:['ROLLBACK_SNAPSHOT_SOLUTION']};
  const exportState=base();exportState.questions=[q];const pack=exportContentPackage(exportState,{packageId:'companion-bank-pack',publisherId:'local',createdAt:NOW});
  let current=applyContentPackage(s,pack,previewContentPackage(s,pack),context).state;
  const opened=act(current,'chat.open',{context:{source:'bank',questionId:q.id,questionVersion:q.version}});current=opened.state;
  current=rollbackContentBatch(current,current.content!.batches[0].id,current.revision,{...context,reason:'恢复先前题库'}).state;
  assert.ok(!current.questions.some(x=>x.id===q.id));validateCompanionState(current);
  const result=send(current,opened.result!.id!,'explanation','').state;assert.match(result.messages.at(-1)!.text,/ROLLBACK_SNAPSHOT_SOLUTION/);
});
test('strict storage validation refuses hidden fields, changed snapshots, orphan messages and malformed tombstones',()=>{
  const opened=open(),s=send(opened.state,opened.result!.id!,'note','validated message','strict-request').state;
  const corruptions=[
    (x:WorkspaceState)=>{(x.companion as unknown as Record<string,unknown>).personality='invented'},
    (x:WorkspaceState)=>{x.companion!.threads[0].snapshot!.answer='forged'},
    (x:WorkspaceState)=>{x.companion!.threads[0].draft.revision=-1},
    (x:WorkspaceState)=>{x.messages[0].threadId='missing-thread'},
    (x:WorkspaceState)=>{x.messages[0].text='different payload'},
    (x:WorkspaceState)=>{x.companion!.requests[0].status='deleted'},
    (x:WorkspaceState)=>{(x.companion!.requests[0] as unknown as Record<string,unknown>).text='body in tombstone'},
    (x:WorkspaceState)=>{delete x.companion!.threads[0].snapshot},
  ];
  for(const corrupt of corruptions) {const copy=structuredClone(s);corrupt(copy);assert.throws(()=>validateCompanionState(copy));}
  validateCompanionState(base());assert.throws(()=>validateCompanionState(projectWorkspace(s,'student')));
});
test('an explicitly confirmed local help summary keeps safe context and survives conversation deletion',()=>{
  const opened=open(),id=opened.result!.id!,input={action:'help.create',threadId:id,topic:'想请大人看一下',summary:'只分享这一段已核对的摘要',requestId:'local-help-request'};
  let s=send(opened.state,id,'note','DO_NOT_SHARE_CONVERSATION').state;
  s=act(s,'chat.draft.save',{threadId:id,text:'DO_NOT_SHARE_DRAFT',intent:'note',expectedDraftRevision:0}).state;
  s=act(s,'memory.preference.set',{key:'presentation',value:'compact',sourceRevision:s.revision}).state;
  const result=applyAction(s,input,{...context,channel:'local'}),request=result.state.helpRequests[0];
  assert.equal(request.delivery,'local-only');assert.equal(request.requestId,'local-help-request');assert.equal(request.sourceThreadId,id);assert.deepEqual(request.context,s.companion!.threads[0].context);
  assert.doesNotMatch(JSON.stringify(request),/DO_NOT_SHARE|snapshot|preference|steps|alternative/);assert.match(String(result.result!.message),/尚未发送/);
  assert.strictEqual(applyAction(result.state,input,{...context,channel:'local'}).state,result.state);
  status(()=>applyAction(result.state,{...input,summary:'更换摘要'},context),409);
  status(()=>act(s,'help.create',{topic:'x',summary:'x',threadId:id,requestId:'cross-owner'},'other-user','owner'),404);
  assert.throws(()=>applyAction(s,{...input,delivery:'workspace',context:{source:'general'}},{...context,channel:'local'}),/字段/);
  const p=preview(result.state,id);assert.equal(p.retainedHelpRequestCount,1);
  const deleted=act(result.state,'chat.delete',{threadId:id,sourceRevision:p.sourceRevision,digest:p.digest,requestId:'delete-with-help'}).state;
  assert.deepEqual(deleted.helpRequests[0],request);assert.doesNotMatch(JSON.stringify(deleted),/DO_NOT_SHARE_CONVERSATION|DO_NOT_SHARE_DRAFT/);
  assert.strictEqual(applyAction(deleted,input,{...context,channel:'local'}).state,deleted);validateCompanionState(deleted);
  assert.deepEqual(projectWorkspace(deleted,'teacher').helpRequests,[]);
  status(()=>act(deleted,'help.receive',{id:request.id},'teacher-a','teacher'),403);
  const web=act(base(),'help.create',{topic:'已选择的主题',summary:'明确共享给教师',requestId:'web-help'}).state;
  assert.equal(web.helpRequests[0].delivery,'workspace');assert.equal(projectWorkspace(web,'teacher').helpRequests.length,1);
  const corrupt=structuredClone(deleted);corrupt.helpRequests[0].sourceThreadId='missing-thread';assert.throws(()=>validateCompanionState(corrupt));
});
