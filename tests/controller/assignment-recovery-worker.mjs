import nodeTest from 'node:test';
export const caseNames=[];
function test(name,body){caseNames.push(name);if(process.env.GITJIG_ASSIGNMENT_RECOVERY_CASE===name)nodeTest(name,body);}
import assert from 'node:assert/strict';
import {world} from './integration-lineage-renewal-worker.mjs';
import {effectiveAssignmentAuthority,recoverGovernedAssignment,assignmentDispatchToken,propagateRecoveredOwnerSources} from '../../dist/controller/assignment-authority.js';
import {snapshot} from './integration-registry-fixture.mjs';
import {coordination} from '../../dist/controller/coordination.js';
const plain=value=>JSON.parse(JSON.stringify(value));
function controlledReadyView(f,core,workId){
 // This fixture already controls procedure completion. Model the prior inherited
 // source-fit flags for that SAME premise; this is not an adjudication receipt.
 const prior=f.c.interactionCore.impacts(workId).filter(input=>input.data.effectHold).map(input=>({conversation:input.conversation,revision:input.revision,inputId:input.input_id,source:input.source}));
 const sources=f.s.all('SELECT * FROM sources ORDER BY id');
 for(const input of prior){const row=f.s.one('SELECT source,data FROM conversation_directions WHERE conversation=? AND revision=?',input.conversation,input.revision);assert.equal(row.source,input.source);const data=JSON.parse(row.data);assert.equal(data.inputId,input.inputId);f.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',JSON.stringify({...data,effectHold:false}),input.conversation,input.revision);}
 assert.deepEqual(f.s.all('SELECT * FROM sources ORDER BY id'),sources,'Controlled prior source-fit changes no root/child source bytes');
 return {...core.inspect(workId),reviewReady:true,fixture:'CONTROLLED_REVIEW_READY_RESULT'};
}
async function fixture(t,options={}){
 const f=await world(t,options),core=f.c.changeCore,drive=core.drive;let drives=0,lastDrive,emitted=false;core.drive=async input=>{drives++;lastDrive=input;return core.inspect(input.workId);};t.after(()=>{core.drive=drive;});
 const turn=async(action,{drain=true,model=f.model,text='Explicit original coordinator action'}={})=>{let emitted=false;f.setAction(async()=>{if(!emitted){emitted=true;return action();}return {text:'Original coordinator observed task result'};});const v=f.c.inspectConversation(f.cid);await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:v.generation,text,mode:'idle'});const result=await f.c.runConversation({conversationId:f.cid,model});assert.equal(result.status,'delivered',JSON.stringify(result));if(drain)await f.c.ordinaryCore.drain();return result;};
 // Actual tool, assignment ledger, source capture and launch; stop at drive,
 // before governed models or engine. There is no synthetic COMPLETE state.
 await turn(()=>({tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Original captured governed request',operation:'change'}}}));
 const a=f.s.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change'"),originalIdentity=f.identity();assert.ok(a?.work);assert.equal(a.state,'UNAVAILABLE');assert.equal(drives,1);await options.beforeCancel?.({...f,a,turn});await f.recover();const cancelled=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',a.id);assert.equal(cancelled.state,'CANCELLED');
 const request=()=>({assignmentId:a.id,expectedWorkEpoch:f.s.one('SELECT epoch FROM works WHERE id=?',a.work).epoch,observedDirectionRevision:f.c.inspectConversation(a.target).directionRevision,reason:'Restore exactly this original assigned task'});
 const recover=()=>turn(()=>({tool:{name:'conversation_recover_assignment',arguments:request()}}));
 return {...f,a,cancelled,originalIdentity,turn,request,recover,drives:()=>drives,lastDrive:()=>lastDrive};
}

test('actual current Pi coordinator restores original task admission without launch, then explicitly reenters that same captured work',async t=>{
 const f=await fixture(t),before=f.s.one('SELECT * FROM works WHERE id=?',f.a.work),version=f.s.one('SELECT * FROM change_state WHERE work=?',f.a.work),budgets=f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',before.lineage),grant=f.s.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.id),oldDispatch=assignmentDispatchToken(f.s,f.a.id);
 await f.recover();const a=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),w=f.s.one('SELECT * FROM works WHERE id=?',before.id);assert.equal(a.state,'RECOVERY_READY',JSON.stringify(a));assert.deepEqual(plain(w),{...plain(before),state:'ACTIVE',epoch:before.epoch+1,generation:before.generation+1});assert.equal(f.drives(),1);assert.notEqual(assignmentDispatchToken(f.s,a.id),oldDispatch);assert.deepEqual(f.s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',before.lineage),budgets);assert.deepEqual(f.s.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.id),grant);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM effect_operations').n,0);
 const data=JSON.parse(a.data),event=f.s.one('SELECT * FROM sources WHERE id=?',data.authorityRecovery.sourceId),proof=JSON.parse(event.raw);assert.deepEqual(proof.previous,plain(f.cancelled));assert.notEqual(effectiveAssignmentAuthority(f.s,a.id,true).runId,f.originalIdentity.runId);assert.equal(JSON.parse(w.data).invocation.actor.runId,f.originalIdentity.runId);assert.equal(f.s.one('SELECT base FROM change_state WHERE work=?',w.id).base,version.base);
 await assert.rejects(f.c.ordinaryCore.h.launchChange(a.id,{model:f.model}),/explicit queued reentry/);assert.equal(f.drives(),1);
 await f.turn(()=>({tool:{name:'conversation_assign',arguments:{projectId:'P',conversationId:a.target,observedDirectionRevision:f.c.inspectConversation(a.target).directionRevision,instructions:'Original captured governed request',operation:'change'}}}));
 assert.equal(f.drives(),2);assert.equal(f.lastDrive().workId,before.id);assert.equal(f.lastDrive().model.provider,f.model.provider);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);assert.equal(f.s.one('SELECT work FROM conversation_assignments WHERE id=?',a.id).work,before.id);assert.equal(effectiveAssignmentAuthority(f.s,a.id).workId,f.wid);f.pass();
});

