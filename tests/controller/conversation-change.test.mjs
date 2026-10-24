import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
const tables=['sources','works','requirements','budgets','runs','change_state','change_versions','effect_delegations','conversation_state'];
const ledger=c=>Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
const pendingRecovery=inputId=>error=>{assert.match(error.message,/Earlier conversation requests or work still need attention/);assert.match(error.recovery,/Use \/inputs/);assert.match(error.recovery,/inspect \/work/);assert.ok(error.recovery.includes('input:'+inputId));return true;};
const latch=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function world(t){
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/conversation-change-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Original governed input');
 const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});await c.registerProject({id:'P',sourceRoot:source});await c.registerProject({id:'Q',sourceRoot:await fs.realpath(await fs.mkdtemp(path.join(root,'other-')))});
 const accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c);await accounts.configure({providers:{'owner-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED',models:[{id:'original'},{id:'later'}]}}});await accounts.setDefault('owner-fixture','original');models.install();const conversation=await models.newConversation({projectId:'P'}),cid=conversation.conversationId;
 const options=async()=>({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedModelRevision:c.getConversationModelChoice(cid).revision,projectId:'P',request:'Explicit owner intent',applicationModelBaseline:{...await models.baseline('P',c.getConversationModelChoice(cid)),source:{kind:'conversation',conversationId:cid,choiceRevision:c.getConversationModelChoice(cid).revision}}});
 // Capture/ledger/admission/activation are actual. The drive boundary is controlled;
 // these tests do not claim execution, review readiness or a provider endpoint.
 const calls=[];c.changes.drive=async input=>{calls.push(input);return c.inspectChange(input.workId);};
 return{root,home,source,c,models,accounts,cid,options,calls};
}

test('actual owner admission binds source conversation/project/model and calls drive under one supervisor',async t=>{
 const f=await world(t),view=await f.c.startConversationChange(await f.options()),s=f.c.store,w=s.one('SELECT * FROM works WHERE id=?',view.workId),data=JSON.parse(w.data),source=s.one('SELECT * FROM sources WHERE id=?',w.source);
 assert.equal(data.conversation,f.cid);assert.equal(source.conversation,f.cid);assert.equal(JSON.parse(source.origin).kind,'owner-conversation-change');assert.equal(s.one('SELECT work FROM conversation_state WHERE conversation=?',f.cid).work,w.id);assert.equal(view.ownerActivation,'complete');assert.equal(data.applicationModelBaseline.choice.modelId,'original');assert.equal(f.calls[0].workId,w.id);assert.deepEqual(f.calls[0].applicationModel,{version:1,baselineRevision:1});assert.equal(f.c.managedOperations.size,0);assert.equal(f.c.conversationChange(f.cid).workId,w.id);
 const before=ledger(f.c),retry=await f.options();assert.throws(()=>f.c.startConversationChange({...retry,request:'Different intent must not replace original'}),e=>e.code==='RETAINED_CHANGE'&&e.workId===w.id);assert.deepEqual(ledger(f.c),before);
});

test('leased preparation rejects competing input, scope, model, goal and managed start; navigation is independent',async t=>{
 const f=await world(t),options=await f.options(),pending=f.c.startConversationChange(options);
 assert.throws(()=>f.c.setConversationProject({conversationId:f.cid,expectedGeneration:0,projectId:'Q'}),/Managed conversation/);
 await assert.rejects(f.models.select({conversationId:f.cid,expectedGeneration:0,expectedRevision:options.expectedModelRevision,provider:'owner-fixture',modelId:'later'}),/Managed conversation/);
 assert.throws(()=>f.c.createGoal({conversationId:f.cid,objective:'Must not compete'}),/Managed conversation/);
 assert.throws(()=>f.c.startConversationChange(options),/Managed conversation/);
 assert.throws(()=>f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text:'Competing input',mode:'idle'}),/Managed conversation/);
 const other=f.c.createConversation({projectId:'Q'});f.c.setConversationView({selectedId:other.conversationId,secondId:f.cid});assert.equal(f.c.inspectConversation(other.conversationId).projectId,'Q');
 await pending;assert.equal(f.calls.length,1);
});

