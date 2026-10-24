import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {Store} from '../../dist/controller/store.js';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {loadCriteria} from '../../dist/controller/criteria.js';
import {nativeCheckpoint} from '../../dist/controller/history.js';
import {hash} from '../../dist/controller/change-files.js';
import {initializePiHost} from '../../dist/pi/index.js';
import {runRole} from '../../dist/workflow/adapter.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'historical-operands-'))),state=path.join(root,'state'),artifacts=path.join(root,'artifacts'),workspace=path.join(root,'work');
for(const dir of[state,artifacts,workspace])await fs.mkdir(dir,{mode:0o700});
const previousFetch=globalThis.fetch;let refusedFetch=0;globalThis.fetch=async()=>{refusedFetch++;throw Error('External fetch forbidden in DUMMY historical fixture');};
const previousTemp=process.env.TMPDIR;process.env.TMPDIR=artifacts;const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
after(async()=>{if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;await fs.rm(root,{recursive:true,force:true});globalThis.fetch=previousFetch;assert.equal(refusedFetch,0);});
const deny=()=>{throw Error('No engine/project/network execution in this DUMMY native history fixture');};
const operations={workspaceRoot:workspace,validatePath(p){const f=path.resolve(workspace,p);if(f!==workspace&&!f.startsWith(workspace+path.sep))throw Error('outside');return f;},readFile:deny,access:deny,exec:deny,writeFile:deny,mkdir:deny};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const common={version:1,summary:'DUMMY historical assessment',findings:[],assessedScope:[]};
const finding=description=>({requirementId:'R1',severity:'blocking',repair:'substantive',description,evidence:['original source']});
const plan={intent:'Preserve requested behavior',requirements:[{id:'R1',text:'Preserve behavior',source:'owner'}],approach:'OLD_DISCARDED_PLAN retained as data',simplerAlternative:'Reuse existing behavior',factualSources:['Only the actual initial scope'],verification:{checks:[{id:'C1',guaranteeIds:['R1'],command:'node /input/check.cjs',assertions:['healthy','adverse'],timeoutMs:1000,fixturePaths:[]}],requiredPaths:[],reviewRoles:[{key:'behavior',kind:'reviewer',purpose:'Independent assessment',requiredPaths:[]}]},ambiguities:[]};
function model(raw,onInput=()=>{}){return {provider:'historical-fixture-'+randomUUID(),modelId:'fixture',definition:{api:'fixture-api',apiKey:'DUMMY',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',input:['text'],reasoning:false,contextWindow:500000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(selected,context){onInput(JSON.stringify(context));const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_HISTORICAL_THINKING_MUST_NOT_PROJECT'},{type:'text',text:raw}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};}
async function fixture(){
 const store=new Store(':memory:'),criteria=await loadCriteria(),tuple={contracts:'K',requirements:null,base:'B',candidate:null,plan:null,verification:null};
 store.run('INSERT INTO sources VALUES(?,?,?,?)','S',null,'{}','Original owner intent');store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'S',null,'W','ACTIVE',1,1,null,'{}');
 store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','K','W','contracts',null,null,criteria.hash,JSON.stringify({text:criteria.text,assets:criteria.assets}));store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','B','W','base',null,workspace,hash('base'),JSON.stringify({manifest:{files:[],directories:[]}}));
 store.run('INSERT INTO change_state VALUES(?,?,?,?,?,?,?,?)','W','BASE_CAPTURED','B',null,null,null,1,JSON.stringify({contractsVersion:'K',ownerRequirements:[],request:'Original owner intent'}));for(const kind of['execution','resolution'])store.run('INSERT INTO budgets VALUES(?,?,?,?,?)','W',kind,32,0,0);
 const core=new ChangeCore({store,sourceImpacts:()=>[],assertOpen(){},options:{installationHome:root}});
 async function produce(role,stage,protocol,context={},onInput){
  const launch=randomUUID(),run=randomUUID(),bundle=await core.bundle('W',{stage,...context},role),raw=typeof protocol==='string'?protocol:JSON.stringify(protocol);
  store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,'W',1,1,'CREATED',workspace,'reserved','{}');store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,'W',run,role,1,'CREATED','none',JSON.stringify({stage,inputVersions:tuple,...context}));
  const result=await runRole({launchId:launch,role,inputBundle:bundle,operations,host,model:model(raw,onInput),assertEntry(){},beforeModelRequest:async()=>{}}),cp=await nativeCheckpoint(result.historyRef);
  const native={cleanup:'removed',historyRef:result.historyRef,nativeSessionId:cp.sessionId,nativeCheckpoint:cp};store.run('UPDATE runs SET phase=?,reservation=?,data=? WHERE id=?','SETTLED','consumed',JSON.stringify(native),run);store.run('UPDATE role_launches SET status=?,data=? WHERE id=?',result.usable?'COMPLETE':'UNUSABLE',JSON.stringify({stage,inputVersions:tuple,...context,...native}),launch);
  const output=core.collect('W',launch,{...result,nativeEntryId:result.selectedFinalEntryId},result.usable);return{launch,run,output,bundle,result,cp,raw};
 }
 const invalid=await produce('planner','planning','<function=write>never executed</function>');
 const planner=await produce('planner','planning',{...common,plan,findings:[finding('Baseline implementation remains a distinct pending concern')]});
 const challenger=await produce('challenger','planning-challenge',{...common,findings:[finding('The earlier planner had fewer visible claims; historical census needs its actual input')]},{planProposal:plan,plannerOutput:JSON.parse(planner.raw)});
 return{store,core,tuple,invalid,planner,challenger,produce,close(){store.close();}};
}

