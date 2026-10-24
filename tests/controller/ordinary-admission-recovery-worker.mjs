import nodeTest from 'node:test';
export const caseNames=[];
function test(name,body){caseNames.push(name);if(process.env.GITJIG_ORDINARY_RECOVERY_CASE===name)nodeTest(name,body);}
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {snapshot} from './integration-registry-fixture.mjs';
import {scripted} from './effect-fixture.mjs';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {workCommands} from '../../dist/ui/work-commands.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const ledger=c=>createHash('sha256').update(snapshot(c)).digest('hex');
async function world(t){
 const root=await fs.realpath(await fs.mkdtemp('/tmp/gitjig-ordinary-recovery-')),home=path.join(root,'home'),c=await openController({installationHome:home}),cid=c.createConversation().conversationId,previousTmp=process.env.TMPDIR;
 let calls=0,passed=false;const model=scripted(()=>{calls++;return{text:'Owned ordinary response; no project standing'};});
 model.provider='ordinary-recovery-'+randomUUID();model.definition.api='ordinary-recovery-api-'+randomUUID();
 process.env.TMPDIR=path.join(home,'artifacts');
 t.after(async()=>{await c.close();if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained ordinary recovery world: '+root);});
 await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original ordinary owner request',mode:'idle'});
 const result=await c.runConversation({conversationId:cid,model});assert.equal(result.status,'delivered',JSON.stringify(result));const wid=result.workId;
 await c.cancelWork({workId:wid});
 const request=()=>({workId:wid,expectedContext:c.inspectOrdinaryWorkRecovery(wid).fingerprint,reason:'Explicit original admission recovery'});
 return {c,s:c.store,cid,wid,root,home,model,request,calls:()=>calls,pass(){passed=true;}};
}
function command(f,choices,inputs=[],hooks={}){
 const shown=[],notices=[],h=new HostCommands(workCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{if(title==='Confirm original conversation admission recovery')assert.equal(rows[0],'Back without recovery');const selected=choices.shift();return typeof selected==='function'?selected(title,rows):rows.find(row=>row.startsWith(selected??'NO_SELECTION'));},input:async()=>inputs.shift(),show:async(title,text)=>shown.push({title,text}),notice:text=>notices.push(text),activate:async()=>assert.fail('Recovery cannot navigate automatically'),...hooks}));
 return {shown,notices,run:()=>h.execute('/work '+f.wid,f.cid)};
}

test('actual ordinary cancellation has explicit same-original admission recovery, then a separate real Pi turn',async t=>{
 const f=await world(t),context=f.c.inspectOrdinaryWorkRecovery(f.wid);assert.equal(context.eligible,true,JSON.stringify(context.holds));
 const work=f.c.inspectWork(f.wid),view=f.c.inspectConversation(f.cid),budgets=f.s.all('SELECT * FROM budgets'),sources=f.s.all('SELECT * FROM sources'),runs=f.s.all('SELECT * FROM runs'),inputs=f.s.all('SELECT * FROM conversation_inputs');
 const result=f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{});assert.equal(f.calls(),1);assert.equal(result.workId,f.wid);assert.equal(result.epoch,work.epoch+1);assert.equal(result.generation,context.workGeneration);
 const revived=f.c.inspectWork(f.wid);assert.equal(revived.state,'ACTIVE');assert.equal(revived.source.id,work.source.id);assert.deepEqual(f.c.inspectConversation(f.cid),view);assert.deepEqual(f.s.all('SELECT * FROM budgets'),budgets);assert.deepEqual(f.s.all('SELECT * FROM runs'),runs);assert.deepEqual(f.s.all('SELECT * FROM conversation_inputs'),inputs);assert.deepEqual(f.s.all('SELECT * FROM sources').slice(0,-1),sources);
 const event=f.s.one('SELECT * FROM sources WHERE id=?',result.sourceId);assert.equal(JSON.parse(event.origin).kind,'owner-ordinary-admission-recovery');assert.equal(JSON.parse(event.raw).reason,f.request().reason);
 const active=ledger(f.c);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),/held/);assert.equal(ledger(f.c),active);
 await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:view.generation,text:'Separate owner continuation after explicit recovery',mode:'idle'});const continued=await f.c.runConversation({conversationId:f.cid,model:f.model});assert.equal(continued.status,'delivered',JSON.stringify(continued));assert.equal(continued.workId,f.wid);assert.equal(f.calls(),2);f.pass();
});

