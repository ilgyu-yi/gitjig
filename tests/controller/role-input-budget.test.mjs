import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {resolveManagedModel} from '../../dist/pi/managed-provider.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';
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
test('controller seeds are small; mandatory bytes and source catalogue survive model-aware assembly',async t=>{
 const f=await world(t),context={stage:'planning',requiredPaths:['mandatory.txt']};
 const before=f.snapshot(),unknown=(await f.c.changes.bundle(f.work.workId,context,'planner')).bundle;
 const selected=unknown.sources.find(source=>source.path==='mandatory.txt');assert.equal(selected.content,f.mandatory);assert.ok(unknown.requiredScope.some(scope=>scope.sourceId===selected.id));
 assert.ok(unknown.sources.filter(source=>source.path!=='mandatory.txt').reduce((bytes,source)=>bytes+Buffer.byteLength(source.content),0)<=32768);
 const known=(await f.c.changes.bundle(f.work.workId,context,'planner',await f.selection(128000,16384))).bundle;
 assert.equal(known.sources.find(source=>source.path==='mandatory.txt').content,f.mandatory);assert.deepEqual(known.requiredScope,unknown.requiredScope);assert.deepEqual(known.requirements,unknown.requirements);assert.equal(known.contracts,unknown.contracts);assert.deepEqual(known.sourceCatalogue,unknown.sourceCatalogue);assert.deepEqual(f.snapshot(),before);
 assert.equal(await fs.readFile(path.join(f.source,'mandatory.txt'),'utf8'),f.mandatory);
});
test('captured model room can omit every optional seed before original INITIAL allocation',async t=>{
 const f=await world(t),context={stage:'planning'},initial=(await f.c.changes.bundle(f.work.workId,context,'planner')).bundle;assert.ok(initial.sources.length);
 const mandatory={...initial,sources:[]},framing=roleFraming('planner',mandatory);
 const lower=assertModelContextBudget({contextWindow:1000000,maxTokens:1000},{systemPrompt:framing.systemPrompt,messages:[{role:'user',content:framing.prompt,timestamp:0}]});
 // A controlled tight profile tests assembly headroom, not provider qualification.
 const model=await f.selection(lower.estimatedInput+1000+4096+7500),packed=(await f.c.changes.bundle(f.work.workId,context,'planner',model)).bundle;
 assert.deepEqual(packed.sources,[]);assert.deepEqual(packed.requirements,initial.requirements);assert.equal(packed.contracts,initial.contracts);assert.deepEqual(packed.sourceCatalogue,initial.sourceCatalogue);
 for(const source of initial.sources)assert.ok(packed.context.sourceInventory.excluded.includes(source.id));
 let capacity=0;f.c.changes.h.acquireCapacity=async()=>{capacity++;throw Error('CONTROLLED_AFTER_INITIAL_BEFORE_ENGINE');};
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(f.c.options.installationHome,'artifacts');let result;
 try{result=await f.c.planChange({workId:f.work.workId,model});}finally{if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;}
 assert.match(result.blocked.join(' '),/CONTROLLED_AFTER_INITIAL/);assert.equal(capacity,1);
 const launches=f.c.store.all('SELECT * FROM role_launches WHERE work=?',f.work.workId);assert.equal(launches.length,1);
 const scope=JSON.parse(launches[0].data).inputScope;assert.deepEqual(scope.selectedSources,[]);assert.deepEqual(scope.promptIncludedSourceIds,[]);
});
test('known mandatory lower-bound overflow refuses public planning before charge or native allocation',async t=>{
 const f=await world(t),model=await f.selection(8192),before=f.snapshot();let capacity=0;
 f.c.changes.h.acquireCapacity=async()=>{capacity++;throw Error('UNEXPECTED_NATIVE_ALLOCATION');};
 const result=await f.c.planChange({workId:f.work.workId,model});assert.match(result.blocked.join(' '),/MODEL_CONTEXT_LIMIT/);assert.equal(capacity,0);assert.deepEqual(f.snapshot(),before);
 assert.match(result.nextAction,/context\/output limits/);assert.ok(result.nextAction.includes('/change resume '+f.work.workId));assert.doesNotMatch(result.nextAction,/corrected verification cases|owner clarification/);
 const original=f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId),legacy={...JSON.parse(original.data),nextAction:'Explicit same-W run/resume with corrected verification cases or targeted owner clarification'};
 f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify(legacy),f.work.workId);const recorded=f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId);
 assert.match(f.c.inspectChange(f.work.workId).nextAction,/context\/output limits/);assert.deepEqual(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId),recorded);
 assert.match(f.c.inspectChange(f.work.workId).nextAction,/explicit profiles retain their original model route/);
 const quoted={...legacy,blocked:['Owner quoted ModelContextBudgetError: MODEL_CONTEXT_LIMIT: as ordinary text']};f.c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify(quoted),f.work.workId);
 const quotedView=f.c.inspectChange(f.work.workId);
 assert.equal(quotedView.modelContextFailure,undefined);assert.match(quotedView.nextAction,/Inspect original planning blockers/);
 assert.doesNotMatch(quotedView.nextAction,/context\/output limits/);
 assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?',f.work.workId).data),quoted);
 assert.equal(await fs.readFile(path.join(f.source,'mandatory.txt'),'utf8'),f.mandatory);
});
