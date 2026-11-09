import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedWorkspace } from '../lib/seed.ts';
import { applyAction, DomainError } from '../lib/server/domain.ts';
import { projectWorkspace } from '../lib/server/access-policy.ts';
import { questionContentDigest, recordQuestionVersion } from '../lib/server/content.ts';
import { recognitionHistoryRevision, validateRecognition } from '../lib/server/recognition.ts';
import { validateHistoryDeletion } from '../lib/server/history.ts';
import { effectiveAttempt } from '../lib/effective-evidence.ts';
import type { HistoryDeletionPreview, RecognitionEntry, RecognitionMatch, Role, WorkspaceState } from '../lib/types.ts';

const NOW = '2026-10-28T08:00:00.000Z'; let serial = 0;
const newId = () => `ocr-${++serial}`;
const status = (fn: () => unknown, code: number) => assert.throws(fn, (e: unknown) => e instanceof DomainError && e.status === code);
function act(state: WorkspaceState, action: string, input: Record<string, unknown>, role: Role = 'student', userId = 'learner', local = true) {
  return applyAction(state, { action, ...input }, { userId, displayName: userId, role, now: NOW, newId, ...(local ? {channel:'local' as const} : {}) });
}
function base() {
  const state = createSeedWorkspace('learner', '学习者', NOW); state.actor.role = 'student';
  state.papers = []; state.attempts = []; state.evidence = []; state.mistakes = []; state.events = []; state.messages = []; state.helpRequests = [];
  state.uploads = [{ id:'photo', name:'本机原图.jpg', url:'file:///documents/xiaohe-images/photo.jpg', createdAt:NOW, status:'pending', purpose:'homework' }];
  return state;
}
const line = (id = 'line-1', text = 'PRIVATE_RAW 原题 24÷4=6') => ({id,text,confidence:null,box:{x:0.05,y:0.1,width:0.8,height:0.1}});
function opened(state = base()) { return act(state, 'recognition.open', {uploadId:'photo',imageDigest:'a'.repeat(64),historyRevision:recognitionHistoryRevision(state),requestId:newId()}).state; }
function runPayload(state: WorkspaceState, overrides: Record<string,unknown> = {}) {
  const c=state.recognition!.captures[0]; return {captureId:c.id,expectedRevision:c.revision,historyRevision:recognitionHistoryRevision(state),runId:newId(),imageDigest:c.imageDigest,engine:'mlkit-chinese',platform:'android',engineVersion:'16.0.1',width:1600,height:2000,lines:[line(),line('line-2','PRIVATE_UNASSIGNED 第二题')],requestId:newId(),...overrides};
}
function scanned(state = opened()) { return act(state, 'recognition.run.save', runPayload(state)).state; }
function entryPayload(state: WorkspaceState, entryId = newId(), index = 0, overrides: Record<string,unknown> = {}) {
  const c = state.recognition!.captures[0], q = state.questions[index], existing=state.recognition!.entries.find(e=>e.id===entryId);
  return {captureId:c.id,expectedRevision:c.revision,entryId,runId:state.recognition!.runs[0].id,sourceLineIds:['line-1'],originalNumber:String(index+1),stem:q.text,answer:q.answer,working:'PRIVATE_WORK',candidate:{questionId:q.id,questionVersion:q.version,contentDigest:questionContentDigest(q)},checked:{stem:false,answer:false,match:false,unit:false},requestId:newId(),...(existing ? body(existing) : {}),...overrides};
}
function body(e: RecognitionEntry) { return {entryId:e.id,runId:e.runId,sourceLineIds:e.sourceLineIds,originalNumber:e.originalNumber,stem:e.stem,answer:e.answer,working:e.working,candidate:e.candidate,checked:e.checked}; }
function addEntry(state: WorkspaceState, index = 0, overrides: Record<string,unknown> = {}) { const p=entryPayload(state,newId(),index,overrides); return {state:act(state,'recognition.entry.save',p).state,id:p.entryId as string}; }
function checkEntry(state: WorkspaceState, id: string) { return act(state,'recognition.entry.save',entryPayload(state,id,0,{checked:{stem:true,answer:true,match:true,unit:true}})).state; }
function submit(state: WorkspaceState, entryIds = state.recognition!.entries.filter(e=>e.status==='draft').map(e=>e.id), requestId = newId()) { const c=state.recognition!.captures[0],payload={captureId:c.id,expectedRevision:c.revision,entryIds,requestId}; return {...act(state,'recognition.submit',payload),payload}; }
function ready(count = 1) { let state=scanned(); const ids:string[]=[]; for(let i=0;i<count;i++){const entry=addEntry(state,i);state=checkEntry(entry.state,entry.id);ids.push(entry.id);} return {state,ids}; }
function remove(state: WorkspaceState, evidenceIds: string[], uploadIds:string[]=[]){ const p=act(state,'history.delete.preview',{evidenceIds,uploadIds}).result!.preview as HistoryDeletionPreview; const payload={evidenceIds,uploadIds,sourceRevision:p.sourceRevision,digest:p.digest,requestId:newId()}; return {...act(state,'history.delete.confirm',payload),preview:p}; }

