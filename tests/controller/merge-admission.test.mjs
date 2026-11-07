import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCoordinationTools} from '../../dist/pi/coordination.js';
import {coordination} from '../../dist/controller/coordination.js';
import {integrationTransmissionHolds} from '../../dist/controller/integration-transmission.js';
import {subject} from './merge-controller-fixture.mjs';

// Controlled successful software/publication and live-coordinator premises;
// real queue, source, grant, Store, tool and transmission consumers. No model
// procedure completion or native publication standing is certified here.
async function agent(t,{grant=true}={}){
 const f=await subject(t),{c}=f,s=c.store,parent=c.createConversation({projectId:'P'}).conversationId;
 const rootData=JSON.parse(s.one('SELECT data FROM works WHERE id=?',f.workId).data);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...rootData,conversation:parent}),f.workId);s.run('UPDATE conversation_state SET work=? WHERE conversation=?',f.workId,parent);
 const identity={conversationId:parent,workId:f.workId,runId:randomUUID(),launchId:null,generation:c.inspectConversation(parent).generation,directionRevision:0,initialInputId:randomUUID()};
 // Controlled original run epoch for assignment capture; actual SDK provenance
 // is separately exercised in merge-sdk.test.mjs.
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',identity.runId,f.workId,1,1,'SETTLED',f.home,'released',JSON.stringify({kind:'controlled-coordinator-premise',cleanup:'not-allocated'}));
 if(grant)c.delegateMerge({workId:f.workId,targetId:f.targetId,scope:'delegation-lineage',operationLimit:1,notifications:'allow-merge-notifications'});
 const controls=coordination({store:s,interactions:c.interactionCore,identity,entry(){},delegation:{projectIds:['P'],maxAssignments:4,rootWorkId:f.workId},launch(){},onWait(){}});
 async function child(){const handle=controls.assign({projectId:'P',instructions:'Controlled current reviewed publication',operation:'change'}),assignment=s.one('SELECT * FROM conversation_assignments WHERE id=?',handle.assignmentId),data=JSON.parse(assignment.data),work=await c.changes.begin({projectId:'P',request:'Controlled current reviewed publication'},{kind:'agent-governed-assignment',actor:data.source,delegationRoot:f.workId,sourceEvent:data.instructionsSource,conversationId:assignment.target,assignmentId:assignment.id});s.run('UPDATE conversation_assignments SET state=? WHERE id=?','COMPLETE',assignment.id);s.run('UPDATE conversation_state SET work=? WHERE conversation=?',work.workId,assignment.target);return {workId:work.workId,assignmentId:assignment.id};}
 const original=await child(),evidence={workId:original.workId,epoch:1,generation:1,versions:{candidate:'CONTROLLED-ADMISSION'},fingerprint:'CONTROLLED-'+original.workId};
 const old=s.one('SELECT * FROM effect_operations WHERE id=?',f.branchOperationId),branchGrant=randomUUID(),publication=randomUUID();s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',branchGrant,f.workId,old.target,1,JSON.stringify({kind:'github-existing-ref',scope:'delegation-lineage',mode:'ordinary',rootEpoch:1,operationLimit:1,projectId:'P'}));s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',publication,original.workId,old.target,branchGrant,'CONFIRMED',JSON.stringify({...JSON.parse(old.data),evidence,reviewedAssignmentId:original.assignmentId}));
 c.changes.currentEvidence=async()=>structuredClone(evidence);c.changes.assertCurrentEvidence=value=>assert.deepEqual(value,evidence);
 const getHandle=c.interactionCore.getHandle;c.interactionCore.getHandle=id=>id===parent?{identity}:undefined;t.after(()=>{c.interactionCore.getHandle=getHandle;});
 const request={reviewedAssignmentId:original.assignmentId,targetId:f.targetId,branchOperationId:publication};
 const tool=createCoordinationTools({status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),merge:input=>c.effects.merges.queue(input,identity,()=>{})},()=>{}).find(tool=>tool.name==='conversation_merge');
 return {...f,s,parent,identity,child,evidence,request,queue:()=>tool.execute(randomUUID(),request,new AbortController().signal)};
}
const originals=f=>Object.fromEntries(['effect_operations','effect_delegations','effect_receipts','conversation_assignments','conversation_dependencies'].map(table=>[table,f.s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for(const fault of ['missing separate grant','different publication work','different reviewed assignment'])test('merge tool refuses '+fault+' without allocation or native send',async t=>{
 const f=await agent(t,{grant:fault!=='missing separate grant'});
 if(fault==='different publication work')f.request.branchOperationId=f.branchOperationId;
 if(fault==='different reviewed assignment')f.request.reviewedAssignmentId=(await f.child()).assignmentId;
 const before=originals(f);await assert.rejects(f.queue());assert.deepEqual(originals(f),before);assert.equal(f.native.puts(),0);f.native.pass();
});
test('actual owner source during awaited merge standing cannot become a refreshed native actor token',async t=>{
 const f=await agent(t);let after;
 f.c.changes.currentEvidence=async()=>{await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Actual new owner direction before merge admission',mode:'idle'});after=originals(f);return structuredClone(f.evidence);};
 await assert.rejects(f.queue(),/context changed/);assert.deepEqual(originals(f),after);assert.equal(f.native.puts(),0);f.native.pass();
});
test('branch and merge originals hold the same native receiver in both directions',async t=>{
 const f=await subject(t),s=f.c.store,old=s.one('SELECT * FROM effect_operations WHERE id=?',f.branchOperationId),source=s.one('SELECT * FROM effect_targets WHERE id=?',old.target),target=randomUUID(),grant=randomUUID(),op=randomUUID();
 const mergeGrant=f.grant();
 const config=JSON.parse(source.data);config.target.ref='refs/heads/main';s.run('INSERT INTO effect_targets VALUES(?,?,?)',target,'P',JSON.stringify(config));s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)',grant,f.workId,target,1,JSON.stringify({kind:'github-existing-ref',mode:'ordinary',scope:'work',rootEpoch:1,operationLimit:1,projectId:'P'}));s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',op,f.workId,target,grant,'UNKNOWN',JSON.stringify({kind:'github-existing-ref',dispatchRun:1}));
 assert.throws(()=>f.grant(),/held/);await assert.rejects(f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),/receiver transmission/);assert.equal(s.one('SELECT COUNT(*) AS n FROM effect_operations WHERE grant_id=?',mergeGrant.delegationId).n,0);
 s.run('UPDATE effect_operations SET phase=? WHERE id=?','CONFIRMED',op);const prepared=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId);s.run('UPDATE effect_operations SET phase=?,data=json_set(data,\'$.dispatchRun\',1) WHERE id=?','UNKNOWN',prepared.operationId);
 const holds=integrationTransmissionHolds(s,target);assert.ok(holds.some(row=>row.id===prepared.operationId&&row.unavailable===0));assert.equal(f.native.puts(),0);f.native.pass();
});
test('send is held until the original can retain its largest native response receipt',async t=>{
 const f=await subject(t);f.grant();const o=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),merges=f.c.effects.merges;
 assert.deepEqual(merges.inspectDispatch(o.operationId).holds,[]);
 // Controlled historical receipts: 1.5 MiB retained leaves less than one bounded response receipt of room.
 for(const key of ['R-history-1','R-history-2'])f.c.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)',key,o.operationId,'fixture-history',JSON.stringify({padding:'x'.repeat(786432)}));
 assert.ok(merges.inspectDispatch(o.operationId).holds.includes('Original receipt capacity unavailable'));
 f.pass?.();
});
