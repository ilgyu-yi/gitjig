/** Persisted source and fresh carrier selection; no live Native dispatch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SessionManager,parseSessionEntries} from '@earendil-works/pi-coding-agent';
import {NativeRoleCollector,nativeRoleEntries,nativeRoleIntentReceipt,nativeRoleSourceMaterialId,nativeRoleMaterial} from '../../dist/workflow/native-role-output.js';
import {nativeCheckpoint,readSelectedRoleOutput} from '../../dist/controller/history.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {structuredOutputContext} from '../../dist/pi/structured-output.js';
import {nativeEvidencePolicy} from '../../dist/workflow/native-evidence-budget.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const value={version:1,summary:'Exact original text',findings:[],assessedScope:[]};
function captured(raw=JSON.stringify(value),assistantBeforeStop=true,inputBeforeIntent=false,{policy,hookMiB=0,counterMiB=0}={}){
 const manager=SessionManager.inMemory('/controlled-native-text-source'),launchId=randomUUID(),input='One frozen role input';
 const intent={version:2,carrier:'assistant-json/v1',requestId:launchId,binding:{launchId,role:'reviewer',stage:'fresh-review',inputDigest:sha(input),...(policy===undefined?{}:{nativeEvidencePolicy:policy})},schema:{type:'object',properties:{}},maxNativeTurns:3};
 if(inputBeforeIntent)manager.appendMessage({role:'user',content:input,timestamp:Date.now()});
 const collector=new NativeRoleCollector(manager,intent),receipt=nativeRoleIntentReceipt(intent),sid='native-'+randomUUID(),mid='message-'+randomUUID();
 if(!inputBeforeIntent)manager.appendMessage({role:'user',content:input,timestamp:Date.now()});
 const observe=m=>collector.observe({uuid:randomUUID(),session_id:sid,...m});
 const event=e=>observe({type:'stream_event',parent_tool_use_id:null,event:e});
 observe({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]});
 for(let n=0;n<hookMiB;n++)observe({type:'system',subtype:'hook_progress',hook_id:'controlled',hook_name:'controlled',hook_event:'UserPromptSubmit',stdout:'x'.repeat(1024*1024-512),stderr:'',output:''});
 let counterBytes=0;
 for(let n=1;counterBytes<counterMiB*1024*1024;n++){
  const m={type:'system',subtype:'thinking_tokens',estimated_tokens:n,estimated_tokens_delta:1,uuid:randomUUID(),session_id:sid},size=Buffer.byteLength(JSON.stringify(m));
  if(counterBytes+size>counterMiB*1024*1024)break;collector.observe(m);counterBytes+=size;
 }
 event({type:'message_start',message:{id:mid,type:'message',role:'assistant',content:[]}});
 event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
 for(let i=0;i<raw.length;i+=11)event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:raw.slice(i,i+11)}});
 const assistant=()=>observe({type:'assistant',parent_tool_use_id:null,message:{id:mid,role:'assistant',content:[{type:'text',text:raw}]}});
 if(assistantBeforeStop)assistant();
 event({type:'content_block_stop',index:0});
 event({type:'message_delta',delta:{stop_reason:'end_turn'}});event({type:'message_stop'});
 if(!assistantBeforeStop)assistant();
 observe({type:'result',subtype:'success',is_error:false,result:raw,num_turns:1,permission_denials:[],terminal_reason:'completed'});
 const sdk=manager.getBranch().filter(e=>e.customType===nativeRoleEntries.sdk);
 collector.observe({type:'gitjig.native-query-settled/v1',ownerSessionId:manager.getSessionId(),queryId:randomUUID(),nativeSessionId:sid,nativeCleanup:'confirmed',format:{request:structuredClone(intent),requestDigest:sha(JSON.stringify(intent)),schemaDigest:sha(JSON.stringify(intent.schema))},messages:sdk.length,messageDigest:sha(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join(''))});
 const selected=collector.select(),entries=JSON.parse(JSON.stringify(manager.getBranch()));
 const expected={entryId:selected.entryId,sessionId:manager.getSessionId(),launchId,role:'reviewer',stage:'fresh-review',checkpointLeafId:selected.entryId,nativeIntent:structuredClone(receipt)};
 return {manager,entries,expected,selected,intent};
}
const read=f=>readSelectedRoleOutput(f.entries,f.expected,f.selected.source);
test('current captured accounting accepts mixed quotas through cold text proof while literal history stays bounded',()=>{
 const raw=JSON.stringify(value),f=captured(raw,true,false,{policy:nativeEvidencePolicy.id,hookMiB:6,counterMiB:3});
 assert.equal(read(f),raw);
 const sdk=f.entries.filter(e=>e.customType===nativeRoleEntries.sdk);
 assert.ok(sdk.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0)>8*1024*1024);
 assert.throws(()=>captured(raw,true,false,{hookMiB:6,counterMiB:3}),/original source trace exceeds bounds/,'Absent original policy keeps its literal historical bound');
});
function rebindSyntheticPolicy(f,policy){
 const intent=f.entries.find(e=>e.customType===nativeRoleEntries.intent),settled=f.entries.find(e=>e.customType===nativeRoleEntries.settlement),final=f.entries.find(e=>e.customType===nativeRoleEntries.final);
 intent.data.request.binding.nativeEvidencePolicy=policy;
 const requestDigest=sha(JSON.stringify(intent.data.request));settled.data.attestation.format.request=structuredClone(intent.data.request);settled.data.attestation.format.requestDigest=requestDigest;
 final.data.requestDigest=requestDigest;f.selected.source.requestDigest=requestDigest;
 return requestDigest;
}
test('a retrospective policy edit cannot change independently captured original request correspondence',()=>{
 const f=captured();rebindSyntheticPolicy(f,nativeEvidencePolicy.id);
 assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE|original.*intent|request/i);
});
test('an unknown policy refuses cold selection even with internally consistent synthetic digest fields',()=>{
 const f=captured();f.expected.nativeIntent.requestDigest=rebindSyntheticPolicy(f,'unsupported-policy');
 assert.throws(()=>read(f),/NATIVE_CAPTURE_POLICY_UNSUPPORTED/);
});
function trace(f){
 const sdk=f.entries.filter(e=>e.customType===nativeRoleEntries.sdk),result=sdk.find(e=>e.data.message.type==='result'),assistant=sdk.find(e=>e.data.message.type==='assistant'),initial=sdk.find(e=>e.data.message.type==='system');
 const settlement=f.entries.find(e=>e.customType===nativeRoleEntries.settlement);
 return {sdk,result,assistant,initial,settlement};
}
function refresh(f){const {sdk,settlement}=trace(f);sdk.forEach((e,i)=>e.data.sequence=i+1);settlement.data.attestation.messages=sdk.length;settlement.data.attestation.messageDigest=sha(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join(''));}
function insertBeforeResult(f,message){
 const {result}=trace(f),entry=structuredClone(result);
 entry.id=randomUUID();entry.parentId=result.parentId;entry.data.message=message;
 result.parentId=entry.id;f.entries.splice(f.entries.indexOf(result),0,entry);
}
for(const budget of ['single-event','provider-evidence','progress-counter','settlement'])test('cold declared policy refuses '+budget+' overflow despite consistent original digest',()=>{
 const f=captured(undefined,true,false,{policy:nativeEvidencePolicy.id});
 const {initial}=trace(f),sid=initial.data.message.session_id;
 const message=(type,extra)=>({type,uuid:randomUUID(),session_id:sid,...extra});
 if(budget==='single-event')insertBeforeResult(f,message('system',{subtype:'hook_progress',stdout:'x'.repeat(nativeEvidencePolicy.eventBytes)}));
 if(budget==='provider-evidence')for(let n=0;n<9;n++)insertBeforeResult(f,message('system',{subtype:'hook_progress',stdout:'x'.repeat(1024*1024)}));
 if(budget==='progress-counter'){
  let bytes=0;
  while(bytes<=nativeEvidencePolicy.progressBytes){const m=message('system',{subtype:'thinking_tokens',estimated_tokens:1,estimated_tokens_delta:1});insertBeforeResult(f,m);bytes+=Buffer.byteLength(JSON.stringify(m));}
 }
 if(budget==='settlement'){
  let remaining=nativeEvidencePolicy.normalBytes-trace(f).sdk.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0);
  while(remaining>0){
   const m=message('system',{subtype:'hook_progress',stdout:''}),base=Buffer.byteLength(JSON.stringify(m)),size=Math.min(1024*1024,remaining);
   assert.ok(size>=base);m.stdout='x'.repeat(size-base);insertBeforeResult(f,m);remaining-=size;
  }
  assert.equal(trace(f).sdk.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0),nativeEvidencePolicy.normalBytes);
 }
 refresh(f);
 assert.throws(()=>read(f),new RegExp('original declared evidence policy exceeded: '+(budget==='settlement'?'provider-evidence':budget)));
});
for(const before of [true,false])test('exact original text survives persisted SDK codec with completed message '+(before?'before':'after')+' block stop',async()=>{
 const f=captured(' \n'+JSON.stringify(value)+'\n',before),root=await temporaryDirectory('native-text-source');let passed=false;
 try{
  const file=path.join(root,'session.jsonl'),text=[f.manager.getHeader(),...f.entries].map(e=>JSON.stringify(e)+'\n').join('');await fs.writeFile(file,text,{mode:0o600});
  const checkpoint=await nativeCheckpoint(file);assert.equal(checkpoint.sessionId,f.expected.sessionId);assert.equal(checkpoint.leafId,f.selected.entryId);
  f.entries=parseSessionEntries(await fs.readFile(file,'utf8'));assert.equal(read(f),f.selected.raw);assert.equal(parseRoleOutput(read(f),'reviewer').value.summary,value.summary);
  assert.equal(nativeRoleSourceMaterialId(f.selected.source),f.selected.source.textEntryId);passed=true;
 }finally{if(passed)await fs.rm(root,{recursive:true});else console.error('Retained text-source evidence: '+root);}
});
const mutations={
 'missing captured intent':f=>delete f.expected.nativeIntent,
 'different predispatch digest':f=>f.expected.nativeIntent.requestDigest='0'.repeat(64),
 'legacy commitment cannot choose text':f=>{const old={...f.intent,version:1};delete old.carrier;f.expected.nativeIntent=nativeRoleIntentReceipt(old);},
 'wrong selected source kind':f=>f.selected.source.kind='unknown',
 'wrong checkpoint':f=>f.expected.checkpointLeafId='foreign',
 'sparse original user content':f=>{const user=f.entries.find(e=>e.type==='message'&&e.message.role==='user');user.message.content=[{type:'text',text:user.message.content}];user.message.content.length=2;},
 'duplicate original user input':f=>{const at=f.entries.findIndex(e=>e.type==='message'&&e.message.role==='user'),next=f.entries[at+1],copy=structuredClone(f.entries[at]);copy.id=randomUUID();copy.parentId=next.parentId;next.parentId=copy.id;f.entries.splice(at+1,0,copy);},
 'user input after native initialization':f=>{const user=f.entries.find(e=>e.type==='message'&&e.message.role==='user'),init=trace(f).initial;user.message.role='system';const at=f.entries.indexOf(init)+1,next=f.entries[at],copy=structuredClone(user);copy.id=randomUUID();copy.message.role='user';copy.parentId=next.parentId;next.parentId=copy.id;f.entries.splice(at,0,copy);},
 'different input bytes':f=>f.entries.find(e=>e.type==='message'&&e.message.role==='user').message.content+=' ',
 'unknown cleanup':f=>trace(f).settlement.data.attestation.nativeCleanup='unknown',
 'wrong settlement kind':f=>trace(f).settlement.data.attestation.type='unknown',
 'wrong native owner':f=>trace(f).settlement.data.attestation.ownerSessionId='foreign',
 'malformed query identity':f=>trace(f).settlement.data.attestation.queryId={invalid:true},
 'missing assistant identity':f=>delete trace(f).assistant.data.message.uuid,
 'contradictory completed-message stop':f=>trace(f).assistant.data.message.message.stop_reason='max_tokens',
 'aborted assistant':f=>trace(f).assistant.data.message.aborted=true,
 'errored assistant':f=>trace(f).assistant.data.message.error='aborted',
 'replayed assistant':f=>trace(f).assistant.data.message.resume_reason='interrupted_turn',
 'foreign assistant':f=>trace(f).assistant.data.message.session_id='foreign',
 'subagent assistant':f=>trace(f).assistant.data.message.parent_tool_use_id='subagent',
 'retracted assistant':f=>trace(f).result.data.message.retracted_message_uuids=[trace(f).assistant.data.message.uuid],
 'malformed result identity':f=>trace(f).result.data.message.uuid={invalid:true},
 'foreign result parent':f=>trace(f).result.data.message.parent_tool_use_id='subagent',
 'aborted initialization':f=>trace(f).initial.data.message.aborted=true,
 'errored initialization':f=>trace(f).initial.data.message.error='failed init',
 'nonroot initialization':f=>trace(f).initial.data.message.parent_tool_use_id='subagent',
 'errored result':f=>trace(f).result.data.message.is_error=true,
 'blocking terminal reason':f=>trace(f).result.data.message.terminal_reason='blocking_limit',
 'wrong terminal text':f=>trace(f).result.data.message.result+=' ',
 'denied native tool':f=>trace(f).result.data.message.permission_denials=[{tool_name:'read'}],
 'oversized original envelope':f=>trace(f).sdk.find(e=>e.data.message.type==='stream_event').data.message.padding='x'.repeat(2*1024*1024),
 'oversized complete trace':f=>trace(f).sdk.slice(0,9).forEach(e=>e.data.message.padding='x'.repeat(1024*1024)),
 'missing frame UUID':f=>delete trace(f).sdk.find(e=>e.data.message.type==='stream_event').data.message.uuid,
 'replayed stream':f=>trace(f).sdk.find(e=>e.data.message.type==='stream_event').data.message.resume_reason='interrupted_turn',
 'truncated stream':f=>trace(f).sdk.find(e=>e.data.message.event?.type==='message_stop').data.message.event.type='ping',
 'output token stop':f=>trace(f).sdk.find(e=>e.data.message.event?.type==='message_delta').data.message.event.delta.stop_reason='max_tokens',
 'open opaque block':f=>{const {sdk,result}=trace(f),copy=structuredClone(sdk.find(e=>e.data.message.event?.type==='content_block_start'));copy.id=randomUUID();copy.data.message.uuid=randomUUID();copy.data.message.event.index=1;copy.data.message.event.content_block={type:'thinking',thinking:''};f.entries.splice(f.entries.indexOf(result)-2,0,copy);},
 'later root stream':f=>{const {sdk,result}=trace(f),copy=structuredClone(sdk.find(e=>e.data.message.event?.type==='message_start'));copy.id=randomUUID();copy.data.message.uuid=randomUUID();copy.data.message.event.message.id='later';f.entries.splice(f.entries.indexOf(result),0,copy);},
 'orphan stop after final':f=>{const {sdk,result}=trace(f),copy=structuredClone(sdk.find(e=>e.data.message.event?.type==='message_delta'));copy.id=randomUUID();copy.data.message.uuid=randomUUID();f.entries.splice(f.entries.indexOf(result),0,copy);},
 'ambiguous result':f=>{const {result}=trace(f),copy=structuredClone(result);copy.id=randomUUID();copy.data.message.uuid=randomUUID();f.entries.splice(f.entries.indexOf(result),0,copy);},
 'duplicate material projection':f=>{const m=f.entries.find(e=>e.id===f.selected.source.textEntryId),copy=structuredClone(m);copy.id=randomUUID();const final=f.entries.at(-1);copy.parentId=final.parentId;final.parentId=copy.id;f.entries.splice(-1,0,copy);},
 'material bytes changed':f=>f.entries.find(e=>e.id===f.selected.source.textEntryId).data.raw+=' ',
};
for(const [name,mutate]of Object.entries(mutations))test('persisted text refuses '+name+' with recomputed producer digest',()=>{
 const f=captured();mutate(f);refresh(f);assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
});
for(const raw of ['{"version":1,"version":1,"summary":"bad","findings":[],"assessedScope":[]}','```json\n'+JSON.stringify(value)+'\n```','{"findings":[]'])test('exact source is not protocol acceptance: '+raw.slice(0,25),()=>{
 const f=captured(raw);assert.equal(read(f),raw);assert.equal(parseRoleOutput(raw,'reviewer').value,null);
});
test('text context uses already inline schema without adding a formatter tool',()=>{
 const f=captured(),context={messages:[],tools:[]};assert.equal(structuredOutputContext(context,f.intent),context);
 assert.equal(structuredOutputContext(context,{...f.intent,version:1}).tools[0].name,'StructuredOutput');
});

test('a captured Native intent cannot fall back to an ordinary Pi assistant',()=>{
 const f=captured();f.manager.appendMessage({role:'assistant',content:[{type:'text',text:JSON.stringify(value)}],api:'controlled',provider:'controlled',model:'controlled',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 f.entries=f.manager.getBranch();f.expected.entryId=f.entries.at(-1).id;f.expected.checkpointLeafId=f.expected.entryId;
 for(const source of [undefined,null])assert.throws(()=>readSelectedRoleOutput(f.entries,f.expected,source),/requires its original carrier source/);
 assert.throws(()=>readSelectedRoleOutput(f.entries,{...f.expected,nativeIntent:null},null),/requires its original carrier source/);
 const legacy={...f.expected};delete legacy.nativeIntent;
 assert.equal(readSelectedRoleOutput(f.entries,legacy,null),JSON.stringify(value));
 assert.equal(readSelectedRoleOutput(f.entries,{...legacy,nativeIntent:undefined},undefined),JSON.stringify(value));
});
test('an explicit current policy cannot become an ordinary assistant recipe when dispatch metadata is missing',()=>{
 const f=captured(undefined,true,false,{policy:nativeEvidencePolicy.id});f.manager.appendMessage({role:'assistant',content:[{type:'text',text:JSON.stringify(value)}],api:'controlled',provider:'controlled',model:'controlled',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 f.entries=f.manager.getBranch();const expected={...f.expected,entryId:f.entries.at(-1).id,checkpointLeafId:f.entries.at(-1).id};delete expected.nativeIntent;
 assert.throws(()=>readSelectedRoleOutput(f.entries,expected),/requires its original carrier source/);
});
test('a different decoded terminal value cannot hide findings behind exact text',()=>{
 const f=captured(),finding={id:'separate-received-claim',severity:'high',message:'Preserve separately received material'};
 trace(f).result.data.message.structured_output={findings:[finding]};refresh(f);
 assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 const material=nativeRoleMaterial(f.entries,f.entries.find(e=>e.customType===nativeRoleEntries.intent).id).materials.find(m=>m.selector==='decoded-result-value');
 assert.deepEqual(JSON.parse(material.raw).findings,[finding]);
});

test('Controller harvest retains wrapped unusable text findings and original charges idempotently',async()=>{
 const {Store}=await import('../../dist/controller/store.js'),{ChangeCore}=await import('../../dist/controller/change-core.js');
 const finding={requirementId:'R1',severity:'blocking',repair:'unknown',description:'Preserve wrapped received claim',evidence:['original']};
 const f=captured(JSON.stringify({answer:{...value,findings:[finding]}})),store=new Store(':memory:'),work=randomUUID(),run=randomUUID(),source=randomUUID(),launch=f.expected.launchId;
 try{
  store.run('INSERT INTO sources VALUES(?,?,?,?)',source,null,'controlled','Controlled source');
  store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,null,source,null,work,'ACTIVE',0,0,null,'{}');
  store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,work,0,0,'review','controlled','original-reservation','{}');
  store.run('INSERT INTO budgets VALUES(?,?,?,?,?)',work,'execution',3,1,0);
  store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,work,run,'reviewer',0,'settled','original-resolution',JSON.stringify({stage:'fresh-review',nativeRoleIntent:f.expected.nativeIntent}));
  // Native tool narration may precede the final JSON response. It is received
  // evidence, but cannot acquire an incomplete-role-envelope duty merely because
  // the eventual answer uses an explicitly declared JSON text carrier.
  const at=f.entries.findIndex(e=>e.data?.message?.event?.type==='message_start'),next=f.entries[at];
  const narration={id:randomUUID(),parentId:next.parentId,type:'custom',customType:nativeRoleEntries.sdk,data:{intentEntryId:f.selected.source.intentEntryId,sequence:0,message:{type:'assistant',uuid:randomUUID(),session_id:f.selected.source.nativeSessionId,parent_tool_use_id:null,message:{id:'prior-tool-narration',role:'assistant',content:[{type:'text',text:'I will inspect the captured project first.'}]}}}};
  next.parentId=narration.id;f.entries.splice(at,0,narration);refresh(f);
  const core=new ChangeCore({store}),execution={role:'reviewer',rawFinal:f.selected.raw,rawFinalTruncated:false,protocol:null,issues:['PROTOCOL: wrapped role root'],exposures:[],events:[],terminal:'stop',historyRef:'controlled-private-journal',providerRequests:1,nativeEntryId:f.selected.entryId,nativeSource:f.selected.source,nativeSessionId:f.expected.sessionId,nativeCheckpoint:{leafId:f.selected.entryId}};
  const before=store.all('SELECT * FROM budgets');
  core.collect(work,launch,execution,false);
  assert.equal(core.harvestEntries(work,launch,'reviewer',f.entries,execution,f.selected.entryId),true,'Ordinary prior narration must not create a formatter completeness hold');
  const received=store.all('SELECT * FROM finding_occurrences WHERE work=?',work).filter(row=>JSON.parse(row.data).finding.description===finding.description);
  assert.ok(received.length>=1,'Wrapped original findings must survive unusable text collection');
  const rows=store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',work);
  core.harvestEntries(work,launch,'reviewer',f.entries,execution,f.selected.entryId);
  assert.deepEqual(store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY rowid',work),rows);
  assert.deepEqual(store.all('SELECT * FROM budgets'),before);
 }finally{store.close();}
});

for(const [role,stage] of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication'],['reviewer','fresh-review'],['implementer','implementation'],['repairer','repair']])test('shared Native framing binds the current evidence policy for both carriers: '+role,async()=>{
 const {nativeRoleFraming,roleFraming}=await import('../../dist/workflow/role-framing.js');
 const bundle={requirements:[{id:'R1',text:'Preserve original behavior',source:'owner'}],contracts:'Exact original rules',context:{stage},sources:[],requiredScope:[]};
 const original=roleFraming(role,bundle,true),f=nativeRoleFraming(role,bundle,'original-launch',16,'formatter/v1');
 assert.equal(f.prompt,original.prompt);assert.equal(f.systemPrompt,original.systemPrompt);assert.deepEqual(f.schema,original.schema);assert.deepEqual(f.constraints,original.constraints);
 assert.equal(JSON.stringify(f.intent),JSON.stringify({version:1,requestId:'original-launch',binding:{launchId:'original-launch',role,nativeEvidencePolicy:nativeEvidencePolicy.id,stage,inputDigest:sha(JSON.stringify(bundle))},schema:original.schema,maxNativeTurns:16}));
 assert.equal(f.schema,f.intent.schema);assert.ok(Object.isFrozen(f.intent)&&Object.isFrozen(f.schema)&&Object.isFrozen(f.intent.binding));
 const text=nativeRoleFraming(role,bundle,'text-launch',3,'assistant-json/v1'),ordinary=roleFraming(role,bundle);
 assert.equal(text.prompt,ordinary.prompt);assert.equal(text.systemPrompt,ordinary.systemPrompt);assert.equal(text.intent.binding.inputDigest,sha(text.prompt));assert.notEqual(text.intent.binding.inputDigest,sha(JSON.stringify(bundle)));
 assert.equal(text.intent.binding.nativeEvidencePolicy,nativeEvidencePolicy.id);assert.equal(text.intent.version,2);assert.equal(text.schema,text.intent.schema);assert.ok(text.systemPrompt.includes(JSON.stringify(text.schema)));
});
test('fresh planning family selects submission while explicit text, formatter and other defaults retain their own recipes',async()=>{
 const {nativeRoleFraming}=await import('../../dist/workflow/role-framing.js');
 const bundle={requirements:[{id:'R1',text:'Preserve original behavior',source:'owner'}],contracts:'Exact original rules',context:{stage:'planning-challenge'},sources:[],requiredScope:[]};
 for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication']]){
 const input={...bundle,context:{stage}},current=nativeRoleFraming(role,input,'current-planning',16);
 assert.equal(current.intent.version,3);assert.equal(current.intent.carrier,'tool-submission/v1');
 assert.deepEqual(current,nativeRoleFraming(role,input,'current-planning',16,'tool-submission/v1'));
 assert.equal(nativeRoleFraming(role,input,'original-text',16,'assistant-json/v1').intent.version,2);
 assert.equal(current.intent.binding.inputDigest,sha(current.prompt));
 assert.equal(nativeRoleFraming(role,input,'original-planning',16,'formatter/v1').intent.version,1);
 }
 for(const [role,stage]of [['planner','fresh-review'],['planner','planning-challenge'],['challenger','planning'],['adjudicator','source-fit'],['challenger','fresh-review'],['reviewer','planning-challenge']])
  assert.equal(nativeRoleFraming(role,{...bundle,context:{stage}},'unchanged-default',16).intent.version,1,role+' '+stage);
 assert.throws(()=>nativeRoleFraming('challenger',{...bundle,context:{...bundle.context,reviewResolutionInput:{version:1}}},'invalid-declaration',16),/review adjudication/);
});
test('shared text request binds the final presented finding-body wire',async()=>{
 const {nativeRoleFraming}=await import('../../dist/workflow/role-framing.js');
 const finding={requirementId:'R1',severity:'blocking',repair:'unknown',description:'Repeated exact original claim '+ 'original evidence '.repeat(80),evidence:['original']};
 const bundle={requirements:[{id:'R1',text:'Preserve original behavior',source:'owner'}],contracts:'Exact original rules',sources:[],requiredScope:[],context:{stage:'planning-adjudication',findingBodyInput:{version:3},occurrences:Array.from({length:8},(_,i)=>({id:'F'+i,work:'W',output:'O'+i,ordinal:0,data:{finding,launchId:'L'+i,role:'planner'}}))}};
 const f=nativeRoleFraming('adjudicator',bundle,'wire-launch',3,'assistant-json/v1');
 const wire=JSON.parse(f.prompt.split('\n').find(line=>line.startsWith('{"requirements":')));assert.ok(wire.context.findingBodyEncoding);
 assert.equal(f.intent.binding.inputDigest,sha(f.prompt));assert.notEqual(f.intent.binding.inputDigest,sha(JSON.stringify(bundle)));assert.ok(bundle.context.occurrences.every(o=>o.data.finding===finding));
});

test('public predispatch checkpoint may bind input already appended before Native intent',()=>{const f=captured(JSON.stringify(value),true,true);assert.equal(read(f),JSON.stringify(value));});

for(const carrier of ['formatter/v1','assistant-json/v1'])test('dedicated source-fit freezes exact held duties in Native '+carrier,async()=>{
 const {nativeRoleFraming}=await import('../../dist/workflow/role-framing.js');
 const context={stage:'source-fit',sourceFitInput:{version:1},sourceInputChain:[{input_id:'owner-input',revision:3,text:'Retain scope; clarify recovery',data:{effectHold:true}}]};
 const bundle={requirements:[{id:'R1',text:'Preserve original behavior',source:'owner'}],contracts:'Original rules',context,sources:[],requiredScope:[]};
 const frame=nativeRoleFraming('adjudicator',bundle,'source-fit-launch',3,carrier);
 assert.deepEqual(frame.sourceFit,[{inputId:'owner-input',directionRevision:3}]);
 assert.ok(frame.schema.required.includes('inputDecisions'));assert.equal(frame.schema.properties.inputDecisions.minItems,1);
 assert.ok(frame.schema.properties.inputDecisions.description.includes(JSON.stringify(frame.sourceFit)));
 assert.equal(frame.intent.schema,frame.schema);assert.ok(Object.isFrozen(frame.schema));
 assert.equal(frame.intent.binding.inputDigest,sha(carrier==='assistant-json/v1'?frame.prompt:JSON.stringify(bundle)));
 context.sourceInputChain[0].revision=4;delete context.sourceFitInput;
 assert.equal(frame.sourceFit[0].directionRevision,3);assert.ok(frame.prompt.includes('"sourceFitInput":{"version":1}'));
});

test('unversioned dedicated source-fit retains the original generic producer schema',async()=>{
 const {nativeRoleFraming}=await import('../../dist/workflow/role-framing.js');
 const {roleOutputSchema}=await import('../../dist/workflow/role-output-shape.js');
 const bundle={requirements:[],contracts:'Original rules',context:{stage:'source-fit',sourceInputChain:[{input_id:'historical-input',revision:2,data:{effectHold:true}}]},sources:[],requiredScope:[]};
 for(const carrier of ['formatter/v1','assistant-json/v1']){
  const frame=nativeRoleFraming('adjudicator',bundle,'legacy-launch',3,carrier);
  assert.deepEqual(frame.sourceFit,[]);assert.equal(JSON.stringify(frame.schema),JSON.stringify(roleOutputSchema('adjudicator','source-fit')));
 }
});
