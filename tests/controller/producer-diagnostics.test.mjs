import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {initializePiHost} from '../../dist/pi/index.js';
import {runRole} from '../../dist/workflow/index.js';
const fixtureTemporaryRoot=os.tmpdir();
const sha=x=>createHash('sha256').update(x).digest('hex');
const common={version:1,summary:'Independent diagnostic assessment',findings:[],assessedScope:[]};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
async function fixture(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(fixtureTemporaryRoot,'producer-diagnostics-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');
 const c=await openController({installationHome:home});await c.registerProject({id:'P',sourceRoot:source});const view=await c.beginChange({projectId:'P',request:'Require3 and retain exact failed producer evidence'}),work=view.workId,core=c.changeCore;let serial=0;
 const state=JSON.parse(c.store.one('SELECT data FROM change_state WHERE work=?',work).data),versions={contracts:state.contractsVersion,requirements:null,base:view.baseVersion,candidate:null,plan:null,verification:null},run=c.store.one('SELECT id FROM runs WHERE work=?',work).id;
 function seed(raw,issues){
  const launch='fixture-origin-'+(++serial);c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,work,run,'planner',view.epoch,'UNUSABLE','none',JSON.stringify({stage:'planning',inputVersions:versions}));
  const output=core.collect(work,launch,{role:'planner',rawFinal:raw,issues,exposures:[],terminal:'complete',historyRef:null,rawFinalTruncated:false,protocol:null,events:[],providerRequests:1,nativeEntryId:'fixture-native-entry-'+serial},false);
  return{launch,output,occurrences:c.store.all('SELECT * FROM finding_occurrences WHERE output=?',output)};
 }
 return{root,home,source,c,core,work,view,versions,seed,async close(){await c.close();await fs.rm(root,{recursive:true,force:true});}};
}
test('retained failed XML/trailing producer operands reach actual native J prompt; no ledger rehabilitation or planner advocacy leak',async()=>{
 const f=await fixture();try{
  const xml='<function=write>\n<parameter=path>/input/verification-cases.json</parameter>\n</function>';
  const trailing=JSON.stringify({...common,findings:[{requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'RAW_UNVALIDATED_CLAIM: consumer exports2',evidence:['consumer.cjs exports2']}]})+'}';
  const a=f.seed(xml,['PROTOCOL: Unexpected token < in JSON']),b=f.seed(trailing,['PROTOCOL: trailing bytes']);const before=f.c.store.all('SELECT * FROM role_outputs ORDER BY id');
  const bundle=await f.core.bundle(f.work,{stage:'planning-adjudication'},'adjudicator');const d=bundle.context.producerDiagnostics;assert.equal(d.occurrences.length,2);assert.equal(d.outputs.length,2);assert.deepEqual(d.currentInputVersions,f.versions);
  for(const [record,raw]of[[a,xml],[b,trailing]]){const out=d.outputs.find(o=>o.outputId===record.output);assert.equal(out.raw,raw);assert.equal(out.rawUtf8Bytes,Buffer.byteLength(raw));assert.equal(out.rawSha256,sha(raw));assert.equal(out.status,'unusable');assert.equal(out.rawFinalTruncated,false);assert.equal(out.terminal,'complete');assert.deepEqual(out.origin.inputVersions,f.versions);assert.equal(out.origin.stage,'planning');assert.ok(out.validationIssues[0].startsWith('PROTOCOL'));assert.equal('historyRef'in out,false);}
  const planner=await f.core.bundle(f.work,{stage:'planning'},'planner');assert.equal(planner.context.producerDiagnostics,undefined);assert.ok(planner.context.occurrences.every(o=>o.findingBodyOmitted));assert.equal(JSON.stringify(planner).includes('RAW_UNVALIDATED_CLAIM'),false);
  for(const [role,stage]of[['challenger','planning-challenge'],['reviewer','fresh-review'],['adjudicator','source-fit']])assert.equal((await f.core.bundle(f.work,{stage},role)).context.producerDiagnostics,undefined);
  // This planning-only fixture has no accepted selected review roster.
  await assert.rejects(f.core.bundle(f.work,{stage:'review-adjudication'},'adjudicator'),/SELECTED_REVIEW_EVIDENCE_UNAVAILABLE: current accepted roster\/selection missing/);
  const staging=path.join(f.root,'native-work');await fs.mkdir(staging,{mode:0o700});process.env.TMPDIR=path.join(f.home,'artifacts');const host=await initializePiHost({stateRoot:path.join(f.home,'state'),artifactRoot:process.env.TMPDIR});let nativePrompt;
  const model={provider:'diagnostic-native-fixture',modelId:'fixture',definition:{baseUrl:'http://unused.invalid',apiKey:'dummy',api:'fixture-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:500000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(selected,context){nativePrompt=JSON.stringify(context);const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'text',text:JSON.stringify({...common,planAccepted:false,ownerDecisionRequired:[],decisions:[]})}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};
  const deny=()=>{throw Error('No host/project tool operation selected')};const execution=await runRole({launchId:'fixture-J',role:'adjudicator',host,model,inputBundle:bundle,operations:{workspaceRoot:staging,validatePath(p){const q=path.resolve(staging,p);if(q!==staging&&!q.startsWith(staging+path.sep))throw Error('outside');return q;},readFile:deny,access:deny,exec:deny,writeFile:deny,mkdir:deny},assertEntry(){},beforeModelRequest:async()=>{}});
  assert.equal(execution.usable,true,execution.issues.join());for(const out of d.outputs){assert.ok(nativePrompt.includes(out.rawSha256));assert.ok(nativePrompt.includes(out.validationIssues[0]));}assert.ok(nativePrompt.includes('producerDiagnostics'));assert.equal(execution.protocol.planAccepted,false);assert.deepEqual(f.c.store.all('SELECT * FROM role_outputs ORDER BY id'),before);assert.ok(f.core.pending(f.work).some(o=>o.id===a.occurrences[0].id));
 }finally{await f.close();}
});
test('deduplicates raw payloads without losing pending occurrence identities; accounted findings do not reopen',async()=>{
 const f=await fixture();try{const a=f.seed('<function=bash/>',['PROTOCOL: invalid JSON']),o=a.occurrences[0],data=o.data;f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)','fixture-duplicate',a.output,1,f.work,data);f.c.store.run('INSERT INTO obligations VALUES(?,?,?)','fixture-duplicate',f.work,JSON.stringify({kind:'finding',occurrence:'fixture-duplicate',state:'pending'}));let d=f.core.producerDiagnostics(f.work);assert.equal(d.occurrences.length,2);assert.equal(d.outputs.length,1);for(const id of[o.id,'fixture-duplicate'])f.c.store.run('UPDATE obligations SET data=? WHERE id=?',JSON.stringify({kind:'finding',occurrence:id,state:'resolved'}),id);d=f.core.producerDiagnostics(f.work);assert.equal(d.occurrences.length,0);assert.equal(d.outputs.length,0);}finally{await f.close();}
});
test('foreign/missing/mismatched diagnostic provenance and raw loss fail closed before native dispatch',async()=>{
 const f=await fixture();try{const a=f.seed('<function=bash/>',['PROTOCOL: invalid JSON']),output=f.c.store.one('SELECT * FROM role_outputs WHERE id=?',a.output),launch=f.c.store.one('SELECT * FROM role_launches WHERE id=?',a.launch),o=a.occurrences[0];
 const mutate=[()=>f.c.store.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify({...JSON.parse(o.data),launchId:'foreign'}),o.id),()=>f.c.store.run('UPDATE finding_occurrences SET data=? WHERE id=?',JSON.stringify({...JSON.parse(o.data),finding:{...JSON.parse(o.data).finding,evidence:['different-output']}}),o.id),()=>f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({stage:'planning',inputVersions:{...f.versions,base:'missing-version'}}),a.launch),()=>f.c.store.run('UPDATE role_outputs SET raw=NULL WHERE id=?',a.output),()=>f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(output.data),rawFinalTruncated:true}),a.output),()=>f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(output.data),omittedFindingCount:1}),a.output),()=>f.c.store.run('UPDATE role_outputs SET raw=? WHERE id=?','x'.repeat(128*1024+1),a.output),()=>f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(output.data),issues:[{private:'no whole-data clone'}]}),a.output)];
 for(const change of mutate){change();await assert.rejects(f.core.bundle(f.work,{stage:'planning-adjudication'},'adjudicator'),/Producer diagnostic unavailable:.*restore the exact retained same-W/);f.c.store.run('UPDATE finding_occurrences SET data=? WHERE id=?',o.data,o.id);f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,a.launch);f.c.store.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',output.raw,output.data,a.output);}
 // Empty observed text is preserved distinctly from missing NULL; statuses never become usable.
 f.c.store.run('UPDATE role_outputs SET raw=? WHERE id=?','',a.output);assert.equal(f.core.producerDiagnostics(f.work).outputs[0].raw,'');assert.equal(f.core.producerDiagnostics(f.work).outputs[0].rawUtf8Bytes,0);
 }finally{await f.close();}
});

