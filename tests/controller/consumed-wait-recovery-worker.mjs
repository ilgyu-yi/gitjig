import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {scripted} from './effect-fixture.mjs';
export const caseNames=[];
const test=(name,body)=>{caseNames.push(name);if(process.env.GITJIG_CONSUMED_WAIT_CASE===name)nodeTest(name,body);};
const ledger=c=>createHash('sha256').update(JSON.stringify(Object.fromEntries(['sources','works','runs','budgets','conversation_state','conversation_inputs','conversation_directions','conversation_assignments','conversation_dependencies','conversation_results'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')])))).digest('hex');

async function world(t,kind,legacy=false,captured=false){
 const root=await fs.realpath(await fs.mkdtemp('/tmp/gitjig-consumed-wait-')),home=path.join(root,'home'),previousTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
 const c=await openController({installationHome:home});let passed=false,calls=0;
 t.after(async()=>{await c.close();if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained consumed wait fixture '+root);});
 const model=scripted(()=>{calls++;return{text:'Owned ordinary response, no external execution'};});model.provider='consumed-wait-'+randomUUID();model.definition.api='consumed-wait-api-'+randomUUID();
 const cid=c.createConversation().conversationId;
 await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original owner request',mode:'idle'});
 const first=await c.runConversation({conversationId:cid,model});assert.equal(first.status,'delivered');
 const s=c.store,view=c.inspectConversation(cid),run=s.one('SELECT * FROM runs WHERE id=?',first.runId),rd=JSON.parse(run.data),state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',cid).data),child=c.createConversation().conversationId,assignment=randomUUID(),resultId=randomUUID();
 const actor={conversationId:cid,workId:first.workId,runId:first.runId,launchId:null,generation:view.generation,directionRevision:view.directionRevision,initialInputId:rd.initialInputId};
 // The WAIT/result operands are explicit controlled records. Both ordinary turns,
 // owner/continuation input admission and later cancellation/recovery are actual.
 s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',assignment,cid,child,null,'COMPLETE',JSON.stringify({source:actor,operation:'investigate'}));
 s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',randomUUID(),cid,child,assignment,'RESOLVED',JSON.stringify({source:actor}));
 s.run('INSERT INTO conversation_results VALUES(?,?,?,?,?)',resultId,child,null,null,JSON.stringify({version:1,assignmentId:assignment,result:{status:'delivered'},audience:[],fixture:'Controlled result, not procedure standing'}));
 s.run("UPDATE conversation_state SET resource='WAITING',data=? WHERE conversation=?",JSON.stringify({...state,runId:first.runId,sourceIdentity:actor,waitHandles:[assignment],continuationAuthorized:true}),cid);
 s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...rd,outcome:'waiting'}),first.runId);
 if(kind==='superseded'){const request={conversationId:cid,expectedGeneration:view.generation,text:captured?'Owner @@literal changes direction instead of waiting':'Owner changes direction instead of waiting',mode:'idle'};if(captured)await c.queueConversationInputWithContext(request);else await c.queueConversationInput(request);}
 const second=await c.runConversation({conversationId:cid,model});assert.equal(second.status,'delivered');assert.equal(second.workId,first.workId);
 const clean=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',cid).data),archive=kind==='superseded'?clean.supersededContinuation:clean.explicitContinuation;
 if(legacy){const old={...clean,sourceIdentity:actor,waitHandles:[assignment],continuationAuthorized:false};if(kind==='explicit')old.explicitContinuation={runId:first.runId,resultIds:[resultId]};s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify(old),cid);}
 await c.cancelWork({workId:first.workId});
 return{c,s,cid,work:first.workId,first,second,actor,assignment,resultId,archive,clean,kind,model,calls:()=>calls,pass(){passed=true;}};
}

for(const kind of ['superseded','explicit'])test(`${kind} wait consumption archives its token and leaves no active handles before later owner recovery`,async t=>{
 const f=await world(t,kind);
 assert.equal(f.c.inspectConversation(f.cid).state,'IDLE');assert.equal(f.clean.continuationAuthorized,false);
 assert.equal(Object.hasOwn(f.clean,'waitHandles'),false);assert.equal(Object.hasOwn(f.clean,'sourceIdentity'),false);
 assert.deepEqual(f.archive.sourceIdentity,f.actor);assert.deepEqual(f.archive.waitHandles,[f.assignment]);assert.equal(f.archive.newRunId,f.second.runId);
 const context=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(context.eligible,true,JSON.stringify(context.holds));assert.equal(context.withdrawConsumedWait,null);
 const budgets=f.s.all('SELECT * FROM budgets ORDER BY rowid'),inputs=f.s.all('SELECT * FROM conversation_inputs ORDER BY rowid');
 f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:context.fingerprint,reason:'Explicit owner recovery after consumed wait'},()=>{});
 assert.equal(f.calls(),2);assert.deepEqual(f.s.all('SELECT * FROM budgets ORDER BY rowid'),budgets);assert.deepEqual(f.s.all('SELECT * FROM conversation_inputs ORDER BY rowid'),inputs);f.pass();
});

