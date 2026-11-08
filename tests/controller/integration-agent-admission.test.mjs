import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {integrationWorld,snapshot} from './integration-registry-fixture.mjs';
import {createCoordinationTools} from '../../dist/pi/coordination.js';
const ledger=c=>createHash('sha256').update(snapshot(c)).digest('hex');

// The real tool, queue, ancestry, grant, SQLite and interaction readers are used.
// Native coordinator presence and successful procedure evidence are controlled
// fixtures: no model, engine, projection or send is performed or certified.
async function world(t){
 const f=await integrationWorld(t),{c}=f,s=c.store,e=c.effects;
 const root=(await c.beginChange({projectId:'P',request:'Agent admission root fixture'})).workId;
 const subject=(await c.beginChange({projectId:'P',request:'Completed child fixture; not actual procedure standing'})).workId;
 const parent=c.createConversation({projectId:'P'}).conversationId,child=c.createConversation({projectId:'P'}).conversationId;
 const identity={conversationId:parent,workId:root,runId:randomUUID(),launchId:null,generation:1,directionRevision:0,initialInputId:randomUUID()};
 const assignment=randomUUID(),grant=c.delegateIntegration({workId:root,targetId:f.target,mode:'ordinary',scope:'delegation-lineage',operationLimit:3}).delegationId;
 for(const [wid,cid,extra]of [[root,parent,{}],[subject,child,{invocation:{assignmentId:assignment,conversationId:child,actor:identity}}]]){
  const row=s.one('SELECT data FROM works WHERE id=?',wid);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),conversation:cid,...extra}),wid);s.run('UPDATE conversation_state SET work=? WHERE conversation=?',wid,cid);
 }
 s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',assignment,parent,child,subject,'COMPLETE',JSON.stringify({operation:'change',source:identity}));
 let live=identity,revision=0,load=async()=>evidence(),admit=()=>{};
 const evidence=()=>({workId:subject,epoch:1,generation:1,versions:{candidate:'CONTROLLED-'+revision},fingerprint:'CONTROLLED-'+revision});
 const original={handle:e.h.interactions.getHandle,current:c.changeCore.currentEvidence,assert:c.changeCore.assertCurrentEvidence};
 e.h.interactions.getHandle=cid=>cid===parent&&live?{identity:live}:undefined;
 c.changeCore.currentEvidence=()=>load();c.changeCore.assertCurrentEvidence=value=>assert.deepEqual(value,evidence(),'only exact controlled evidence accepted');
 t.after(()=>{e.h.interactions.getHandle=original.handle;c.changeCore.currentEvidence=original.current;c.changeCore.assertCurrentEvidence=original.assert;});
 const entry=()=>admit(),tools=createCoordinationTools({status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),integrate:input=>e.queueIntegration(input,identity,entry)},()=>{}),tool=tools.find(t=>t.name==='conversation_integrate');
 const request={reviewedAssignmentId:assignment,targetId:f.target},queue=()=>tool.execute(randomUUID(),request),retry=async()=>{await queue();const op=e.op(s.one('SELECT id FROM effect_operations WHERE work=?',subject).id);s.run('UPDATE effect_operations SET phase=? WHERE id=?','REFUSED',op.id);s.run('UPDATE conversation_assignments SET state=? WHERE id=?','UNAVAILABLE',op.data.assignmentId);s.run('UPDATE conversation_state SET resource=? WHERE conversation=?','IDLE',op.data.conversationId);revision++;return op.id;};
 return {...f,s,e,root,subject,parent,child,identity,assignment,grant,request,queue,retry,evidence,setLoad(fn){load=fn;},setLive(value){live=value;},setEntry(fn){admit=fn;}};
}

test('agent tool rejects a cancelled retained alias without replacing original evidence',async t=>{
 const f=await world(t),id=await f.retry(),op=f.e.op(id);f.s.run('UPDATE conversation_assignments SET state=? WHERE id=?','CANCELLED',op.data.assignmentId);const before=ledger(f.c);
 await assert.rejects(f.queue(),/assignment|alias/i);assert.equal(ledger(f.c),before);f.pass();
});

test('agent tool source-fit refusal preserves original evidence and all retained state',async t=>{
 const f=await world(t),id=await f.retry(),op=f.e.op(id);f.s.run('UPDATE effect_operations SET data=? WHERE id=?',JSON.stringify({...op.data,origin:{...op.data.origin,workEpoch:0}}),id);const before=ledger(f.c);
 await assert.rejects(f.queue(),/Cancellation\/root authority/);assert.equal(ledger(f.c),before);f.pass();
});

test('agent tool rechecks completed assignment after asynchronous evidence loading',async t=>{
 const f=await world(t);let after;
 f.setLoad(async()=>{f.s.run('UPDATE conversation_assignments SET state=? WHERE id=?','CANCELLED',f.assignment);after=ledger(f.c);return f.evidence();});
 await assert.rejects(f.queue(),/assignment|context/i);assert.equal(ledger(f.c),after);f.pass();
});