test('actual normal J bundle and native consumer receive deduplicated historical plan/original P view without old private history or rehabilitation',async()=>{
 const f=await fixture();try{
  const prior=f.store.all('SELECT * FROM role_outputs ORDER BY id'),launches=f.store.all('SELECT * FROM role_launches ORDER BY id'),beforeObligations=f.store.all('SELECT * FROM obligations ORDER BY id');
  const disputed={planProposal:plan,challenge:JSON.parse(f.challenger.raw)};
  const bundle=await f.core.bundle('W',{stage:'planning-adjudication',...disputed},'adjudicator'),projection=bundle.context.historicalPlanningOperands;
  assert.equal(projection.links.length,1);assert.equal(projection.plans.length,1);assert.equal(projection.unavailable.length,0);assert.deepEqual(projection.plans[0].plan,plan);
  const oldP=projection.producers.find(x=>x.outputId===f.planner.output),oldC=projection.producers.find(x=>x.outputId===f.challenger.output);
  assert.equal(oldP.initialView.occurrenceIds.length,1);assert.equal(oldP.initialView.findingBodyOmittedIds.length,1);assert.equal(oldC.initialView.occurrenceIds.length,2);assert.equal(oldC.initialView.findingBodySuppliedIds.length,2);assert.ok(oldP.initialView.textSha256);assert.equal(oldP.checkpoint.sha256,f.planner.cp.sha256);assert.match(projection.links[0].pairSemantics,/not a historical host-assigned pair/);
  const text=JSON.stringify(projection);assert.ok(text.includes('OLD_DISCARDED_PLAN'));assert.ok(!text.includes('PRIVATE_HISTORICAL_THINKING'));assert.ok(!text.includes(f.planner.result.historyRef));assert.ok(!text.includes(criteriaMarker()));assert.ok(Buffer.byteLength(text)<20000);
  const currentP=await f.core.bundle('W',{stage:'planning'},'planner');assert.equal(currentP.context.historicalPlanningOperands,undefined);assert.ok(currentP.context.occurrences.find(x=>x.output===f.invalid.output).findingBodyOmitted);
  for(const [role,stage]of[['challenger','planning-challenge'],['reviewer','fresh-review'],['adjudicator','source-fit']])assert.equal((await f.core.bundle('W',{stage},role)).context.historicalPlanningOperands,undefined);
  let nativeInput;const result=await runRole({launchId:'DUMMY-current-J',role:'adjudicator',inputBundle:bundle,operations,host,model:model(JSON.stringify({...common,planAccepted:false,decisions:[]}),x=>nativeInput=x),assertEntry(){},beforeModelRequest:async()=>{}});
  assert.equal(result.usable,true,result.issues.join());assert.equal(result.protocol.planAccepted,false);assert.ok(nativeInput.includes(oldP.initialView.textSha256));assert.ok(nativeInput.includes(projection.plans[0].planHash));assert.ok(!nativeInput.includes('PRIVATE_HISTORICAL_THINKING'));assert.deepEqual(f.store.all('SELECT * FROM role_outputs ORDER BY id'),prior);assert.deepEqual(f.store.all('SELECT * FROM role_launches ORDER BY id'),launches);assert.deepEqual(f.store.all('SELECT * FROM obligations ORDER BY id'),beforeObligations);assert.equal(f.store.all('SELECT * FROM finding_dispositions').length,0);
 }finally{f.close();}
});
function criteriaMarker(){return '# Mission\n\nThe product is named';}