test('old native caller cannot restore a cancelled task and refusal preserves every original record',async t=>{
 const f=await fixture(t),before=snapshot(f.c);assert.throws(()=>recoverGovernedAssignment({store:f.s,interactions:f.c.interactionCore,identity:f.originalIdentity,delegation:JSON.parse(f.s.one('SELECT data FROM works WHERE id=?',f.wid).data).delegation,entry(){},busy:()=>false},f.request()),/exact live coordinator/);assert.equal(snapshot(f.c),before);f.pass();
});

const host=f=>({store:f.s,interactions:f.c.interactionCore,identity:f.identity(),delegation:JSON.parse(f.s.one('SELECT data FROM works WHERE id=?',f.wid).data).delegation,entry(){f.c.entry(f.identity().runId);},busy:id=>f.c.integrationGrantBusy(id)});
for(const operand of ['expected epoch','target direction','instructions raw','instructions actor','input source','context task','pending input','pending goal','capacity unknown','run cleanup unknown','run reservation unknown','wrong root','overused assignment ceiling'])test('same-task recovery refuses '+operand+' through the actual current caller without changing originals',async t=>{
 const f=await fixture(t);await f.turn(()=>{const request=f.request(),undo=[];const change=(table,column,value,where,args)=>{const old=f.s.one('SELECT '+column+' AS value FROM '+table+' WHERE '+where,...args).value;f.s.run('UPDATE '+table+' SET '+column+'=? WHERE '+where,value,...args);undo.push(()=>f.s.run('UPDATE '+table+' SET '+column+'=? WHERE '+where,old,...args));};
 if(operand==='expected epoch')request.expectedWorkEpoch++;else if(operand==='target direction')request.observedDirectionRevision++;else if(operand==='instructions raw')change('sources','raw','Contradictory replacement','id=?',[JSON.parse(f.a.data).instructionsSource]);else if(operand==='instructions actor'){const id=JSON.parse(f.a.data).instructionsSource,old=JSON.parse(f.s.one('SELECT origin FROM sources WHERE id=?',id).origin);change('sources','origin',JSON.stringify({...old,actor:{...old.actor,runId:'00000000-0000-4000-8000-000000000000'}}),'id=?',[id]);}else if(operand==='input source')change('conversation_inputs','source',f.s.one('SELECT source FROM works WHERE id=?',f.wid).source,'id=?',[JSON.parse(f.a.data).inputId]);else if(operand==='context task'){const data=JSON.parse(f.s.one('SELECT data FROM works WHERE id=?',f.a.work).data);change('works','data',JSON.stringify({...data,contextOrigin:{}}),'id=?',[f.a.work]);}else if(operand==='pending input')change('conversation_inputs','state','QUEUED','id=?',[JSON.parse(f.a.data).inputId]);else if(operand==='pending goal'){change('conversation_state','resource','IDLE','conversation=?',[f.a.target]);const goal=f.c.createGoal({conversationId:f.a.target,objective:'Preserve unfinished original goal',criteria:['Separate recovery'],turnLimit:1});undo.push(()=>{f.s.run('DELETE FROM goal_events WHERE goal=?',goal.goalId);f.s.run('DELETE FROM goals WHERE id=?',goal.goalId);});}else if(operand==='capacity unknown'){const run=f.s.one('SELECT id,epoch FROM runs WHERE work=?',f.a.work),sequence=f.s.one('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM capacity_leases').n;f.s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','CONTROLLED_UNKNOWN_CAPACITY',f.a.work,run.id,run.epoch,sequence,'UNKNOWN','{}');undo.push(()=>f.s.run('DELETE FROM capacity_leases WHERE id=?','CONTROLLED_UNKNOWN_CAPACITY'));}else if(operand==='run cleanup unknown'){const row=f.s.one('SELECT id,data FROM runs WHERE work=?',f.a.work);change('runs','data',JSON.stringify({...JSON.parse(row.data),cleanup:'unknown'}),'id=?',[row.id]);}else if(operand==='run reservation unknown')change('runs','reservation','unknown','work=?',[f.a.work]);else if(operand==='wrong root'){const data=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.a.id).data);change('conversation_assignments','data',JSON.stringify({...data,delegationRoot:'00000000-0000-4000-8000-000000000000'}),'id=?',[f.a.id]);}else{for(let i=0;i<8;i++){const id='CONTROLLED_OVERUSE_'+i;f.s.run('INSERT INTO conversation_assignments SELECT ?,source_conversation,target,work,state,data FROM conversation_assignments WHERE id=?',id,f.a.id);undo.push(()=>f.s.run('DELETE FROM conversation_assignments WHERE id=?',id));}}
 const before=snapshot(f.c);try{assert.throws(()=>recoverGovernedAssignment(host(f),request));assert.equal(snapshot(f.c),before);}finally{for(const restore of undo.reverse())restore();}return {text:'Preserved original refusal'};});f.pass();
});

test('same-task recovery at the exact captured assignment limit preserves use instead of allocating a replacement',async t=>{const f=await fixture(t,{assignmentLimit:1});await f.recover();assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');assert.equal(f.s.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);f.pass();});

test('task recovery rechecks its source inside the transaction and rolls back drift with its authority event',async t=>{const f=await fixture(t);await f.turn(()=>{const before=snapshot(f.c),h=host(f);let entries=0;h.entry=()=>{f.c.entry(f.identity().runId);if(++entries===2)f.s.run("UPDATE sources SET raw=raw||' changed' WHERE id=?",JSON.parse(f.a.data).instructionsSource);};assert.throws(()=>recoverGovernedAssignment(h,f.request()),/correspondence|context changed/);assert.equal(entries,2);assert.equal(snapshot(f.c),before);return {text:'Atomic refusal preserved original task'};});f.pass();});

test('final recovered correspondence failure rolls back the task transition and authority event',async t=>{const f=await fixture(t);await f.turn(()=>{const before=snapshot(f.c),one=f.s.one;f.s.one=function(sql,...args){const row=one.call(this,sql,...args);if(sql==='SELECT resource FROM conversation_state WHERE conversation=?'&&row?.resource==='IDLE')return undefined;return row;};try{assert.throws(()=>recoverGovernedAssignment(host(f),f.request()),/correspondence unavailable/);}finally{f.s.one=one;}assert.equal(snapshot(f.c),before);return {text:'Final read refusal preserved originals'};});f.pass();});

test('recovered task history allows legitimate later transitions but refuses corrupted older epoch claims',async t=>{const f=await fixture(t);await f.recover();const first=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.a.id).data).authorityRecovery.sourceId;await f.c.cancelAssignment({assignmentId:f.a.id,reason:'Explicit original task cancellation'});await f.recover();const now=f.s.one('SELECT * FROM works WHERE id=?',f.a.work),before=snapshot(f.c),source=f.s.one('SELECT raw FROM sources WHERE id=?',first),event=JSON.parse(source.raw);f.s.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,fromEpoch:100,toEpoch:101}),first);assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id,true),/transition order/);f.s.run('UPDATE sources SET raw=? WHERE id=?',source.raw,first);assert.equal(snapshot(f.c),before);assert.equal(effectiveAssignmentAuthority(f.s,f.a.id,true).workId,f.wid);assert.ok(now.epoch>event.toEpoch);f.pass();});