test('ordinary recovery UI Back and reason cancellation are pure; explicit confirmation never dispatches',async t=>{
 const f=await world(t),before=ledger(f.c);
 for(const [choices,inputs]of [[['Review original conversation admission','Back without recovery','Back to all works'],['Owner reason']],[['Review original conversation admission','Back to all works'],[undefined]]]){const h=command(f,choices,inputs);await h.run();assert.equal(ledger(f.c),before);}
 const h=command(f,['Review original conversation admission','Recover this original conversation admission'],['Owner confirms restored admission']);assert.equal(await h.run(),'completed');assert.equal(f.calls(),1);assert.ok(h.shown[0].text.includes('Physical history verification remains pending'));assert.ok(h.notices[0].includes('no execution'));f.pass();
});

for(const kind of ['source','work epoch','conversation binding','history pointer','native session','pending input','native input checkpoint','native checkpoint session','native input marker','reserved budget','unsettled run','oversized family','delegated metadata','context metadata','pending goal'])test('ordinary admission recovery holds '+kind+' without changing original records',async t=>{
 const f=await world(t);
 if(kind==='source')f.s.run("UPDATE sources SET origin=json_set(origin,'$.uid',-1) WHERE id=(SELECT source FROM works WHERE id=?)",f.wid);
 else if(kind==='work epoch')f.s.run('UPDATE works SET epoch=? WHERE id=?',Number.MAX_SAFE_INTEGER,f.wid);
 else if(kind==='conversation binding')f.s.run('UPDATE conversation_state SET work=NULL WHERE conversation=?',f.cid);
 else if(kind==='history pointer')f.s.run('UPDATE conversations SET history=NULL WHERE id=?',f.cid);
 else if(kind==='native session')f.s.run('UPDATE conversation_state SET native_id=? WHERE conversation=?','different-session',f.cid);
 else if(kind==='pending input')await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'Retained unconsumed input',mode:'idle'});
 else if(kind==='native input checkpoint')f.s.run("UPDATE runs SET data=json_remove(data,'$.nativeCheckpoint') WHERE work=?",f.wid);
 else if(kind==='native checkpoint session')f.s.run("UPDATE runs SET data=json_set(data,'$.nativeCheckpoint.sessionId','other-session') WHERE work=?",f.wid);
 else if(kind==='native input marker')f.s.run("UPDATE conversation_state SET data=json_set(data,'$.nativeInputRecovery',json('null')) WHERE conversation=?",f.cid);
 else if(kind==='reserved budget')f.s.run("UPDATE budgets SET reserved=1 WHERE lineage=? AND kind='execution'",f.wid);
 else if(kind==='oversized family'){const row=f.s.one('SELECT * FROM works WHERE id=?',f.wid);for(let i=0;i<128;i++)f.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','bounded-family-'+i,null,row.source,null,f.wid,'DELIVERED',1,1,null,'{"fixture":"unexecuted family membership"}');}
 else if(kind==='delegated metadata')f.s.run("UPDATE works SET data=json_set(data,'$.assignmentId','unexecuted-assignment') WHERE id=?",f.wid);
 else if(kind==='context metadata')f.s.run("UPDATE works SET data=json_set(data,'$.contextOrigin',json('null')) WHERE id=?",f.wid);
 else if(kind==='pending goal')f.c.createGoal({conversationId:f.cid,objective:'Preserve existing goal recovery',criteria:['No admission bypass'],turnLimit:1});
 else f.s.run("UPDATE runs SET phase='UNKNOWN' WHERE work=?",f.wid);
 const context=f.c.inspectOrdinaryWorkRecovery(f.wid),before=ledger(f.c);assert.equal(context.eligible,false,kind);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),/held|changed/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),1);f.pass();
});

test('ordinary owner review rechecks in the final transaction and rolls back late result failure',async t=>{
 const f=await world(t),before=ledger(f.c);let checks=0;
 assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{if(++checks===2)f.s.run('UPDATE conversation_state SET direction=direction+1 WHERE conversation=?',f.cid);}),/changed/);assert.equal(checks,2);assert.equal(ledger(f.c),before);
 const read=f.c.inspectWorkRecovery;f.c.inspectWorkRecovery=()=>{throw Error('Injected result read failure');};try{assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),/Injected result/);}finally{f.c.inspectWorkRecovery=read;}assert.equal(ledger(f.c),before);f.pass();
});

