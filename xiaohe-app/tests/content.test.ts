import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSeedWorkspace} from '../lib/seed.ts';
import {applyAction} from '../lib/server/domain.ts';
import {projectWorkspace} from '../lib/server/access-policy.ts';
import {applyContentPackage, canonicalStringify, ensureContent, exportContentPackage, MAX_CONTENT_PACKAGE_BYTES, parseContentPackage, previewContentPackage, questionContentDigest, recordQuestionVersion, rollbackContentBatch, sha256, validateContentState} from '../lib/server/content.ts';
import type {ContentPackage, Question, WorkspaceState} from '../lib/types.ts';
const NOW='2026-10-26T08:00:00.000Z'; let serial=0;
const ctx=(reason?:string)=>({now:NOW,newId:()=>`content-${++serial}`,userId:'local-content-test',reason});
const act=(s:WorkspaceState,action:string,input:Record<string,unknown>={},role:'owner'|'student'|'editor'|'reviewer'='owner',userId='author')=>applyAction(s,{action,...input},{...ctx(),role,userId,displayName:userId});
function base() {const s=createSeedWorkspace('local-content-test','内容测试',NOW); s.papers=[];s.attempts=[];s.evidence=[];s.mistakes=[];s.events=[];return s;}
function newQuestion(id='new-content-q'):Question {return {...structuredClone(base().questions[0]),id,familyId:`${id}-family`,version:1,text:`${id}：园艺社把总计 756 颗种子分装后，留 12 袋作展品，其余 24 袋送给同学。每袋相同，平均有多少颗种子？`,answer:'21',hint:'先求所有袋数。',steps:['756 ÷ (12 + 24) = 21。'],sourceScope:'四年级数学本地试用',reviewNote:'机器样例校核，尚未人工验证'};}
function pack(qs:Question[],id=`pack-${++serial}`,withdrawals:string[]=[], bank=qs):ContentPackage {const s=base();s.questions=bank;return exportContentPackage(s,{packageId:id,publisherId:'local-trial',createdAt:NOW,questionIds:qs.map(q=>q.id),withdrawals});}
function apply(s:WorkspaceState,p:ContentPackage) {return applyContentPackage(s,p,previewContentPackage(s,p),ctx()).state;}
function signedAgain(p:ContentPackage):ContentPackage {return {...p,digest:sha256(canonicalStringify({...p,digest:undefined}))};}