for(const outcome of ['completion','error'])test('an old governed '+outcome+' tail cannot run or complete a newly restored original assignment',async t=>{
 const f=await fixture(t);await f.recover();const ordinary=f.c.ordinaryCore,launch=ordinary.h.launchChange;let release;ordinary.h.launchChange=()=>new Promise((resolve,reject)=>{release=()=>outcome==='completion'?resolve({reviewReady:true,fixture:'OLD_SETTLED_TAIL'}):reject(Error('OLD_SETTLED_TAIL'));});
 try{await f.turn(()=>({tool:{name:'conversation_assign',arguments:{projectId:'P',conversationId:f.a.target,observedDirectionRevision:f.c.inspectConversation(f.a.target).directionRevision,instructions:'Original captured governed request',operation:'change'}}}),{drain:false});assert.equal(typeof release,'function');await f.c.cancelAssignment({assignmentId:f.a.id,reason:'Withdraw the same queued original'});await f.turn(()=>({tool:{name:'conversation_recover_assignment',arguments:f.request()}}),{drain:false});const before=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),results=f.s.all('SELECT * FROM conversation_results ORDER BY rowid');assert.equal(before.state,'RECOVERY_READY');release();await ordinary.drain();assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),before);assert.deepEqual(f.s.all('SELECT * FROM conversation_results ORDER BY rowid'),results);assert.equal(f.drives(),1);f.pass();}finally{release?.();await ordinary.drain();ordinary.h.launchChange=launch;}
});

test('same-task recovery is retained through pure restart without the old startup recipe',async t=>{const f=await fixture(t);await f.recover();await f.c.close();const {openController}=await import('../../dist/controller/index.js'),c=await openController({installationHome:f.home});try{const before=snapshot(c);assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');assert.equal(effectiveAssignmentAuthority(c.store,f.a.id,true).workId,f.wid);assert.throws(()=>effectiveAssignmentAuthority(c.store,f.a.id),/queued reentry/);assert.equal(snapshot(c),before);}finally{await c.close();}f.pass();});

test('bounded repeated same-task recovery refuses growth atomically without resetting the original assignment use',async t=>{const f=await fixture(t,{assignmentLimit:1});await f.turn(async()=>{let accepted=0,held=false;for(let i=0;i<65;i++){const before=snapshot(f.c);try{recoverGovernedAssignment(host(f),f.request());accepted++;}catch(error){assert.match(String(error),/history|bounded profile/);assert.equal(snapshot(f.c),before);held=true;break;}await f.c.cancelAssignment({assignmentId:f.a.id,reason:'Repeat only this original task'});}assert.equal(accepted,64);assert.equal(held,true);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);return {text:'Bounded original recovery growth refused'};});f.pass();});

test('large mutable progress results do not invalidate original authority or asynchronous ownership tokens',async t=>{const f=await fixture(t),id=f.a.id,old=f.s.one('SELECT data FROM conversation_assignments WHERE id=?',id).data;let token=assignmentDispatchToken(f.s,id);f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...JSON.parse(old),result:{fixture:'CONTROLLED_LARGE_PROGRESS',text:'x'.repeat(131072)}}),id);assert.equal(assignmentDispatchToken(f.s,id),token);assert.equal(effectiveAssignmentAuthority(f.s,id).workId,f.wid);f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',old,id);await f.recover();token=assignmentDispatchToken(f.s,id);const restored=f.s.one('SELECT data FROM conversation_assignments WHERE id=?',id).data;f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify({...JSON.parse(restored),result:{fixture:'CONTROLLED_LARGE_PROGRESS',text:'x'.repeat(131072)}}),id);assert.equal(assignmentDispatchToken(f.s,id),token);assert.equal(effectiveAssignmentAuthority(f.s,id,true).workId,f.wid);assert.throws(()=>effectiveAssignmentAuthority(f.s,id),/queued reentry/);f.s.run('UPDATE conversation_assignments SET data=? WHERE id=?',restored,id);f.pass();});

test('a changed current coordinator model cannot replace the retained task model on reentry',async t=>{const f=await fixture(t);await f.recover();const before=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.a.id).data).modelBinding,other={...f.model,provider:f.model.provider+'-other'};await f.turn(()=>({tool:{name:'conversation_assign',arguments:{projectId:'P',conversationId:f.a.target,observedDirectionRevision:f.c.inspectConversation(f.a.target).directionRevision,instructions:'Original captured governed request',operation:'change'}}}),{model:other});assert.equal(f.drives(),1);const data=JSON.parse(f.s.one('SELECT data FROM conversation_assignments WHERE id=?',f.a.id).data);assert.deepEqual(data.modelBinding,before);assert.match(data.error,/matching explicit model route/);assert.equal(f.s.one('SELECT COUNT(*) AS n FROM conversation_assignments').n,1);f.pass();});

