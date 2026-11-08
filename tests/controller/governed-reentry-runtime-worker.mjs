/** Public same-target SDK/Controller reentry and real pinned Docker; judgments are scripted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {scripted, withValueCases} from './effect-fixture.mjs';

const execute=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const claim={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original immutable BASE exports2 instead of the owner-required3',evidence:['base:consumer.cjs:1']};
const instructions='Consumer exports3 instead of2 using its existing simple implementation. Preserve the registered project and checker; stop at independent review readiness.';
const toolValue=context=>{
 const message=context.messages.filter(message=>message.role==='toolResult').at(-1);
 assert.ok(message);const text=message.content.filter(part=>part.type==='text').map(part=>part.text).join('');return {message,value:message.isError?text:JSON.parse(text)};
};

assert.ok(['owner','automatic'].includes(process.env.GITJIG_REENTRY_CASE),'Select one isolated worker scenario');
for(const automatic of [process.env.GITJIG_REENTRY_CASE==='automatic'])test((automatic?'accepted WAIT continuation':'explicit owner continuation')+' reenters one original governed assignment without a replacement grant or lost finding',{timeout:90000},async()=>{
 const parentDirectory=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
 assert.ok(parentDirectory&&path.isAbsolute(parentDirectory),'Explicit existing shared fixture parent required');
 assert.equal(await fs.realpath(parentDirectory),parentDirectory);
 const checkout=await fs.realpath('.');assert.ok(parentDirectory!==checkout&&!parentDirectory.startsWith(checkout+path.sep));
 const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
 assert.ok(Object.values(runtimeProfile).every(Boolean),'Explicit existing pinned engine required');
 assert.match(runtimeProfile.image,/^sha256:[a-f0-9]{64}$/);
 const docker=async args=>(await execute(runtimeProfile.dockerBinary,['--config',runtimeProfile.dockerConfigDirectory,'--context',runtimeProfile.dockerContext,...args],{timeout:10000,maxBuffer:1024*1024})).stdout.trim();
 const daemon=await docker(['info','--format','{{.ID}}']);assert.ok(daemon);
 assert.equal(await docker(['image','inspect',runtimeProfile.image,'--format','{{.Id}}']),runtimeProfile.image);
 const root=await fs.realpath(await fs.mkdtemp(path.join(parentDirectory,'governed-reentry-')));await fs.chmod(root,0o700);
 const home=path.join(root,'home'),project=path.join(root,'project');await fs.mkdir(project);
 const original='module.exports=2;\n',checker=withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3,actual:String(value)}]}));\n");
 await fs.writeFile(path.join(project,'consumer.cjs'),original);await fs.writeFile(path.join(project,'check.cjs'),checker);
 const report={kind:'public-governed-reentry-runtime/v2',automatic,root,runtimeProfile,daemon,learnedModel:false,model:{contextWindow:100000,maxTokens:20000},initialLimits:{execution:32,resolution:8,assignments:1},roles:[],observations:[],complete:false};
 const oldTemp=process.env.TMPDIR,oldFetch=globalThis.fetch;process.env.TMPDIR=path.join(home,'artifacts');let c,primaryError,networkCalls=0,release;const held=new Promise(resolve=>{release=resolve;});let entered;const ready=new Promise(resolve=>{entered=resolve;});
 globalThis.fetch=async()=>{networkCalls++;throw Error('No network provider in controlled reentry qualification');};
 try{
  c=await openController({installationHome:home,runtimeProfile,interactionDelegation:{projectIds:['P'],maxAssignments:1}});
  await c.registerProject({id:'P',sourceRoot:project});const parent=c.createConversation().conversationId,s=c.store;
  report.parent=parent;let mode='initial',step=0,assignment,initial,censusBefore,staleRefused=false,reentryReceipt,publicPointer,outputs,occurrences,originalBudget,originalWork,ownerQueueCalls=0;
  const queueOwner=async input=>{ownerQueueCalls++;return c.queueConversationInput(input);};
  const census=()=>Object.fromEntries(['conversations','sources','conversation_inputs','conversation_assignments','role_launches','runs','capacity_leases'].map(table=>[table,s.one(`SELECT COUNT(*) n FROM ${table}`).n]));
  const retainInitial=()=>{
  assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent);assert.ok(assignment);assert.equal(assignment.state,'UNAVAILABLE');assert.ok(assignment.work);
  initial=c.inspectChange(assignment.work);assert.equal(initial.phase,'BLOCKED');assert.equal(initial.planVersion,null);assert.equal(initial.candidateVersion,null);assert.equal(initial.occurrences.length,1);assert.match(initial.blocked.join(),/original proposal validation at handoff/);
  assert.deepEqual({execution:initial.execution.limit,resolution:initial.resolution.limit},{execution:32,resolution:8});assert.equal(initial.execution.reserved,0);assert.equal(initial.resolution.reserved,0);
  outputs=s.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',assignment.work);occurrences=s.all('SELECT * FROM finding_occurrences WHERE work=?',assignment.work);originalBudget=s.all('SELECT * FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',assignment.work);originalWork=s.one('SELECT * FROM works WHERE id=?',assignment.work);
  assert.equal(outputs.length,3);assert.equal(s.one('SELECT COUNT(*) n FROM check_runs WHERE work=?',assignment.work).n,0);
  report.initial={assignmentId:assignment.id,workId:assignment.work,base:initial.baseVersion,phase:initial.phase,execution:initial.execution,resolution:initial.resolution,outputs:outputs.map(row=>({id:row.id,sha256:sha(JSON.stringify(row))})),occurrences:occurrences.map(row=>({id:row.id,sha256:sha(JSON.stringify(row))}))};
  };
  const model=scripted(context=>{
   const lastUser=context.messages.filter(message=>message.role==='user').at(-1);
   const latest=typeof lastUser?.content==='string'?lastUser.content:lastUser?.content.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
   if(automatic&&mode==='initial'&&latest.startsWith('Explicitly resumed authorized dependency outcomes')){retainInitial();mode='resume';step=0;report.failureContinuationObserved=true;}
   if(mode==='initial'){
    if(step++===0)return {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions,resultDependency:automatic}}};
    if(automatic){const {value}=toolValue(context);return {tool:{name:'conversation_wait',arguments:{resultHandles:[value.assignmentId]}}};}
    return {text:'Original assignment launched; no completion is claimed.'};
   }
   if(step++===0)return {tool:{name:'conversation_status',arguments:{conversationId:assignment.target}}};
   if(step===2){
    const {message,value}=toolValue(context);assert.equal(message.isError,false);const outcome=value.assignments.find(item=>item.assignmentId===assignment.id);assert.ok(outcome?.reentry,'Original public unavailable result supplies same-target reentry guidance');publicPointer=outcome.reentry;report.publicPointer=publicPointer;
    assert.equal(publicPointer.conversationId,assignment.target);assert.equal(publicPointer.operation,'change');assert.ok(Number.isSafeInteger(publicPointer.observedDirectionRevision)&&publicPointer.observedDirectionRevision>=0);
    censusBefore=census();return {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:publicPointer.conversationId,instructions,observedDirectionRevision:publicPointer.observedDirectionRevision+1}}};
   }
   if(step===3){
    const {message,value}=toolValue(context);assert.equal(message.isError,true);assert.match(value,/Existing assignment target binding stale/);assert.deepEqual(census(),censusBefore,'Stale target cannot allocate assignment/source/input/run/capacity/launch; parent tool history may append');staleRefused=true;
    return {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',conversationId:publicPointer.conversationId,observedDirectionRevision:publicPointer.observedDirectionRevision,instructions,resultDependency:automatic}}};
   }
   if(step===4){const {message,value}=toolValue(context);assert.equal(message.isError,false);assert.equal(value.accepted,true);assert.equal(value.reentry,true);assert.equal(value.assignmentId,assignment.id);assert.equal(value.workId,assignment.work);reentryReceipt=value;if(automatic)return {tool:{name:'conversation_wait',arguments:{resultHandles:[assignment.id]}}};}
   if(automatic){assert.equal(s.one('SELECT state FROM conversation_assignments WHERE id=?',assignment.id).state,'COMPLETE');report.successContinuationObserved=true;}
   return {text:automatic?'The original task reached independent review readiness with actual checks.':'The exact original work was reentered; its independent result is not yet presumed successful.'};
  },({role,body,result})=>{
   if(!role)return;
   report.roles.push({mode,role,stage:body.context.stage});
   if(mode==='initial'&&role==='planner'){
    result.findings=[claim];result.plan.verification.checks[0].command='node ./check.cjs';result.plan.verification.checks[0].cases=[];
   }
   if(mode==='initial'&&['challenger','adjudicator'].includes(role))assert.match(body.context.currentProposalDiagnostics.issue,/lacks healthy actual consumer case/);
   if(role==='adjudicator'&&body.context.stage==='planning-adjudication'){
    if(mode==='initial'){result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];return;}
    assert.ok(body.context.occurrences.some(o=>o.data.finding?.description===claim.description));
    result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'Actual original BASE defect remains an implementation duty of this same owner-required3 task; no new before-edit execution is required',witnesses:['base:consumer.cjs:1'],implementation:{kind:'assign-to-plan',baselineVersion:body.context.baseVersion,requirementIds:['R1'],...(body.context.decisionCarry?.version===3?{baseSourceIds:['base:consumer.cjs']}: {})}}));
    report.reentryInputDecisions=structuredClone(result.inputDecisions);
   }
   if(role==='adjudicator'&&body.context.stage==='review-adjudication')result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',resolution:'repaired',reason:'Actual changed immutable candidate, paired consumer check receipts and separate current review establish the original code remedy',witnesses:body.context.checks.filter(check=>check.status==='pass'&&check.candidate===body.context.candidateVersion).map(check=>check.id)}));
  });
  model.provider='governed-reentry-'+randomUUID();model.definition.api='governed-reentry-api-'+randomUUID();
  const stream=model.definition.streamSimple;
  if(automatic)model.definition.streamSimple=(selected,context,options)=>{
   const first=context.messages.find(message=>message.role==='user'),text=typeof first?.content==='string'?first.content:first?.content.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
   if(mode!=='initial'||!text.startsWith('Perform the assigned planner task'))return stream(selected,context,options);
   const output=createAssistantMessageEventStream();entered();void(async()=>{try{await held;const message=await stream(selected,context,options).result();output.push(['error','aborted'].includes(message.stopReason)?{type:'error',reason:message.stopReason,error:message}:{type:'done',reason:message.stopReason,message});output.end(message);}catch(error){const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:String(error),timestamp:Date.now()};output.push({type:'error',reason:'error',error:message});output.end(message);}})();return output;
  };
  await queueOwner({conversationId:parent,expectedGeneration:0,text:'Delegate this one governed code change and preserve its original work across any planning refusal.',mode:'idle'});
  const first=await c.runConversation({conversationId:parent,model});assert.equal(first.status,automatic?'waiting':'delivered');
  if(automatic){await ready;assert.equal(c.inspectConversation(parent).state,'WAITING');report.acceptedInitialWait=true;release();await c.ordinary.drain();}
  else{await c.ordinary.drain();retainInitial();mode='resume';step=0;const owner=c.inspectConversation(parent);await queueOwner({conversationId:parent,expectedGeneration:owner.generation,text:'Continue that exact original task with unchanged requirements, retained findings and remaining allowance.',mode:'idle'});assert.equal((await c.runConversation({conversationId:parent,model})).status,'delivered');await c.ordinary.drain();}
  report.ownerQueueCalls=ownerQueueCalls;assert.equal(ownerQueueCalls,automatic?1:2);
  const parentInputs=s.all('SELECT i.id,i.state,s.origin FROM conversation_inputs i JOIN sources s ON s.id=i.source WHERE i.conversation=? ORDER BY i.rowid',parent);
  report.parentInputs=parentInputs.map(row=>({id:row.id,state:row.state,origin:JSON.parse(row.origin)}));
  assert.equal(report.parentInputs.filter(row=>row.origin.kind==='owner-conversation-input').length,automatic?1:2,'The durable parent source roster has no additional owner confirmation');
  assert.ok(report.parentInputs.every(row=>row.state==='CONSUMED'));

  if(automatic){assert.equal(report.failureContinuationObserved,true);assert.equal(report.successContinuationObserved,true);assert.equal(c.inspectConversation(parent).state,'IDLE');}
  assert.equal(staleRefused,true);assert.ok(reentryReceipt);assert.equal(s.one('SELECT COUNT(*) n FROM conversation_assignments').n,1);
  const finalAssignment=s.one('SELECT * FROM conversation_assignments WHERE id=?',assignment.id);assert.equal(finalAssignment.work,assignment.work);assert.equal(finalAssignment.target,assignment.target);assert.equal(finalAssignment.state,'COMPLETE');
  const final=c.inspectChange(assignment.work);assert.equal(final.reviewReady,true,JSON.stringify(final.blocked));assert.equal(final.phase,'REVIEW_READY');assert.equal(final.baseVersion,initial.baseVersion);assert.ok(final.checks.some(check=>check.status==='pass'&&check.data.caseResults.complete));
  assert.ok(report.reentryInputDecisions.length>0,'Actual appended source direction is independently classified');
  for(const row of outputs)assert.deepEqual(s.one('SELECT * FROM role_outputs WHERE id=?',row.id),row);
  for(const row of occurrences){assert.deepEqual(s.one('SELECT * FROM finding_occurrences WHERE id=?',row.id),row);assert.equal(JSON.parse(s.one('SELECT data FROM obligations WHERE id=?',row.id).data).state,'resolved');}
  const currentWork=s.one('SELECT * FROM works WHERE id=?',assignment.work);for(const key of ['id','lineage','source','epoch','generation','predecessor'])assert.equal(currentWork[key],originalWork[key]);
  const currentBudget=s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',originalWork.lineage);for(const old of originalBudget){const now=currentBudget.find(row=>row.kind===old.kind);assert.equal(now.lim,old.lim);assert.ok(now.consumed>=old.consumed);assert.equal(now.reserved,0);}
  assert.ok(final.execution.consumed>initial.execution.consumed);assert.equal(final.execution.limit,32);assert.equal(final.resolution.limit,8);
  assert.equal(await fs.readFile(path.join(project,'consumer.cjs'),'utf8'),original);assert.equal(await fs.readFile(path.join(project,'check.cjs'),'utf8'),checker);
  const candidate=c.changeCore.version(final.candidateVersion);assert.equal(await fs.readFile(path.join(candidate.artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');assert.equal(await fs.readFile(path.join(candidate.artifact,'check.cjs'),'utf8'),checker);
  report.final={assignment:finalAssignment,workId:final.workId,phase:final.phase,reviewReady:final.reviewReady,checks:final.checks,execution:final.execution,resolution:final.resolution,candidate:final.candidateVersion,dispositions:final.dispositions};
  report.observations=['Original rejection and negative judgment retained','Stale public target refusal allocates no child resources','Sole original assignment and budgets reused','Original source direction independently classified','Real isolated author/check/review reaches REVIEW_READY','Registered project and immutable checker unchanged'];report.complete=true;
 }catch(error){primaryError=error;report.error=String(error);throw error;}
 finally{
  try{
   release();await c?.ordinary.drain();await c?.close();report.ownerClosed=true;
   if(c){const {DatabaseSync}=await import('node:sqlite'),database=path.join(home,'state/controller.sqlite'),db=new DatabaseSync(database,{readOnly:true});try{report.runs=db.prepare('SELECT * FROM runs ORDER BY rowid').all();report.leases=db.prepare('SELECT * FROM capacity_leases ORDER BY rowid').all();report.budgets=db.prepare('SELECT * FROM budgets ORDER BY rowid').all();assert.ok(report.runs.every(run=>run.phase==='SETTLED'));assert.ok(report.leases.every(lease=>lease.state==='RELEASED'));assert.ok(report.budgets.every(budget=>budget.reserved===0));}finally{db.close();}report.database={path:database,sha256:sha(await fs.readFile(database))};}
   assert.equal(await docker(['info','--format','{{.ID}}']),daemon);const present=new Set((await docker(['ps','-a','--no-trunc','--format','{{.ID}}'])).split('\n'));report.containers=[];
   for(const run of report.runs??[]){const data=JSON.parse(run.data);if(data.containerId){assert.match(data.containerId,/^[a-f0-9]{64}$/);assert.equal(data.cleanup,'removed');assert.equal(present.has(data.containerId),false);report.containers.push({runId:run.id,containerId:data.containerId,cleanup:data.cleanup,sameDaemonAbsent:true});}}
   assert.equal(networkCalls,0);report.networkCalls=networkCalls;
  }catch(error){report.cleanupError=String(error);report.complete=false;if(!primaryError)throw error;}
  finally{globalThis.fetch=oldFetch;if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;report.source={path:fileURLToPath(import.meta.url),sha256:sha(await fs.readFile(fileURLToPath(import.meta.url)))};await fs.writeFile(path.join(root,'evidence-index.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log('RETAINED_GOVERNED_REENTRY='+path.join(root,'evidence-index.json'));}
 }
});
