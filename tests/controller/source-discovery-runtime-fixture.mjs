import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
export async function sourceDiscoveryProfile(profile) {
 assert.ok(process.env.GITJIG_RUNTIME_FIXTURE_ROOT&&process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_RUNTIME_IMAGE,'Explicit prepared disposable runtime required');
 const root=await fs.mkdtemp(path.join(process.env.GITJIG_RUNTIME_FIXTURE_ROOT,'discovery-')),source=path.join(root,'source');await fs.mkdir(source,{mode:0o700});
 const original=new Map();
 for(let i=0;i<96;i++)original.set('a-context-'+String(i).padStart(3,'0')+'.txt',('context '+i+'\n').padEnd(16383,'x')+'\n');
 original.set('consumer.cjs','// '+ 'consumer context '.padEnd(40000,'x')+'\nmodule.exports=2;\n');
 original.set('check.cjs','// '+ 'checker context '.padEnd(40000,'y')+'\n'+withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
 original.set('README.md','The required consumer is consumer.cjs and its checker is check.cjs. Preserve unrelated context.\n');
 for(const [name,text] of original)await fs.writeFile(path.join(source,name),text);
 const controllerOptions={installationHome:path.join(root,'application'),runtimeProfile:{dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,image:process.env.GITJIG_RUNTIME_IMAGE}};
 const previousTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(root,'application','artifacts');
 let c;
 let passed=false,workId;
 const claims=['consumer.cjs','check.cjs'].map(name=>({sourceId:'base:'+name,startLine:1,endLine:original.get(name).split('\n').length}));
 const model=scripted(undefined,({body,result})=>{if(body.sourceDiscovery?.side==='base'&&String(body.context.stage).startsWith('planning'))result.assessedScope=claims;});
 // Normal qualification uses the actual installed profile; the prior smaller
 // synthetic profile remains a separate adverse case, not a silently widened default.
 Object.assign(model.definition.models[0],{contextWindow:profile.contextWindow,maxTokens:profile.maxTokens});
 const delegate=model.definition.streamSimple,seen=new Set(),headers=[],budgets=[];
 model.definition.streamSimple=(selected,context,options)=>{
  assert.equal(selected.contextWindow,profile.contextWindow);assert.equal(selected.maxTokens,profile.maxTokens);
  budgets.push(assertModelContextBudget(selected,context));
  const user=context.messages.find(message=>message.role==='user'),text=user.content.filter(part=>part.type==='text').map(part=>part.text).join(''),body=JSON.parse(text.split('\n')[1]);
  if(body.sourceDiscovery?.side==='base'&&String(body.context.stage).startsWith('planning')){
   const key=hash(text);
   if(!seen.has(key)){
    seen.add(key);headers.push(body.sourceDiscovery);
    assert.equal(body.sources.some(s=>['consumer.cjs','check.cjs'].includes(s.path)),false,'Needed modules must actually be off-seed');
    const stream=createAssistantMessageEventStream(),message={role:'assistant',content:['consumer.cjs','check.cjs'].map((name,i)=>({type:'toolCall',id:'discover-'+i,name:'read',arguments:{path:name}})),api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'toolUse',timestamp:Date.now()};
    queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message);});return stream;
   }
  }
  return delegate(selected,context,options);
 };
 try{
  c=await openController(controllerOptions);
  await c.registerProject({id:'P',sourceRoot:source});const started=await c.beginChange({projectId:'P',request:'Make consumer.cjs export3. Use check.cjs and preserve all unrelated files.',executionLimit:9,resolutionLimit:8});workId=started.workId;
  const result=await c.driveChange({workId,model});
  if(profile.hold){
   assert.equal(result.reviewReady,false);assert.match(result.blocked.join(' '),/MODEL_CONTEXT_LIMIT/);assert.equal(result.modelContextFailure,'MODEL_CONTEXT_LIMIT');assert.equal(c.inspectChangeActivity(workId).recordedModelContextFailure,'MODEL_CONTEXT_LIMIT');assert.equal(c.inspectChangeResult(workId).modelContextFailure,'MODEL_CONTEXT_LIMIT');assert.match(result.nextAction,/context\/output limits/);assert.ok(result.nextAction.includes('/change resume '+workId));assert.doesNotMatch(result.nextAction,/corrected verification cases|owner clarification/);
   const launches=c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',workId),runs=c.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',workId),allowance=c.inspectWork(workId).allowance;
   assert.ok(launches.length>0);assert.equal(launches.at(-1).status,'UNUSABLE');assert.equal(allowance.consumed,launches.length+1,'Capture and every genuinely allocated role retain their charges');assert.equal(allowance.reserved,0);
   for(const run of runs){assert.equal(run.phase,'SETTLED');assert.equal(run.reservation,'consumed');assert.ok(['removed','not-allocated'].includes(JSON.parse(run.data).cleanup));}
   const leases=c.store.all('SELECT * FROM capacity_leases WHERE work=?',workId);assert.equal(leases.length,launches.length);for(const lease of leases)assert.equal(lease.state,'RELEASED');
   for(const [name,text] of original)assert.equal(await fs.readFile(path.join(source,name),'utf8'),text);
   await fs.writeFile(path.join(root,'public-source-discovery-context-hold.json'),JSON.stringify({scope:'Fresh actual SDK/owned-engine context-limit refusal and charged cleanup, not healthy profile acceptance',profile,workId,result,budgets,launches,runs,leases,allowance},null,2),{mode:0o600});
   passed=true;console.log(JSON.stringify({root,workId,profile,contextHeld:true,executionConsumed:allowance.consumed}));return;
  }
  assert.equal(result.reviewReady,true,JSON.stringify(result.blocked));
  const baseRow=c.store.one('SELECT * FROM change_versions WHERE id=?',result.baseVersion),candidateRow=c.store.one('SELECT * FROM change_versions WHERE id=?',result.candidateVersion);
  const base=baseRow&&{...baseRow,data:JSON.parse(baseRow.data)},candidate=candidateRow&&{...candidateRow,data:JSON.parse(candidateRow.data)};
  assert.ok(base&&candidate);assert.equal(headers.length,3);assert.ok(budgets.length>=8);for(const budget of budgets){assert.equal(budget.availableInput,107520);assert.ok(budget.estimatedInput<=107520);}
  const catalogue={format:1,version:base.id,side:'base',files:base.data.manifest.files.map(file=>({path:file.path,sha256:file.sha256,size:file.size}))};
  for(const header of headers){assert.equal(header.version,base.id);assert.equal(header.side,'base');assert.equal(header.count,99);assert.equal(header.sha256,hash(JSON.stringify(catalogue)));}
  for(const [name,text] of original){
   assert.equal(await fs.readFile(path.join(source,name),'utf8'),text,'Original source changed: '+name);
   assert.equal(await fs.readFile(path.join(base.artifact,name),'utf8'),text,'Captured base changed: '+name);
   assert.equal(await fs.readFile(path.join(candidate.artifact,name),'utf8'),name==='consumer.cjs'?text.replace('exports=2','exports=3'):text,'Candidate context mismatch: '+name);
  }
  const launches=c.store.all('SELECT * FROM role_launches WHERE work=?',workId),outputs=[];
  for(const launch of launches){
   const data=JSON.parse(launch.data);
   if(!String(data.stage).startsWith('planning'))continue;
   const output=c.store.one('SELECT * FROM role_outputs WHERE launch=?',launch.id),observed=JSON.parse(output.data);outputs.push({launch,data,output,observed});
   for(const claim of claims){
    assert.ok(observed.exposures.some(e=>e.sourceId===claim.sourceId&&e.version===base.id&&e.producer==='read'&&e.sourceSha256===hash(original.get(e.path))));
    assert.ok(observed.protocol.assessedScope.some(s=>s.sourceId===claim.sourceId));
    if(data.inputScope){assert.ok(data.inputScope.selectedSources.length<=2,'Initial scope reflects bounded seeds');assert.equal(data.inputScope.selectedSources.some(s=>s.id===claim.sourceId),false);assert.equal(data.inputScope.promptIncludedSourceIds.includes(claim.sourceId),false);}
   }
  }
  assert.equal(outputs.length,3);assert.equal(outputs.filter(o=>o.data.inputScope).length,2);
  const allowance=c.inspectWork(workId).allowance;assert.equal(allowance.consumed,8);assert.equal(allowance.reserved,0);
  await fs.writeFile(path.join(root,'public-source-discovery-proof.json'),JSON.stringify({scope:'Fresh model-free public Controller/SDK/owned-engine normal procedure; not paid-model or whole-product maturity',profile,workId,result,budgets,headers,catalogue,outputs,allowance,sourceHashes:Object.fromEntries([...original].map(([name,text])=>[name,hash(text)]))},null,2),{mode:0o600});
  passed=true;console.log(JSON.stringify({root,workId,reviewReady:true,executionConsumed:allowance.consumed,initialScopeExpanded:false}));
 }finally{
  await c?.close();
  if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
  await fs.writeFile(path.join(root,'completion.json'),JSON.stringify({passed,workId,closed:true}),{mode:0o600});
 }
}