test('later root cancellation invalidates current task authority without hiding its historical lineage',async t=>{const f=await fixture(t);await f.recover();await f.c.cancelWork({workId:f.wid});const context=f.c.inspectOrdinaryWorkRecovery(f.wid);assert.equal(context.eligible,true);f.c.recoverOrdinaryWorkAdmission({workId:f.wid,expectedContext:context.fingerprint,reason:'Restore only the original owner root'},()=>{});const before=snapshot(f.c);assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id,true),/stale/);const {historicalGrantRoot}=await import('../../dist/controller/historical-grant.js');historicalGrantRoot(f.s,f.a.work,f.wid,'delegation-lineage');assert.equal(snapshot(f.c),before);await f.recover();assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');f.pass();});

// Later owner direction on the original root reaches the recovered task as held, unclassified source input.
const inherited=f=>f.s.all("SELECT * FROM conversation_inputs WHERE work=? AND mode='inherited-owner-source' ORDER BY rowid",f.a.work);
const laterRoot=f=>f.s.all("SELECT d.revision,d.source,s.raw FROM conversation_directions d JOIN sources s ON s.id=d.source WHERE d.conversation=? AND d.revision>? AND json_extract(s.origin,'$.kind') LIKE 'owner-%' ORDER BY d.revision",f.cid,JSON.parse(f.a.data).source.directionRevision);
const reenter=(f,observed)=>({tool:{name:'conversation_assign',arguments:{projectId:'P',conversationId:f.a.target,observedDirectionRevision:observed??f.c.inspectConversation(f.a.target).directionRevision,instructions:'Original captured governed request',operation:'change'}}});

test('recovery holds every exact later root owner input on the original task and reports the updated target direction',async t=>{
 const f=await fixture(t),text='Later owner constraint 한국어 ✓\n  exact  bytes  ',earlier=f.s.all("SELECT d.source FROM conversation_directions d WHERE d.conversation=? AND d.revision<=?",f.cid,JSON.parse(f.a.data).source.directionRevision).map(row=>row.source);let receipt;
 await f.turn(()=>({text:'Observed while the task was cancelled'}),{text:'First later owner direction'});await f.turn(()=>{receipt=recoverGovernedAssignment(host(f),f.request());return {text:'Recovered original task'};},{text});
 const rows=inherited(f),later=laterRoot(f),impacts=f.c.interactionCore.impacts(f.a.work).filter(row=>row.data.inherited);assert.ok(later.length>=2);assert.deepEqual(rows.map(row=>row.source),later.map(row=>row.source));assert.ok(rows.some(row=>row.text===text));
 for(const [i,row] of rows.entries()){const data=JSON.parse(row.data);assert.equal(row.text,later[i].raw);assert.equal(row.conversation,f.a.target);assert.equal(data.inheritedOwnerSource,later[i].source);assert.equal(data.parentConversation,f.cid);assert.equal(data.parentRevision,later[i].revision);assert.equal(data.assignment,f.a.id);assert.ok(!earlier.includes(row.source));}
 assert.deepEqual(impacts.map(row=>[row.source,row.data.effectHold,row.data.classification,row.data.affectedAssignmentId]),later.map(row=>[row.source,true,'unknown',f.a.id]));
 assert.equal(receipt.directionRevision,f.c.inspectConversation(f.a.target).directionRevision);const event=JSON.parse(f.s.one('SELECT raw FROM sources WHERE id=?',receipt.sourceId).raw);assert.equal(event.root.direction,later.at(-1).revision);assert.equal(effectiveAssignmentAuthority(f.s,f.a.id,true).workId,f.wid);assert.equal(f.drives(),1);f.pass();
});

test('later root owner input propagates once through the input subscription and an old observed target direction cannot reenter',async t=>{
 const f=await fixture(t);await f.recover();const first=inherited(f).length,stale=f.c.inspectConversation(f.a.target).directionRevision;
 await f.turn(()=>reenter(f,stale),{text:'Second later owner direction'});assert.equal(f.drives(),1);const rows=inherited(f);assert.equal(rows.length,first+1);assert.equal(rows.at(-1).text,'Second later owner direction');assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');
 const before=snapshot(f.c);assert.equal(propagateRecoveredOwnerSources(f.s,f.a.id),f.c.inspectConversation(f.a.target).directionRevision);assert.equal(snapshot(f.c),before);
 await f.turn(()=>reenter(f),{text:'Third later owner direction'});assert.equal(f.drives(),2);assert.deepEqual(inherited(f).map(row=>row.source),laterRoot(f).map(row=>row.source));assert.ok(f.c.interactionCore.impacts(f.a.work).filter(row=>row.data.inherited).every(row=>row.data.effectHold));f.pass();
});

