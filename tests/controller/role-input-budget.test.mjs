import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {resolveManagedModel} from '../../dist/pi/managed-provider.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';
import {prepareSubjectActionInput} from '../../dist/workflow/subject-actions.js';
import {freshCriteriaDeliveryVersion} from '../../dist/workflow/criteria-delivery.js';
async function world(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'role-input-budget-'))),home=path.join(root,'app'),source=path.join(root,'source');await fs.mkdir(source,{mode:0o700});
 for(let i=0;i<8;i++)await fs.writeFile(path.join(source,`optional-${i}.txt`),String(i).padEnd(16000,'x'));
 const mandatory='exact mandatory 한국어\n'+'m'.repeat(64000);await fs.writeFile(path.join(source,'mandatory.txt'),mandatory);
 const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'must-not-dispatch',image:'sha256:'+'0'.repeat(64)}});
 t.after(async()=>{await c.close();t.diagnostic('Retained private input-budget world '+root);});
 await c.registerProject({id:'P',sourceRoot:source});const work=await c.beginChange({projectId:'P',request:'Preserve original owner intent 한국어 and inspect actual source.',executionLimit:9});
 const accounts=ApplicationAccounts.open(c);
 async function selection(contextWindow,maxTokens=1000){
  await accounts.configure({providers:{'budget-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'DUMMY_BUDGET_NO_REQUEST',models:[{id:'original',contextWindow,maxTokens,reasoning:false}]}}});
  return{provider:'budget-fixture',modelId:'original',managed:await resolveManagedModel(home,'budget-fixture','original')};
 }
 const snapshot=()=>Object.fromEntries(['sources','runs','role_launches','role_outputs','budgets','capacity_leases'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
 return{c,work,source,mandatory,selection,snapshot};
}
test('exhausted execution refuses before role model selection, bundle assembly or reservation',async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",lineage);
 const before=f.snapshot();let selections=0,bundles=0,reservations=0;
 core.selectRoleModel=async()=>{selections++;throw Error('UNEXPECTED_MODEL_PREPARATION')};
 core.bundle=async()=>{bundles++;throw Error('UNEXPECTED_BUNDLE')};core.reserve=()=>{reservations++;throw Error('UNEXPECTED_RESERVATION')};
 const result=await f.c.planChange({workId:f.work.workId,model:{provider:'unused',modelId:'unused'}});
 assert.match(result.blocked.join(' '),/Execution allowance exhausted/);
 assert.deepEqual({selections,bundles,reservations},{selections:0,bundles:0,reservations:0});assert.deepEqual(f.snapshot(),before);
});
for(const [role,stage] of [['challenger','planning-challenge'],['adjudicator','planning-adjudication']])test('exhausted resolution refuses '+role+' before model preparation',async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='resolution'",lineage);
 const before=f.snapshot();let selections=0;core.selectRoleModel=async()=>{selections++;throw Error('UNEXPECTED_MODEL_PREPARATION')};
 const options={workId:f.work.workId,model:{provider:'unused',modelId:'unused'}};
 const result=await core.operation(options,'plan',async()=>{await core.role(options,role,{stage});return core.inspect(f.work.workId)});
 assert.match(result.blocked.join(' '),/Resolution allowance exhausted/);assert.equal(selections,0);assert.deepEqual(f.snapshot(),before);
});
test('one available resolution unit still permits original planner preparation',async t=>{
 const f=await world(t), lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 f.c.store.run("UPDATE budgets SET lim=consumed+1 WHERE lineage=? AND kind='resolution'",lineage);
 const before=f.snapshot();let selections=0;
 f.c.changes.selectRoleModel=async()=>{selections++;throw Error('CONTROL_MODEL_PREPARATION_REACHED')};
 const result=await f.c.planChange({workId:f.work.workId,model:{provider:'unused',modelId:'unused'}});
 assert.equal(selections,1);assert.match(result.blocked.join(' '),/CONTROL_MODEL_PREPARATION_REACHED/);assert.deepEqual(f.snapshot(),before);
});
for(const timing of ['before-preflight','during-selection'])test('writable source hold retains priority '+timing,async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 let held=timing==='before-preflight',selections=0;
 core.h.sourceImpacts=()=>[{input_id:'controlled-owner-direction',revision:1,source:'controlled-source',data:{effectHold:held}}];
 if(held)f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",lineage);
 const before=f.snapshot(),selection=core.selectRoleModel.bind(core);
 core.selectRoleModel=async(...args)=>{selections++;const selected=await selection(...args);held=true;return selected};
 const options={workId:f.work.workId,model:{provider:'unused',modelId:'unused'}};
 const result=await core.operation(options,'implement',async()=>{await core.role(options,'implementer',{stage:'implementation'},true);return core.inspect(f.work.workId)});
 assert.match(result.blocked.join(' '),/source-fit decision/);assert.equal(selections,timing==='before-preflight'?0:1);assert.deepEqual(f.snapshot(),before);
});
test('stale entry after planning prefix is refused before exhausted allowance or model advice',async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 const role=core.role.bind(core);let refusal,spent;
 core.planningPrefix=async()=>{
  f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.work.workId);
  f.c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",lineage);
  spent=f.snapshot();return null;
 };
 core.selectRoleModel=async()=>assert.fail('Stale producer cannot prepare a model');
 core.role=async(...args)=>{try{return await role(...args)}catch(error){refusal=error;throw error}};
 await f.c.planChange({workId:f.work.workId,model:{provider:'unused',modelId:'unused'}});
 assert.match(refusal.message,/Operation interrupted or selected input versions changed/);assert.deepEqual(f.snapshot(),spent);
});
test('resolution allowance spent during planning prefix lookup stops before planner model preparation',async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot;
 const original=core.planningPrefix.bind(core);let spent;
 core.planningPrefix=async(...args)=>{
  const prefix=await original(...args);
  f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='resolution'",lineage);
  spent=f.snapshot();
  return prefix;
 };
 core.selectRoleModel=async()=>assert.fail('Planner must not prepare a model after resolution allowance is spent');
 const result=await f.c.planChange({workId:f.work.workId,model:{provider:'unused',modelId:'unused'}});
 assert.match(result.blocked.join(' '),/Resolution allowance exhausted/);
 assert.deepEqual(f.snapshot(),spent);
});
for(const kind of ['execution','resolution'])test(`shared ${kind} allowance spent during model selection still fails the atomic reservation`,async t=>{
 const f=await world(t),core=f.c.changes,lineage=f.c.inspectWork(f.work.workId).lineageRoot,model=await f.selection(1000000,32000);
 f.c.store.run("UPDATE budgets SET lim=consumed+1 WHERE lineage=? AND kind=?",lineage,kind);
 const originalSelection=core.selectRoleModel.bind(core),originalBundle=core.bundle.bind(core),originalReserve=core.reserve.bind(core);
 let selections=0,bundles=0,reservations=0,spent;
 core.selectRoleModel=async(...args)=>{selections++;const result=await originalSelection(...args);f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind=?",lineage,kind);spent=f.snapshot();return result};
 core.bundle=async(...args)=>{bundles++;return originalBundle(...args)};
 core.reserve=(...args)=>{reservations++;try{return originalReserve(...args)}catch(error){assert.equal(error.code,kind==='execution'?'BUDGET_EXHAUSTED':'RESOLUTION_EXHAUSTED');throw error}};
 const result=await f.c.planChange({workId:f.work.workId,model});
 assert.match(result.blocked.join(' '),new RegExp(kind+' allowance exhausted','i'));
 assert.deepEqual({selections,bundles,reservations},{selections:1,bundles:1,reservations:1});assert.deepEqual(f.snapshot(),spent,'Only the controlled concurrent shared spend survives; no new reservation/run/output');
});
test('prepared subject recipe cannot be coherently replaced or removed before reservation',async t=>{
 const f=await world(t),before=f.snapshot();
 for(const replacement of ['base','removal','declaration']){
  const prepared=await f.c.changes.bundle(f.work.workId,{stage:'planning-adjudication',subjectActionsInput:{version:1},metadataIdentityInput:{version:3}},'adjudicator');
  prepared.assertCurrent();
  const context=structuredClone(prepared.bundle.context);
  if(replacement==='base'){
   delete context.subjectActionsProfile;delete context.subjectActionsView;
   for(const row of context.occurrences)delete row.subjectKey;
   context.baseVersion='DIFFERENT-BASE';
   prepared.bundle.context=prepareSubjectActionInput('adjudicator',context);
  }else{
   delete context.subjectActionsInput;delete context.subjectActionsProfile;delete context.subjectActionsView;
   if(replacement==='declaration')context.subjectActionsInput={version:2};
   prepared.bundle.context=context;
  }
  assert.throws(()=>prepared.assertCurrent(),/subject action|Subject action/);
 }
 assert.deepEqual(f.snapshot(),before,'Drift refusal creates no run, charge, capture or capacity lease');
});
test('model-aware planner assembly preserves mandatory bytes and keeps the legacy full-text refusal',async t=>{
 const f=await world(t),core=f.c.changes,workId=f.work.workId,legacy={stage:'planning',requiredPaths:['mandatory.txt']};
 const context={...legacy,workflowCriteriaInput:{version:freshCriteriaDeliveryVersion('planner',legacy.stage),id:randomUUID()},metadataIdentityInput:{version:1},findingBodyInput:{version:4}};
 const model=await f.selection(128000,16384),before=f.snapshot();
 await assert.rejects(core.bundle(workId,legacy,'planner',model),{code:'MODEL_CONTEXT_LIMIT'});
 const unknown=(await core.bundle(workId,context,'planner')).bundle;
 const selected=unknown.sources.find(source=>source.path==='mandatory.txt');assert.equal(selected.content,f.mandatory);assert.ok(unknown.requiredScope.some(scope=>scope.sourceId===selected.id));
 assert.ok(unknown.sources.filter(source=>source.path!=='mandatory.txt').reduce((bytes,source)=>bytes+Buffer.byteLength(source.content),0)<=32768);
 const known=(await core.bundle(workId,context,'planner',model)).bundle;
 assert.equal(known.sources.find(source=>source.path==='mandatory.txt').content,f.mandatory);assert.deepEqual(known.requiredScope,unknown.requiredScope);assert.deepEqual(known.requirements,unknown.requirements);assert.equal(known.contracts,unknown.contracts);assert.deepEqual(known.sourceCatalogue,unknown.sourceCatalogue);assert.deepEqual(f.snapshot(),before);
 assert.equal(await fs.readFile(path.join(f.source,'mandatory.txt'),'utf8'),f.mandatory);
});
test('captured model room can omit every optional seed before original INITIAL allocation',async t=>{
 const f=await world(t),stage='planning',context={stage,workflowCriteriaInput:{version:freshCriteriaDeliveryVersion('planner',stage),id:randomUUID()},metadataIdentityInput:{version:1},findingBodyInput:{version:4}},initial=(await f.c.changes.bundle(f.work.workId,context,'planner')).bundle;assert.ok(initial.sources.length);
 const mandatory={...initial,sources:[]},framing=roleFraming('planner',mandatory);
 const lower=assertModelContextBudget({contextWindow:1000000,maxTokens:1000},{systemPrompt:framing.systemPrompt,messages:[{role:'user',content:framing.prompt,timestamp:0}]});
 // Calibrate the fixture against the same criteria and body profiles admitted by the public planner.
 const model=await f.selection(lower.estimatedInput+1000+4096+7500),packed=(await f.c.changes.bundle(f.work.workId,context,'planner',model)).bundle;
 assert.deepEqual(packed.sources,[]);assert.deepEqual(packed.requirements,initial.requirements);assert.equal(packed.contracts,initial.contracts);assert.deepEqual(packed.sourceCatalogue,initial.sourceCatalogue);
 for(const source of initial.sources)assert.ok(packed.context.sourceInventory.excluded.includes(source.id));
 let capacity=0;f.c.changes.h.acquireCapacity=async()=>{capacity++;throw Error('CONTROLLED_AFTER_INITIAL_BEFORE_ENGINE');};
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(f.c.options.installationHome,'artifacts');let result;
 try{result=await f.c.planChange({workId:f.work.workId,model});}finally{if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;}
 assert.match(result.blocked.join(' '),/CONTROLLED_AFTER_INITIAL/);assert.equal(capacity,1);
 const launches=f.c.store.all('SELECT * FROM role_launches WHERE work=?',f.work.workId);assert.equal(launches.length,1);
 const launch=JSON.parse(launches[0].data),scope=launch.inputScope;assert.deepEqual(scope.selectedSources,[]);assert.deepEqual(scope.promptIncludedSourceIds,[]);
 assert.equal(launch.workflowCriteria.profile,initial.context.workflowCriteria.profile);
 assert.equal(launch.workflowCriteriaInput.version,context.workflowCriteriaInput.version);
});
test('known mandatory lower-bound overflow refuses public planning before charge or native allocation',async t=>{
 const f=await world(t),model=await f.selection(8192),before=f.snapshot();let capacity=0;
 f.c.changes.h.acquireCapacity=async()=>{capacity++;throw Error('UNEXPECTED_NATIVE_ALLOCATION');};
 const result=await f.c.planChange({workId:f.work.workId,model});assert.match(result.blocked.join(' '),/MODEL_CONTEXT_LIMIT/);assert.equal(capacity,0);assert.deepEqual(f.snapshot(),before);
 assert.match(result.nextAction,/context\/output limits/);assert.ok(result.nextAction.includes('/change resume '+f.work.workId));assert.doesNotMatch(result.nextAction,/corrected verification cases|owner clarification/);
 const original=f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId),legacy={...JSON.parse(original.data),nextAction:'Explicit same-W run/resume with corrected verification cases or targeted owner clarification'};
 f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify(legacy),f.work.workId);const recorded=f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId);
 assert.match(f.c.inspectChange(f.work.workId).nextAction,/context\/output limits/);assert.deepEqual(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId),recorded);
 assert.match(f.c.inspectChange(f.work.workId).nextAction,/Explicit profiles retain their original model route/);
 assert.doesNotMatch(f.c.inspectChange(f.work.workId).nextAction,/\/role-model/);
 const quoted={...legacy,blocked:['Owner quoted ModelContextBudgetError: MODEL_CONTEXT_LIMIT: as ordinary text']};f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify(quoted),f.work.workId);
 const quotedView=f.c.inspectChange(f.work.workId);
 assert.equal(quotedView.modelContextFailure,undefined);assert.match(quotedView.nextAction,/Inspect original planning blockers/);
 assert.doesNotMatch(quotedView.nextAction,/context\/output limits/);
 assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId).data),quoted);
 assert.equal(await fs.readFile(path.join(f.source,'mandatory.txt'),'utf8'),f.mandatory);

 const workId=f.work.workId,store=f.c.store;
 store.run('UPDATE change_state SET data=? WHERE work=?',recorded.data,workId);
 const owner=store.one('SELECT lineage FROM works WHERE id=?',workId);
 for (const kind of ['execution','resolution']) {
  store.run('UPDATE budgets SET consumed=lim WHERE lineage=? AND kind=?',owner.lineage,kind);
  const beforeInspect=f.snapshot(),action=f.c.inspectChange(workId).nextAction;
  const actions=kind==='execution'?'Extend shared execution allowance':'Extend shared execution allowance and Extend shared resolution allowance';
  assert.match(action,new RegExp(`context/output limits.*After resolving the context capacity mismatch and settling the current work, open /work .* and select ${actions}\\. Once the model and inputs fit and allowance is available, use /change resume`));
  assert.doesNotMatch(action,/\.\./);
  assert.deepEqual(f.snapshot(),beforeInspect);
 }
});
test('explicit selected limits refuse before charge and retain their original detached definition across awaits',async t=>{
 const f=await world(t),definition={api:'openai-completions',apiKey:'DUMMY_EXPLICIT_NO_REQUEST',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'other',contextWindow:1000000,maxTokens:1000,reasoning:false},{id:'original',contextWindow:8192,maxTokens:1000,reasoning:false}]},model={provider:'explicit-budget',modelId:'original',definition},before=f.snapshot();let capacity=0;
 f.c.changes.h.acquireCapacity=async()=>{capacity++;throw Error('UNEXPECTED_EXPLICIT_ALLOCATION');};
 const pending=f.c.planChange({workId:f.work.workId,model});definition.models[1].contextWindow=1000000;
 const result=await pending;assert.match(result.blocked.join(' '),/MODEL_CONTEXT_LIMIT/);assert.equal(result.modelContextFailure,'MODEL_CONTEXT_LIMIT');assert.equal(capacity,0);assert.deepEqual(f.snapshot(),before);assert.equal(await fs.readFile(path.join(f.source,'mandatory.txt'),'utf8'),f.mandatory);
});
test('explicit known room preserves required source and uses the same optional-seed selection',async t=>{
 const f=await world(t),context={stage:'planning',workflowCriteriaInput:{version:1,id:randomUUID()},metadataIdentityInput:{version:1}},before=f.snapshot(),initial=(await f.c.changes.bundle(f.work.workId,context,'planner')).bundle;
 const framing=roleFraming('planner',{...initial,sources:[]}),lower=assertModelContextBudget({contextWindow:1000000,maxTokens:1000},{systemPrompt:framing.systemPrompt,messages:[{role:'user',content:framing.prompt,timestamp:0}]});
 const definition={models:[{id:'selected',contextWindow:lower.estimatedInput+1000+4096+7500,maxTokens:1000,reasoning:false}]};
 const packed=(await f.c.changes.bundle(f.work.workId,context,'planner',{provider:'explicit-budget',modelId:'selected',definition})).bundle;
 assert.deepEqual(packed.sources,[]);assert.deepEqual(packed.requirements,initial.requirements);assert.equal(packed.contracts,initial.contracts);assert.deepEqual(packed.sourceCatalogue,initial.sourceCatalogue);assert.deepEqual(f.snapshot(),before);
 definition.models[0].contextWindow=200000;
 const required=(await f.c.changes.bundle(f.work.workId,{stage:'planning',requiredPaths:['mandatory.txt']},'planner',{provider:'explicit-budget',modelId:'selected',definition})).bundle;assert.equal(required.sources.find(s=>s.path==='mandatory.txt').content,f.mandatory);assert.deepEqual(f.snapshot(),before);
});