for(const kind of ['superseded','explicit'])test(`legacy ${kind} inactive residue is withdrawn only by reviewed original-owner recovery`,async t=>{
 const f=await world(t,kind,true),before=ledger(f.c),context=f.c.inspectOrdinaryWorkRecovery(f.work);
 assert.equal(context.eligible,true,JSON.stringify(context.holds));assert.equal(ledger(f.c),before);assert.equal(context.withdrawConsumedWait.kind,kind);
 const budgets=f.s.all('SELECT * FROM budgets ORDER BY rowid'),assignments=f.s.all('SELECT * FROM conversation_assignments'),deps=f.s.all('SELECT * FROM conversation_dependencies'),prior=f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data;
 const result=f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:context.fingerprint,reason:'Owner reviews the original consumed token'},()=>{});
 assert.equal(result.withdrawConsumedWait,true);assert.equal(f.calls(),2);
 const state=JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data),event=JSON.parse(f.s.one('SELECT raw FROM sources WHERE id=?',result.sourceId).raw);
 assert.equal(Object.hasOwn(state,'waitHandles'),false);assert.equal(Object.hasOwn(state,'sourceIdentity'),false);assert.equal(event.previous.conversation.data,prior);assert.equal(event.withdrawConsumedWait.kind,kind);
 assert.deepEqual(f.s.all('SELECT * FROM budgets ORDER BY rowid'),budgets);assert.deepEqual(f.s.all('SELECT * FROM conversation_assignments'),assignments);assert.deepEqual(f.s.all('SELECT * FROM conversation_dependencies'),deps);f.pass();
});

for(const kind of ['superseded','explicit'])for(const damage of ['authorization','missing archive','old run','successor run','input source','raw bytes','inactive identity','other matching archive'])
test(`legacy ${kind} ${damage} contradiction remains held without a recovery mutation`,async t=>{
 const f=await world(t,kind,true),state=JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data),key=kind==='superseded'?'supersededContinuation':'explicitContinuation';
 if(damage==='authorization')state.continuationAuthorized=true;
 if(damage==='missing archive')delete state[key];
 if(damage==='inactive identity')state.sourceIdentity={...state.sourceIdentity,generation:state.sourceIdentity.generation+1};
 if(damage==='other matching archive')state[kind==='superseded'?'explicitContinuation':'supersededContinuation']={runId:f.first.runId,resultIds:[],sourceIdentity:{...f.actor,workId:'wrong'},waitHandles:[f.assignment]};
 f.s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify(state),f.cid);
 if(damage==='old run'){const row=f.s.one('SELECT data FROM runs WHERE id=?',f.first.runId);f.s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),outcome:'delivered'}),f.first.runId);}
 if(damage==='successor run'){const row=f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId);f.s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),initialInputId:'other'}),f.second.runId);}
 if(damage==='input source'){const row=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId).data),input=f.s.one('SELECT source FROM conversation_inputs WHERE id=?',row.initialInputId);f.s.run('UPDATE sources SET origin=? WHERE id=?','{"kind":"unbound-other-source"}',input.source);}
 if(damage==='raw bytes'){const row=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId).data),input=f.s.one('SELECT source FROM conversation_inputs WHERE id=?',row.initialInputId);f.s.run('UPDATE sources SET raw=raw||? WHERE id=?',' \n',input.source);}
 const before=ledger(f.c),context=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(context.eligible,false,damage);
 assert.throws(()=>f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:context.fingerprint,reason:'Must remain held'},()=>{}),/held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),2);f.pass();
});