test('a failed propagation keeps the accepted root input, holds the recovered task and launch propagates before dispatch',async t=>{
 const f=await fixture(t);await f.recover();const run=f.s.run;let failing=true,faults=0;f.s.run=function(sql,...args){if(failing&&sql.startsWith('INSERT INTO conversation_inputs')&&args[3]===f.a.work){faults++;throw Error('CONTROLLED_PROPAGATION_FAULT');}return run.call(this,sql,...args);};
 try{await f.turn(()=>{failing=false;const root=laterRoot(f).at(-1);assert.equal(root.raw,'Held after a controlled listener fault');assert.ok(!inherited(f).some(row=>row.source===root.source));assert.throws(()=>effectiveAssignmentAuthority(f.s,f.a.id,true),/not yet held/);return reenter(f);},{text:'Held after a controlled listener fault'});}finally{f.s.run=run;}
 assert.equal(faults,1);assert.equal(f.drives(),2);assert.deepEqual(inherited(f).map(row=>row.source),laterRoot(f).map(row=>row.source));f.pass();
});

test('later owner input beyond the aggregate bound refuses recovery atomically without truncation',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.turn(()=>({text:'Observed large owner direction'}),{text:String(i).repeat(400*1024)});
 await f.turn(()=>{const before=snapshot(f.c);assert.throws(()=>recoverGovernedAssignment(host(f),f.request()),/bounded profile/);assert.equal(snapshot(f.c),before);return {text:'Bounded refusal preserved originals'};});assert.equal(inherited(f).length,0);assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'CANCELLED');f.pass();
});

test('cancelling a recovered task withdraws inherited dispatch while retaining held source and repeated recovery does not duplicate it',async t=>{
 const f=await fixture(t);await f.recover();const rows=inherited(f);assert.ok(rows.length);await f.c.cancelAssignment({assignmentId:f.a.id,reason:'Explicit original task cancellation'});
 assert.ok(inherited(f).every(row=>row.state==='CANCELLED'));assert.ok(f.c.interactionCore.impacts(f.a.work).filter(row=>row.data.inherited).every(row=>row.data.effectHold));await f.turn(()=>({text:'Owner direction while cancelled'}),{text:'Owner direction while cancelled'});assert.equal(inherited(f).length,rows.length);
 await f.recover();const after=inherited(f);assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'RECOVERY_READY');assert.deepEqual(after.map(row=>row.source),laterRoot(f).map(row=>row.source));assert.equal(new Set(after.map(row=>row.source)).size,after.length);f.pass();
});

test('bounds apply only to owner input not yet held, so cumulative propagated input does not block later admission',async t=>{
 const f=await fixture(t);await f.recover();for(let i=0;i<3;i++)await f.turn(()=>({text:'Observed large owner direction'}),{text:String(i).repeat(400*1024)});
 assert.deepEqual(inherited(f).map(row=>row.source),laterRoot(f).map(row=>row.source));assert.ok(inherited(f).reduce((n,row)=>n+Buffer.byteLength(row.text),0)>1048576);assert.equal(effectiveAssignmentAuthority(f.s,f.a.id,true).workId,f.wid);
 await f.turn(()=>reenter(f));assert.equal(f.drives(),2);f.pass();
});

test('a completed recovered result stops propagation; later root input is left to operation inheritance',async t=>{
 const f=await fixture(t);await f.recover();const core=f.c.changeCore,drive=core.drive;core.drive=async input=>controlledReadyView(f,core,input.workId);
 try{await f.turn(()=>reenter(f));}finally{core.drive=drive;}assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'COMPLETE');const count=inherited(f).length;
 await f.turn(()=>({text:'Observed after completion'}),{text:'Owner direction after the completed result'});assert.equal(inherited(f).length,count);assert.equal(effectiveAssignmentAuthority(f.s,f.a.id).workId,f.wid);assert.equal(propagateRecoveredOwnerSources(f.s,f.a.id),null);f.pass();
});

test('a review-ready result of a recovered task stays unavailable while later owner input is not held',async t=>{
 const f=await fixture(t);await f.recover();const core=f.c.changeCore,drive=core.drive,run=f.s.run;let failing=false;
 core.drive=async input=>{const ready=controlledReadyView(f,core,input.workId);failing=true;try{await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'Owner direction during the running task',mode:'follow-up'});}finally{failing=false;}return ready;};
 f.s.run=function(sql,...args){if(failing&&sql.startsWith('INSERT INTO conversation_inputs')&&args[3]===f.a.work)throw Error('CONTROLLED_PROPAGATION_FAULT');return run.call(this,sql,...args);};
 try{await f.turn(()=>reenter(f));}finally{core.drive=drive;f.s.run=run;}
 const a=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id);assert.equal(a.state,'UNAVAILABLE');assert.match(JSON.parse(a.data).error,/not yet held.*cancel this assignment, recover it, then reenter/);const published=f.s.one("SELECT data FROM conversation_results WHERE json_extract(data,'$.assignmentId')=? ORDER BY rowid DESC LIMIT 1",f.a.id);assert.ok(published,'held result remains published');assert.match(published.data,/assignmentHold/);
 const data=JSON.parse(a.data),compact=JSON.parse(published.data).result;assert.ok(Buffer.byteLength(JSON.stringify(compact))<=8192);let cursor=0,text='';
 do{const page=await f.c.inspectConversationResultDetail({resultId:data.resultId,fingerprint:compact.detailRef.sha256,cursor});text+=page.text;cursor=page.nextCursor;}while(cursor!==null);
 assert.equal(JSON.parse(text).assignmentHold,compact.assignmentHold,'Original detail retains the exact host completion hold');
 const input=f.s.one("SELECT i.*,d.data AS direction_data,s.raw FROM conversation_inputs i JOIN conversation_directions d ON d.conversation=i.conversation AND d.source=i.source JOIN sources s ON s.id=i.source WHERE i.conversation=? AND i.text='Owner direction during the running task'",f.cid);assert.ok(input);assert.equal(input.raw,'Owner direction during the running task');assert.equal(JSON.parse(input.direction_data).effectHold,true);assert.ok(!inherited(f).some(row=>row.source===input.source),'New actual root input stays unpropagated; prior-flag alignment never touches it');f.pass();
});