test('supervisor closes stage gaps to same-work public dispatch, while actual run entry remains usable',async t=>{
 const f=await world(t),entered=latch(),release=latch();f.c.changes.drive=async input=>{entered.resolve(input);await Promise.race([release.promise,new Promise(resolve=>input.signal.addEventListener('abort',resolve,{once:true}))]);return f.c.inspectChange(input.workId);};
 const pending=f.c.startConversationChange(await f.options()),input=await entered.promise,run=f.c.store.one('SELECT id FROM runs WHERE work=?',input.workId);
 f.c.assertRunEntry(run.id);
 assert.throws(()=>f.c.driveChange({workId:input.workId,applicationModel:{version:1,baselineRevision:1}}),/supervisor active/);assert.throws(()=>f.c.checkChange({workId:input.workId}),/supervisor active/);assert.throws(()=>f.c.activateChangeOwner({workId:input.workId,expectedEpoch:1}),/supervisor active/);
 await assert.rejects(f.c.archiveConversation({conversationId:f.cid,expectedGeneration:0}),/Managed conversation/);assert.throws(()=>f.c.beginApplicationMutation(),/managed conversation operations/);
 release.resolve();await pending;assert.equal(f.c.managedOperations.size,0);
});

async function ordinary(f){
 f.c.capacity.acquire=async()=>{throw Error('CONTROLLED_NO_ENGINE_ADMISSION');};
 const receipt=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'Original ordinary source',mode:'idle'});
 const turn=await f.c.runConversation({conversationId:f.cid,initialInputId:receipt.inputId,...f.models.conversationOperation(f.cid)});assert.equal(turn.status,'unavailable');
 // This is a controlled settled-source ledger for transition tests. The real
 // failed attempt retains INITIAL_RESERVED and must refuse before this fixture acknowledgement.
 assert.throws(()=>f.c.startConversationChange({...{conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,projectId:'P',request:'Do not bypass pending input',model:{provider:'fixture',modelId:'unused'}}}),pendingRecovery(receipt.inputId));
 f.c.store.run("UPDATE conversation_inputs SET state='CONSUMED' WHERE id=?",receipt.inputId);return turn.workId;
}

test('ordinary-to-governed entry preserves source identity, family ceiling and consumed allowances',async t=>{
 const f=await world(t),prior=await ordinary(f),s=f.c.store;s.run('UPDATE budgets SET lim=2 WHERE lineage=? AND kind=?',prior,'execution');s.run('UPDATE budgets SET lim=3,consumed=2 WHERE lineage=? AND kind=?',prior,'resolution');
 const view=await f.c.startConversationChange(await f.options()),w=s.one('SELECT * FROM works WHERE id=?',view.workId),data=JSON.parse(w.data);
 assert.equal(w.predecessor,prior);assert.equal(w.lineage,prior);assert.equal(data.contextContinuation.sourceWorkId,prior);assert.equal(view.execution.limit,2);assert.equal(view.execution.consumed,2);assert.equal(view.resolution.limit,3);assert.equal(view.resolution.consumed,2);assert.equal(data.ownerRootActivation,undefined);assert.equal(s.one('SELECT COUNT(*) AS n FROM budgets').n,2);
});

test('exhausted inherited allowance and explicit reset attempt roll back family anchoring and new work',async t=>{
 const f=await world(t),prior=await ordinary(f),s=f.c.store;s.run('UPDATE budgets SET lim=1 WHERE lineage=? AND kind=?',prior,'execution');let before=ledger(f.c);
 await assert.rejects(f.c.startConversationChange(await f.options()),/allowance exhausted/);assert.deepEqual(ledger(f.c),before);
 s.run('UPDATE budgets SET lim=8 WHERE lineage=? AND kind=?',prior,'execution');before=ledger(f.c);
 await assert.rejects(f.c.startConversationChange({...await f.options(),executionLimit:32}),/cannot be reset/);assert.deepEqual(ledger(f.c),before);assert.equal(f.c.managedOperations.size,0);
});