test('portable SHA256 matches standard vectors, UTF8, surrogate replacement and long input',()=>{
  for(const text of ['', 'abc','小禾学伴🌱','\ud800','z'.repeat(10000)]) assert.equal(sha256(text),createHash('sha256').update(text).digest('hex'));
  assert.equal(canonicalStringify({z:1,a:{y:2,x:3}}),' {"a":{"x":3,"y":2},"z":1}'.trim());
});
test('strict unsigned trial package rejects private fields, unknown schema, altered digest, incomplete annotation and oversized files',()=>{
  const p=pack([newQuestion()]);
  for(const extra of [{profile:{}},{mastery:{}},{papers:[]},{schemaVersion:2},{trust:'signed'},{teachingValidation:'validated'}]) assert.throws(()=>parseContentPackage({...p,...extra}));
  assert.throws(()=>parseContentPackage({...p,items:[{...p.items[0],answer:'99'}]}),/摘要/);
  for(const [field,message] of [['taskType',/任务类型与情境须同时有效/],['contextId',/任务类型与情境须同时有效/],['reviewerId',/缺少独立审核/],['sourceScope',/sourceScope 缺失或超限/]] as const) {const q={...newQuestion()};delete q[field];assert.throws(()=>pack([q]),message);}
  assert.throws(()=>parseContentPackage(' '.repeat(MAX_CONTENT_PACKAGE_BYTES+1)),/500/);
  const q={...newQuestion(),profile:{name:'must not ship'}};assert.throws(()=>pack([q]),/不允许.*profile/);
});
test('export includes only requested published independently reviewed items and never learner data',()=>{
  const s=base(); const p=exportContentPackage(s,{packageId:'pack-all',publisherId:'local-trial',createdAt:NOW});
  assert.equal(p.items.length,30);assert.equal(p.trust,'unsigned');assert.equal(p.teachingValidation,'unvalidated-trial');
  assert.ok(!JSON.stringify(p).includes('demo-original-attempt'));assert.ok(!Object.hasOwn(p,'profile'));
  assert.throws(()=>exportContentPackage(s,{packageId:'x',publisherId:'local-trial',createdAt:NOW,questionIds:['missing']}),/不存在/);
  s.profile.grade='五年级';assert.throws(()=>exportContentPackage(s,{packageId:'x',publisherId:'local-trial',createdAt:NOW}),/四年级/);
});
test('baseline archives conflicting frozen snapshots without changing or inventing history; conflicts cannot import',()=>{
  const s=createSeedWorkspace('local-test','test',NOW);const q=s.questions[0];const snapshot={...q,answer:'wrong historical key'};
  s.papers[0].questions[0]=snapshot;const frozen=structuredClone(s.papers);
  const c=ensureContent(s);validateContentState(s);assert.deepEqual(s.papers,frozen);
  assert.equal(c.versions.filter(v=>v.questionId===q.id&&v.version===q.version).length,2);
  assert.equal(ensureContent(s),c);assert.throws(()=>previewContentPackage(s,pack([q])),/归档正文冲突/);
});
test('a conflicting legacy paper snapshot does not prevent disabling the exact current bank version',()=>{
  const s=createSeedWorkspace('local-test','test',NOW),q=s.questions[0];
  s.papers[0].questions[0]={...q,answer:'wrong historical key'};
  const content=ensureContent(s),archives=structuredClone(content.versions),papers=structuredClone(s.papers);
  validateContentState(s);
  const disabled=act(s,'question.disable',{id:q.id,reason:'历史答案存在冲突，暂停使用待复核'}).state;
  assert.equal(disabled.questions.find(item=>item.id===q.id)!.status,'disabled');
  assert.equal(s.questions[0].status,'published');
  assert.deepEqual(disabled.content!.versions,archives);assert.deepEqual(disabled.papers,papers);
  assert.throws(()=>recordQuestionVersion(disabled,{...q,answer:'new conflicting body'}),/正文已归档/);
  assert.deepEqual(disabled.content!.versions,archives);validateContentState(disabled);
});
test('preview is read-only and never includes question text, answer, author or solution',()=>{
  const s=base(), before=structuredClone(s), q=newQuestion();const p=pack([q]);const v=previewContentPackage(s,p);
  assert.deepEqual(s,before);assert.equal(v.counts.added,1);assert.equal(v.sourceRevision,s.revision);
  for(const field of ['text','answer','steps','hint','authorId','reviewerId']) assert.ok(!Object.hasOwn(v.changes[0],field));
  assert.throws(()=>applyContentPackage({...s,revision:1},p,v,ctx()),/预览已过期/);
});
test('qid and family remain bound and same version body conflict rejects the entire package',()=>{
  const s=base();ensureContent(s);const q=s.questions[0];
  assert.throws(()=>previewContentPackage(s,pack([{...q,familyId:'other-family',version:q.version+1}])),/题族/);
  assert.throws(()=>apply(s,pack([newQuestion(),{...q,answer:'wrong'}])),/归档正文冲突/);
  assert.ok(!s.questions.some(q=>q.id==='new-content-q'));
});
test('changed ID, answer, whitespace, full-width digits and number-only variants cannot manufacture new families',()=>{
  const s=base();ensureContent(s);const q=s.questions[0];
  for(const changed of [{...q,id:'copy',familyId:'copy-family'},{...q,id:'copy',familyId:'copy-family',answer:'999'},{...q,id:'copy',familyId:'copy-family',text:q.text.replace('168','１６８')+'  '}]) assert.throws(()=>previewContentPackage(s,pack([changed])),/规范化题干/);
  assert.throws(()=>previewContentPackage(s,pack([{...q,id:'number-variant',familyId:'new-family',text:q.text.replace('168','192'),answer:'16'}])),/仅数字/);
  const variant={...q,id:'number-variant',familyId:q.familyId,text:q.text.replace('168','192'),answer:'16'};
  assert.equal(previewContentPackage(s,pack([variant])).counts.added,1);
});
test('apply is one revision; repeat and returned rolled-back packages are true no-ops',()=>{
  const s=base(),p=pack([newQuestion()]);const applied=apply(s,p);assert.equal(applied.revision,s.revision+1);
  assert.strictEqual(applyContentPackage(applied,p,{sourceRevision:0,digest:p.digest},ctx()).state,applied);
  const b=applied.content!.batches[0];const rolled=rollbackContentBatch(applied,b.id,applied.revision,ctx('撤回本次试用')).state;
  assert.ok(!rolled.questions.some(q=>q.id===p.items[0].id));assert.ok(rolled.content!.versions.some(v=>v.questionId===p.items[0].id));
  assert.strictEqual(applyContentPackage(rolled,p,{sourceRevision:0,digest:p.digest},ctx()).state,rolled);
  assert.throws(()=>previewContentPackage(applied,signedAgain({...p,publisherId:'changed-publisher'})),/相同内容包 ID/);
});
test('equal published body/version does not replace review metadata through an untracked update',()=>{
  const s=base();ensureContent(s);const before=structuredClone(s.questions[0]);const p=pack([{...before,reviewerId:'forged-reviewer',reviewNote:'new claim'}]);
  const out=apply(s,p);assert.deepEqual(out.questions[0],before);assert.deepEqual(out.content!.batches[0].changes,[]);
});
test('upgrade, withdrawal and rollback preserve papers, drafts, evidence, mastery and all prior versions',()=>{
  let s=base();const q=s.questions[0];s=act(s,'paper.create',{count:1,knowledgeIds:['division'],difficulty:'基础'}).state;
  s=act(s,'attempt.save',{paperId:s.papers[0].id,answers:[{questionId:q.id,value:'draft preserved'}]}).state;
  const untouched=structuredClone({papers:s.papers,attempts:s.attempts,evidence:s.evidence,mastery:s.mastery});
  const newer={...q,version:q.version+1,text:q.text+' 请用乘法验算。'};s=apply(s,pack([newer]));
  const disabled={...newer,status:'disabled' as const};s=apply(s,pack([],undefined,[q.id],[disabled]));assert.equal(s.questions[0].status,'disabled');
  s=rollbackContentBatch(s,s.content!.batches.at(-1)!.id,s.revision,ctx('取消撤回')).state;assert.equal(s.questions[0].status,'published');
  s=rollbackContentBatch(s,s.content!.batches[0].id,s.revision,ctx('撤销升级')).state;assert.equal(s.questions[0].version,q.version);
  assert.deepEqual({papers:s.papers,attempts:s.attempts,evidence:s.evidence,mastery:s.mastery},untouched);validateContentState(s);
});
test('only latest effective batch rolls back; later editorial edits cannot be overwritten',()=>{
  let s=apply(base(),pack([newQuestion('first-q')]));const first=s.content!.batches[0];s=apply(s,pack([newQuestion('second-q')]));
  assert.throws(()=>rollbackContentBatch(s,first.id,s.revision,ctx('错序回退')),/最近/);
  const last=s.content!.batches.at(-1)!;s=act(s,'question.update',{id:'second-q',question:{text:'人工修订内容必须保留'}}).state;
  assert.throws(()=>rollbackContentBatch(s,last.id,s.revision,ctx('不能覆盖')),/后续编辑/);
});
test('editorial update archives old published version and independent publish preserves complete new history',()=>{
  let s=base();const old=structuredClone(s.questions[0]);s=act(s,'question.update',{id:old.id,question:{text:'新的完整教学题目'}}).state;
  assert.ok(s.content!.versions.some(v=>v.questionId===old.id&&v.version===old.version&&v.question.text===old.text));
  s=act(s,'question.submit',{id:old.id}).state;s=act(s,'question.review',{id:old.id,decision:'approve',note:'独立复核'},'reviewer','reviewer').state;s=act(s,'question.publish',{id:old.id},'reviewer','reviewer').state;
  const archive=s.content!.versions.find(v=>v.questionId===old.id&&v.version===old.version+1)!;assert.equal(archive.question.status,'published');assert.equal(archive.question.reviewerId,'reviewer');
  s=act(s,'question.disable',{id:old.id,reason:'校核单位'}).state;assert.match(s.events[0].detail,/校核单位/);assert.equal(archive.question.status,'published');validateContentState(s);
});
test('projection never leaks archives to learners and role actions do not grant student imports or export',()=>{
  const s=apply(base(),pack([newQuestion()]));for(const role of ['student','parent','teacher'] as const){const view=projectWorkspace(s,role);assert.deepEqual(view.content!.versions,[]);assert.ok(view.content!.catalog!.length);assert.ok(!JSON.stringify(view.content).includes('园艺社'));}
  for(const action of ['content.export','content.rollback','content.apply'])assert.throws(()=>act(s,action,{},'student'),/权限/);
});
test('raw validation catches changed archive bodies, orphan pointers, duplicate packages, fake catalog and broken current references',()=>{
  const good=apply(base(),pack([newQuestion()]));
  const mutations=[(s:WorkspaceState)=>{s.content!.versions[0].question.answer='wrong'},(s:WorkspaceState)=>{s.content!.batches[0].changes[0].after!.versionId='missing'},(s:WorkspaceState)=>{s.content!.batches.push({...s.content!.batches[0],id:'other-batch'})},(s:WorkspaceState)=>{s.content!.catalog=[]},(s:WorkspaceState)=>{s.questions[0].text='changed without archive'}];
  for(const mutate of mutations){const s=structuredClone(good);mutate(s);assert.throws(()=>validateContentState(s));}
  assert.equal(questionContentDigest(good.questions[0]),good.content!.versions.find(v=>v.questionId===good.questions[0].id)!.digest);
});

