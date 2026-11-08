/** Public controller/real capture/SDK/history recovery. Only physical Docker scope
 * creation is controlled; this does not qualify a real engine or provider. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';
const root=await temporaryDirectory('planning-prefix'),home=path.join(root,'home'),source=path.join(root,'project'),shim=path.join(root,'scope.mjs');
await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),'// Controlled planning fixture: no check executes.\n');
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__planningPrefixScope(options)}');
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/change-core.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const scopes=[];globalThis.__planningPrefixScope=async options=>{
 const deny=()=>assert.fail('No physical project execution in planning controls');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full},readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'}}};scopes.push(scope);return scope;
};
const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('Network forbidden in controlled planning fixture')};
const originalTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
const {openController}=await import('../../dist/controller/index.js');
const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});
await c.registerProject({id:'P',sourceRoot:source});let failures=0;
after(async()=>{await c.close();assert.equal(fetches,0);assert.ok(scopes.every(scope=>scope.closed));globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;delete globalThis.__planningPrefixScope;if(!failures)await fs.rm(root,{recursive:true,force:true});else console.error('RETAINED_PLANNING_PREFIX '+root);});
async function world(t,failedRole,prepare=()=>{}){
 t.after(()=>{if(t.passed===false)failures++});
 const {workId}=await c.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:20,resolutionLimit:12}),calls=[];let mode='fail',observe=()=>{};
 const model=scripted(undefined,({role,body,result})=>{
  const live=c.store.one("SELECT l.data FROM role_launches l JOIN runs r ON r.id=l.run WHERE l.work=? AND l.status='RUNNING' AND r.phase='RUNNING' ORDER BY l.rowid DESC LIMIT 1",workId);
  assert.deepEqual(JSON.parse(live.data).bounds,{timeoutMs:300000,maxProviderRequests:16},'Admitted bounds exist before the original provider callback');
  calls.push({mode,role,body:structuredClone(body)});
  if(mode==='fail')prepare({role,body,result});
  if(mode==='fail'&&role===failedRole){result.unexpected='Controlled unusable output';result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original failed producer concern must survive retry',evidence:['base:consumer.cjs exports2']}];}
  if(mode==='resume'){
   if(role==='adjudicator'){result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];result.summary='Independent negative judgment remains authoritative';}
   observe({role,body,result});
  }
 });
 const first=await c.planChange({workId,model});assert.equal(first.phase,'BLOCKED');assert.equal(first.planVersion,null);
 const runs=()=>c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),launches=()=>c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId);
 const originals=launches(),outputs=c.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',workId),charges=first.execution.consumed;
 return {workId,model,calls,first,originals,outputs,runs,launches,charges,setObserver(fn){observe=fn},async resume(signal){mode='resume';return c.driveChange({workId,model,maximumSteps:1,signal})}};
}
for(const failedRole of ['challenger','adjudicator'])test('retained successful prefix resumes only required suffix after '+failedRole+' failure',{timeout:30000},async t=>{
 const f=await world(t,failedRole),beforeP=f.originals.find(l=>l.role==='planner'),beforeC=f.originals.find(l=>l.role==='challenger');
 f.setObserver(({role,body})=>{
  if(role==='challenger'||role==='adjudicator')assert.equal(body.context.plannerInputScope.launchId,beforeP.id);
  if(role==='adjudicator'&&failedRole==='adjudicator')assert.equal(body.context.challengerInputScope.launchId,beforeC.id);
  for(const occurrence of f.first.occurrences)assert.ok(body.context.occurrences.some(current=>current.id===occurrence.id),'Fresh suffix must receive every original claim');
 });
 const resumed=await f.resume();assert.equal(resumed.phase,'BLOCKED');assert.equal(resumed.planVersion,null);assert.equal(resumed.candidateVersion,null);
 assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),failedRole==='challenger'?['challenger','adjudicator']:['adjudicator']);
 assert.equal(resumed.execution.consumed-f.charges,failedRole==='challenger'?2:1);assert.equal(resumed.execution.reserved,0);assert.equal(resumed.resolution.reserved,0);
 for(const output of f.outputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',output.id),output);
 for(const original of f.originals.filter(l=>l.status==='COMPLETE'))assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',original.id),original);
 assert.ok(resumed.blocked.join().includes('Independent planning did not accept'),JSON.stringify(resumed.blocked));
});

for(const scenario of ['model','runtime','base','criteria-version','epoch','protection','source-input','latest-unusable','legacy-scope'])test('changed or unsupported premise takes fresh planning: '+scenario,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),s=c.store,originalRuntime=c.options.runtimeProfile;
 const p=f.originals.find(l=>l.role==='planner');
 if(scenario==='model')f.model.definition.models[0].maxTokens--;
 if(scenario==='runtime')await c.applyRuntimeProfile({...originalRuntime,dockerContext:'controlled-changed'});
 if(scenario==='base'){
  const base=s.one('SELECT * FROM change_versions WHERE id=(SELECT base FROM change_state WHERE work=?)',f.workId),id=randomUUID();
  s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,base.work,base.kind,base.predecessor,base.artifact,base.hash,base.data);s.run('UPDATE change_state SET base=? WHERE work=?',id,f.workId);
 }
 if(scenario==='criteria-version'){const old=s.one("SELECT * FROM change_versions WHERE id=(SELECT json_extract(data,'$.contractsVersion') FROM change_state WHERE work=?)",f.workId),id=randomUUID(),row=s.one('SELECT data FROM change_state WHERE work=?',f.workId);s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,old.work,old.kind,old.predecessor,old.artifact,old.hash,old.data);s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...JSON.parse(row.data),contractsVersion:id}),f.workId);}
 if(scenario==='protection')await c.setProjectProtection({projectId:'P',expectedRevision:c.inspectProjectProtection('P').revision,protectedPaths:['check.cjs']});
 if(scenario==='source-input'){const run=s.one('SELECT data FROM runs WHERE id=?',p.run);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(run.data),sourceInputHash:'previous-input-chain'}),p.run);}
 if(scenario==='epoch')s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId);
 if(scenario==='latest-unusable')s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',randomUUID(),f.workId,p.run,'planner',p.epoch,'UNUSABLE','none',p.data);
 if(scenario==='legacy-scope'){const data=JSON.parse(p.data);delete data.inputScope;s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 try{const after=await f.resume();assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['planner','challenger','adjudicator'],JSON.stringify(after.blocked));assert.equal(after.execution.consumed-f.charges,3);assert.equal(after.planVersion,null);}
 finally{if(scenario==='runtime')await c.applyRuntimeProfile(originalRuntime);}
});

for(const scenario of ['wrong-stage','duplicate-output','checkpoint','missing-history','truncated','unsettled','scope-census'])test('inconsistent complete prefix holds before fresh reservation: '+scenario,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),s=c.store,p=f.originals.find(l=>l.role==='planner'),data=JSON.parse(p.data),run=s.one('SELECT * FROM runs WHERE id=?',p.run),rd=JSON.parse(run.data),output=f.outputs.find(o=>o.launch===p.id);
 if(scenario==='wrong-stage'){data.stage='source-fit';s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 if(scenario==='duplicate-output')s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),output.launch,output.raw,output.status,output.data);
 if(scenario==='checkpoint'){rd.nativeCheckpoint.sha256='b'.repeat(64);s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(rd),run.id);}
 if(scenario==='missing-history')await fs.rename(rd.historyRef,rd.historyRef+'.retained');
 if(scenario==='truncated'){const od=JSON.parse(output.data);od.rawFinalTruncated=true;s.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(od),output.id);}
 if(scenario==='unsettled')s.run("UPDATE runs SET phase='UNKNOWN' WHERE id=?",run.id);
 if(scenario==='scope-census'){data.inputScope.occurrenceIds.push('invented');s.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),p.id);}
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);assert.ok(after.blocked.length);
 // This is a negative provenance fixture, not an actual unresolved physical run.
 if(scenario==='unsettled')s.run('UPDATE runs SET phase=? WHERE id=?',run.phase,run.id);
});

for(const changed of ['record','history'])test('all-prefix fence rejects P drift during later C evidence await: '+changed,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.historicalPlanningProducer,p=f.originals.find(l=>l.role==='planner'),ch=f.originals.find(l=>l.role==='challenger');let cReads=0,injected=false;
 core.historicalPlanningProducer=async function(work,outputId){
  const value=await original.call(this,work,outputId);
  if(work===f.workId&&value.launch.id===ch.id&&++cReads===1){
   injected=true;
   if(changed==='record')c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringProof:true}),p.id);
   else await fs.appendFile(JSON.parse(p.data).historyRef,'\n');
  }
  return value;
 };
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.phase,'BLOCKED');assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);assert.match(after.blocked.join(),/changed/);}
 finally{core.historicalPlanningProducer=original;}
});

function acceptWithRetainedDuties({role,body,result}){
 if(role!=='adjudicator')return;
 result.planAccepted=true;result.acceptedPlan=body.context.planProposal;
 result.decisions=body.context.occurrences.map(o=>({occurrenceId:o.id,disposition:'upheld',reason:'Retain actual baseline defect as implementation duty',witnesses:['base:consumer.cjs']}));
 assert.deepEqual(body.context.decisionCarry,{version:2});for(const decision of result.decisions)decision.implementation={kind:'assign-to-plan',baselineVersion:body.context.baseVersion,requirementIds:['R1']};
}
// Deliberately seeded historical closure; the current role/capture/adoption path
// is real, while these old verdicts do not claim learned or engine qualification.
async function retainedWorld(t){
 const f=await world(t,'adjudicator',({role,result})=>{
  if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Prior baseline concern',evidence:['base:consumer.cjs']}];
 });
 const [target,member]=f.first.occurrences;assert.ok(target&&member);
 const rows=[];
 for(const [occurrence,decision] of [[target,{disposition:'rejected'}],[member,{disposition:'equivalent',equivalentTo:target.id}]]){
  const id=randomUUID(),data={occurrenceId:occurrence.id,...decision,reason:'Controlled historical verdict',witnesses:['base:consumer.cjs']};
  c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',id,occurrence.id,f.originals.at(-1).id,decision.disposition,JSON.stringify(data));
  c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence:occurrence.id,state:'resolved',...decision}),occurrence.id);
  rows.push(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',id));
 }
 return {...f,target,member,rows};
}
test('original planning capture retains exact closed rows without replaying verdicts or carry',{timeout:30000},async t=>{
 const f=await retainedWorld(t);let captured;
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  acceptWithRetainedDuties(event);captured=event.body.context.decisionReferences;
  assert.equal(captured.version,3);assert.equal(captured.retentionChoices.length,2);
  event.result.retainedDispositions=captured.retentionChoices.map(row=>row.dispositionId);
  event.result.decisions=event.result.decisions.filter(row=>![f.target.id,f.member.id].includes(row.occurrenceId));
 });
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 for(const row of f.rows){assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',row.id),row);assert.equal(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',row.occurrence).length,1);}
 const judge=f.launches().at(-1);assert.deepEqual(JSON.parse(judge.data).decisionReferences,captured);
});
for(const drift of ['row','latest','pending'])test('retention '+drift+' drift refuses before criteria and source-fit effects',{timeout:30000},async t=>{
 const f=await retainedWorld(t),core=c.changeCore,originalAdopt=core.adoptCriteria,originalInput=core.inputDecisions;let effects=0;
 core.adoptCriteria=()=>{effects++;assert.fail('Stale retention reached criteria adoption')};core.inputDecisions=()=>{effects++;assert.fail('Stale retention reached source-fit adoption')};
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  acceptWithRetainedDuties(event);event.result.retainedDispositions=event.body.context.decisionReferences.retentionChoices.map(row=>row.dispositionId);
  event.result.decisions=event.result.decisions.filter(row=>![f.target.id,f.member.id].includes(row.occurrenceId));
  if(drift==='row')c.store.run('UPDATE finding_dispositions SET data=? WHERE id=?',JSON.stringify({...JSON.parse(f.rows[0].data),reason:'Changed after capture'}),f.rows[0].id);
  if(drift==='latest')c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',randomUUID(),f.target.id,f.rows[0].launch,'rejected',f.rows[0].data);
  if(drift==='pending')c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',state:'pending'}),f.target.id);
 });
 try{const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/Retained disposition changed/);assert.equal(f.launches().at(-1).status,'COMPLETE');assert.equal(effects,0);}
 finally{core.adoptCriteria=originalAdopt;core.inputDecisions=originalInput;}
});
test('retained equivalent row reopens when its target acquires a new implementation duty',{timeout:30000},async t=>{
 const f=await retainedWorld(t);
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;acceptWithRetainedDuties(event);
  event.result.retainedDispositions=[f.rows[1].id];event.result.decisions=event.result.decisions.filter(row=>row.occurrenceId!==f.member.id);
 });
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.equal(after.planVersion,null);assert.match(after.blocked.join(),/unaccounted/);
 assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',f.rows[1].id),f.rows[1]);
 assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?',f.member.id).data).state,'pending');
});
test('fresh J may adopt original P/C and preserves required independent role identities',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');f.setObserver(acceptWithRetainedDuties);const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));
 const plan=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',after.planVersion).data);
 assert.equal(plan.authorLaunch,f.originals.find(l=>l.role==='planner').id);assert.equal(plan.challengeLaunch,f.originals.find(l=>l.role==='challenger').id);assert.notEqual(plan.decisionLaunch,f.originals.find(l=>l.role==='adjudicator').id);assert.equal(after.execution.consumed-f.charges,1);
});

test('planning retry supplies the prior host adoption refusal to fresh J',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator');
 assert.equal(f.calls.find(call=>call.role==='adjudicator').body.context.priorPlanningFailure,undefined);
 f.setObserver(event=>{acceptWithRetainedDuties(event);if(event.role==='adjudicator')for(const decision of event.result.decisions)decision.implementation.requirementIds=['foreign-requirement'];});
 const refused=await f.resume();assert.equal(refused.phase,'BLOCKED');assert.equal(refused.planVersion,null);
 assert.match(refused.blocked.join(),/BASE|baseline|mapping/);
 const previous=f.launches().at(-1);assert.equal(previous.status,'COMPLETE','A usable producer is distinct from host plan adoption');
 const outputs=c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',previous.id);
 let received;
 f.setObserver(({role,body})=>{
  if(role!=='adjudicator')return;
  received=structuredClone(body.context);
 });
 const after=await f.resume();assert.ok(received);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,refused.execution.consumed+1);
 const strings=[];const visit=value=>{if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);};visit(received);
 for(const reason of refused.blocked)assert.ok(strings.includes(reason),'The next independent judge needs the actual host refusal, not only the previous producer success and pending findings');
 for(const occurrence of refused.occurrences)assert.ok(received.occurrences.some(current=>current.id===occurrence.id));
 assert.equal(received.priorPlanningFailure.workId,f.workId);assert.equal(received.priorPlanningFailure.epoch,refused.epoch);
 assert.equal(received.priorPlanningFailure.recordedPhase,'BLOCKED');assert.equal(received.priorPlanningFailure.omittedMessages,0);
 assert.deepEqual(c.store.one('SELECT * FROM role_launches WHERE id=?',previous.id),previous);
 assert.deepEqual(c.store.all('SELECT * FROM role_outputs WHERE launch=? ORDER BY rowid',previous.id),outputs);
});

test('planning recovery feedback bounds serialized UTF8 and preserves current duties',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),row=c.store.one('SELECT * FROM change_state WHERE work=?',f.workId),data=JSON.parse(row.data);
 const messages=['가😀'.repeat(3000),'현재 검증에서 빠진 지적사항을 독립적으로 처리해야 합니다.'];
 c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...data,blocked:messages}),f.workId);
 let received;f.setObserver(({role,body})=>{if(role==='adjudicator')received=structuredClone(body.context);});
 const after=await f.resume();assert.ok(received);assert.equal(after.planVersion,null);
 assert.ok(Buffer.byteLength(JSON.stringify(received.priorPlanningFailure),'utf8')<=8192);
 assert.deepEqual(received.priorPlanningFailure.messages,[messages[1]]);assert.equal(received.priorPlanningFailure.omittedMessages,1);
 for(const occurrence of f.first.occurrences)assert.ok(received.occurrences.some(current=>current.id===occurrence.id));
 const entry={...row,data:{...data,blocked:messages}},core=c.changeCore;
 assert.equal(core.priorPlanningFailure(f.workId,{...entry,phase:'BASE_CAPTURED'}),undefined);
 assert.equal(core.priorPlanningFailure(f.workId,{...entry,data:{...entry.data,resumeStage:'implement'}}),undefined);
 const detached=core.priorPlanningFailure(f.workId,entry);detached.messages.push('Local projection mutation');assert.deepEqual(entry.data.blocked,messages);
});

test('explicit criteria refresh retains the previous planning refusal for fresh J',{timeout:30000},async t=>{
 t.after(()=>{if(t.passed===false)failures++});
 const isolated=path.join(root,'refresh-feedback-'+randomUUID()),payload=path.join(isolated,'payload');await fs.mkdir(payload,{recursive:true});
 const shipped=fileURLToPath(new URL('../../', import.meta.url));
 await fs.cp(path.join(shipped,'dist'),path.join(payload,'dist'),{recursive:true});
 for(const name of ['package.json','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md'])await fs.copyFile(path.join(shipped,name),path.join(payload,name));
 for(const name of ['node_modules','runtime'])await fs.symlink(path.join(shipped,name),path.join(payload,name));
 const {openController:open}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')));
 const options={installationHome:path.join(isolated,'home'),runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}};
 let selected=await open(options);t.after(()=>selected.close());await selected.registerProject({id:'P',sourceRoot:source});
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(options.installationHome,'artifacts');t.after(()=>{process.env.TMPDIR=previousTemp;});
 const {workId}=await selected.beginChange({projectId:'P',request:'Consumer exports3',executionLimit:20,resolutionLimit:12});let refreshed=false,received;
 const model=scripted(undefined,({role,body,result})=>{
  if(role==='planner')result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Original baseline exports2 instead of3',evidence:['base:consumer.cjs exports2']}];
  if(role==='adjudicator'&&!refreshed){acceptWithRetainedDuties({role,body,result});for(const decision of result.decisions)decision.implementation.requirementIds=['foreign-requirement'];}
  if(role==='adjudicator'&&refreshed){received=structuredClone(body.context);result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];}
 });
 const refused=await selected.planChange({workId,model});assert.match(refused.blocked.join(),/BASE|baseline|mapping/);
 const oldLaunches=selected.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId);
 const oldBudgets=selected.store.all('SELECT * FROM budgets ORDER BY rowid');
 await fs.appendFile(path.join(payload,'DESIGN.md'),'\nOwned isolated criteria clarification for recovery feedback.\n');
 await selected.refreshChangeCriteria({workId,expectedEpoch:refused.epoch,reason:'Explicitly adopt current rules while preserving the original failed task'});
 assert.equal(selected.inspectChange(workId).epoch,refused.epoch+1);assert.equal(selected.inspectChange(workId).phase,'BASE_CAPTURED');
 assert.deepEqual(selected.store.all('SELECT * FROM budgets ORDER BY rowid'),oldBudgets);
 const entry=selected.changeCore.row(workId),refresh=entry.data.criteriaRefresh,event=selected.store.one('SELECT * FROM sources WHERE id=?',refresh.sourceId),origin=JSON.parse(event.origin);
 assert.equal(event.raw,'Explicitly adopt current rules while preserving the original failed task');
 assert.deepEqual(origin.priorPlanningFailure.messages,refused.blocked);
 // Corrupt only controlled fixture correspondence; no invalid history is accepted or repaired.
 for(const change of [o=>{o.work='foreign'},o=>{o.toHash='0'.repeat(64)},o=>{o.fromContractsVersion=refresh.toContractsVersion},
  o=>{o.priorPlanningFailure.epoch--},o=>{o.priorPlanningFailure.generation++},o=>{o.priorPlanningFailure.messages=['가'.repeat(8192)]},
  o=>{o.priorPlanningFailure.omittedMessages=-1},o=>{o.priorPlanningFailure.authority='accept'}]){
  const changed=structuredClone(origin);change(changed);selected.store.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(changed),event.id);
  try{assert.equal(selected.changeCore.priorPlanningFailure(workId,entry),undefined);}finally{selected.store.run('UPDATE sources SET origin=? WHERE id=?',event.origin,event.id);}
 }
 const contracts=selected.store.one('SELECT * FROM change_versions WHERE id=?',refresh.toContractsVersion);
 selected.store.run('UPDATE change_versions SET predecessor=NULL WHERE id=?',contracts.id);
 try{assert.equal(selected.changeCore.priorPlanningFailure(workId,entry),undefined);}finally{selected.store.run('UPDATE change_versions SET predecessor=? WHERE id=?',contracts.predecessor,contracts.id);}
 await selected.close();selected=await open(options);refreshed=true;
 const after=await selected.planChange({workId,model});assert.ok(received);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,refused.execution.consumed+3);
 for(const reason of refused.blocked)assert.ok(received.priorPlanningFailure?.messages.includes(reason),'An explicit owned rules refresh must not erase the previous host refusal from same-work recovery');
 assert.equal(received.priorPlanningFailure.epoch,refused.epoch,'The historical diagnostic keeps its actual older epoch');
 assert.equal(received.priorPlanningFailure.workId,workId);
 assert.deepEqual(selected.changeCore.priorPlanningFailure(workId,selected.changeCore.row(workId)).messages,after.blocked,'The new blocked entry overrides older refresh feedback');
 for(const launch of oldLaunches)assert.deepEqual(selected.store.one('SELECT * FROM role_launches WHERE id=?',launch.id),launch);
});

test('prefix mutation during diagnosis await cannot adopt or resolve old duties',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.prevalidateDiagnoses,p=f.originals.find(l=>l.role==='planner');let injected=false;f.setObserver(acceptWithRetainedDuties);
 core.prevalidateDiagnoses=async function(work,j){const value=await original.call(this,work,j);if(work===f.workId){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringDiagnosis:true}),p.id);}return value;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.planVersion,null);assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/changed/);assert.equal(c.store.one('SELECT count(*) n FROM finding_dispositions d JOIN finding_occurrences o ON o.id=d.occurrence WHERE o.work=?',f.workId).n,0);}
 finally{core.prevalidateDiagnoses=original;}
});

test('claim received during prefix validation enters fresh suffix without altering old input scope',{timeout:30000},async t=>{
 const f=await world(t,'challenger'),core=c.changeCore,original=core.historicalPlanningProducer,p=f.originals.find(l=>l.role==='planner'),savedScope=JSON.parse(p.data).inputScope;let reads=0,injected=false;
 const claimId=randomUUID(),claim={requirementId:'R1',severity:'blocking',repair:'substantive',description:'Independent retained concern arriving before new suffix assembly',evidence:['base:consumer.cjs']};
 core.historicalPlanningProducer=async function(work,outputId){const value=await original.call(this,work,outputId);if(work===f.workId&&value.launch.id===p.id&&++reads===1){injected=true;const failed=f.originals.find(l=>l.role==='challenger'),output=f.outputs.find(o=>o.launch===failed.id);c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',claimId,output.id,1,work,JSON.stringify({finding:claim,launchId:failed.id,role:'challenger'}));c.store.run('INSERT INTO obligations VALUES(?,?,?)',claimId,work,JSON.stringify({kind:'finding',occurrence:claimId,state:'pending'}));}return value;};
 f.setObserver(({body})=>{assert.ok(body.context.pendingObligations.some(o=>o.id===claimId));assert.ok(!body.context.plannerInputScope.occurrenceIds.includes(claimId));});
 try{await f.resume();assert.equal(injected,true);assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['challenger','adjudicator']);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM role_launches WHERE id=?',p.id).data).inputScope,savedScope);}
 finally{core.historicalPlanningProducer=original;}
});

for(const dependency of ['plannerOutput','plannerInputScope'])test('challenge with changed exact dependency reruns C while retaining P: '+dependency,{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),ch=f.originals.find(l=>l.role==='challenger'),data=JSON.parse(ch.data);data[dependency]={changed:true};c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),ch.id);
 const after=await f.resume();assert.deepEqual(f.calls.filter(call=>call.mode==='resume').map(call=>call.role),['challenger','adjudicator'],JSON.stringify(after.blocked));assert.equal(after.execution.consumed-f.charges,2);
});

test('original prefix drift during fresh suffix bundle await refuses before reservation',{timeout:30000},async t=>{
 const f=await world(t,'challenger'),core=c.changeCore,original=core.bundle,p=f.originals.find(l=>l.role==='planner');let injected=false;
 core.bundle=async function(work,context,...rest){const value=await original.call(this,work,context,...rest);if(work===f.workId&&context.stage==='planning-challenge'){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringBundle:true}),p.id);}return value;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.execution.consumed,f.charges);assert.equal(after.phase,'BLOCKED');assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);}
 finally{core.bundle=original;}
});

test('original prefix drift while fresh J runs retains output without adopting',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),p=f.originals.find(l=>l.role==='planner');
 f.setObserver(input=>{acceptWithRetainedDuties(input);if(input.role==='adjudicator')c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(p.data),changedDuringJudgment:true}),p.id);});
 const after=await f.resume();assert.equal(after.planVersion,null);assert.equal(after.phase,'BLOCKED');assert.equal(after.execution.consumed-f.charges,1);assert.match(after.blocked.join(),/changed/);
 const fresh=f.launches().at(-1);assert.equal(fresh.role,'adjudicator');assert.equal(fresh.status,'COMPLETE');assert.equal(c.store.one('SELECT status FROM role_outputs WHERE launch=?',fresh.id).status,'usable');
});


test('cancellation during retained evidence read admits no replacement producer',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,original=core.historicalPlanningProducer,abort=new AbortController();let interrupted=false;
 core.historicalPlanningProducer=async function(work,output){const value=await original.call(this,work,output);if(work===f.workId){interrupted=true;abort.abort(Error('Controlled owner cancellation'));}return value;};
 try{const after=await f.resume(abort.signal);assert.equal(interrupted,true);assert.equal(after.planVersion,null);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(call=>call.mode==='resume').length,0);}
 finally{core.historicalPlanningProducer=original;}
});

test('planning J keeps canonical latest and actual obligation state inline while full exact history leaves the eager view',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),core=c.changeCore,occurrence=c.inspectChange(f.workId).occurrences.find(o=>o.data.finding.requirementId==='R1');assert.ok(occurrence);
 const old=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),producer=f.originals.find(l=>l.role==='adjudicator');let latestId;
 for(let i=0;i<100;i++){latestId=randomUUID();c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',latestId,occurrence.id,producer.id,'upheld',JSON.stringify({occurrenceId:occurrence.id,disposition:'upheld',reason:'Original historical independent BASE assessment '+i,witnesses:['base:consumer.cjs']}));}
 for(let i=0;i<100;i++)c.store.run('INSERT INTO obligations VALUES(?,?,?)','past-diagnostic-'+f.workId+'-'+i,f.workId,JSON.stringify({kind:'diagnostic',state:'resolved',issues:['Original resolved history '+i]}));
 const oldObligations=c.store.all('SELECT * FROM obligations WHERE work=? ORDER BY rowid',f.workId);
 const before=c.store.all('SELECT d.* FROM finding_dispositions d JOIN finding_occurrences o ON o.id=d.occurrence WHERE o.work=? ORDER BY d.rowid',f.workId),inspect=core.inspect;
 core.inspect=function(...args){const view=inspect.apply(this,args);return {...view,dispositions:[...view.dispositions].reverse()};};
 let observed;f.setObserver(event=>{if(event.role!=='adjudicator')return;const body=event.body,manifest=body.context.dispositionHistory;observed=structuredClone(body.context);
  assert.equal(body.context.dispositions.filter(d=>d.occurrence===occurrence.id).length,1);assert.equal(body.context.dispositions.find(d=>d.occurrence===occurrence.id).id,latestId);
  assert.equal(manifest.records,before.length);assert.equal(manifest.workId,f.workId);assert.equal(manifest.stage,'planning-adjudication');const bytes=readFileSync(manifest.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.deepEqual(body.context.occurrences.map(o=>o.id),c.inspectChange(f.workId).occurrences.map(o=>o.id));const pending=new Set(core.pending(f.workId).map(o=>o.id));for(const row of body.context.obligationStates)assert.equal(row.currentPending,pending.has(row.id));assert.ok(body.context.obligationStates.every(o=>!o.id.startsWith('past-diagnostic-')));for(const id of pending)assert.ok(body.context.obligationStates.some(o=>o.id===id));
  assert.ok(JSON.stringify(body.context.dispositions).length<JSON.stringify(before).length/4);acceptWithRetainedDuties(event);
 });
 try{const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(observed);const judgment=f.launches().at(-1);assert.deepEqual(JSON.parse(judgment.data).dispositionHistory,observed.dispositionHistory);for(const row of before)assert.deepEqual(c.store.one('SELECT * FROM finding_dispositions WHERE id=?',row.id),row);assert.equal(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=?',occurrence.id).length,old.length+101);for(const row of oldObligations.filter(o=>o.id.startsWith('past-diagnostic-')))assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?',row.id),row);}
 finally{core.inspect=inspect;}
});

test('oversized chronological evidence refuses before another role reservation or provider call without clipping records',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),occurrence=f.first.occurrences[0],producer=f.originals.find(l=>l.role==='adjudicator');assert.ok(occurrence);
 for(let i=0;i<40;i++)c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)',randomUUID(),occurrence.id,producer.id,'upheld',JSON.stringify({occurrenceId:occurrence.id,disposition:'upheld',reason:'x'.repeat(32000),witnesses:[]}));
 const rows=c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),launchCount=f.launches().length,files=await fs.readdir(path.join(home,'artifacts'));
 const after=await f.resume();assert.equal(after.phase,'BLOCKED');assert.match(after.blocked.join(),/Disposition history exceeds.*1MiB/);assert.equal(f.launches().length,launchCount);assert.equal(after.execution.consumed,f.charges);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.deepEqual(c.store.all('SELECT * FROM finding_dispositions WHERE occurrence=? ORDER BY rowid',occurrence.id),rows);assert.deepEqual(await fs.readdir(path.join(home,'artifacts')),files);
});
test('cancellation during original evidence open cannot write snapshot content or dispatch a role',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),abort=new AbortController(),open=fs.open;let target;
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('/role-dispositions-')){target=String(file);abort.abort(Error('CONTROLLED_EVIDENCE_OPEN_CANCEL'));}return handle;};
 try{await f.resume(abort.signal);assert.ok(target);assert.equal((await fs.stat(target)).size,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');}
 finally{fs.open=open;}
});

test('cancellation while evidence close settles cannot allocate a role conversation afterward',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator'),abort=new AbortController(),open=fs.open,allocate=c.changeCore.h.allocateRole;let target,allocations=0;
 c.changeCore.h.allocateRole=function(...args){allocations++;return allocate.apply(this,args);};
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(!String(file).includes('/role-dispositions-'))return handle;target=String(file);return {writeFile:handle.writeFile.bind(handle),async close(){await handle.close();abort.abort(Error('CONTROLLED_EVIDENCE_CLOSE_CANCEL'));}};};
 try{await f.resume(abort.signal);assert.ok(target);assert.ok((await fs.stat(target)).size>0);assert.equal(allocations,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);}
 finally{fs.open=open;c.changeCore.h.allocateRole=allocate;}
});

const largeHistoricalPlan=({role,result})=>{if(role==='planner')result.plan.approach='Original independently challengeable plan alternative. '.repeat(100);};
test('planning recovery publishes its original exact plan body while retaining current proposal and every pending claim',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan),originalRows=f.outputs;let observed;
 f.setObserver(event=>{
  if(event.role!=='adjudicator')return;
  const context=event.body.context,historical=context.historicalPlanningOperands;observed=structuredClone(context);
  assert.ok(historical.planBodyEncoding);assert.equal(historical.planBodyEncoding.version,1);
  const manifest=historical.planBodyEncoding.manifest;assert.equal(manifest.workId,f.workId);assert.equal(manifest.epoch,f.first.epoch);
  const text=readFileSync(manifest.path,'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),manifest.sha256);
  assert.ok(context.planProposal.approach.startsWith('Original independently'),'Current proposal remains complete');
  const old=historical.plans[0];assert.equal(old.plan,undefined);assert.equal(old.inlinePlan.approach,undefined);assert.ok(old.inlinePlan.requirements.length);assert.ok(old.inlinePlan.verification.checkIndex[0].guaranteeIds.length);
  const full=JSON.parse(text.split('\n').slice(old.record.firstLine-1,old.record.lastLine).map(JSON.parse).map(x=>x.text).join(''));
  assert.equal(createHash('sha256').update(JSON.stringify(full.plan)).digest('hex'),old.planHash);assert.equal(full.plan.approach,context.planProposal.approach);
  assert.deepEqual(context.occurrences.map(x=>x.id),c.inspectChange(f.workId).occurrences.map(x=>x.id));
  acceptWithRetainedDuties(event);
 });
 const after=await f.resume();assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(observed);
 const metadata=JSON.parse(f.launches().at(-1).data);assert.equal(metadata.inputEvidenceManifests.length,2);assert.ok(metadata.inputEvidenceManifests.some(m=>m.kind==='historical-plans'));assert.equal(metadata.historicalInputHash,createHash('sha256').update(JSON.stringify(observed.historicalPlanningOperands)).digest('hex'));
 for(const row of originalRows)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',row.id),row);
});

test('historical source drift after snapshot preparation cannot allocate a fresh role or supply changed evidence',{timeout:30000},async t=>{
 const f=await world(t,'adjudicator',largeHistoricalPlan),open=fs.open,old=f.originals.find(l=>l.role==='adjudicator'),allocate=c.changeCore.h.allocateRole;let injected=false,allocations=0;
 c.changeCore.h.allocateRole=function(...args){allocations++;return allocate.apply(this,args);};
 fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('/role-plans-')){injected=true;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...JSON.parse(old.data),changedAfterSnapshot:true}),old.id);}return handle;};
 try{const after=await f.resume();assert.equal(injected,true);assert.equal(after.phase,'BLOCKED');assert.equal(allocations,0);assert.equal(f.calls.filter(v=>v.mode==='resume').length,0);assert.match(after.blocked.join(),/historical producer records changed/i);}
 finally{fs.open=open;c.changeCore.h.allocateRole=allocate;c.store.run('UPDATE role_launches SET data=? WHERE id=?',old.data,old.id);}
});