test('first-family governed entry is classified as governed without fresh owner authority',async t=>{
 const f=await world(t),clone=await f.c.forkConversation({kind:'clone',conversationId:f.cid,expectedGeneration:0,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision}),cid=clone.conversationId;
 const options={...await f.options(),conversationId:cid,expectedModelRevision:f.c.getConversationModelChoice(cid).revision};options.applicationModelBaseline={...await f.models.baseline('P',f.c.getConversationModelChoice(cid)),source:{kind:'conversation',conversationId:cid,choiceRevision:options.expectedModelRevision}};
 const view=await f.c.startConversationChange(options),data=JSON.parse(f.c.store.one('SELECT data FROM works WHERE id=?',view.workId).data);
 assert.equal(data.continuationWorkId,view.workId);assert.equal(data.continuationSourceWorkId,undefined);assert.equal(data.ownerRootActivation,undefined);assert.equal(f.c.conversationChange(f.cid).workId,view.workId);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_delegations').n,0);
});

test('strict review source and ambiguous known originals refuse before new admission',async t=>{
 const f=await world(t),options=await f.options(),s=f.c.store,original=s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data;
 s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...JSON.parse(original),role:'reviewer'}),f.cid);let before=ledger(f.c);assert.throws(()=>f.c.startConversationChange(options),/strict role view/);assert.deepEqual(ledger(f.c),before);s.run('UPDATE conversation_state SET data=? WHERE conversation=?',original,f.cid);
 for(let i=0;i<2;i++){const work=await f.c.beginChange({projectId:'P',request:'Original '+i});const data=JSON.parse(s.one('SELECT data FROM works WHERE id=?',work.workId).data);s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...data,conversation:f.cid}),work.workId);}
 before=ledger(f.c);assert.throws(()=>f.c.startConversationChange(options),/ambiguous governed originals/);assert.deepEqual(ledger(f.c),before);
});

test('resume retains original model despite a changed current selection; no replacement source or allowance',async t=>{
 const f=await world(t),begun=await f.c.startConversationChange(await f.options());await f.models.select({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedRevision:f.c.getConversationModelChoice(f.cid).revision,provider:'owner-fixture',modelId:'later'}).catch(e=>{assert.match(e.message,/LIFECYCLE_HELD/);});
 // Controlled later selection represents an explicit future preference. Frozen work baseline stays original.
 const choice=f.c.getConversationModelChoice(f.cid);const state=JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data);f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...state,modelChoice:{...choice,modelId:'later',revision:choice.revision+1}}),f.cid);
 const before=ledger(f.c),view=await f.c.resumeConversationChange({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,workId:begun.workId,expectedEpoch:begun.epoch});
 assert.equal(view.workId,begun.workId);assert.equal(f.c.getWorkApplicationModelBaseline(view.workId).choice.modelId,'original');assert.deepEqual(ledger(f.c),before);assert.deepEqual(f.calls.at(-1).applicationModel,{version:1,baselineRevision:1});
});

test('cancel and close abort and join the whole supervised stage gap before resource release',async t=>{
 const f=await world(t),entered=latch(),tail=latch();let finished=false,resourceClosed=false;
 f.c.changes.drive=async input=>{entered.resolve(input);await new Promise(resolve=>input.signal.aborted?resolve():input.signal.addEventListener('abort',resolve,{once:true}));await tail.promise;finished=true;return f.c.inspectChange(input.workId);};
 f.c.adoptApplicationResource({close:async()=>{assert.equal(finished,true);resourceClosed=true;}});
 const pending=f.c.startConversationChange(await f.options()),input=await entered.promise,closing=f.c.close();await Promise.resolve();assert.equal(resourceClosed,false);assert.equal(input.signal.aborted,true);tail.resolve();await assert.rejects(pending,e=>e.workId===input.workId&&/closed or closing/.test(e.message));await closing;assert.equal(resourceClosed,true);
});