test('actual owner direction during evidence loading cannot become a silently refreshed coordinator token',async t=>{
 const f=await world(t);let after;
 f.setLoad(async()=>{await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:0,text:'Actual new owner direction while evidence loads',mode:'idle'});after=ledger(f.c);return f.evidence();});
 await assert.rejects(f.queue(),/context changed/);assert.equal(ledger(f.c),after);f.pass();
});

for(const kind of ['historical actor input','historical source conversation','historical target conversation'])test('agent admission rejects contradictory '+kind+' before evidence loading',async t=>{
 const f=await world(t);let reads=0;f.setLoad(async()=>{reads++;return f.evidence();});
 if(kind==='historical actor input')f.s.run("UPDATE works SET data=json_set(data,'$.invocation.actor.initialInputId','other-original-input') WHERE id=?",f.subject);
 else if(kind==='historical source conversation')f.s.run('UPDATE conversation_assignments SET source_conversation=? WHERE id=?',f.child,f.assignment);
 else f.s.run("UPDATE works SET data=json_set(data,'$.invocation.conversationId',?) WHERE id=?",f.parent,f.subject);
 const before=ledger(f.c);await assert.rejects(f.queue(),/invocation differs/);assert.equal(reads,0);assert.equal(ledger(f.c),before);f.pass();
});

for(const kind of ['native input','native work','native launch','subject epoch','subject invocation','grant limit','target identity'])test('agent tool refuses '+kind+' drift during evidence loading without allocation',async t=>{
 const f=await world(t);let after;
 f.setLoad(async()=>{
  if(kind==='native input')f.setLive({...f.identity,initialInputId:'other-input'});
  else if(kind==='native work')f.setLive({...f.identity,workId:f.subject});
  else if(kind==='native launch')f.setLive({...f.identity,launchId:'other-launch'});
  else if(kind==='subject epoch')f.s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.subject);
  else if(kind==='subject invocation')f.s.run("UPDATE works SET data=json_set(data,'$.invocation.actor.workId',?) WHERE id=?",f.subject,f.subject);
  else if(kind==='grant limit')f.s.run("UPDATE effect_delegations SET data=json_set(data,'$.operationLimit',4) WHERE id=?",f.grant);
  else f.s.run("UPDATE effect_targets SET data=json_set(data,'$.basisCommit',?) WHERE id=?",'b'.repeat(40),f.target);
  after=ledger(f.c);return f.evidence();
 });
 await assert.rejects(f.queue(),/coordinator|context changed|invocation/i);assert.equal(ledger(f.c),after);f.pass();
});

for(const kind of ['stale operation grant','alias work','alias operation','alias reviewed assignment','missing dependency','dependency target','queued alias','reentry count','alias bytes'])test('agent tool holds '+kind+' before changing retained evidence',async t=>{
 const f=await world(t),id=await f.retry(),op=f.e.op(id),alias=op.data.assignmentId;
 if(kind==='stale operation grant')f.s.run("UPDATE effect_operations SET data=json_set(data,'$.grantEpoch',0) WHERE id=?",id);
 else if(kind==='alias work')f.s.run('UPDATE conversation_assignments SET work=? WHERE id=?',f.root,alias);
 else if(kind==='alias operation')f.s.run("UPDATE conversation_assignments SET data=json_set(data,'$.effectOperationId','other-operation') WHERE id=?",alias);
 else if(kind==='alias reviewed assignment')f.s.run("UPDATE conversation_assignments SET data=json_set(data,'$.reviewedAssignmentId','other-assignment') WHERE id=?",alias);
 else if(kind==='missing dependency')f.s.run('DELETE FROM conversation_dependencies WHERE assignment=?',alias);
 else if(kind==='dependency target')f.s.run('UPDATE conversation_dependencies SET target=? WHERE assignment=?',f.child,alias);
 else if(kind==='queued alias')f.s.run('UPDATE conversation_assignments SET state=? WHERE id=?','QUEUED',alias);
 else if(kind==='reentry count')f.s.run("UPDATE conversation_assignments SET data=json_set(data,'$.reentries',json(?)) WHERE id=?",JSON.stringify(Array(64).fill({source:f.identity})),alias);
 else f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',f.s.one('SELECT data FROM conversation_assignments WHERE id=?',alias).data+' '.repeat(65536),alias);
 const before=ledger(f.c);await assert.rejects(f.queue(),/epoch|correspondence|assignment|bounded/i);assert.equal(ledger(f.c),before);f.pass();
});