test('recognition is local-only, owner/student-only, and never accepts a client role/channel override',()=>{
  const state=base(), input={uploadId:'photo',imageDigest:'a'.repeat(64),historyRevision:0,requestId:'scan'};
  for(const role of ['owner','student'] as Role[]) { status(()=>act(state,'recognition.open',input,role,'learner',false),403); assert.ok(act(state,'recognition.open',input,role).state.recognition); }
  for(const role of ['teacher','parent','editor','reviewer'] as Role[]) status(()=>act(state,'recognition.open',input,role),403);
  status(()=>act(state,'recognition.open',{...input,channel:'local'}),400);
  status(()=>act(state,'recognition.open',{...input,role:'owner'}),400);
  status(()=>act(state,'recognition.fake',{}),403);
});
test('raw lines preserve order and real/null confidence; malformed provenance, boxes and extra copies reject',()=>{
  const state=opened(), before=structuredClone(state), p=runPayload(state), saved=act(state,'recognition.run.save',p).state;
  assert.deepEqual(state,before);assert.deepEqual(saved.recognition!.runs[0].lines,p.lines);assert.equal(saved.evidence.length,0);
  for(const bad of [{engine:'cloud-ocr'}, {platform:'ios'}, {imageDigest:'b'.repeat(64)}, {width:0}, {lines:[{...line(),confidence:0.9}]}, {lines:[line(),line()]}, {lines:[{...line(),fullText:'hidden'}]}, {lines:[{...line(),box:{x:.9,y:0,width:.2,height:.1}}]}, {lines:[{...line(),confidence:NaN}]}, {fullText:'hidden'}, {nativeResult:{text:'hidden'}}]) assert.throws(()=>act(state,'recognition.run.save',{...p,...bad}),DomainError);
  const vision=act(state,'recognition.run.save',{...p,engine:'apple-vision',platform:'ios',lines:[{...line(),confidence:.812}]}).state;
  assert.equal(vision.recognition!.runs[0].lines[0].confidence,.812);
  status(()=>act(saved,'recognition.run.save',{...p,expectedRevision:1,requestId:newId()}),409);
  assert.strictEqual(act(saved,'recognition.run.save',p).state,saved);
});
test('all native line and text limits reject rather than silently truncate; empty OCR can retain a manual draft',()=>{
  const state=opened();
  for(const ls of [Array.from({length:301},(_,i)=>line(`l-${i}`)),[line('long','x'.repeat(2001))],Array.from({length:16},(_,i)=>line(`l-${i}`,'x'.repeat(2000)))]) status(()=>act(state,'recognition.run.save',runPayload(state,{lines:ls})),400);
  const zero=act(state,'recognition.run.save',runPayload(state,{lines:[]})).state;
  const draft=addEntry(zero,0,{sourceLineIds:[],stem:'人工核对尚不清楚',answer:'',candidate:null}).state;
  assert.equal(draft.recognition!.runs[0].lines.length,0);assert.equal(draft.recognition!.entries[0].status,'draft');assert.equal(draft.evidence.length,0);
});
test('candidate search is read-only safe metadata with strict version digest and no automatic answer/identity conclusion',()=>{
  const state=scanned(), c=state.recognition!.captures[0], before=structuredClone(state);
  const result=act(state,'recognition.match',{captureId:c.id,text:state.questions[0].text});
  assert.strictEqual(result.state,state);assert.deepEqual(state,before);
  const candidates=result.result!.candidates as RecognitionMatch[]; assert.ok(candidates.length);
  for(const q of candidates){assert.deepEqual(Object.keys(q).sort(),['contentDigest','knowledgeId','questionId','questionVersion','text','unit']);assert.equal(q.contentDigest,questionContentDigest(state.questions.find(v=>v.id===q.questionId)!));}
  assert.equal(act(state,'recognition.match',{captureId:c.id,text:'zzzzzzzz'}).result!.candidates instanceof Array,true);
  status(()=>act(state,'recognition.match',{captureId:c.id,text:'题'},'owner','other'),404);
});
test('first save and every body, line or candidate change resets all checks; incomplete rows never become wrong answers',()=>{
  const state=scanned(), first=addEntry(state,0,{checked:{stem:true,answer:true,match:true,unit:true}});
  assert.ok(Object.values(first.state.recognition!.entries[0].checked).every(v=>!v));status(()=>submit(first.state),409);
  const checked=checkEntry(first.state,first.id);
  for(const change of [{stem:'修改题干'},{answer:'7'},{working:'修改过程'},{originalNumber:'三'},{sourceLineIds:['line-2']},{candidate:null}]){
    const result=act(checked,'recognition.entry.save',entryPayload(checked,first.id,0,change)).state;
    assert.ok(Object.values(result.recognition!.entries[0].checked).every(v=>!v));status(()=>submit(result),409);
  }
  const originalLines=structuredClone(checked.recognition!.runs);const edited=act(checked,'recognition.entry.save',entryPayload(checked,first.id,0,{answer:'人工改字'})).state;
  assert.deepEqual(edited.recognition!.runs,originalLines); assert.equal(edited.evidence.length,0);
  status(()=>act(checked,'recognition.entry.save',entryPayload(checked,first.id,0,{sourceLineIds:['not-this-image']})),400);
});
test('entry CAS and request retry preserve a newer edit without overwriting it',()=>{
  const state=scanned(), p=entryPayload(state), saved=act(state,'recognition.entry.save',p).state;
  assert.strictEqual(act(saved,'recognition.entry.save',p).state,saved);
  status(()=>act(saved,'recognition.entry.save',{...p,requestId:newId()}),409);
  status(()=>act(saved,'recognition.entry.save',{...p,answer:'changed'}),409);
  const newer=act(saved,'recognition.entry.save',entryPayload(saved,p.entryId,0,{answer:'newer'})).state;
  assert.strictEqual(act(newer,'recognition.entry.save',p).state,newer);assert.equal(newer.recognition!.entries[0].answer,'newer');
});
test('candidate selected after bank change rejects old digest; an already frozen snapshot submits its actual older version',()=>{
  const scannedState=scanned(), p=entryPayload(scannedState), old=scannedState.questions[0];
  const saved=act(scannedState,'recognition.entry.save',p).state;
  const newer=structuredClone(saved);newer.questions[0]={...old,version:old.version+1,text:'新版题干',answer:'777'};recordQuestionVersion(newer,newer.questions[0]);
  const checked=checkEntry(newer,p.entryId), done=submit(checked).state;
  const visible=projectWorkspace(newer,'student').recognition!.entries[0];
  assert.deepEqual(visible.candidateSummary,{questionId:old.id,questionVersion:old.version,text:old.text,unit:old.unit});
  assert.equal(visible.snapshot,undefined);assert.ok(!JSON.stringify(visible.candidateSummary).includes('777'));
  assert.equal(done.papers[0].questions[0].version,old.version);assert.equal(done.papers[0].questions[0].text,old.text);assert.equal(done.evidence[0].expected,old.answer);
  const stale=structuredClone(scannedState);stale.questions[0]=newer.questions[0];recordQuestionVersion(stale,stale.questions[0]);
  status(()=>act(stale,'recognition.entry.save',p),409);
});
test('partial one-image submission creates original evidence only for chosen checked rows; retries do not duplicate reports',()=>{
  const r=ready(2), unmatched=addEntry(r.state,2,{candidate:null,stem:'未匹配的题目',answer:''}), first=submit(unmatched.state,[r.ids[1]],'first-submit');
  assert.equal(first.state.papers.length,1);assert.deepEqual(first.state.papers[0].questionIds,[r.state.questions[1].id]);assert.equal(first.state.evidence.length,1);
  assert.equal(first.state.recognition!.entries.find(e=>e.id===unmatched.id)!.status,'draft');
  const proof=first.state.evidence[0];assert.equal(proof.kind,'original');assert.equal(proof.provenance,'paper');assert.equal(proof.help,'unknown');assert.equal(proof.eligible,false);assert.equal(first.state.attempts[0].independentCount,0);
  assert.strictEqual(act(first.state,'recognition.submit',first.payload).state,first.state);
  const second=submit(first.state,[r.ids[0]]).state;assert.equal(second.evidence.length,2);assert.equal(second.papers.length,2);
  assert.ok(second.recognition!.entries.filter(e=>e.status==='submitted').every(e=>second.evidence.some(v=>v.id===e.evidenceId&&v.paperId===e.paperId&&v.attemptId===e.attemptId)));
  status(()=>submit(second,[r.ids[0]]),409);assert.equal(second.recognition!.entries.find(e=>e.id===unmatched.id)!.status,'draft');validateRecognition(second);
});
test('one report preserves selected entry order and rejects duplicate question slots',()=>{
  const r=ready(2), done=submit(r.state,[r.ids[1],r.ids[0]]).state;
  assert.deepEqual(done.papers[0].questionIds,[r.state.questions[1].id,r.state.questions[0].id]);
  const extra=addEntry(r.state,0), checked=checkEntry(extra.state,extra.id);status(()=>submit(checked,[r.ids[0],extra.id]),409);
});
test('projection hides raw snapshots, other actors OCR and all teacher/parent/editor OCR text',()=>{
  const {state}=ready(), original=structuredClone(state), visible=projectWorkspace(state,'student');
  assert.equal(visible.recognition!.entries[0].snapshot,undefined);assert.ok(visible.recognition!.runs[0].lines.length);assert.equal(visible.questions[0].answer,'');
  assert.deepEqual(Object.keys(visible.recognition!.entries[0].candidateSummary!).sort(),['questionId','questionVersion','text','unit']);
  const invalid=structuredClone(state);invalid.recognition!.entries[0].candidateSummary=visible.recognition!.entries[0].candidateSummary;assert.throws(()=>validateRecognition(invalid),DomainError);
  for(const role of ['teacher','parent','editor','reviewer'] as Role[]) assert.equal(projectWorkspace(state,role).recognition,undefined);
  const other={...state,actor:{id:'another-owner',name:'other',role:'owner' as const}};assert.equal(projectWorkspace(other,'owner').recognition!.captures.length,0);assert.ok(projectWorkspace(other,'owner').events.every(e=>!e.action.startsWith('recognition.')));
  assert.equal(projectWorkspace(state,'owner').recognition!.entries[0].snapshot,undefined);assert.deepEqual(state,original);
});
test('history deletion clears every same-image raw run and draft but preserves other submitted manual answers and their photo reference',()=>{
  const r=ready(2), extra=addEntry(r.state,2,{stem:'PRIVATE_DRAFT',answer:'PRIVATE_DRAFT_ANSWER',candidate:null}), run2=act(extra.state,'recognition.run.save',runPayload(extra.state,{lines:[line('old-copy','PRIVATE_RAW_OLD_COPY')]})).state;
  const done=submit(run2,r.ids).state, kept=done.recognition!.entries.find(e=>e.id===r.ids[1])!, keptCopy=structuredClone(kept), deleted=done.recognition!.entries.find(e=>e.id===r.ids[0])!;
  const result=remove(done,[deleted.evidenceId!],['photo']), changed=result.state;
  assert.equal(result.preview.recognition!.runCount,2);assert.deepEqual(result.preview.recognition!.draftIds,[extra.id]);assert.match(result.preview.warnings.join(' '),/机器识别文字/);
  assert.equal(result.preview.photos[0].willDelete,false);assert.equal(changed.uploads.length,1);
  assert.ok(changed.recognition!.runs.every(r=>r.lines.length===0&&r.redactedAt));
  const erased=changed.recognition!.entries.find(e=>e.id===deleted.id)!;assert.equal(erased.status,'redacted');assert.equal(erased.answer,'');assert.equal(erased.snapshot,undefined);assert.equal(erased.candidate,null);
  assert.deepEqual(changed.recognition!.entries.find(e=>e.id===kept.id),keptCopy);
  assert.equal(changed.recognition!.entries.find(e=>e.id===extra.id)!.stem,'');
  assert.ok(!JSON.stringify(changed).includes('PRIVATE_RAW'));assert.ok(!JSON.stringify(changed).includes('PRIVATE_DRAFT'));
  assert.equal(effectiveAttempt(changed,deleted.attemptId!)!.retainedCount,1);validateHistoryDeletion(changed);validateRecognition(changed);
  const all=remove(changed,[kept.evidenceId!],['photo']);assert.equal(all.state.uploads.length,0);assert.equal(all.state.historyDeletion!.fileTasks.length,1);validateRecognition(all.state);
});
test('redacted capture rejects late callback, old request replay, new entry, submit and copied-image re-open',()=>{
  const r=ready(), pendingRun=runPayload(r.state), done=submit(r.state), c=done.state.recognition!.captures[0], removed=remove(done.state,[done.state.evidence[0].id]).state;
  status(()=>act(removed,'recognition.run.save',pendingRun),410);status(()=>act(removed,'recognition.submit',done.payload),410);
  status(()=>act(removed,'recognition.entry.save',entryPayload(removed,newId())),410);
  status(()=>act(removed,'recognition.open',{uploadId:'photo',imageDigest:c.imageDigest,historyRevision:recognitionHistoryRevision(removed),requestId:newId()}),410);
  const copied=structuredClone(removed);copied.uploads.push({...copied.uploads[0],id:'copy',url:'file:///documents/xiaohe-images/copy.jpg',status:'pending'});
  status(()=>act(copied,'recognition.open',{uploadId:'copy',imageDigest:c.imageDigest,historyRevision:recognitionHistoryRevision(copied),requestId:newId()}),410);
  const bad=structuredClone(removed);bad.recognition!.runs[0].lines=[line()];assert.throws(()=>validateRecognition(bad),DomainError);
  const badDraft=structuredClone(removed);badDraft.recognition!.entries[0].working='resurrect';assert.throws(()=>validateHistoryDeletion(badDraft),DomainError);
});
test('open and run results cannot cross an unrelated committed history deletion',()=>{
  const r=ready(), done=submit(r.state).state;
  done.uploads.push({id:'other-photo',name:'另图',url:'file:///documents/xiaohe-images/other.jpg',createdAt:NOW,status:'pending',purpose:'homework'});
  const c=act(done,'recognition.open',{uploadId:'other-photo',imageDigest:'b'.repeat(64),historyRevision:0,requestId:newId()}).state;
  const other=c.recognition!.captures.find(v=>v.uploadId==='other-photo')!, deleted=remove(c,[c.evidence[0].id]).state;
  status(()=>act(deleted,'recognition.run.save',{...runPayload(c),captureId:other.id,expectedRevision:other.revision,imageDigest:other.imageDigest}),409);
  deleted.uploads.push({id:'third-photo',name:'第三图',url:'file:///documents/xiaohe-images/third.jpg',createdAt:NOW,status:'pending',purpose:'homework'});
  status(()=>act(deleted,'recognition.open',{uploadId:'third-photo',imageDigest:'c'.repeat(64),historyRevision:0,requestId:newId()}),409);
});
test('explicitly deleting an unassigned scanned photo clears raw text and discloses it even without a submitted OCR entry',()=>{
  let state=scanned();state=act(state,'paper.create',{knowledgeIds:['division'],count:1}).state;
  const paper=state.papers[0];state=act(state,'attempt.submit',{paperId:paper.id,answers:paper.questions.map(q=>({questionId:q.id,value:q.answer,working:''}))}).state;
  const removed=remove(state,[state.evidence[0].id],['photo']);
  assert.equal(removed.preview.photos[0].willDelete,true);assert.equal(removed.preview.recognition!.runCount,1);assert.match(removed.preview.warnings.join(' '),/1 次机器识别文字/);
  assert.equal(removed.state.uploads.length,0);assert.deepEqual(removed.state.recognition!.runs[0].lines,[]);assert.ok(removed.state.recognition!.captures[0].redactedAt);
  validateHistoryDeletion(removed.state);
});
test('legacy homework and paper return cannot bind a photo already owned by recognition, including aliases',()=>{
  const state=scanned();state.uploads.push({...state.uploads[0],id:'alias'});
  for(const uploadId of ['photo','alias']) status(()=>act(state,'homework.confirm',{uploadId,entries:[{questionId:state.questions[0].id,answer:'6'}]}),409);
  const paper=act(state,'paper.create',{knowledgeIds:['division'],count:1}).state, p=paper.papers[0];
  status(()=>act(paper,'paper.return.save',{paperId:p.id,paperVersion:p.version,questionIds:p.questionIds,uploadIds:['alias'],entries:p.questionIds.map(questionId=>({questionId,value:'6',working:'',claimedHelp:'unknown',confirmed:false,unitConfirmed:false})),expectedRevision:0}),409);
});
test('raw validation rejects forged grading pointers, private snapshot extras and resurrection requests',()=>{
  const r=ready(), done=submit(r.state).state;
  for(const mutate of [(s:WorkspaceState)=>{s.recognition!.entries[0].answer='forged';},(s:WorkspaceState)=>{s.recognition!.entries[0].candidate!.contentDigest='f'.repeat(64);},(s:WorkspaceState)=>{Object.assign(s.recognition!.entries[0].snapshot!,{privateText:'leak'});},(s:WorkspaceState)=>{s.recognition!.entries[0].evidenceId='missing';},(s:WorkspaceState)=>{s.recognition!.requests[0].status='deleted';}]){const bad=structuredClone(done);mutate(bad);assert.throws(()=>validateRecognition(bad),DomainError);}
});
test('unknown-result retry receipts must resolve to the correct result type within the same capture',()=>{
  const r=ready(), done=submit(r.state).state;
  for(const action of ['recognition.open','recognition.run.save','recognition.entry.save','recognition.submit']) {
    for(const resultId of ['missing',done.questions[0].id]) {
      const bad=structuredClone(done), receipt=bad.recognition!.requests.find(r=>r.action===action)!;receipt.resultId=resultId;
      assert.throws(()=>validateRecognition(bad),DomainError);
    }
  }
  const unrelated=act(done,'paper.create',{knowledgeIds:['division'],count:1}).state;
  unrelated.recognition!.requests.find(r=>r.action==='recognition.submit')!.resultId=unrelated.papers[0].id;
  assert.throws(()=>validateRecognition(unrelated),DomainError);
  const erased=remove(done,[done.evidence[0].id],['photo']).state;validateRecognition(erased);
});