for(const key of ['metadataIdentityInput','metadataIdentityEncoding'])for(const value of [undefined,{version:3}])test('literal review refuses explicit '+key+'='+String(value)+' before asynchronous preparation',async t=>{
 const f=await world(t),core=f.c.changes,before=f.snapshot();let selections=0,bundles=0,reservations=0;
 core.selectRoleModel=async()=>{selections++;throw Error('UNEXPECTED_SELECTION')};core.bundle=async()=>{bundles++;throw Error('UNEXPECTED_BUNDLE')};core.reserve=()=>{reservations++;throw Error('UNEXPECTED_RESERVATION')};
 const options={workId:f.work.workId,model:{provider:'unused',modelId:'unused'}};
 const result=await core.operation(options,'resolve',async()=>{await core.role(options,'adjudicator',{stage:'review-adjudication',[key]:value});return core.inspect(f.work.workId)});
 assert.match(result.blocked.join(' '),/metadata identity presentation/);assert.deepEqual({selections,bundles,reservations},{selections:0,bundles:0,reservations:0});assert.deepEqual(f.snapshot(),before);
});

test('literal keyed assembly keeps its identity recipe and refuses insufficient context without allocation',async t=>{
 const f=await world(t),before=f.snapshot(),context={stage:'planning-adjudication',subjectActionsInput:{version:2}};
 const prepared=await f.c.changes.bundle(f.work.workId,context,'adjudicator',await f.selection(200000,16384));
 prepared.assertCurrent();assert.equal(prepared.bundle.context.subjectActionsProfile.version,2);
 assert.equal(Object.hasOwn(prepared.bundle.context,'metadataIdentityInput'),false);assert.equal(Object.hasOwn(prepared.bundle.context,'metadataIdentityEncoding'),false);
 await assert.rejects(f.c.changes.bundle(f.work.workId,context,'adjudicator',await f.selection(8192,1000)),error=>error.code==='MODEL_CONTEXT_LIMIT');
 assert.deepEqual(context,{stage:'planning-adjudication',subjectActionsInput:{version:2}},'Insufficient room cannot silently select compression or change a declaration');
 assert.deepEqual(f.snapshot(),before,'No role/run/allowance/capacity allocated by bundle admission');
});