test('healthy agent retry preserves original IDs, allowances and client facts and queues only its original alias',async t=>{
 const f=await world(t),id=await f.retry(),old=f.e.op(id),budgets=f.s.all('SELECT * FROM budgets ORDER BY rowid'),runs=f.s.all('SELECT * FROM runs ORDER BY rowid'),grants=f.s.all('SELECT * FROM effect_delegations ORDER BY rowid'),sources=f.s.all('SELECT * FROM sources ORDER BY rowid');
 const result=JSON.parse((await f.queue()).content[0].text),op=f.e.op(id);
 assert.deepEqual(result,{operationId:id,assignmentId:old.data.assignmentId,conversationId:old.data.conversationId,state:'QUEUED'});
 assert.deepEqual(op,{...old,data:{...old.data,evidence:f.evidence()}});
 assert.equal(f.s.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);
 assert.deepEqual(f.s.all('SELECT * FROM budgets ORDER BY rowid'),budgets);assert.deepEqual(f.s.all('SELECT * FROM runs ORDER BY rowid'),runs);assert.deepEqual(f.s.all('SELECT * FROM effect_delegations ORDER BY rowid'),grants);assert.deepEqual(f.s.all('SELECT * FROM sources ORDER BY rowid'),sources);
 assert.deepEqual(JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',result.assignmentId).data).reentries,[{source:f.identity}]);f.pass();
});

for(const retry of [false,true])test('concurrent agent '+(retry?'retries':'first entries')+' queue one original once',async t=>{
 const f=await world(t);if(retry)await f.retry();const resolvers=[];f.setLoad(()=>new Promise(resolve=>resolvers.push(resolve)));
 const one=f.queue(),two=f.queue();assert.equal(resolvers.length,2);for(const resolve of resolvers)resolve(f.evidence());
 const outcomes=await Promise.allSettled([one,two]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.s.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);assert.equal(f.s.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.operation')='effect-prepare'").n,1);f.pass();
});

test('agent allocation repeats admission inside its owning transaction',async t=>{
 const f=await world(t);let entries=0;f.setEntry(()=>{if(++entries===3)f.s.run('UPDATE works SET generation=generation+1 WHERE id=?',f.subject);});const before=ledger(f.c);
 await assert.rejects(f.queue(),/context changed/);assert.equal(entries,3);assert.equal(ledger(f.c),before);f.pass();
});

test('late agent requeue failure rolls back evidence and alias updates',async t=>{
 const f=await world(t);await f.retry();const before=ledger(f.c),run=f.s.run;
 f.s.run=function(sql,...values){if(sql==='UPDATE conversation_state SET resource=? WHERE conversation=?'&&values[0]==='QUEUED')throw Error('Injected final requeue write failure');return run.call(this,sql,...values);};
 try{await assert.rejects(f.queue(),/Injected final requeue/);}finally{f.s.run=run;}
 assert.equal(ledger(f.c),before);f.pass();
});

test('actual source-fit receipt and renewed tokens roll back with a failed agent requeue',async t=>{
 const f=await world(t),id=await f.retry(),core=f.c.changeCore;
 const plan=core.newVersion(f.subject,'plan',null,{plan:{requirements:[{id:'R1',text:'Retained source-fit criterion'}]}},'controlled-plan');f.s.run('UPDATE change_state SET plan=? WHERE work=?',plan,f.subject);
 await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:0,text:'Actual owner explanation for retained child',mode:'idle'});f.e.recover();
 const impacts=f.c.interactionCore.impacts(f.subject);assert.equal(impacts.length,1);
 const run=f.s.one('SELECT id FROM runs WHERE work=? ORDER BY rowid LIMIT 1',f.subject),launch=randomUUID();
 // The independent adjudication is an explicit fixture. Its real consumer
 // creates and validates the original source-fit receipt, never a model claim.
 f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,f.subject,run.id,'adjudicator',1,'COMPLETE','none',JSON.stringify({stage:'source-fit'}));
 core.inputDecisions(f.subject,launch,{inputDecisions:impacts.map(i=>({inputId:i.input_id,directionRevision:i.revision,impact:'explanation',reason:'Controlled independent classification',requirementIds:['R1']}))});
 const before=ledger(f.c),original=f.s.run;let receipts=0;
 f.s.run=function(sql,...values){if(sql==='INSERT INTO effect_receipts VALUES(?,?,?,?)'&&values[2]==='source-fit-reentry')receipts++;if(sql==='UPDATE conversation_state SET resource=? WHERE conversation=?'&&values[0]==='QUEUED')throw Error('Injected final source-fit requeue failure');return original.call(this,sql,...values);};
 try{await assert.rejects(f.queue(),/Injected final source-fit/);}finally{f.s.run=original;}
 assert.equal(receipts,1);assert.equal(ledger(f.c),before);
 await f.queue();assert.equal(f.s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='source-fit-reentry'",id).n,1);f.e.validateOrigin(f.e.op(id));f.pass();
});