for(const kind of ['superseded','explicit'])test(`legacy ${kind} proof selects the matching token while retaining unrelated older archive`,async t=>{
 const f=await world(t,kind,true),state=JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data);
 state[kind==='superseded'?'explicitContinuation':'supersededContinuation']={runId:'different-original-history',fixture:'Unrelated retained historical archive'};
 f.s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify(state),f.cid);
 const context=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(context.eligible,true,JSON.stringify(context.holds));assert.equal(context.withdrawConsumedWait.kind,kind);f.pass();
});

for(const kind of ['superseded','explicit'])test(`legacy ${kind} recovery refuses valid-looking source drift after owner review`,async t=>{
 const f=await world(t,kind,true),review=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(review.eligible,true,JSON.stringify(review.holds));
 const row=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId).data),input=f.s.one('SELECT source FROM conversation_inputs WHERE id=?',row.initialInputId),source=f.s.one('SELECT origin FROM sources WHERE id=?',input.source);
 f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({...JSON.parse(source.origin),event:randomUUID()}),input.source);
 const current=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(current.eligible,true,JSON.stringify(current.holds));assert.notEqual(current.fingerprint,review.fingerprint);
 const before=ledger(f.c);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:review.fingerprint,reason:'Stale review must not commit'},()=>{}),/changed or is held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),2);f.pass();
});

test('legacy explicit recovery fingerprints the published result snapshot through owner confirmation',async t=>{
 const f=await world(t,'explicit',true),review=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(review.eligible,true,JSON.stringify(review.holds));
 const row=f.s.one('SELECT data FROM conversation_results WHERE id=?',f.resultId);
 f.s.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),fixture:'Changed retained result after review'}),f.resultId);
 const current=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(current.eligible,true,JSON.stringify(current.holds));assert.notEqual(current.fingerprint,review.fingerprint);
 const before=ledger(f.c);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:review.fingerprint,reason:'Stale result review must not commit'},()=>{}),/changed or is held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),2);f.pass();
});


test('legacy captured host input preserves qualified raw/model text differences without reading payloads',async t=>{
 const f=await world(t,'superseded',true,true),row=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId).data),input=f.s.one('SELECT i.text,s.raw FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.id=?',row.initialInputId);
 assert.notEqual(input.text,input.raw);assert.ok(input.raw.includes('@@literal'));assert.ok(row.inputContext);
 const before=ledger(f.c),context=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(context.eligible,true,JSON.stringify(context.holds));assert.equal(ledger(f.c),before);
 const result=f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:context.fingerprint,reason:'Owner reviews the original captured input metadata'},()=>{});assert.equal(result.withdrawConsumedWait,true);assert.equal(f.calls(),2);f.pass();
});

for(const damage of ['raw bytes','manifest correspondence'])test(`legacy captured host input ${damage} contradiction remains held`,async t=>{
 const f=await world(t,'superseded',true,true),row=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?',f.second.runId).data),input=f.s.one('SELECT source FROM conversation_inputs WHERE id=?',row.initialInputId);
 if(damage==='raw bytes')f.s.run('UPDATE sources SET raw=raw||? WHERE id=?',' altered',input.source);
 else {const origin=JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?',input.source).origin);origin.context.textSha256='0'.repeat(64);f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(origin),input.source);}
 const before=ledger(f.c),context=f.c.inspectOrdinaryWorkRecovery(f.work);assert.equal(context.eligible,false);
 assert.throws(()=>f.c.recoverOrdinaryWorkAdmission({workId:f.work,expectedContext:context.fingerprint,reason:'Contradictory captured metadata must remain held'},()=>{}),/held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),2);f.pass();
});