test('metadata recovery cannot bypass physical native history verification on the next ordinary input',async t=>{
 const f=await world(t),view=f.c.inspectConversation(f.cid);await fs.rename(view.historyRef,view.historyRef+'.retained');
 f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{});await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:view.generation,text:'Explicit next turn must verify original history',mode:'idle'});const before=ledger(f.c);
 await assert.rejects(f.c.runConversation({conversationId:f.cid,model:f.model}),/ENOENT|history|checkpoint/i);assert.equal(f.calls(),1);assert.equal(ledger(f.c),before);f.pass();
});

test('cancelled wait recovery archives scheduler state and preserves cancelled children and dependencies',async t=>{
 const f=await world(t),state=f.s.one('SELECT * FROM conversation_state WHERE conversation=?',f.cid),run=f.c.inspectWork(f.wid).runs[0],child=f.c.createConversation().conversationId,assignment=randomUUID(),identity={conversationId:f.cid,workId:f.wid,runId:run.id,initialInputId:run.data.initialInputId,generation:1,launchId:null,directionRevision:1};
 // Controlled settled wait state; real public cancellation and recovery own the
 // ledger transitions. This is not an actual waiting child/model execution.
 f.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',assignment,f.cid,child,null,'QUEUED',JSON.stringify({operation:'investigate',source:identity}));f.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',randomUUID(),f.cid,child,assignment,'PENDING','{}');
 const waiting={...JSON.parse(state.data),waitHandles:[assignment],continuationAuthorized:true,sourceIdentity:identity};f.s.run("UPDATE conversation_state SET resource='WAITING',data=? WHERE conversation=?",JSON.stringify(waiting),f.cid);
 await f.c.cancelWork({workId:f.wid});const dependencies=f.s.all('SELECT * FROM conversation_dependencies'),assignments=f.s.all('SELECT * FROM conversation_assignments');
 const context=f.c.inspectOrdinaryWorkRecovery(f.wid);assert.equal(context.eligible,true,JSON.stringify(context.holds));assert.equal(context.withdrawCancelledWait,true);
 const result=f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),after=f.s.one('SELECT resource,data FROM conversation_state WHERE conversation=?',f.cid),event=JSON.parse(f.s.one('SELECT raw FROM sources WHERE id=?',result.sourceId).raw);
 assert.equal(after.resource,'IDLE');assert.equal(Object.hasOwn(JSON.parse(after.data),'continuationAuthorized'),false);assert.deepEqual(JSON.parse(event.previous.conversation.data),waiting);assert.deepEqual(f.s.all('SELECT * FROM conversation_dependencies'),dependencies);assert.deepEqual(f.s.all('SELECT * FROM conversation_assignments'),assignments);assert.equal(f.calls(),1);f.pass();
});

for(const kind of ['foreign duplicate dependency','pending dependency','unsettled child'])test('cancelled wait admission keeps '+kind+' held without withdrawing obligations',async t=>{
 const f=await world(t),child=f.c.createConversation().conversationId,assignment=randomUUID(),identity={conversationId:f.cid,workId:f.wid};
 f.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',assignment,f.cid,child,null,'QUEUED',JSON.stringify({operation:'investigate',source:identity}));f.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',randomUUID(),f.cid,child,assignment,'PENDING','{}');
 const state=JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data);f.s.run("UPDATE conversation_state SET resource='WAITING',data=? WHERE conversation=?",JSON.stringify({...state,waitHandles:[assignment],continuationAuthorized:true,sourceIdentity:identity}),f.cid);await f.c.cancelWork({workId:f.wid});
 if(kind==='foreign duplicate dependency')f.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',randomUUID(),child,child,assignment,'CANCELLED','{}');
 else if(kind==='pending dependency')f.s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",assignment);
 else{
  // Controlled unsettled child, not an actual runtime or completed procedure.
  const source=f.s.one('SELECT source FROM works WHERE id=?',f.wid).source,wid=randomUUID();f.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',wid,null,source,null,wid,'CANCELLED',1,1,null,'{"fixture":"unsettled child"}');f.s.run('UPDATE conversation_assignments SET work=? WHERE id=?',wid,assignment);for(const budget of ['execution','resolution'])f.s.run('INSERT INTO budgets VALUES(?,?,8,0,0)',wid,budget);f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',randomUUID(),wid,1,1,'UNKNOWN',f.root,'consumed','{"cleanup":"quarantined"}');
 }
 const before=ledger(f.c);assert.equal(f.c.inspectOrdinaryWorkRecovery(f.wid).eligible,false);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),/held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),1);f.pass();
});