// Native-origin integration reauthorization. Controlled premises: completion (drive), procedure
// evidence (currentEvidence), source-fit decisions (accountFor) and launchEffect, which stops the
// requeued alias after queue admission, so it never prepares or sends here. Assignment,
// cancellation, recovery, grant renewal and the conversation_integrate tool use actual paths.
// Refusal cases for held input, agent cancellation and possible transmission are controlled
// SQLite faults, labelled in each case.
const evidenceFor=f=>{const w=f.s.one('SELECT * FROM works WHERE id=?',f.a.work);return {workId:w.id,epoch:w.epoch,generation:w.generation,versions:{candidate:'CONTROLLED-CURRENT-CANDIDATE'},fingerprint:'CONTROLLED-'+w.id+'-'+w.epoch};};
const complete=async f=>{const core=f.c.changeCore,drive=core.drive;core.drive=async input=>({...core.inspect(input.workId),reviewReady:true,fixture:'CONTROLLED_REVIEW_READY_RESULT'});try{await f.turn(()=>reenter(f));}finally{core.drive=drive;}assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',f.a.id).state,'COMPLETE');};
const integrate=f=>f.turn(()=>({tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:f.a.id,targetId:f.target}}}));
const accountFor=f=>{for(const row of f.c.interactionCore.impacts(f.a.work).filter(row=>row.data.effectHold))f.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',JSON.stringify({...row.data,effectHold:false,decision:{fixture:'CONTROLLED_SOURCE_FIT',inputId:row.input_id,impact:'explanation'}}),row.conversation,row.revision);};
async function integrationWorld(t,{renew=true,recoverTask=true}={}){
 let launches=0;const f=await fixture(t,{beforeCancel:async g=>{
  const core=g.c.changeCore,load=core.currentEvidence,check=core.assertCurrentEvidence,ordinary=g.c.ordinaryCore,launch=ordinary.h.launchEffect;
  core.currentEvidence=async id=>{assert.equal(id,g.a.work);return evidenceFor(g);};core.assertCurrentEvidence=evidence=>assert.deepEqual(evidence,evidenceFor(g));ordinary.h.launchEffect=async()=>{launches++;return {phase:'REFUSED',fixture:'STOP_AFTER_ACTUAL_QUEUE_ADMISSION'};};
  t.after(()=>{core.currentEvidence=load;core.assertCurrentEvidence=check;ordinary.h.launchEffect=launch;});
  await complete(g);accountFor(g);await integrate(g);assert.equal(launches,1);
 }});
 const op=f.s.one('SELECT * FROM effect_operations WHERE work=?',f.a.work);assert.equal(op.phase,'REFUSED');const alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',JSON.parse(op.data).assignmentId);assert.equal(alias.state,'CANCELLED');
 if(renew){const context=f.c.inspectIntegrationGrantRenewal(f.wid,f.target);assert.equal(context.eligible,true,JSON.stringify(context.holds));f.c.renewOwnerIntegration({workId:f.wid,targetId:f.target,expectedContext:context.fingerprint,reason:'Renew unchanged original lineage ceiling'},()=>{});}if(recoverTask){await f.recover();await complete(f);accountFor(f);}
 return {...f,op,alias,launches:()=>launches};
}
const ledgerCounts=f=>({operations:f.s.one('SELECT COUNT(*) AS n FROM effect_operations').n,assignments:f.s.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.delegationRoot')=?",f.wid).n,sends:f.s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='send'").n});

test('a current coordinator reauthorizes the same cancelled native integration after task recovery without a new operation or send',async t=>{
 const f=await integrationWorld(t),counts=ledgerCounts(f),dependency=f.s.one('SELECT * FROM conversation_dependencies WHERE assignment=?',f.alias.id),grant=f.s.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.id);let caller;
 await f.turn(()=>{caller=f.identity();return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:f.a.id,targetId:f.target}}};});
 const op=f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),data=JSON.parse(op.data),receipt=f.s.one("SELECT * FROM effect_receipts WHERE operation=? AND kind='agent-reauthorization'",op.id),event=JSON.parse(receipt.data);
 assert.equal(op.phase,'PREPARED');assert.equal(op.grant_id,f.grant.id);assert.equal(data.grantEpoch,grant.epoch);assert.ok(grant.epoch>JSON.parse(f.op.data).grantEpoch);assert.equal(data.origin.identity.runId,caller.runId);assert.equal(data.assignmentId,f.alias.id);assert.equal(data.evidence.epoch,evidenceFor(f).epoch);
 for(const key of ['expectedBase','integrationCommit','headCommit','projectionReceipt','noChange','authority'])assert.equal(Object.hasOwn(data,key),false);
 assert.deepEqual(event.previous.operation,plain(f.op));assert.deepEqual(event.previous.alias,plain(f.alias));assert.equal(event.previous.alias.state,'CANCELLED');assert.equal(event.previous.dependency.id,dependency.id);
 assert.deepEqual(ledgerCounts(f),counts);assert.equal(f.launches(),2);const alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id);assert.equal(JSON.parse(alias.data).reentries.at(-1).reauthorization,receipt.id);assert.equal(f.s.one('SELECT id FROM conversation_dependencies WHERE assignment=?',f.alias.id).id,dependency.id);f.pass();
});