test('finite diagnostic serialization/link caps and cross-W operands hold without leaking foreign raw',async()=>{
 const f=await fixture();try{
  const a=f.seed('<function=read/>',['PROTOCOL: invalid JSON']),original=f.c.store.one('SELECT * FROM role_outputs WHERE id=?',a.output),o=a.occurrences[0];
  const foreign=await f.c.beginChange({projectId:'P',request:'Separate unrelated work'}),foreignRun=f.c.store.one('SELECT id FROM runs WHERE work=?',foreign.workId).id;
  f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','foreign-origin',foreign.workId,foreignRun,'planner',foreign.epoch,'UNUSABLE','none',JSON.stringify({stage:'planning',inputVersions:{...f.versions,base:foreign.baseVersion}}));
  const foreignOutput=f.core.collect(foreign.workId,'foreign-origin',{role:'planner',rawFinal:'FOREIGN_RAW_MUST_NEVER_LEAK',issues:['PROTOCOL: invalid JSON'],exposures:[],terminal:'complete',historyRef:null,rawFinalTruncated:false,protocol:null,events:[],providerRequests:1,nativeEntryId:'foreign-entry'},false);
  f.c.store.run('UPDATE finding_occurrences SET ordinal=50,output=?,data=? WHERE id=?',foreignOutput,JSON.stringify({...JSON.parse(o.data),launchId:'foreign-origin'}),o.id);
  assert.throws(()=>f.core.producerDiagnostics(f.work),e=>/provenance mismatch/.test(e.message)&&!e.message.includes('FOREIGN_RAW'));
  f.c.store.run('UPDATE finding_occurrences SET ordinal=0,output=?,data=? WHERE id=?',a.output,o.data,o.id);
  const launch=f.c.store.one('SELECT * FROM role_launches WHERE id=?',a.launch);f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({stage:'planning',inputVersions:{...f.versions,base:foreign.baseVersion}}),a.launch);assert.throws(()=>f.core.producerDiagnostics(f.work),/foreign or mismatched origin input version/);f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,a.launch);
  f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(original.data),issues:['x'.repeat(8193)]}),a.output);assert.throws(()=>f.core.producerDiagnostics(f.work),/bounded validation metadata/);f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?',original.data,a.output);
  for(let i=0;i<64;i++){const id='bounded-duplicate-'+i;f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',id,a.output,i+1,f.work,o.data);f.c.store.run('INSERT INTO obligations VALUES(?,?,?)',id,f.work,JSON.stringify({kind:'finding',occurrence:id,state:'pending'}));}
  assert.throws(()=>f.core.producerDiagnostics(f.work),/limit64 exceeded/);
  f.c.store.run("DELETE FROM obligations WHERE id LIKE 'bounded-duplicate-%'");f.c.store.run("DELETE FROM finding_occurrences WHERE id LIKE 'bounded-duplicate-%'");
  f.c.store.run('UPDATE role_outputs SET raw=? WHERE id=?','x'.repeat(100000),a.output);f.seed('y'.repeat(100000),['PROTOCOL: invalid JSON']);f.seed('z'.repeat(100000),['PROTOCOL: invalid JSON']);assert.throws(()=>f.core.producerDiagnostics(f.work),/exceeds256KiB/);
 }finally{await f.close();}
});
