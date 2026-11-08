import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {initializePiHost} from '../../dist/pi/host.js';
import {NativeRoleCollector,nativeRoleEntries,nativeRoleMaterial,nativeRoleIntentReceipt,readStoppedSubmissionPrefix,readHistoricalSubmissionAttempt} from '../../dist/workflow/native-role-output.js';
import {nativeSubmissionToolName} from '../../dist/workflow/native-submission-source.js';
import {expandNativeTransport} from '../../dist/workflow/native-transport.js';
const root=await temporaryDirectory('native-material-stop'),stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts');
for(const dir of [stateRoot,artifactRoot])await fs.mkdir(dir,{mode:0o700});process.env.TMPDIR=artifactRoot;
const host=await initializePiHost({stateRoot,artifactRoot}),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
after(()=>fs.rm(root,{recursive:true,force:true}));
async function fixture(t,policy,version=3){
 const directory=path.join(stateRoot,randomUUID());await fs.mkdir(directory,{mode:0o700});
 const memory=SessionManager.inMemory('/controlled-stop');memory.appendMessage({role:'user',content:'Original controlled request',timestamp:1});
 const file=path.join(directory,'original.jsonl');await fs.writeFile(file,[memory.getHeader(),...memory.getBranch()].map(e=>JSON.stringify(e)+'\n').join(''),{mode:0o600});
 const manager=SessionManager.open(file,directory),launchId=randomUUID(),sid='native-controlled',signal=new AbortController();t.after(()=>signal.abort(Error('Original test owner closed')));
 const request={version,...(version===1?{}:{carrier:version===3?'tool-submission/v1':'assistant-json/v1'}),requestId:launchId,binding:{launchId,role:'planner',stage:'planning',inputDigest:sha('Original controlled request'),nativeEvidencePolicy:policy},schema:{type:'object'},maxNativeTurns:4};
 const collector=await NativeRoleCollector.create(manager,request,host),observed=[];t.after(()=>collector.seal().catch(()=>{}));
 const observe=async message=>{const m={uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,...message};observed.push(m);await collector.observe(m);};
 const event=event=>observe({type:'stream_event',event});
 await observe({type:'system',subtype:'init',tools:[nativeSubmissionToolName],mcp_servers:[{name:'custom-tools',status:'connected'}],plugins:[]});
 const start=async(id,raw)=>{await event({type:'message_start',message:{id:'message-'+id,role:'assistant'}});await event({type:'content_block_start',index:0,content_block:{type:'tool_use',id,name:nativeSubmissionToolName,input:{}}});await event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});};
 const cleanup=async(overrides={})=>collector.observe({type:'gitjig.native-query-settled/v1',ownerSessionId:manager.getSessionId(),nativeSessionId:sid,queryId:'query',nativeCleanup:'confirmed',messages:observed.length,messageDigest:sha(observed.map(m=>JSON.stringify(m)+'\n').join('')),format:{request,requestDigest:sha(JSON.stringify(request)),schemaDigest:sha(JSON.stringify(request.schema))},...overrides});
 return{collector,manager,event,observe,start,cleanup,signal,file};
}
for(const policy of ['raw-envelope/v1','embedded-envelope/v2']){
 test('closed material fault stops '+policy+' and retains original fragment and cleanup',async t=>{
  const f=await fixture(t,policy),raw='{"findings":[{"description":"Original retained claim"}';await f.start('call',raw);
  await assert.rejects(f.event({type:'message_stop'}),/NATIVE_MATERIAL_CUSTODY_STOPPED/);
  const before=f.manager.getBranch().length;
  await assert.rejects(async()=>f.collector.observe({type:'assistant',message:{content:[{type:'text',text:'Unadmitted later reply'}]}}),/stopped/);assert.equal(f.manager.getBranch().length,before);
  await f.cleanup();
  await f.collector.seal();f.collector.materialize();
  const kept=expandNativeTransport(f.manager.getBranch());assert.equal(kept.filter(e=>e.customType===nativeRoleEntries.settlement).length,1);
  const read=nativeRoleMaterial(kept,f.collector.intentEntryId);assert.ok(read.materials.some(m=>m.raw===raw&&m.invalid&&m.complete===false));assert.equal(read.diagnostics.prefix.count,1);
  const expected={sessionId:f.manager.getSessionId(),launchId:f.collector.intent.binding.launchId,role:'planner',intent:nativeRoleIntentReceipt(f.collector.intent),checkpointLeafId:f.manager.getLeafId()};
  const full=[f.manager.getHeader(),...kept],material=read.materials.find(m=>m.raw===raw);
  assert.deepEqual(readStoppedSubmissionPrefix(full,expected,material.sourceEntryId),material);
  assert.throws(()=>readHistoricalSubmissionAttempt(full,expected,material.sourceEntryId),/incomplete/);
  assert.ok(kept.some(e=>e.customType===nativeRoleEntries.sdk&&e.data.message.event?.type==='message_stop'));
  assert.throws(()=>f.collector.select(),/stopped/);
 });
 test('closed material fault rejects original submission wait without hanging '+policy,async t=>{
  const f=await fixture(t,policy),raw='{"version":1}';await f.start('call',raw);
  const waiting=f.collector.submitObserved('call',JSON.parse(raw),()=>[],f.signal.signal);
  await Promise.all([assert.rejects(waiting,/NATIVE_MATERIAL_CUSTODY_STOPPED/),assert.rejects(f.event({type:'message_stop'}),/NATIVE_MATERIAL_CUSTODY_STOPPED/)]);
  await f.cleanup();await f.collector.seal();
 });
 test('retained stop never grants forged cleanup authority '+policy,async t=>{
  const f=await fixture(t,policy);await f.start('call','{"version":1}');
  await assert.rejects(f.event({type:'message_stop'}),/NATIVE_MATERIAL_CUSTODY_STOPPED/);
  await assert.rejects(f.cleanup({messageDigest:'0'.repeat(64)}),/original cleanup receipt is invalid/);
  await f.collector.seal();f.collector.materialize();
  assert.equal(f.manager.getBranch().filter(e=>e.customType===nativeRoleEntries.settlement).length,1);
  assert.throws(()=>f.collector.select(),/stopped/);
  const expected={sessionId:f.manager.getSessionId(),launchId:f.collector.intent.binding.launchId,role:'planner',intent:nativeRoleIntentReceipt(f.collector.intent),checkpointLeafId:f.manager.getLeafId()},entries=[f.manager.getHeader(),...f.manager.getBranch()],material=nativeRoleMaterial(entries,f.collector.intentEntryId).materials[0];
  assert.throws(()=>readStoppedSubmissionPrefix(entries,expected,material.sourceEntryId),/settled trace mismatch/);
 });
 for(const version of [1,2])test('non-submission carrier retains its original live recipe '+policy+' v'+version,async t=>{
  const f=await fixture(t,policy,version);await f.event({type:'message_start',message:{id:'old-recipe'}});
  await f.event({type:'content_block_start',index:0,content_block:{type:'text',text:'Original partial public claim'}});
  await f.event({type:'message_stop'});
  await f.observe({type:'assistant',message:{id:'later',content:[{type:'text',text:'Later original material'}]}});
  await f.cleanup();await f.collector.seal();f.collector.materialize();
  const read=nativeRoleMaterial(f.manager.getBranch(),f.collector.intentEntryId);assert.equal(read.diagnostics.prefix.count,1);assert.ok(read.materials.some(m=>m.raw==='Later original material'));
 });
 test('ordinary role validation remains correctable within '+policy,async t=>{
  const f=await fixture(t,policy),raw='{"version":1}';
  await f.start('rejected',raw);await f.event({type:'content_block_stop',index:0});await f.event({type:'message_stop'});
  await assert.rejects(f.collector.submitObserved('rejected',JSON.parse(raw),()=>['Correct the role shape'],f.signal.signal),/Role result rejected/);
  await f.start('corrected',raw);await f.event({type:'content_block_stop',index:0});await f.event({type:'message_stop'});
  assert.equal(JSON.parse(await f.collector.submitObserved('corrected',JSON.parse(raw),()=>[],f.signal.signal)).provisional,true);
  await f.cleanup();await f.collector.seal();
 });
}