test('actual SDK WAIT resumption reauthorizes its cancelled original integration while retaining historical handles',async t=>{
 const f=await integrationWorld(t),counts=ledgerCounts(f);f.c.extendExecutionAllowance({workId:f.wid,additional:4,reason:'Allow actual WAIT and resumed original integration'});let phase=0;
 f.setAction(async()=>{
  if(phase++===0)return {tool:{name:'conversation_wait',arguments:{resultHandles:[f.a.id]}}};
  if(phase===2){const state=f.s.one('SELECT * FROM conversation_state WHERE conversation=?',f.cid),data=JSON.parse(state.data);assert.equal(state.resource,'RUNNING');assert.equal(data.runId,f.identity().runId);assert.equal(data.continuationAuthorized,false);assert.equal(Object.hasOwn(data,'waitHandles'),false);assert.equal(Object.hasOwn(data,'sourceIdentity'),false);assert.deepEqual(data.explicitContinuation.waitHandles,[f.a.id]);assert.equal(data.explicitContinuation.newRunId,f.identity().runId);accountFor(f);return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:f.a.id,targetId:f.target}}};}
  return {text:'Resumed coordinator observed original integration admission'};
 });
 const view=f.c.inspectConversation(f.cid);await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:view.generation,text:'Wait for the original recovered child, then reauthorize its original integration',mode:'idle'});
 const waiting=await f.c.runConversation({conversationId:f.cid,model:f.model});assert.equal(waiting.status,'waiting');await f.c.ordinaryCore.drain();
 assert.equal(phase,3);assert.ok(f.s.one("SELECT id FROM effect_receipts WHERE operation=? AND kind='agent-reauthorization'",f.op.id));assert.equal(f.launches(),2);assert.deepEqual(ledgerCounts(f),counts);f.pass();
});

for(const fault of ['authorized continuation','WAITING resource','stale current run','different state work'])test('native integration reauthorization refuses coordinator '+fault+' without rewriting originals',async t=>{
 const f=await integrationWorld(t),counts=ledgerCounts(f),before=f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id);
 await f.turn(async()=>{const state=f.s.one('SELECT * FROM conversation_state WHERE conversation=?',f.cid),data=JSON.parse(state.data);
  if(fault==='authorized continuation')data.continuationAuthorized=true;
  if(fault==='stale current run')data.runId='CONTROLLED_STALE_RUN';
  f.s.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?',fault==='different state work'?f.a.work:state.work,fault==='WAITING resource'?'WAITING':state.resource,JSON.stringify(data),f.cid);
  try{await assert.rejects(f.c.effects.queueIntegration({reviewedAssignmentId:f.a.id,targetId:f.target},f.identity(),()=>f.c.entry(f.identity().runId)),/current coordinator under the same original owner root/);}
  finally{f.s.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?',state.work,state.resource,state.data,f.cid);}
  return {text:'Preserved original coordinator refusal'};
 });
 assert.deepEqual(f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),before);assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),alias);assert.deepEqual(ledgerCounts(f),counts);assert.equal(f.launches(),1);f.pass();
});

// 'grant not renewed' and 'task not recovered' are held by existing admission before the new branch.
for(const operand of ['grant not renewed','task not recovered','held owner input','agent cancellation','uncertain transmission'])test('native integration reauthorization refuses '+operand+' without changing originals',async t=>{
 const f=await integrationWorld(t,{renew:operand!=='grant not renewed',recoverTask:operand!=='task not recovered'});
 if(operand==='held owner input'){const row=f.c.interactionCore.impacts(f.a.work).at(-1);f.s.run('UPDATE conversation_directions SET data=? WHERE conversation=? AND revision=?',JSON.stringify({...row.data,effectHold:true}),row.conversation,row.revision);}
 if(operand==='agent cancellation'){const source=JSON.parse(f.alias.data).cancellationSource;f.s.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({kind:'agent-assignment-cancel',actor:f.originalIdentity}),source);}
 if(operand==='uncertain transmission')f.s.run("INSERT INTO effect_receipts VALUES(?,?,?,?)",'controlled-send-'+f.op.id,f.op.id,'send',JSON.stringify({handoff:'possible',fixture:'CONTROLLED_UNCERTAIN_SEND'}));
 const counts=ledgerCounts(f),before=f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),launches=f.launches();
 const cause={'grant not renewed':/No actual current owner grant/,'task not recovered':/completed governed reviewed assignment/,'held owner input':/every owner input accounted/,'agent cancellation':/alias was not withdrawn by the owner cancellation/,'uncertain transmission':/definitely-unsent/}[operand];
 await f.turn(async()=>{await assert.rejects(f.c.effects.queueIntegration({reviewedAssignmentId:f.a.id,targetId:f.target},f.identity(),()=>f.c.entry(f.identity().runId)),cause);return {text:'Original integration refusal observed'};});assert.deepEqual(f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),before);assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),alias);assert.deepEqual(ledgerCounts(f),counts);assert.equal(f.launches(),launches);assert.equal(f.s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='agent-reauthorization'").n,0);f.pass();
});

