import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {configureCreatedAcceptance} from '../../.qualification/controller-acceptance.js';
import {createOwnedAcceptanceSetup} from '../../dist/platform/hosted-context.js';
import {gitFixture,command,git} from '../platform/acceptance-git-fixture.mjs';
import {scripted} from './effect-fixture.mjs';
const readme='# Reviewed product\n',consumer='module.exports=2;\n';
const presenceConsumer="module.exports=()=>require('fs').existsSync('obsolete.txt')?'present':'absent';\n";
const checker=`const fs=require('fs'),value=String(require('./consumer.cjs')),presence=require('./presence.cjs')();const descriptor=JSON.parse(fs.readFileSync('/input/verification-cases.json','utf8'));const cases=descriptor.cases.map(c=>{const claim=c.declaration.input.literalUtf8,actual=['present','absent'].includes(claim)?presence:value;return{id:c.id,inputDigest:c.inputDigest,observed:{kind:claim===actual?'return':'rejection',value:actual}}});console.log(JSON.stringify({version:1,cases,assertions:[{id:'three',passed:value==='3'},{id:'no-obsolete',passed:presence==='absent'}]}));\n`;
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function modelForRepair(firstMode='delete'){
 let mode=firstMode;const injected=new Set();
 const model=scripted(undefined,({role,result})=>{if(role==='planner'){
  result.plan.requirements.push({id:'R2',text:'Published candidate excludes obsolete.txt',source:result.plan.requirements[0].source});
  result.plan.verification.checks=[{id:'value-and-absence',guaranteeIds:['R1','R2'],command:'node verify.cjs',assertions:['three','no-obsolete'],timeoutMs:2000,fixturePaths:['consumer.cjs','presence.cjs','verify.cjs'],expectationPaths:['verify.cjs'],cases:[
   ...[['value-healthy','healthy','R1','3','return','3'],['value-adverse','adverse','R1','4','rejection','3'],['absence-healthy','healthy','R2','absent','return','absent'],['absence-adverse','adverse','R2','present','rejection','absent']].map(([id,kind,req,literalUtf8,expectedKind,value])=>({id,kind,guaranteeIds:[req],derivation:req==='R2'?'Actual candidate file presence must match the claimed absence; contradictory presence claim is rejected':'Actual numeric consumer must match export3 and reject export4',consumerPaths:req==='R2'?['presence.cjs']:['consumer.cjs'],input:{literalUtf8,fixturePaths:[]},expected:{kind:expectedKind,value}}))] }];
  result.plan.verification.requiredPaths=['consumer.cjs','presence.cjs','verify.cjs'];result.plan.verification.reviewRoles[0].requiredPaths=['consumer.cjs','presence.cjs','verify.cjs'];
 }});
 const original=model.definition.streamSimple;
 model.definition.streamSimple=(m,context,...rest)=>{
  const first=context.messages.find(x=>x.role==='user'),text=first?.content.filter(x=>x.type==='text').map(x=>x.text).join('')??'';
  const key=mode+'\n'+text;
  if(text.startsWith('Perform the assigned repairer task')&&!injected.has(key)){
   injected.add(key);const tool={name:'bash',arguments:{command:mode==='unauthorized'?"rm -f -- obsolete.txt; printf '%s\\n' 'Unexpected agent README' > README.md":'rm -f -- obsolete.txt'}};
   const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'toolCall',id:'actual-repair-'+injected.size,name:tool.name,arguments:tool.arguments}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:'toolUse',timestamp:Date.now()};stream.push({type:'done',reason:'toolUse',message});stream.end(message);});return stream;
  }
  return original(m,context,...rest);
 };
 return{model,setMode:next=>{mode=next;}};
}
export async function scenario(t,unauthorizedRepair=false,initialRace=false){
 const f=await gitFixture();let c,setup,passed=false;
 try{
  const run=(args,input)=>command(f.gitRoot,f.receiver,args,input);let rows='';
  for(const [name,value] of Object.entries({'README.md':readme,'consumer.cjs':consumer,'presence.cjs':presenceConsumer,'verify.cjs':checker})){const blob=(await run(['hash-object','-w','--stdin'],Buffer.from(value))).toString().trim();rows+=`100644 blob ${blob}\t${name}\n`;}
  const tree=(await run(['mktree'],Buffer.from(rows))).toString().trim(),basis=(await run(['commit-tree',tree,'-p',f.B],Buffer.from('Owned repair basis'))).toString().trim();await run(['update-ref','refs/heads/main',basis]);f.state.native={command:run};
  const home=path.join(f.gitRoot,'controller'),source=path.join(f.gitRoot,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'README.md'),readme+'Owner-only local suffix\n');await fs.writeFile(path.join(source,'consumer.cjs'),consumer);await fs.writeFile(path.join(source,'verify.cjs'),checker);await fs.writeFile(path.join(source,'presence.cjs'),presenceConsumer);process.env.TMPDIR=path.join(home,'artifacts');
  setup=await createOwnedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps});const context=await setup.create();c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE},effectsProfile:{gitBinary:git}});await c.registerProject({id:'P',sourceRoot:source});configureCreatedAcceptance(c,context);
  const scriptedRepair=modelForRepair(unauthorizedRepair?'unauthorized':'delete'),model=scriptedRepair.model,{workId}=await c.beginChange({projectId:'P',request:'Export3 and exclude obsolete.txt; publish only authorized consumer/obsolete delta, preserve owner-only local README suffix in source',executionLimit:96,resolutionLimit:32});
  const initialReady=await c.driveChange({workId,model});assert.equal(initialReady.reviewReady,true,JSON.stringify(initialReady.blocked));
  const target=await c.registerHostedIntegrationTarget({projectId:'P',repository:{...context.target,visibility:'private'},expectedUserId:context.target.actorUserId,ref:'refs/heads/main',basisCommit:basis,publicationInventory:['README.md','consumer.cjs','presence.cjs','verify.cjs','obsolete.txt'],authorizedDeltaPaths:['consumer.cjs','obsolete.txt']});c.delegateHostedIntegration({workId,targetId:target.targetId,mode:'ordinary',operationLimit:2});
  const blob=(await run(['hash-object','-w','--stdin'],Buffer.from('Obsolete remote-only fact\n'))).toString().trim();const peerTree=(await run(['mktree'],Buffer.from((await run(['ls-tree',basis])).toString()+`100644 blob ${blob}\tobsolete.txt\n`))).toString().trim(),peer=(await run(['commit-tree',peerTree,'-p',basis],Buffer.from('Peer addition'))).toString().trim();await run(['update-ref','refs/heads/main',peer,basis]);
  if(initialRace){
   const effects=c.effectsCore,originalClient=effects.client.bind(effects);let advanced=false;
   effects.client=async(...args)=>{const actual=await originalClient(...args);return new Proxy({},{get(_object,key){const object=actual;if(key==='fetchHttpsPinnedBasis')return async(...request)=>{const observed=await object.fetchHttpsPinnedBasis(...request);if(!advanced){advanced=true;await run(['update-ref','refs/heads/main',f.B,peer]);}return observed;};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;}});};
   const stopped=await c.prepareIntegration({workId,targetId:target.targetId,model});
   t.diagnostic(JSON.stringify({phase:stopped.phase,blocked:stopped.blocked}));assert.equal(advanced,true);assert.equal(stopped.phase,'REFUSED');assert.match(stopped.blocked.join(';'),/base changed after checked ancestry/);assert.equal(setup.inspect().counters.nativePushes,0);assert.equal((await run(['rev-parse','refs/heads/main'])).toString().trim(),f.B);assert.equal(c.store.all('SELECT * FROM change_versions WHERE work=?',workId).some(row=>JSON.parse(row.data).derived),false);
   t.diagnostic(JSON.stringify({fixture:f.gitRoot,operationId:stopped.operationId,phase:stopped.phase,blocked:stopped.blocked,actualCheckedBase:peer,actualLaterBase:f.B,pushes:setup.inspect().counters.nativePushes}));passed=true;return;
  }
  const first=await c.prepareIntegration({workId,targetId:target.targetId,model});const selected=c.inspectChange(workId),selectedRow=c.store.one('SELECT * FROM change_versions WHERE id=?',selected.candidateVersion),op=JSON.parse(c.store.one('SELECT data FROM effect_operations WHERE id=?',first.operationId).data);
  t.diagnostic(JSON.stringify({firstPhase:first.phase,blocked:first.blocked,nativeI:op.integrationCommit}));
  assert.ok(op.integrationCommit,JSON.stringify(first));
  const nativeHasObsolete=(await command(f.gitRoot,path.join(op.clientRoot,'client.git'),['ls-tree','--name-only',op.integrationCommit])).toString().split('\n').includes('obsolete.txt');
  const record={workId,operationId:first.operationId,phase:first.phase,selectedCandidate:selected.candidateVersion,selectedDigest:selectedRow.hash,selectedHasObsolete:JSON.parse(selectedRow.data).manifest.files.some(x=>x.path==='obsolete.txt'),nativeI:op.integrationCommit,nativeHasObsolete,actualChecks:selected.checks.map(x=>({candidate:x.candidate,status:x.status,caseResults:x.data.caseResults})),actualRepairLaunches:selected.launches.filter(x=>x.role==='repairer').map(x=>x.id),actualPushes:setup.inspect().counters.nativePushes};
  await fs.writeFile(path.join(f.gitRoot,'repair-first-receipt.json'),JSON.stringify(record,null,2)+'\n');t.diagnostic(JSON.stringify({fixture:f.gitRoot,record}));
  assert.equal(selected.reviewReady,true,JSON.stringify(selected.blocked));assert.equal(record.selectedHasObsolete,false);assert.equal(record.nativeHasObsolete,true);assert.equal(record.actualPushes,0);assert.equal(first.phase,'REFUSED','A repaired selected C must not reserve the pre-repair native I');
  if(unauthorizedRepair){const denied=await c.prepareIntegration({workId,targetId:target.targetId,operationId:first.operationId,model});assert.equal(denied.phase,'REFUSED');assert.match(denied.blocked.join(';'),/Unauthorized publication delta: README.md/);assert.equal(setup.inspect().counters.nativePushes,0);passed=true;return;}
  const prepared=await c.prepareIntegration({workId,targetId:target.targetId,operationId:first.operationId,model});assert.equal(prepared.phase,'RESERVED',JSON.stringify(prepared));assert.equal((await command(f.gitRoot,path.join(op.clientRoot,'client.git'),['ls-tree','--name-only',prepared.integrationCommit])).toString().split('\n').includes('obsolete.txt'),false);
  const checkpoint=c.store.all('SELECT * FROM change_versions WHERE work=?',workId).find(row=>JSON.parse(row.data).derived),originalCheckpoint=checkpoint.data;
  for(const [name,mutate,reason]of[
   ['legacy-missing',x=>{delete x.native.baseVersion},/legacy base\/target binding missing/],
   ['stale-base',x=>{x.native.baseVersion='different-base'},/base version changed/],
   ['foreign-target',x=>{x.native.targetFingerprint='0'.repeat(64)},/target\/inventory binding changed/],
   ['foreign-operation',x=>{x.producer='other-operation'},/another operation/],
   ['missing-receipt',x=>{x.native.receiptId='absent-receipt'},/integration receipt unavailable/]
  ]){
   const fault=JSON.parse(originalCheckpoint);mutate(fault);c.store.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(fault),checkpoint.id);
   try{const stopped=await c.prepareIntegration({workId,targetId:target.targetId,operationId:first.operationId,model});assert.equal(stopped.phase,'REFUSED',name);assert.match(stopped.blocked.join(';'),reason,name);assert.equal(setup.inspect().counters.nativePushes,0,name);}
   finally{c.store.run('UPDATE change_versions SET data=? WHERE id=?',originalCheckpoint,checkpoint.id);}
  }
  await run(['update-ref','refs/heads/main',basis,peer]);const rewritten=await c.prepareIntegration({workId,targetId:target.targetId,operationId:first.operationId,model});assert.equal(rewritten.phase,'REFUSED');assert.match(rewritten.blocked.join(';'),/ancestor|ancestry/i);assert.equal(setup.inspect().counters.nativePushes,0);await run(['update-ref','refs/heads/main',peer,basis]);
  const finalPrepared=await c.prepareIntegration({workId,targetId:target.targetId,operationId:first.operationId,model});assert.equal(finalPrepared.phase,'RESERVED',JSON.stringify(finalPrepared));
  const sent=await c.dispatchIntegration({operationId:first.operationId});assert.equal(sent.phase,'CONFIRMED',JSON.stringify(sent));assert.equal((await run(['ls-tree','--name-only','refs/heads/main'])).toString().split('\n').includes('obsolete.txt'),false);assert.equal((await run(['show','refs/heads/main:consumer.cjs'])).toString(),'module.exports=3;\n');assert.equal(await fs.readFile(path.join(source,'README.md'),'utf8'),readme+'Owner-only local suffix\n');
  passed=true;
 }finally{await c?.close();await setup?.close();await f.close({preserve:!passed});if(!passed)console.error('Preserved repair fixture '+f.gitRoot);}
}