test('changed native checkpoint, wrong selected raw, foreign provenance and ambiguous P equality refuse historical witness',async()=>{
 const f=await fixture();try{
  const origin=f.store.one('SELECT * FROM role_launches WHERE id=?',f.challenger.launch),producer=f.store.one('SELECT * FROM role_outputs WHERE id=?',f.challenger.output),planner=f.store.one('SELECT * FROM role_outputs WHERE id=?',f.planner.output),run=f.store.one('SELECT * FROM runs WHERE id=?',f.challenger.run);
  f.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','FOREIGN',null,'S',null,'FOREIGN','ACTIVE',1,1,null,'{}');
  for(const mutate of[
   ()=>{const d=JSON.parse(run.data);d.nativeCheckpoint.sha256='a'.repeat(64);f.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(d),run.id);},
   ()=>f.store.run('UPDATE role_outputs SET raw=? WHERE id=?',JSON.stringify({...JSON.parse(producer.raw),summary:'changed selected raw'}),producer.id),
   ()=>f.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(producer.data),protocol:{changed:true}}),producer.id),
   ()=>f.store.run('UPDATE role_launches SET work=? WHERE id=?','FOREIGN',origin.id),
   ()=>f.store.run('UPDATE finding_occurrences SET data=? WHERE output=?',JSON.stringify({finding:finding('wrong origin'),launchId:'foreign',role:'challenger'}),producer.id),
   ()=>f.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','duplicate-P',planner.launch,planner.raw,planner.status,planner.data),
  ]){
   mutate();const result=await f.core.historicalPlanningOperands('W',{});assert.equal(result.links.length,0);assert.equal(result.unavailable.length,1);assert.match(result.unavailable[0].code,/^HISTORICAL_.*_UNAVAILABLE$/);assert.equal(result.producers.length,0);
   f.store.run('UPDATE role_launches SET work=? WHERE id=?','W',origin.id);f.store.run('UPDATE runs SET data=? WHERE id=?',run.data,run.id);f.store.run('UPDATE role_outputs SET raw=? WHERE id=?',producer.raw,producer.id);f.store.run('UPDATE role_outputs SET data=? WHERE id=?',producer.data,producer.id);f.store.run('UPDATE finding_occurrences SET data=? WHERE output=?',JSON.stringify({finding:JSON.parse(producer.raw).findings[0],launchId:origin.id,role:'challenger'}),producer.id);f.store.run('DELETE FROM role_outputs WHERE id=?','duplicate-P');
  }
 }finally{f.close();}
});

test('missing or changed initial assigned framing yields unavailable, never a later/current roster substitution',async()=>{
 const f=await fixture();try{
  const file=f.challenger.result.historyRef,original=await fs.readFile(file,'utf8'),run=f.store.one('SELECT * FROM runs WHERE id=?',f.challenger.run),rd=JSON.parse(run.data);
  const entries=original.trim().split('\n').map(JSON.parse),user=entries.find(e=>e.message?.role==='user');user.message.content=[{type:'text',text:'A later arbitrary message is not the original assigned role frame'}];await fs.writeFile(file,entries.map(x=>JSON.stringify(x)).join('\n')+'\n');const cp=await nativeCheckpoint(file);f.store.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...rd,nativeCheckpoint:cp}),run.id);
  const projection=await f.core.historicalPlanningOperands('W',{});assert.equal(projection.links.length,0);assert.equal(projection.unavailable[0].code,'HISTORICAL_INITIAL_INPUT_UNAVAILABLE');
  await fs.writeFile(file,original);f.store.run('UPDATE runs SET data=? WHERE id=?',run.data,run.id);
  const healthy=await f.core.historicalPlanningOperands('W',{});assert.equal(healthy.links.length,1);
 }finally{f.close();}
});