test('actual source terminal recovers the original admission, preserves draft and has no execution',async t=>{
 const f=await world(t),draft='KEEP 한국어',work=f.c.inspectWork(f.wid),budgets=f.s.all('SELECT * FROM budgets ORDER BY rowid'),runs=f.s.all('SELECT * FROM runs ORDER BY rowid');await f.c.close();const file=path.join(f.root,'ordinary-recovery-ui.json');
 const steps=[{wait:'Model: not selected',send:draft+'\x07t'},{wait:'Setup and next actions',send:'More settings and details\r'},{wait:'More settings and details',send:'Work recovery\r'},{wait:'Original work and allowances',send:f.wid+'\r'},{wait:'Work recovery · #',send:'Review original conversation admission\r'},{wait:'Owner reason to recover original conversation admission',send:'Explicit original admission recovery\r'},{wait:'Review exact original conversation admission',send:'\x1b'},{wait:'Confirm original conversation admission recovery',send:'Recover this original conversation admission\r'},{wait:'More settings and details',queries:[{sql:'SELECT state,epoch FROM works WHERE id=?',params:[f.wid],rows:[['ACTIVE',work.epoch+1]]},{sql:'SELECT * FROM budgets ORDER BY rowid',rows:budgets.map(Object.values)},{sql:'SELECT * FROM runs ORDER BY rowid',rows:runs.map(Object.values)}],send:'Return to request\r'},{wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'}];
 const env={...process.env,HOME:f.root,GITJIG_HOME:f.home,TMPDIR:f.root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''};delete env.NODE_TEST_CONTEXT;
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/reopen-no-dispatch.mjs','dist/cli/entry.js','conversation','ui','--conversation',f.cid],env,steps,timeoutSeconds:5,gracefulShutdownSeconds:2,expectedInputs:1,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal'}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{env,timeout:7500,maxBuffer:1048576})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(f.calls(),1);f.pass();
});

for(const waiting of [false,true])for(const kind of ['unknown cleanup','unavailable cleanup','unknown reservation','unknown capacity'])test((waiting?'cancelled wait child':'shared family')+' keeps '+kind+' held without recovery mutation',async t=>{
 const f=await world(t),wid=randomUUID(),rid=randomUUID(),source=f.s.one('SELECT source FROM works WHERE id=?',f.wid).source;
 // Explicit adverse ledger fixture, never a live child or cleanup claim.
 f.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',wid,null,source,null,waiting?wid:f.wid,'CANCELLED',1,1,null,'{"fixture":"settlement counterexample"}');
 if(waiting){for(const budget of ['execution','resolution'])f.s.run('INSERT INTO budgets VALUES(?,?,8,0,0)',wid,budget);const child=f.c.createConversation().conversationId,aid=randomUUID(),state=JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data),identity={conversationId:f.cid,workId:f.wid};f.s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',aid,f.cid,child,wid,'CANCELLED',JSON.stringify({operation:'investigate',source:identity}));f.s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',randomUUID(),f.cid,child,aid,'CANCELLED','{}');f.s.run("UPDATE conversation_state SET resource='WAITING',data=? WHERE conversation=?",JSON.stringify({...state,waitHandles:[aid],continuationAuthorized:true,sourceIdentity:identity}),f.cid);}
 const cleanup=kind==='unknown cleanup'?'unknown':kind==='unavailable cleanup'?'unavailable':'confirmed';f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',rid,wid,1,1,'SETTLED',f.root,kind==='unknown reservation'?'unknown':'released',JSON.stringify({cleanup}));if(kind==='unknown capacity')f.s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',randomUUID(),wid,rid,1,f.s.one('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM capacity_leases').n,'UNKNOWN','{}');
 const before=ledger(f.c);assert.equal(f.c.inspectOrdinaryWorkRecovery(f.wid).eligible,false);assert.throws(()=>f.c.recoverOrdinaryWorkAdmission(f.request(),()=>{}),/held/);assert.equal(ledger(f.c),before);assert.equal(f.calls(),1);f.pass();
});
