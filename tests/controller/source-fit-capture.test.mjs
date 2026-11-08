/** Actual Controller/SDK source-fit dispatch; only physical scope is controlled.
 * These controls mutate owned captured metadata, never a real Native session. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';
const scratch=await temporaryDirectory('source-fit-capture'),shim=path.join(scratch,'scope.mjs'),scopes=[];
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__sourceFitCaptureScope(options)}');
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/controller/change-core.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};
 return next(specifier,context);
}});
globalThis.__sourceFitCaptureScope=async options=>{
 const deny=()=>assert.fail('No physical project execution in source-fit capture controls');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};
 scopes.push(scope);return scope;
};
const {structuredAssignmentWorld}=await import('./structured-assignment-fixture.mjs');
let failed=false;
after(async()=>{assert.ok(scopes.every(scope=>scope.closed));delete globalThis.__sourceFitCaptureScope;if(!failed)await fs.rm(scratch,{recursive:true,force:true});});
async function fixture(t,{checker=true}={}){
 t.after(()=>{if(t.passed===false)failed=true;});
 const f=await structuredAssignmentWorld(t,{runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}}),c=f.c;
 await fs.writeFile(path.join(f.root,'source/consumer.cjs'),'module.exports=2;\n');
 if(checker)await fs.writeFile(path.join(f.root,'source/check.cjs'),'// No check executes in source-fit capture controls.\n');
 else await fs.rm(path.join(f.root,'source/check.cjs'),{force:true});
 f.onGoverned(()=>{throw Error('CONTROLLED_STOP_BEFORE_GOVERNED_DRIVE');});
 let call,ordinaryIndex=0;const model=scripted(()=>ordinaryIndex++?{text:'Original assignment recorded.'}:call);model.provider='source-fit-capture-'+randomUUID();model.definition.api='source-fit-capture-api-'+randomUUID();
 async function send(arguments_){ordinaryIndex=0;call={tool:{name:'conversation_assign',arguments:arguments_}};await c.queueConversationInput({conversationId:f.parent,expectedGeneration:c.inspectConversation(f.parent).generation,text:'Continue only the original assigned task',mode:'idle'});await c.runConversation({conversationId:f.parent,model});await c.ordinaryCore.drain();}
 await send({projectId:'P',instructions:checker?'Consumer exports3 using its existing consumer and checker.':'Consumer exports3 and creates its planned checker.',operation:'change',resultDependency:true});
 let roleAction=()=>{};const roleModel=scripted(()=>assert.fail('No ordinary role request expected'),o=>roleAction(o));roleModel.definition.models[0].contextWindow=200000;
 assert.equal((await c.planChange({workId:f.child.workId,model:roleModel})).phase,'PLAN_READY');
 c.ordinaryCore.h.launchChange=async()=>{throw Error('CONTROLLED_STOP_AFTER_ACCEPTED_REENTRY');};
 await send({conversationId:f.child.conversationId,observedDirectionRevision:c.inspectConversation(f.child.conversationId).directionRevision,projectId:'P',operation:'change',instructions:'Retain the existing accepted requirements; explain this original same-task recovery.'});
 const held=()=>c.interactionCore.impacts(f.child.workId).filter(row=>row.data.effectHold);
 assert.equal(held().length,1);
 return{...f,c,held,roleModel,setRoleAction:action=>{roleAction=action;},options:{workId:f.child.workId,maximumSteps:1},budgets:()=>c.store.all('SELECT kind,consumed,reserved FROM budgets WHERE lineage=? ORDER BY kind',f.child.workId)};
}
for(const field of ['sourceFitInput','sourceFitReferences'])for(const phase of ['reservation','provider'])for(const mutation of ['removed','changed'])test(`source-fit ${field==='sourceFitInput'?'captured declaration':'captured reference domain'} ${mutation} at ${phase} refuses without clearing original held input`,async t=>{
 const f=await fixture(t),s=f.c.store,originalRun=s.run,originalHeld=JSON.stringify(f.held());let changed=false,providerCalls=0,launchId;
 const mutate=()=>{const row=s.one("SELECT * FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit' ORDER BY rowid DESC LIMIT 1",f.child.workId);assert.ok(row);launchId=row.id;const data=JSON.parse(row.data);assert.deepEqual(data.sourceFitInput,{version:1});assert.deepEqual(data.sourceFitReferences,{version:1,stage:'source-fit',inputs:f.held().map(input=>({inputId:input.input_id,directionRevision:input.revision})),requirementIds:['R1']});if(mutation==='removed')delete data[field];else data[field]={...data[field],version:2};originalRun.call(s,'UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);changed=true;};
 if(phase==='reservation')s.run=function(sql,...values){const result=originalRun.call(this,sql,...values);if(!changed&&sql.startsWith('INSERT INTO role_launches'))mutate();return result;};
 const before=f.budgets();
 try{
  f.setRoleAction(({body})=>{if(body.context.stage==='source-fit'){providerCalls++;assert.deepEqual(body.context.sourceFitInput,{version:1});if(phase==='provider')mutate();}});
  await f.c.driveChange({...f.options,model:f.roleModel});
 }finally{s.run=originalRun;}
 assert.equal(changed,true);assert.equal(providerCalls,phase==='reservation'?0:1);
 assert.equal(JSON.stringify(f.held()),originalHeld,'A malformed captured receiver cannot consume source holds');
 const view=f.c.inspectChange(f.child.workId);assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(' '),/source-fit|Source-fit/);
 assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',launchId).status,'UNUSABLE');
 const after=f.budgets();for(const row of after){assert.equal(row.reserved,0);assert.equal(row.consumed,before.find(x=>x.kind===row.kind).consumed+1);}
 assert.equal(view.candidateVersion,null);f.pass();
});


test('prospective source-fit can classify retained intent before a planned checker exists',async t=>{
 const f=await fixture(t,{checker:false});let observed=false;
 f.setRoleAction(({body})=>{if(body.context.stage==='source-fit'){
  observed=true;assert.ok(body.requirements.some(requirement=>requirement.id==='R1'));
  assert.ok(!body.sources.some(source=>source.path==='check.cjs'));
  assert.ok(!body.requiredScope.some(scope=>scope.sourceId.endsWith(':check.cjs')));
 }});
 await f.c.driveChange({...f.options,model:f.roleModel});
 assert.equal(observed,true);assert.equal(f.held().length,0);
 const launch=f.c.store.one("SELECT status FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit'",f.child.workId);
 assert.equal(launch.status,'COMPLETE');
 await assert.rejects(fs.access(path.join(f.root,'source/check.cjs')),{code:'ENOENT'});
 f.pass();
});
test('actual retained source-fit captures plan IDs rather than normalized owner locators and applies valid classification',async t=>{
 const f=await fixture(t);let observed=false;const expected={version:1,stage:'source-fit',inputs:f.held().map(input=>({inputId:input.input_id,directionRevision:input.revision})),requirementIds:['R1']};
 f.setRoleAction(({body})=>{if(body.context.stage==='source-fit'){
  observed=true;assert.deepEqual(body.context.sourceFitReferences,expected);
  assert.ok(body.requirements.some(row=>row.id==='R1'));
 }});
 await f.c.driveChange({...f.options,model:f.roleModel});assert.equal(observed,true);assert.equal(f.held().length,0);
 const launch=f.c.store.one("SELECT data,status FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit' ORDER BY rowid DESC LIMIT 1",f.child.workId);
 assert.equal(launch.status,'COMPLETE');assert.deepEqual(JSON.parse(launch.data).sourceFitReferences,expected);f.pass();
});
test('actual source-fit distinguishes an agent reentry from a direct owner direction',async t=>{
 const f=await fixture(t),target=f.child.conversationId;
 const agent=f.held()[0];
 const queued=await f.c.queueConversationInput({conversationId:target,expectedGeneration:f.c.inspectConversation(target).generation,
  text:'Keep the original verification and its exact task scope.',mode:'idle'});
 const expected=new Map([[agent.input_id,'agent-governed-reentry'],[queued.inputId,'owner-conversation-input']]);
 assert.equal(f.held().length,2);
 assert.ok(f.held().every(row=>!Object.hasOwn(row,'sourceOrigin')));
 const view=f.c.inspectChangeResult(f.child.workId);
 assert.deepEqual(new Map(view.heldDirections.entries.map(row=>[row.inputId,row.sourceOrigin])),expected);
 const {recordedResultSummary}=await import('../../dist/controller/change-result.js');
 assert.deepEqual(recordedResultSummary(view).heldDirections,view.heldDirections);
 const {changeResultText}=await import('../../dist/ui/change-result.js');
 assert.match(changeResultText(view,'en'),/Agent follow-up.*\nOwner follow-up/);
 assert.match(changeResultText(view,'ko'),/에이전트 후속 지시.*\n사용자 후속 지시/);
 const captured=await f.c.changes.bundle(f.child.workId,{stage:'source-fit',sourceFitInput:{version:1}},'adjudicator',f.roleModel);
 const source=f.c.store.one('SELECT origin FROM sources WHERE id=?',agent.source);
 try{
  f.c.store.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({kind:'unrecognized-origin'}),agent.source);
  assert.throws(()=>captured.assertCurrent(),/source direction or provenance changed/);
  const uncertain=await f.c.changes.bundle(f.child.workId,{stage:'source-fit',sourceFitInput:{version:1}},'adjudicator',f.roleModel);
  assert.equal(uncertain.bundle.context.sourceInputChain.find(row=>row.input_id===agent.input_id).sourceOrigin,'unknown');
 }finally{f.c.store.run('UPDATE sources SET origin=? WHERE id=?',source.origin,agent.source);}
 captured.assertCurrent();
 const {roleFraming}=await import('../../dist/workflow/role-framing.js');
 const {systemPrompt}=roleFraming('adjudicator',captured.bundle);
 assert.match(systemPrompt,/sourceOrigin identifies the recorded author/);
 assert.doesNotMatch(systemPrompt,/effect of actual held owner input/);
 let observed=false;
 f.setRoleAction(({body})=>{if(body.context.stage==='source-fit'){
  observed=true;
  assert.deepEqual(new Map(body.context.sourceInputChain.filter(row=>row.data.effectHold).map(row=>[row.input_id,row.sourceOrigin])),expected);
 }});
 const result=await f.c.driveChange({...f.options,model:f.roleModel});
 assert.equal(observed,true);assert.equal(f.held().length,0,JSON.stringify(result.blocked));
 f.pass();
});
for (const mode of ['agent amendment', 'owner amendment', 'inherited amendment', 'broken parent link', 'origin drift'])
test('source-fit preserves the plan and all held inputs unless owner authority matches: '+mode,async t=>{
 const f=await fixture(t), target=f.child.conversationId, core=f.c.changeCore;
 const inherited=mode==='inherited amendment'||mode==='broken parent link';
 const destination=inherited?f.parent:target, text='Change the required export from 3 to 4.';
 const direct=await f.c.queueConversationInput({conversationId:destination,expectedGeneration:f.c.inspectConversation(destination).generation,text,mode:'idle'});
 const inputId=inherited?randomUUID():direct.inputId;
 if(inherited){
  const view=f.c.inspectConversation(target), revision=view.directionRevision+1;
  f.c.store.tx(()=>{
   f.c.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',inputId,target,view.generation,
    f.child.workId,direct.sourceId,'DISPATCHED_WORKFLOW','inherited-owner-source',text,JSON.stringify({inheritedOwnerSource:direct.sourceId,
     parentConversation:f.parent,parentRevision:direct.directionRevision,parentInputId:mode==='broken parent link'?randomUUID():direct.inputId}));
   f.c.store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)',target,revision,direct.sourceId,
    JSON.stringify({inputId,effectHold:true,inherited:true,affectedWorkId:f.child.workId}));
   f.c.store.run('UPDATE conversation_state SET direction=? WHERE conversation=?',revision,target);
  });
 }
 const prior=f.c.inspectChange(f.child.workId).planVersion, held=JSON.stringify(f.held());
 const owner=f.held().find(input=>input.input_id===inputId);
 const originalPrepare=core.prepareInputDecisions;
 if(mode==='origin drift')core.prepareInputDecisions=function(...args){
  const apply=originalPrepare.apply(this,args);
  return ()=>{
   f.c.store.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify({kind:'agent-governed-reentry'}),owner.source);
   apply();
  };
 };
 f.setRoleAction(({body,result})=>{
  if(body.context.stage!=='source-fit')return;
  for(const decision of result.inputDecisions)
   if(decision.inputId===inputId || mode==='agent amendment')decision.impact='scope-change';
 });
 try {
  const result=await f.c.driveChange({...f.options,model:f.roleModel});
  if(mode==='owner amendment'||mode==='inherited amendment'){
   assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
   assert.notEqual(result.planVersion,prior);
   assert.equal(f.held().length,0);
   const row=f.c.store.one("SELECT data FROM conversation_directions WHERE conversation=? AND json_extract(data,'$.inputId')=?",target,inputId);
   assert.equal(JSON.parse(row.data).decision.impact,'scope-change');
  }else{
   assert.equal(result.phase,'BLOCKED');
   assert.match(result.blocked.join(),mode==='origin drift'?/Pending source tuple changed/:/Scope change requires a verified owner input/);
   assert.equal(result.planVersion,prior);
   assert.equal(JSON.stringify(f.held()),held);
  }
  f.pass();
 }finally{core.prepareInputDecisions=originalPrepare;}
});
test('actual source-fit decoder rejects source locators without consuming held owner input',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.held());let observed=false;
 f.setRoleAction(({body,result})=>{if(body.context.stage==='source-fit'){
  observed=true;assert.deepEqual(body.context.sourceFitReferences.requirementIds,['R1']);
  result.inputDecisions.forEach(decision=>decision.requirementIds.push('owner-request'));
 }});
 const result=await f.c.driveChange({...f.options,model:f.roleModel});assert.equal(observed,true);assert.equal(result.phase,'BLOCKED');
 assert.equal(JSON.stringify(f.held()),before);assert.match(result.blocked.join(' '),/effective plan requirements/);
 assert.equal(f.c.store.one("SELECT status FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit' ORDER BY rowid DESC LIMIT 1",f.child.workId).status,'UNUSABLE');f.pass();
});


test('actual held planning qualified approval survives stored-producer decoding and current inspection',async t=>{
 const f=await fixture(t);let observed=false;
 f.setRoleAction(({role,body,result})=>{if(role==='adjudicator'&&body.context.stage==='planning-adjudication'){
  observed=true;assert.ok(body.context.proposalApproval);assert.deepEqual(body.context.sourceFitReferences.requirementIds,['R1']);
  assert.equal(body.context.sourceFitReferences.inputs.length,1);delete result.acceptedPlan;
 }});
 const result=await f.c.planChange({workId:f.child.workId,model:f.roleModel});assert.equal(observed,true);assert.equal(result.phase,'PLAN_READY',JSON.stringify(result.blocked));
 assert.equal(f.held().length,0);assert.equal(f.c.inspectChange(f.child.workId).phase,'PLAN_READY');
 const launch=f.c.store.one("SELECT data,status FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='planning-adjudication' ORDER BY rowid DESC LIMIT 1",f.child.workId);
 const data=JSON.parse(launch.data);assert.equal(launch.status,'COMPLETE');assert.deepEqual(data.requirementSourceIds,f.c.changeCore.requirementSources(f.child.workId));assert.ok(data.sourceFitReferences.inputs.length);f.pass();
});


for(const phase of ['reservation','provider'])for(const operand of ['retained-requirements','held-tuple','source-domain'])test(`source-fit valid ${operand} drift at ${phase} cannot replace original capture`,async t=>{
 const f=await fixture(t),s=f.c.store,run=s.run,before=JSON.stringify(f.held());let changed=false,calls=0,launchId;
 const mutate=()=>{
  const row=s.one("SELECT id,data FROM role_launches WHERE work=? AND json_extract(data,'$.stage')='source-fit' ORDER BY rowid DESC LIMIT 1",f.child.workId);assert.ok(row);launchId=row.id;
  const data=JSON.parse(row.data);assert.equal(data.sourceFitReferences.inputs.length,1);assert.ok(data.requirementSourceIds.length);
  if(operand==='retained-requirements')data.sourceFitReferences.requirementIds=['owner-request'];
  if(operand==='held-tuple')data.sourceFitReferences.inputs[0].directionRevision++;
  if(operand==='source-domain')data.requirementSourceIds=['different-original-source'];
  run.call(s,'UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),row.id);changed=true;
 };
 if(phase==='reservation')s.run=function(sql,...values){const result=run.call(this,sql,...values);if(!changed&&sql.startsWith('INSERT INTO role_launches'))mutate();return result;};
 try{
  f.setRoleAction(({body})=>{if(body.context.stage==='source-fit'){calls++;assert.deepEqual(body.context.sourceFitReferences.requirementIds,['R1']);if(phase==='provider')mutate();}});
  await f.c.driveChange({...f.options,model:f.roleModel});
 }finally{s.run=run;}
 assert.equal(changed,true);assert.equal(calls,phase==='reservation'?0:1);assert.equal(JSON.stringify(f.held()),before);
 assert.equal(s.one('SELECT status FROM role_launches WHERE id=?',launchId).status,'UNUSABLE');assert.equal(f.c.inspectChange(f.child.workId).phase,'BLOCKED');f.pass();
});