test('pending links deduplicate plan data, accounted history stays closed, current selected C is not historical and materiality remains independent',async()=>{
 const f=await fixture();try{
  const second=await f.produce('adjudicator','planning-adjudication',{...common,planAccepted:false,decisions:[],findings:[finding('An accurate old proposal criticism may not block the corrected present plan')]},{planProposal:plan,challenge:JSON.parse(f.challenger.raw)});
  const projection=await f.core.historicalPlanningOperands('W',{});assert.equal(projection.links.length,2);assert.equal(projection.plans.length,1);
  const scoped=await f.core.historicalPlanningOperands('W',{challengerInputScope:{launchId:f.challenger.launch}});assert.equal(scoped.links.length,1);assert.equal(scoped.links[0].producerOutputId,second.output);
  const occurrence=f.store.one('SELECT * FROM finding_occurrences WHERE output=?',f.challenger.output);f.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence:occurrence.id,state:'resolved'}),occurrence.id);const current=await f.core.historicalPlanningOperands('W',{});assert.equal(current.links.length,1);assert.equal(current.links[0].producerOutputId,second.output);assert.match(current.semantics,/present materiality/);
  // A scripted verdict is not semantic proof; unchanged strict protocol still admits both accountable choices.
  const {parseRoleOutput}=await import('../../dist/workflow/protocol.js');for(const disposition of['rejected','upheld'])assert.ok(parseRoleOutput(JSON.stringify({...common,planAccepted:false,decisions:[{occurrenceId:occurrence.id,disposition,reason:'Independent current applicability assessment',witnesses:['actual historical plan and present plan']}]}),'adjudicator').value);
 }finally{f.close();}
});


test('historical plan is data even when its selected whole output fails the current role schema',async()=>{
 const f=await fixture();try{
  const legacyPlan={...plan,approach:'LEGACY_PLAN_DATA_NOT_CURRENT_STANDING'},legacyProtocol={...common,plan:legacyPlan,legacyField:'Historical shape from another protocol version'};
  const p=await f.produce('planner','planning',legacyProtocol);assert.equal(p.result.usable,false);
  const c=await f.produce('challenger','planning-challenge',{...common,findings:[finding('Assess this historical plan as data, not a current adopted plan')]},{planProposal:legacyPlan,plannerOutput:legacyProtocol});
  const before=f.store.one('SELECT * FROM role_outputs WHERE id=?',p.output),projection=await f.core.historicalPlanningOperands('W',{});
  const link=projection.links.find(x=>x.observationOutputId===c.output);assert.ok(link,JSON.stringify(projection.unavailable));assert.equal(projection.producers.find(x=>x.outputId===p.output).producerStatus,'unusable');assert.deepEqual(projection.plans.find(x=>x.planHash===link.planHash).plan,legacyPlan);assert.deepEqual(f.store.one('SELECT * FROM role_outputs WHERE id=?',p.output),before);
 }finally{f.close();}
});

test('current independent materiality can reject an obsolete plan objection while real baseline and diagnostic obligations stay pending',async()=>{
 const f=await fixture();try{
  const oldC=f.store.one('SELECT * FROM finding_occurrences WHERE output=?',f.challenger.output),oldP=f.store.one('SELECT * FROM finding_occurrences WHERE output=?',f.planner.output),rawBefore=f.store.all('SELECT * FROM role_outputs ORDER BY id');
  const decisions=f.core.pending('W').filter(x=>x.kind==='finding').map(x=>({occurrenceId:x.id,disposition:x.id===oldC.id?'rejected':x.id===oldP.id?'upheld':'unresolved',reason:x.id===oldC.id?'Historical count difference is genuine but not a current defect in a corrected plan':x.id===oldP.id?'Actual baseline behavior still needs implementation and checks':'Retain the independent diagnosis duty',witnesses:['Actual original input and current independent assessment']}));
  const j=await f.produce('adjudicator','planning-adjudication',{...common,planAccepted:true,decisions},{planProposal:{...plan,approach:'CURRENT_CORRECTED_PLAN'},challenge:JSON.parse(f.challenger.raw)});
  assert.equal(j.result.usable,true,j.result.issues.join());f.store.tx(()=>f.core.dispositions('W',j.launch,j.result.protocol));
  assert.equal(JSON.parse(f.store.one('SELECT data FROM obligations WHERE id=?',oldC.id).data).state,'resolved');assert.equal(JSON.parse(f.store.one('SELECT data FROM obligations WHERE id=?',oldP.id).data).state,'pending');
  for(const original of rawBefore)assert.deepEqual(f.store.one('SELECT * FROM role_outputs WHERE id=?',original.id),original);
  assert.equal(f.core.inspect('W').planVersion,null); // Guard unit/native-consumer proof only, not public plan acceptance or task completion.
 }finally{f.close();}
});