test('changed startup delegation cannot widen a retained ordinary source ceiling',async t=>{
 const f=await world(t),prior=await ordinary(f),s=f.c.store,data=JSON.parse(s.one('SELECT data FROM works WHERE id=?',prior).data);
 s.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({...data,delegation:{projectIds:['P'],maxAssignments:2,rootWorkId:prior}}),prior);
 // Controlled current startup defaults differ from the captured source ceiling.
 f.c.options.interactionDelegation={projectIds:['P','Q'],maxAssignments:8};
 const view=await f.c.startConversationChange(await f.options()),next=JSON.parse(s.one('SELECT data FROM works WHERE id=?',view.workId).data);
 assert.deepEqual(next.delegation,{projectIds:['P'],maxAssignments:2,rootWorkId:prior});
});

test('explicit same-work resume revives a cancelled family root only after route validation',async t=>{
 const f=await world(t),begun=await f.c.startConversationChange(await f.options()),generation=f.c.inspectConversation(f.cid).generation;
 await f.c.forkConversation({kind:'clone',conversationId:f.cid,expectedGeneration:generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision});await f.c.cancelWork({workId:begun.workId});
 const w=f.c.inspectWork(begun.workId),before=ledger(f.c),input={conversationId:f.cid,expectedGeneration:generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,workId:w.workId,expectedEpoch:w.epoch};
 await assert.rejects(f.c.resumeConversationChange(input),/resumeCancelled/);assert.deepEqual(ledger(f.c),before);
 const resumed=await f.c.resumeConversationChange({...input,resumeCancelled:true});assert.equal(resumed.workId,w.workId);assert.equal(f.c.inspectWork(w.workId).state,'ACTIVE');assert.equal(resumed.epoch,w.epoch+1);assert.deepEqual(ledger(f.c).budgets,before.budgets);assert.deepEqual(ledger(f.c).sources,before.sources);
});

test('a refused cross-conversation resume rolls back exact-target revival',async t=>{
 const f=await world(t),begun=await f.c.startConversationChange(await f.options());await f.c.cancelWork({workId:begun.workId});const other=await f.models.newConversation({projectId:'P'}),before=ledger(f.c);
 await assert.rejects(f.c.resumeConversationChange({conversationId:other.conversationId,expectedGeneration:0,expectedModelRevision:f.c.getConversationModelChoice(other.conversationId).revision,workId:begun.workId,expectedEpoch:f.c.inspectWork(begun.workId).epoch,resumeCancelled:true}),/original source conversation/);assert.deepEqual(ledger(f.c),before);
});

test('stale or pre-aborted start consumes no source, work or allowance',async t=>{
 const f=await world(t),options=await f.options(),before=ledger(f.c),abort=new AbortController();abort.abort();
 assert.throws(()=>f.c.startConversationChange({...options,expectedGeneration:options.expectedGeneration+1}),/selection changed/);assert.throws(()=>f.c.startConversationChange({...options,signal:abort.signal}),/abort/i);assert.deepEqual(ledger(f.c),before);
 const pending=f.c.startConversationChange(options);const state=JSON.parse(f.c.store.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data);
 f.c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...state,modelChoice:{...state.modelChoice,revision:state.modelChoice.revision+1}}),f.cid);
 await assert.rejects(pending,/selection changed/);assert.deepEqual(ledger(f.c).works,before.works);assert.deepEqual(ledger(f.c).budgets,before.budgets);assert.equal(f.c.managedOperations.size,0);
});