test('reactivating the same retained disabled version preserves approval metadata and remains reversible',()=>{
  let s=base();const q=structuredClone(s.questions[0]);s=act(s,'question.disable',{id:q.id}).state;
  const p=pack([{...q,reviewerId:'incoming-reviewer',reviewNote:'unverified replacement'}]);s=apply(s,p);
  assert.equal(s.questions[0].reviewerId,q.reviewerId);assert.equal(s.questions[0].reviewNote,q.reviewNote);
  s=rollbackContentBatch(s,s.content!.batches.at(-1)!.id,s.revision,ctx('恢复停用')).state;
  assert.equal(s.questions[0].status,'disabled');assert.equal(s.questions[0].reviewerId,q.reviewerId);validateContentState(s);
});
test('preview rejects imported approval for an archived unreviewed disabled revision before any write',()=>{
  let s=base();const id=s.questions[0].id;
  s=act(s,'question.update',{id,question:{text:'小组把新购的 432 张卡纸平均分给 12 名同学，每人得到多少张？',answer:'36'}}).state;
  s=act(s,'question.disable',{id,reason:'草稿尚未完成审核'}).state;
  const q=s.questions.find(q=>q.id===id)!,before=structuredClone(s);
  const imported={...q,status:'published' as const,reviewerId:'incoming-reviewer',reviewNote:'导入包声称已审核'};
  const p=pack([imported]);
  assert.throws(()=>previewContentPackage(s,p),/归档未完成独立审核.*新版本/);
  assert.throws(()=>applyContentPackage(s,p,{sourceRevision:s.revision,digest:p.digest},ctx()),/归档未完成独立审核.*新版本/);
  assert.deepEqual(s,before);
  const next=pack([{...imported,version:q.version+1}]);
  assert.equal(previewContentPackage(s,next).counts.updated,1);
  const out=apply(s,next);assert.equal(out.questions.find(q=>q.id===id)!.version,q.version+1);validateContentState(out);
});
test('editing after a rollback allocates above the historical maximum version',()=>{
  const initial=base(),q=initial.questions[0];let s=apply(initial,pack([{...q,version:q.version+1,text:q.text+' 请列式。'}]));
  s=rollbackContentBatch(s,s.content!.batches[0].id,s.revision,ctx('恢复旧正文')).state;
  s=act(s,'question.update',{id:q.id,question:{text:'回退后的全新修订'}}).state;
  assert.equal(s.questions[0].version,q.version+2);validateContentState(s);
});
test('an editorial disable between package upgrades remains a valid chain and rollback restores disabled status',()=>{
  const q=newQuestion();let s=apply(base(),pack([q]));s=act(s,'question.disable',{id:q.id,reason:'待复核'}).state;
  s=apply(s,pack([{...q,version:2,text:q.text+' 请列式计算。'}]));validateContentState(s);
  s=rollbackContentBatch(s,s.content!.batches.at(-1)!.id,s.revision,ctx('恢复先前停用')).state;
  assert.equal(s.questions.find(item=>item.id===q.id)!.status,'disabled');validateContentState(s);
});
test('revision chronology validates batch ordering, rollback stack, sources and current active pointers',()=>{
  let s=apply(base(),pack([newQuestion('a-question')]));s=apply(s,pack([newQuestion('b-question')]));
  for(const mutate of [
    (x:WorkspaceState)=>x.content!.batches.reverse(),
    (x:WorkspaceState)=>{x.content!.batches[1].appliedRevision=x.content!.batches[0].appliedRevision},
    (x:WorkspaceState)=>{const b=x.content!.batches[0];b.status='rolled-back';b.rolledBackAt=NOW;b.rolledBackRevision=x.revision+1;b.reason='fake';x.revision++},
    (x:WorkspaceState)=>{x.questions=x.questions.filter(q=>q.id!=='b-question')},
    (x:WorkspaceState)=>{x.content!.versions.find(v=>v.source==='package')!.sourceBatchId=x.content!.batches[1].id},
  ]) {const copy=structuredClone(s);mutate(copy);assert.throws(()=>validateContentState(copy));}
});
test('near-limit 200-question packs preview and apply without quadratic archive hashing',t=>{
  const template=newQuestion(), alphabet=(i:number)=>`${String.fromCharCode(97+Math.floor(i/26))}${String.fromCharCode(97+i%26)}`;
  const bulk=(prefix:string)=>pack(Array.from({length:200},(_,i)=>({...template,id:`${prefix}-${i}`,familyId:`${prefix}-family-${i}`,text:`${prefix} ${alphabet(i)}：请阅读本题的独立材料。${'甲'.repeat(420)} 平均分配 432 张卡纸给 12 人，每人得到多少张？`,answer:'36'})),`large-${prefix}`);
  const a=bulk('alpha'),b=bulk('beta');
  for(const p of [a,b]) {const bytes=Buffer.byteLength(JSON.stringify(p));assert.ok(bytes>350_000 && bytes<=MAX_CONTENT_PACKAGE_BYTES,`fixture bytes: ${bytes}`);}
  const s=apply(base(),a),before=structuredClone(s);
  let start=performance.now();const preview=previewContentPackage(s,b),previewMs=performance.now()-start;
  start=performance.now();const out=applyContentPackage(s,b,preview,ctx()).state,applyMs=performance.now()-start;
  start=performance.now();validateContentState(out);const validationMs=performance.now()-start;
  t.diagnostic(`200 items / ${Buffer.byteLength(JSON.stringify(b))} bytes: preview ${previewMs.toFixed(1)} ms, apply ${applyMs.toFixed(1)} ms, validate ${validationMs.toFixed(1)} ms`);
  // Previous repeated hashing took ~11 seconds per operation locally. A loose
  // bound tolerates loaded CI while catching a return to item × archive hashes.
  assert.ok(previewMs<4000,`preview took ${previewMs.toFixed(1)} ms`);
  assert.ok(applyMs<4000,`apply took ${applyMs.toFixed(1)} ms`);
  assert.ok(validationMs<4000,`validation took ${validationMs.toFixed(1)} ms`);
  assert.equal(preview.counts.added,200);assert.equal(out.questions.length,s.questions.length+200);assert.deepEqual(s,before);
  const copy={...b.items[199],id:'bulk-clone',familyId:'bulk-clone-family',answer:'999'};
  assert.throws(()=>previewContentPackage(out,pack([copy])),/规范化题干/);
});
