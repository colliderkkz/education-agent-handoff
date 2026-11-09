import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedWorkspace } from '../lib/seed.ts';
import { applyAction, DomainError } from '../lib/server/domain.ts';
import { ensureMastery, evaluateMastery } from '../lib/server/mastery.ts';
import { validateCompanionState } from '../lib/server/companion.ts';
import { validateEvidenceReviews } from '../lib/server/evidence.ts';
import { completeHistoryFileTask, validateHistoryDeletion } from '../lib/server/history.ts';
import { effectiveAttempt, effectiveEvidence, effectiveReviewSource, evidenceEpoch } from '../lib/effective-evidence.ts';
import { deletedEvidenceForAttempt, historyDeletedUpload, historyFileIdentity } from '../lib/history-deletion.ts';
import { projectWorkspace } from '../lib/server/access-policy.ts';
import type { EvidencePreview, HistoryDeletionPreview, Role, TaskType, WorkspaceState } from '../lib/types.ts';
const NOW = '2026-10-27T10:00:00.000Z', LATER = '2026-11-02T10:00:00.000Z'; let serial = 0;
const newId = () => `history-${++serial}`;
const act = (state: WorkspaceState, action: string, input: Record<string, unknown> = {}, role: Role = 'student', userId = 'learner', now = NOW) => applyAction(state, { action, ...input }, { now, newId, role, userId, displayName: userId, channel: 'local' });
function base() {
  const state = createSeedWorkspace('learner', '学习者', NOW); state.actor.role = 'student';
  state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = []; state.events = []; state.messages = []; state.helpRequests = []; state.uploads = [];
  const original = state.questions[0];
  state.questions = (['basic','application','transfer'] as TaskType[]).flatMap(taskType => Array.from({length:8}, (_,i) => ({...original,id:`q-${taskType}-${i}`,familyId:`family-${taskType}-${i}`,text:`${taskType}${i} ${original.text}`,taskType,contextId:`${taskType}-${i%3}`,difficulty:(taskType==='basic'?'基础':taskType==='application'?'巩固':'挑战') as typeof original.difficulty})));
  ensureMastery(state,{now:NOW,newId,fresh:true}); return state;
}
function submit(state = base(), count = 3, type: TaskType = 'basic', correct = true, now = NOW) {
  const made = act(state,'paper.create',{knowledgeIds:['division'],count,difficulty:type==='basic'?'基础':type==='application'?'巩固':'挑战'},'student','learner',now), paper = made.state.papers[0];
  return act(made.state,'attempt.submit',{paperId:paper.id,submissionKey:paper.id,answers:paper.questions.map((q,i)=>({questionId:q.id,value:correct?q.answer:`PRIVATE_ANSWER_${i}`,working:`PRIVATE_WORK_${i}`}))},'student','learner',now).state;
}
function preview(state: WorkspaceState, evidenceIds = [state.evidence[0].id], uploadIds: string[] = []) { return act(state,'history.delete.preview',{evidenceIds,uploadIds}).result!.preview as HistoryDeletionPreview; }
function remove(state: WorkspaceState, evidenceIds = [state.evidence[0].id], uploadIds: string[] = []) {
  const p=preview(state,evidenceIds,uploadIds), payload={...p.selection,sourceRevision:p.sourceRevision,digest:p.digest,requestId:newId()};
  return {...act(state,'history.delete.confirm',payload),payload,preview:p};
}
const status = (fn:()=>unknown, code:number) => assert.throws(fn,(e:unknown)=>e instanceof DomainError && e.status===code);