test('abort during actual capture retains original identity and activation recovery without dispatching drive',async t=>{
 const f=await world(t),abort=new AbortController(),s=f.c.store,run=s.run.bind(s);let observed=false;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(sql.startsWith('UPDATE runs SET')&&args.includes('CAPTURING')&&!observed){observed=true;queueMicrotask(()=>abort.abort());}return result;};
 let view;try{view=await f.c.startConversationChange({...await f.options(),signal:abort.signal});}finally{s.run=run;}
 assert.equal(observed,true);assert.equal(f.calls.length,0);assert.equal(f.c.inspectWork(view.workId).state,'CANCELLED');assert.equal(view.ownerActivation,'pending');assert.equal(view.execution.consumed,1);assert.equal(f.c.inspectConversation(f.cid).workId,view.workId);
 const resumed=await f.c.resumeConversationChange({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,workId:view.workId,expectedEpoch:f.c.inspectWork(view.workId).epoch,resumeCancelled:true});assert.equal(resumed.ownerActivation,'complete');assert.equal(f.calls.length,1);assert.equal(resumed.execution.consumed,1);
});

test('model-free management activation recovers non-null owner CID and cancelled family root',async t=>{
 const f=await world(t),s=f.c.store,run=s.run.bind(s);let workId;
 s.run=(sql,...args)=>{const result=run(sql,...args);if(sql==='UPDATE works SET data=? WHERE id=?'&&JSON.parse(args[0]).ownerRootActivation?.state==='COMPLETE')throw Error('Controlled activation storage failure');return result;};
 try{await assert.rejects(f.c.startConversationChange(await f.options()),e=>{workId=e.workId;return !!workId;});}finally{s.run=run;}
 const generation=f.c.inspectConversation(f.cid).generation;await f.c.forkConversation({kind:'clone',conversationId:f.cid,expectedGeneration:generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision});await f.c.cancelWork({workId});const epoch=f.c.inspectWork(workId).epoch,budgets=ledger(f.c).budgets;
 await f.c.close();const reopened=await openController({installationHome:f.home},{managementOnly:true});try{const view=reopened.activateChangeOwner({workId,expectedEpoch:epoch,resumeCancelled:true});assert.equal(view.ownerActivation,'complete');assert.deepEqual(ledger(reopened).budgets,budgets);assert.equal(reopened.inspectWork(workId).state,'ACTIVE');}finally{await reopened.close();}
});

test('explicit work cancellation aborts the supervisor in a stage gap and preserves its allowance',async t=>{
 const f=await world(t),entered=latch();f.c.changes.drive=async input=>{entered.resolve(input);await new Promise(resolve=>input.signal.aborted?resolve():input.signal.addEventListener('abort',resolve,{once:true}));return f.c.inspectChange(input.workId);};
 const pending=f.c.startConversationChange(await f.options()),input=await entered.promise,before=ledger(f.c).budgets;
 await f.c.cancelWork({workId:input.workId});const cancelled=await pending;assert.equal(f.c.inspectWork(input.workId).state,'CANCELLED');assert.equal(input.signal.aborted,true);assert.equal(cancelled.workId,input.workId);assert.deepEqual(ledger(f.c).budgets,before);assert.equal(f.c.managedOperations.size,0);
});

test('retained queued input refuses before new source or budget writes',async t=>{
 const f=await world(t),options=await f.options(),receipt=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:0,text:'Retained input',mode:'idle'}),before=ledger(f.c);
 assert.throws(()=>f.c.startConversationChange(options),pendingRecovery(receipt.inputId));assert.deepEqual(ledger(f.c),before);
 assert.equal(f.c.store.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,'QUEUED');
});


test('unknown original cleanup refuses resume before any execution or record mutation',async t=>{
 const f=await world(t),begun=await f.c.startConversationChange(await f.options());f.c.store.run("UPDATE works SET state='UNKNOWN' WHERE id=?",begun.workId);const before=ledger(f.c),calls=f.calls.length;
 assert.throws(()=>f.c.resumeConversationChange({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,workId:begun.workId,expectedEpoch:begun.epoch}),e=>e.code==='CLEANUP_UNKNOWN'&&e.workId===begun.workId);
 assert.deepEqual(ledger(f.c),before);assert.equal(f.calls.length,calls);
});