test('native integration reauthorization rolls back a late fault atomically and a repeated request cannot reauthorize twice',async t=>{
 const f=await integrationWorld(t),effects=f.c.effects,assertGrant=effects.assertPreparationGrant,counts=ledgerCounts(f),before=f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),dependency=f.s.one('SELECT * FROM conversation_dependencies WHERE assignment=?',f.alias.id);
 const request=()=>f.c.effects.queueIntegration({reviewedAssignmentId:f.a.id,targetId:f.target},f.identity(),()=>f.c.entry(f.identity().runId));
 await f.turn(async()=>{effects.assertPreparationGrant=()=>{throw Error('CONTROLLED_LATE_FAULT');};try{await assert.rejects(request(),/CONTROLLED_LATE_FAULT/);}finally{effects.assertPreparationGrant=assertGrant;}return {text:'Late fault observed'};});
 assert.deepEqual(f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),before);assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),alias);assert.deepEqual(f.s.one('SELECT * FROM conversation_dependencies WHERE assignment=?',f.alias.id),dependency);assert.equal(f.s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='agent-reauthorization'").n,0);
 await f.turn(async()=>{const first=await request();assert.equal(first.reauthorized,true);await assert.rejects(request(),/active or uncertain/);return {text:'Single reauthorization observed'};});
 assert.equal(f.s.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE kind='agent-reauthorization'").n,1);assert.deepEqual(ledgerCounts(f),counts);f.pass();
});

test('a task cancelled and recovered again after the withdrawing owner cancellation cannot reauthorize its old integration',async t=>{
 const f=await integrationWorld(t);f.c.extendExecutionAllowance({workId:f.wid,additional:10,reason:'Owner allows further coordinator turns'});await f.c.cancelAssignment({assignmentId:f.a.id,reason:'Separate later task cancellation'});await f.recover();await complete(f);accountFor(f);
 const counts=ledgerCounts(f),before=f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),alias=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),launches=f.launches();
 await f.turn(async()=>{await assert.rejects(f.c.effects.queueIntegration({reviewedAssignmentId:f.a.id,targetId:f.target},f.identity(),()=>f.c.entry(f.identity().runId)),/alias was not withdrawn by the owner cancellation/);return {text:'Different cancellation refusal observed'};});
 assert.deepEqual(f.s.one('SELECT * FROM effect_operations WHERE id=?',f.op.id),before);assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.alias.id),alias);assert.deepEqual(ledgerCounts(f),counts);assert.equal(f.launches(),launches);f.pass();
});


test('actual Pi status supplies the cancelled original task epoch for later explicit same-task recovery',async t=>{
 const f=await fixture(t);
 const messages=async()=> (await f.c.getConversationHistory(f.cid)).sessionManager.getEntries().filter(entry=>entry.type==='message').map(entry=>entry.message);
 const receipt=(entries,name)=>JSON.parse(entries.findLast(message=>message.role==='toolResult'&&message.toolName===name).content.filter(part=>part.type==='text').map(part=>part.text).join(''));
 const original=receipt(await messages(),'conversation_assign');assert.equal(original.assignmentId,f.a.id);
 const before=f.c.inspectWork(f.a.work),assignment=f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),grant=f.s.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.id);
 await f.turn(()=>({tool:{name:'conversation_status',arguments:{conversationId:original.conversationId}}}));
 const observed=receipt(await messages(),'conversation_status');assert.equal(observed.workId,before.workId);assert.equal(observed.workEpoch,before.epoch);
 assert.deepEqual(f.c.inspectWork(f.a.work),before);assert.deepEqual(f.s.one('SELECT * FROM conversation_assignments WHERE id=?',f.a.id),assignment);assert.deepEqual(f.s.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.id),grant);assert.equal(f.drives(),1);
 await f.turn(()=>({tool:{name:'conversation_recover_assignment',arguments:{assignmentId:original.assignmentId,expectedWorkEpoch:observed.workEpoch,observedDirectionRevision:observed.directionRevision,reason:'Use the observed original task epoch without side-channel state'}}}));
 const recovered=receipt(await messages(),'conversation_recover_assignment');assert.equal(recovered.assignmentId,original.assignmentId);assert.equal(f.s.one('SELECT state FROM conversation_assignments WHERE id=?',original.assignmentId).state,'RECOVERY_READY');assert.equal(f.drives(),1);f.pass();
});


test('status epoch observation preserves current visibility and refuses inconsistent bound metadata',async t=>{
 const f=await fixture(t),empty=f.c.createConversation({projectId:'P'}),foreign=f.c.createConversation();
 await f.turn(()=>{
  const controls=coordination({...host(f),launch(){throw Error('Status must not launch');},onWait(){throw Error('Status must not wait');}}),before=snapshot(f.c);
  const target=controls.status({conversationId:f.a.target});assert.equal(target.workEpoch,f.c.inspectWork(f.a.work).epoch);
  assert.equal(controls.status({conversationId:empty.conversationId}).workEpoch,null);
  const listed=controls.status({});assert.ok(listed.some(view=>view.conversationId===empty.conversationId&&view.workEpoch===null));assert.ok(!listed.some(view=>view.conversationId===foreign.conversationId));
  assert.throws(()=>controls.status({conversationId:foreign.conversationId}),/outside explicit captured delegation/);
  assert.equal(Object.hasOwn(f.c.inspectConversation(f.a.target),'workEpoch'),false,'Do not change the shared conversation view');
  assert.equal(snapshot(f.c),before,'Metadata reads and refusal preserve every application record');
  const one=f.s.one;
  for(const fault of [undefined,{epoch:0},{epoch:1.5}]){
   f.s.one=function(sql,...args){const projection=/^SELECT ([\w, ]+) FROM works WHERE id=\?$/u.exec(sql);return projection&&projection[1].split(/\s*,\s*/u).includes('epoch')&&args[0]===f.a.work?fault:one.call(this,sql,...args);};
   try{assert.throws(()=>controls.status({conversationId:f.a.target}),/work epoch unavailable/);}finally{f.s.one=one;}
   assert.equal(snapshot(f.c),before,'Invalid observation cannot change authority or state');
  }
  return {text:'Observed scoped epochs without dispatch or new authority'};
 });assert.equal(f.drives(),1);f.pass();
});