test('retained embedded append failure keeps its original error instead of a derived custody error',async t=>{
 const f=await fixture(t,'embedded-envelope/v2');await f.start('call','{"version":1}');
 const writer=f.collector.transport,append=writer.append.bind(writer);writer.append=async(...args)=>{await append(...args);throw Error('CONTROLLED_APPEND_FAILURE_AFTER_RETAIN');};
 try{await assert.rejects(f.event({type:'message_stop'}),{message:'CONTROLLED_APPEND_FAILURE_AFTER_RETAIN'});}finally{writer.append=append;}
 await f.cleanup();await f.collector.seal();
 const read=nativeRoleMaterial(f.manager.getBranch(),f.collector.intentEntryId);assert.equal(read.diagnostics.prefix.count,1);
});

test('stopped prefix source refuses missing cleanup and structurally ambiguous closed owners',async t=>{
 const f=await fixture(t,'raw-envelope/v1'),raw='{"version":1,"findings":[';await f.start('call',raw);
 await assert.rejects(f.event({type:'message_stop'}),/NATIVE_MATERIAL_CUSTODY_STOPPED/);
 const expected=()=>({sessionId:f.manager.getSessionId(),launchId:f.collector.intent.binding.launchId,role:'planner',intent:nativeRoleIntentReceipt(f.collector.intent),checkpointLeafId:f.manager.getLeafId()});
 const partial=()=>[f.manager.getHeader(),...structuredClone(f.manager.getBranch())],material=nativeRoleMaterial(partial(),f.collector.intentEntryId).materials[0];
 assert.throws(()=>readStoppedSubmissionPrefix(partial(),expected(),material.sourceEntryId),/settlement/);
 await f.cleanup();f.collector.materialize();const original=partial(),base=expected(),kind=nativeRoleEntries.sdk;
 const source=entries=>entries.find(e=>e.id===material.sourceEntryId),delta=entries=>entries.find(e=>e.customType===kind&&e.data.message.event?.type==='content_block_delta'),start=entries=>entries.find(e=>e.customType===kind&&e.data.message.event?.type==='message_start');
 const add=(entries,event)=>{const at=entries.findIndex(e=>e.customType===nativeRoleEntries.settlement);entries.splice(at,0,{id:'extra-'+randomUUID(),type:'custom',customType:kind,data:{intentEntryId:f.collector.intentEntryId,message:{type:'stream_event',uuid:randomUUID(),session_id:'native-controlled',parent_tool_use_id:null,event}}});};
 const cases={
  'foreign source session':entries=>source(entries).data.message.session_id='foreign',
  'foreign source parent':entries=>source(entries).data.message.parent_tool_use_id='foreign',
  'wrong served port':entries=>source(entries).data.message.event.content_block.name='mcp__other__tool',
  'unaccounted initial arguments':entries=>source(entries).data.message.event.content_block.input={claim:'Unaccounted initial public field'},
  'missing served tool':entries=>entries.find(e=>e.customType===kind&&e.data.message.subtype==='init').data.message.tools=[],
  'oversized received bytes':entries=>delta(entries).data.message.event.delta.partial_json='x'.repeat(128*1024+1),
  'non-roundtripping received bytes':entries=>delta(entries).data.message.event.delta.partial_json=String.fromCharCode(0xd800),
  'source block index mismatch':entries=>source(entries).data.message.event.index=1,
  'resumed owner':entries=>start(entries).data.message.resume_reason='resumed',
  'retracted owner':entries=>{const at=entries.findIndex(e=>e.customType===nativeRoleEntries.settlement);entries.splice(at,0,{id:'retract',type:'custom',customType:kind,data:{intentEntryId:f.collector.intentEntryId,message:{type:'system',uuid:randomUUID(),session_id:'native-controlled',supersedes:[material.nativeMessageId]}}});},
  'duplicate envelope identity':entries=>delta(entries).data.message.uuid=start(entries).data.message.uuid,
  'reused owner message ID':entries=>add(entries,{type:'message_start',message:{id:material.nativeMessageId,role:'assistant'}}),
  'public bytes after owner stop':entries=>add(entries,{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'extra'}}),
  'second open opaque block':entries=>{const stop=entries.find(e=>e.customType===kind&&e.data.message.event?.type==='message_stop');const pos=entries.indexOf(stop);add(entries,{type:'content_block_start',index:1,content_block:{type:'thinking'}});const extra=entries.splice(entries.findIndex(e=>e.data?.message?.event?.type==='content_block_start'&&e.data.message.event.index===1),1)[0];entries.splice(pos,0,extra);},
  'duplicate decoded alias':entries=>{const at=entries.findIndex(e=>e.customType===nativeRoleEntries.settlement);for(let i=0;i<2;i++)entries.splice(at,0,{id:'typed-'+i,type:'custom',customType:kind,data:{intentEntryId:f.collector.intentEntryId,message:{type:'assistant',uuid:randomUUID(),session_id:'native-controlled',parent_tool_use_id:null,message:{id:material.nativeMessageId,role:'assistant',content:[{type:'tool_use',id:'call',name:nativeSubmissionToolName,input:{}}]}}}});},
  'unrelated global block stop':entries=>{const at=entries.findIndex(e=>e.id===start(entries).id);const extra=[{type:'message_start',message:{id:'unrelated-empty',role:'assistant'}},{type:'content_block_stop',index:0}];for(const event of extra)add(entries,event);const added=entries.splice(entries.findIndex(e=>e.customType===nativeRoleEntries.settlement)-extra.length,extra.length);entries.splice(at,0,...added);},
  'unrelated empty source':entries=>{const at=entries.findIndex(e=>e.id===start(entries).id);const extra=[{type:'message_start',message:{id:'unrelated-empty',role:'assistant'}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}}];for(const event of extra)add(entries,event);const added=entries.splice(entries.findIndex(e=>e.customType===nativeRoleEntries.settlement)-extra.length,extra.length);entries.splice(at,0,...added);},
  'wrong census':entries=>entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.messages++,
 };
 for(const [name,mutate]of Object.entries(cases)){
  const entries=structuredClone(original);mutate(entries);
  if(name!=='wrong census'){
   const packets=entries.filter(e=>e.customType===kind);packets.forEach((e,i)=>{e.data.sequence=i+1;});
   const a=entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation;a.messages=packets.length;a.messageDigest=sha(packets.map(e=>JSON.stringify(e.data.message)+'\n').join(''));
  }
  assert.throws(()=>readStoppedSubmissionPrefix(entries,base,material.sourceEntryId),undefined,name);
 }
});