test('selected evidence is actually removed, report excludes its denominator, and held stars cannot retain it',()=>{
  const state=submit(), e=state.evidence[0], original=structuredClone(state), paper=state.papers[0]; assert.equal(state.knowledge[0].stars,3);
  const p=preview(state); assert.deepEqual(state,original); assert.equal(p.reports[0].remainingCount,2); assert.equal(p.knowledge.find(k=>k.knowledgeId==='division')!.afterStars,null);
  const result=remove(state), changed=result.state; assert.equal(changed.revision,state.revision+1);
  assert.deepEqual(changed.papers,original.papers); assert.equal(changed.evidence.some(v=>v.id===e.id),false);
  assert.deepEqual(changed.attempts[0].answers,original.attempts[0].answers.filter(a=>a.questionId!==e.questionId));
  const report=effectiveAttempt(changed,e.attemptId)!; assert.equal(report.deletedCount,1); assert.equal(report.retainedCount,2); assert.equal(report.correctCount,2); assert.equal(report.originalCorrectCount,null);
  assert.equal(deletedEvidenceForAttempt(changed,e.attemptId)[0].questionId,e.questionId); assert.equal(changed.knowledge[0].stars,null);
  assert.equal(evidenceEpoch(changed,'division'),changed.revision); assert.equal(act(changed,'mastery.reevaluate').state.knowledge[0].stars,null);
  assert.ok(changed.mastery!.assessments.every(a=>!a.adoptedEvidenceIds.includes(e.id)&&!a.excludedEvidence.some(v=>v.evidenceId===e.id)));
  assert.ok(changed.historyDeletion!.assessments.length>0); validateHistoryDeletion(JSON.parse(JSON.stringify(changed)));
  assert.strictEqual(act(changed,'attempt.submit',{paperId:paper.id,answers:original.attempts[0].answers,submissionKey:paper.id}).state,changed);
  status(()=>act(changed,'attempt.save',{paperId:paper.id,answers:original.attempts[0].answers}),409);
  assert.equal(effectiveEvidence(changed,0).some(v=>v.id===e.id),false,'as-of never recovers erased data');
});
test('same request retry precedes CAS; stale previews, conflicts, forged fields and other roles reject',()=>{
  const state=submit(), p=preview(state), snapshot=structuredClone(state), payload={...p.selection,sourceRevision:p.sourceRevision,digest:p.digest,requestId:'stable-delete'};
  const changed=act(state,'history.delete.confirm',payload).state; assert.deepEqual(state,snapshot);
  assert.strictEqual(act(changed,'history.delete.confirm',payload).state,changed);
  status(()=>act(changed,'history.delete.confirm',{...payload,uploadIds:['x']}),409);
  const newer=act(state,'profile.update',{profile:{name:'新名字'}}).state; status(()=>act(newer,'history.delete.confirm',payload),409);
  for(const role of ['parent','teacher','editor','reviewer'] as Role[]) status(()=>act(state,'history.delete.preview',{...p.selection},role),403);
  status(()=>act(state,'history.delete.confirm',{...payload,role:'owner'}),400);
  assert.equal(remove(state,state.evidence.map(e=>e.id)).state.attempts[0].answers.length,0);
});
test('own bound conversations, summaries, drafts, corrections and every answer copy are purged without deleting another persons private thread',()=>{
  let state=submit(base(),2,'basic',false); const e=state.evidence[0], kept=state.evidence[1];
  const open={source:'paper',paperId:e.paperId,questionId:e.questionId,questionVersion:e.questionVersion};
  let result=act(state,'chat.open',{context:open}); state=result.state; const threadId=result.result!.id!;
  state=act(state,'chat.send',{threadId,text:'PRIVATE_MESSAGE',intent:'note',requestId:'deleted-send'}).state;
  state=act(state,'chat.draft.save',{threadId,text:'PRIVATE_DRAFT',intent:'note',expectedDraftRevision:0}).state;
  state=act(state,'help.create',{threadId,topic:'PRIVATE_TOPIC',summary:'PRIVATE_SUMMARY',requestId:'deleted-help'}).state;
  state=act(state,'chat.open',{context:open},'owner','another-owner').state; const other=state.companion!.threads.find(t=>t.ownerId==='another-owner')!;
  state=act(state,'chat.send',{threadId:other.id,text:'OTHER_OWNER_TEXT',intent:'note',requestId:'other-message'},'owner','another-owner').state;
  const originalRequest={evidenceId:e.id,patch:{answer:'PRIVATE_CORRECTION'},reason:'PRIVATE_REASON',uploadIds:[],sourceRevision:state.revision,requestId:'deleted-proposal'};
  result=act(state,'evidence.propose',originalRequest); state=result.state; const proposalId=result.result!.id!;
  const p=act(state,'evidence.preview',{proposalId,outcome:'accept'}).result!.preview as EvidencePreview;
  state=act(state,'local.evidence.confirm',{proposalId,outcome:'accept',sourceRevision:p.sourceRevision,digest:p.digest,reason:'PRIVATE_DECISION',requestId:'deleted-decision'}).state;
  const deletedWork=state.attempts[0].answers.find(a=>a.questionId===e.questionId)!.working;
  state.events.push({id:newId(),action:'legacy.student.note',label:'old note',actorId:'learner',createdAt:NOW,detail:'PRIVATE_AUDIT'});
  result=remove(state,[e.id]); const changed=result.state, json=JSON.stringify(changed);
  for(const secret of ['PRIVATE_MESSAGE','PRIVATE_DRAFT','PRIVATE_TOPIC','PRIVATE_SUMMARY','PRIVATE_CORRECTION','PRIVATE_REASON','PRIVATE_DECISION','PRIVATE_AUDIT',e.answer,deletedWork]) assert.ok(!json.includes(secret),secret);
  assert.ok(json.includes('OTHER_OWNER_TEXT')); assert.ok(json.includes(kept.answer)); assert.equal(changed.companion!.threads.length,1);
  validateHistoryDeletion(changed); validateCompanionState(changed); validateEvidenceReviews(changed);
  status(()=>act(changed,'chat.send',{threadId,text:'PRIVATE_MESSAGE',intent:'note',requestId:'deleted-send'}),410);
  status(()=>act(changed,'help.create',{threadId,topic:'PRIVATE_TOPIC',summary:'PRIVATE_SUMMARY',requestId:'deleted-help'}),410);
  status(()=>act(changed,'evidence.propose',originalRequest),410); status(()=>act(changed,'chat.open',{context:open}),410);
});
test('paper returns lose only selected entries and online draft copies, while shared photo references prevent deletion',()=>{
  const state=submit(base(),2), paper=state.papers[0], attempt=state.attempts[0], e=state.evidence[0];
  state.uploads=[{id:'photo',name:'纸面.jpg',url:'file:///old/xiaohe-images/11111111-1111-1111-1111-111111111111.jpg',createdAt:NOW,status:'confirmed',purpose:'homework'}];
  state.paperReturns=[{id:'return',paperId:paper.id,paperVersion:paper.version,questionIds:[...paper.questionIds],revision:1,uploadIds:['photo'],entries:attempt.answers.map(a=>({questionId:a.questionId,value:a.value,working:a.working,claimedHelp:a.help,confirmed:true,unitConfirmed:true})),status:'submitted',createdAt:NOW,updatedAt:NOW,submittedAt:NOW,attemptId:attempt.id,submissionKey:attempt.submissionKey,onlineDraftSnapshot:{...structuredClone(attempt),status:'draft',correctCount:0,independentCount:0,answers:attempt.answers.map(a=>({...a,correct:null,working:'SNAPSHOT_'+a.questionId}))}}];
  const p=preview(state,[e.id],['photo']); assert.equal(p.photos[0].willDelete,false);
  let changed=remove(state,[e.id],['photo']).state; assert.equal(changed.uploads.length,1); assert.equal(changed.paperReturns![0].entries.length,1); assert.equal(changed.paperReturns![0].onlineDraftSnapshot!.answers.length,1);
  changed=remove(changed,changed.evidence.map(e=>e.id),['photo']).state; assert.equal(changed.uploads.length,0); assert.equal(changed.paperReturns![0].uploadIds.length,0);
  assert.equal(changed.paperReturns![0].questionIds.length,2); assert.equal(changed.paperReturns![0].entries.length,0);
  const task=changed.historyDeletion!.fileTasks[0]; assert.equal(task.status,'pending'); assert.equal(historyDeletedUpload(changed,'another-id','file:///new/xiaohe-images/11111111-1111-1111-1111-111111111111.jpg'),true);
  const complete=completeHistoryFileTask(changed,task.id,LATER); assert.equal(complete.state.revision,changed.revision+1); assert.equal(complete.state.historyDeletion!.fileTasks[0].uploadUrl,task.uploadUrl);
  assert.strictEqual(completeHistoryFileTask(complete.state,task.id,LATER).state,complete.state); validateHistoryDeletion(complete.state);
});
test('an unselected upload alias retains its file, selecting all aliases schedules durable idempotent cleanup',()=>{
  const state=submit(base(),1); const uri='file:///old/xiaohe-images/11111111-1111-1111-1111-111111111111.jpg';
  state.uploads=['a','b'].map(id=>({id,name:id+'.jpg',url:uri,createdAt:NOW,status:'pending',purpose:'homework'}));
  assert.equal(preview(state,[state.evidence[0].id],['a']).photos.find(p=>p.uploadId==='a')!.willDelete,false);
  const changed=remove(state,[state.evidence[0].id],['a','b']).state; assert.equal(changed.uploads.length,0); assert.equal(changed.historyDeletion!.fileTasks.length,2);
  assert.equal(historyFileIdentity(uri),historyFileIdentity(uri.replace('/old/','/new/'))); validateHistoryDeletion(changed);
});
test('deleting all source evidence invalidates spaced-transfer qualification without cascading later work',()=>{
  let state=submit(); state=submit(state,3,'application'); const source=state.attempts[0], plan=state.mastery!.reviewPlans.find(p=>p.sourceAttemptId===source.id)!;
  const start=act(state,'review.start',{planId:plan.id,count:2},'student','learner',LATER), paper=start.state.papers[0];
  state=act(start.state,'attempt.submit',{paperId:paper.id,submissionKey:paper.id,answers:paper.questions.map(q=>({questionId:q.id,value:q.answer,working:'KEEP_REVIEW_WORK'}))},'student','learner',LATER).state;
  assert.equal(state.knowledge[0].stars,5); const downstream=structuredClone(state.attempts.find(a=>a.paperId===paper.id));
  const selected=state.evidence.filter(e=>e.attemptId===source.id).map(e=>e.id), changed=remove(state,selected).state;
  assert.deepEqual(changed.attempts.find(a=>a.paperId===paper.id),downstream); assert.equal(effectiveReviewSource(changed,changed.mastery!.reviewPlans.find(p=>p.id===plan.id)!).valid,false);
  assert.notEqual(changed.knowledge[0].stars,5); assert.equal(evaluateMastery(changed,'division',changed.mastery!.rules[0],LATER).conditions.find(c=>c.key==='transfer')!.actual,0);
  assert.ok(changed.mastery!.reviewPlans.find(p=>p.id===plan.id)!.sourceHistoryDeletionId); validateHistoryDeletion(changed);
});
test('projections give all learning readers the same missing slots and epoch without private file or request metadata',()=>{
  let state=submit(base(),1); state.uploads=[{id:'private-photo',name:'PRIVATE_FILENAME.jpg',url:'file:///private.jpg',createdAt:NOW,status:'pending',purpose:'homework'}]; state=remove(state,undefined,['private-photo']).state;
  for(const role of ['student','owner','parent','teacher'] as const) { const view=projectWorkspace(state,role); assert.equal(effectiveAttempt(view,state.attempts[0].id)!.deletedCount,1); assert.equal(evidenceEpoch(view,'division'),state.revision); if(role==='teacher'||role==='parent') { assert.ok(!JSON.stringify(view).includes('file:///private.jpg')); assert.deepEqual(view.historyDeletion!.requests,[]); } }
  for(const role of ['editor','reviewer'] as const) assert.equal(projectWorkspace(state,role).historyDeletion,undefined);
});
test('strict deletion validation rejects resurrected content, broken references and disguised payload fields',()=>{
  const initial=submit(base(),1), e=initial.evidence[0], changed=remove(initial).state;
  for(const mutate of [(s:WorkspaceState)=>{s.evidence.push(e);}, (s:WorkspaceState)=>{s.attempts[0].answers.push(initial.attempts[0].answers[0]);}, (s:WorkspaceState)=>{s.historyDeletion!.evidence[0].operationId='missing';}, (s:WorkspaceState)=>{s.historyDeletion!.operations[0].appliedRevision=s.revision+1;}, (s:WorkspaceState)=>{s.historyDeletion!.qualificationFacts=[];}, (s:WorkspaceState)=>{Object.assign(s.historyDeletion!.evidence[0],{answer:'HIDDEN_BODY'});}]) { const corrupt=structuredClone(changed); mutate(corrupt); assert.throws(()=>validateHistoryDeletion(corrupt),DomainError); }
});
test('deleting a corrected knowledge chain redacts both grade histories, records its plan provenance, and retains strongest known help',()=>{
  let state=submit(base(),1); const e=state.evidence[0];
  const requested=act(state,'evidence.propose',{evidenceId:e.id,patch:{knowledgeId:'geometry',help:'hint'},reason:'PRIVATE_MAPPING',uploadIds:[],sourceRevision:state.revision,requestId:'moved-proposal'}); state=requested.state;
  const proposalId=requested.result!.id!, p=act(state,'evidence.preview',{proposalId,outcome:'accept'}).result!.preview as EvidencePreview;
  state=act(state,'local.evidence.confirm',{proposalId,outcome:'accept',sourceRevision:p.sourceRevision,digest:p.digest,reason:'PRIVATE_MAPPING_CONFIRMED',requestId:'moved-decision'}).state;
  const oldRevision=state.revision, moved=state.mastery!.reviewPlans.find(p=>p.knowledgeId==='geometry')!, oldDue=moved.dueAt;
  state=remove(state,[e.id]).state;
  assert.equal(state.historyDeletion!.qualificationFacts[0].help,'hint'); assert.equal(evidenceEpoch(state,'division'),state.revision); assert.equal(evidenceEpoch(state,'geometry'),state.revision);
  assert.equal(state.mastery!.reviewPlans.find(p=>p.id===moved.id)!.sourceRevision,oldRevision); assert.equal(state.mastery!.reviewPlans.find(p=>p.id===moved.id)!.dueAt,oldDue);
  assert.ok(state.mastery!.reviewPlans.find(p=>p.id===moved.id)!.sourceHistoryDeletionId); assert.equal(effectiveReviewSource(state,moved).valid,false);
  assert.ok(!JSON.stringify(state).includes('PRIVATE_MAPPING')); validateHistoryDeletion(state);
});
test('pre-mastery legacy dossiers delete selected records without creating score snapshots that retain deleted IDs',()=>{
  const state=createSeedWorkspace('learner','学习者',NOW); state.actor.role='student'; assert.equal(state.mastery,undefined);
  const selected=state.evidence.map(e=>e.id), changed=remove(state,selected).state;
  assert.equal(changed.evidence.length,0); assert.ok(changed.mastery!.assessments.every(a=>a.adoptedEvidenceIds.length===0));
  validateHistoryDeletion(changed); assert.ok(changed.knowledge.every(k=>k.stars===null));
});
test('exposure retention reconstructs only whitelisted facts and cannot retain a hidden deleted body',()=>{
  const state=submit(base(),1), e=state.evidence[0]; state.events.push({id:newId(),action:'learning.exposure',label:'曝光',actorId:'learner',createdAt:NOW,detail:JSON.stringify({familyIds:[e.familyId],level:'hint',ruleVersion:'trial',text:'DELETED_EXPOSURE_BODY'})});
  state.events.push({id:newId(),action:'learning.exposure',label:'旧坏记录',actorId:'learner',createdAt:NOW,detail:'DELETED_MALFORMED_BODY'});
  const changed=remove(state).state, serialized=JSON.stringify(changed); assert.ok(!serialized.includes('DELETED_EXPOSURE_BODY')); assert.ok(!serialized.includes('DELETED_MALFORMED_BODY'));
  assert.equal(changed.events.filter(e=>e.action==='learning.exposure').length,1);
  const damaged=structuredClone(changed); damaged.attempts[0].correctCount=1; assert.throws(()=>validateHistoryDeletion(damaged),/统计/);
});
test('deleted review provenance remains exactly bound across multiple deletions and rejects later or earlier source revisions',()=>{
  let state=submit(base(),3); const source=state.evidence[0];
  const request=act(state,'evidence.propose',{evidenceId:source.id,patch:{knowledgeId:'geometry'},reason:'mapping',uploadIds:[],sourceRevision:state.revision,requestId:'source-snapshot-proposal'});
  const p=act(request.state,'evidence.preview',{proposalId:request.result!.id,outcome:'accept'}).result!.preview as EvidencePreview;
  state=act(request.state,'local.evidence.confirm',{proposalId:request.result!.id,outcome:'accept',sourceRevision:p.sourceRevision,digest:p.digest,reason:'confirm',requestId:'source-snapshot-decision'}).state;
  const original=structuredClone(state.mastery!.reviewPlans.find(p=>p.knowledgeId==='geometry')!);
  state=remove(state,[source.id]).state;
  const first=state.mastery!.reviewPlans.find(p=>p.id===original.id)!;
  assert.deepEqual(state.historyDeletion!.operations[0].reviewPlanSources.find(p=>p.planId===first.id),{planId:first.id,sourceRevision:original.sourceRevision,createdAt:original.createdAt});
  state=act(state,'profile.update',{profile:{name:'after deletion'}}).state;
  for(const sourceRevision of [state.revision,original.sourceRevision!-1,undefined]) { const corrupt=structuredClone(state); corrupt.mastery!.reviewPlans.find(p=>p.id===original.id)!.sourceRevision=sourceRevision; assert.throws(()=>validateHistoryDeletion(corrupt),/历史快照/); }
  const changedDate=structuredClone(state); changedDate.mastery!.reviewPlans.find(p=>p.id===original.id)!.createdAt=LATER; assert.throws(()=>validateHistoryDeletion(changedDate),/历史快照/);
  state=remove(state,state.evidence.map(e=>e.id)).state; validateHistoryDeletion(state);
  assert.equal(state.mastery!.reviewPlans.find(p=>p.id===original.id)!.sourceRevision,original.sourceRevision);
  const badSnapshot=structuredClone(state), op=badSnapshot.historyDeletion!.operations[0]; op.reviewPlanSources[0].sourceRevision=op.appliedRevision; assert.throws(()=>validateHistoryDeletion(badSnapshot),/不能晚于/);
});
