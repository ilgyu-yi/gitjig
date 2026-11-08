/** Prospective source3 cold codec only; no executable role/tool/model admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {SessionManager,parseSessionEntries} from '@earendil-works/pi-coding-agent';
import {NativeRoleCollector,nativeRoleEntries,nativeRoleIntentReceipt,nativeRoleMaterial} from '../../dist/workflow/native-role-output.js';
import {nativeEvidencePolicy} from '../../dist/workflow/native-evidence-budget.js';
import {nativeSubmissionToolName,nativeSubmissionReceipt} from '../../dist/workflow/native-submission-source.js';
import {readSelectedRoleOutput} from '../../dist/controller/history.js';
import {assertNativeResponseInput} from '../../dist/pi/structured-output.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
const raw=JSON.stringify({version:1,summary:'Literal submitted role payload',findings:[],assessedScope:[]});
function fixture({policy,hookMiB=0,counterMiB=0,select=true,secondSuccess=false,duplicateRejected=false,assistantEarly=false,assistantBeforeStart=false,receiptEarly=null,rejectedReceiptEarly=null,selectedRaw=raw,splitAssistant=false,duplicateOwner=false,siblingFault=null}={}){
 const manager=SessionManager.inMemory('/controlled-submission-codec'),launchId=randomUUID(),input='One original captured input';
 const request={version:3,carrier:'tool-submission/v1',requestId:launchId,binding:{launchId,role:'planner',stage:'planning',inputDigest:sha(input),...(policy===undefined?{}:{nativeEvidencePolicy:policy})},schema:{type:'object',properties:{}},maxNativeTurns:4};
 const collector=new NativeRoleCollector(manager,request),sid='native-'+randomUUID();manager.appendMessage({role:'user',content:input,timestamp:1});
 const observe=message=>collector.observe({uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,...message});
 const event=e=>observe({type:'stream_event',event:e});
 observe({type:'system',subtype:'init',tools:[nativeSubmissionToolName],mcp_servers:[{name:'custom-tools',status:'connected'}],plugins:[]});
 for(let n=0;n<hookMiB;n++)observe({type:'system',subtype:'hook_progress',stdout:'x'.repeat(1024*1024-512)});
 let counterBytes=0;
 for(let n=1;counterBytes<counterMiB*1024*1024;n++){
  const m={type:'system',subtype:'thinking_tokens',estimated_tokens:n,estimated_tokens_delta:1,uuid:randomUUID(),session_id:sid},size=Buffer.byteLength(JSON.stringify(m));
  if(counterBytes+size>counterMiB*1024*1024)break;collector.observe(m);counterBytes+=size;
 }

 const call=(id,text,isError)=>{
  const mid='message-'+id, timing=isError?(rejectedReceiptEarly??receiptEarly):receiptEarly;
  const assistant=()=>observe({type:'assistant',message:{id:mid,role:'assistant',content:[{type:'tool_use',id,name:nativeSubmissionToolName,input:JSON.parse(text)}]}});
  const sibling=()=>observe({type:'assistant',...(siblingFault==='foreign-root'?{parent_tool_use_id:'foreign'}:{}),message:{id:mid,role:'assistant',content:[{type:'text',text:'Narration accompanying a split submission.'}]}});
  const acknowledge=()=>observe({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:id,is_error:isError,content:[{type:'text',text:isError?'Missing verificationRequirements; retain the original finding':nativeSubmissionReceipt(text,request)}]}]}});
  if(assistantBeforeStart)assistant();
  if(splitAssistant&&siblingFault==='before-start')sibling();
  event({type:'message_start',message:{id:mid,role:'assistant',content:[]}});
  const index=splitAssistant?1:0;
  if(splitAssistant){event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Narration accompanying a split submission.'}});event({type:'content_block_stop',index:0});if(siblingFault!=='before-start')sibling();}
  event({type:'content_block_start',index,content_block:{type:'tool_use',name:nativeSubmissionToolName,id,input:{}}});
  for(let i=0;i<text.length;i+=13)event({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:text.slice(i,i+13)}});
  if(assistantEarly&&!assistantBeforeStart)assistant();
  if(timing==='before-stop')acknowledge();
  event({type:'content_block_stop',index});if(timing==='before-message-stop')acknowledge();event({type:'message_delta',delta:{stop_reason:'tool_use'}});event({type:'message_stop'});
  if(timing==='before-assistant')acknowledge();
  if(!assistantEarly&&!assistantBeforeStart)assistant();
  if(duplicateOwner)assistant();
  if(!timing)acknowledge();
 };
 const rejected=JSON.stringify({version:1,summary:'Incomplete plan',findings:[{requirementId:'scope',severity:'blocking',repair:'unknown',description:'Rejected submission finding must survive',evidence:[]}],assessedScope:[]});
 call('rejected',duplicateRejected?rejected.replace('"version":1','"version":2,"version":1'):rejected,true);call('selected',selectedRaw,false);
 if(secondSuccess)call('second',raw,false);
 observe({type:'result',subtype:'success',is_error:false,result:'Narrative is not the role payload',num_turns:3,permission_denials:[],terminal_reason:'completed'});
 const sdk=manager.getBranch().filter(entry=>entry.customType===nativeRoleEntries.sdk);
 collector.observe({type:'gitjig.native-query-settled/v1',ownerSessionId:manager.getSessionId(),queryId:randomUUID(),nativeSessionId:sid,nativeCleanup:'confirmed',format:{request:structuredClone(request),requestDigest:sha(JSON.stringify(request)),schemaDigest:sha(JSON.stringify(request.schema))},messages:sdk.length,messageDigest:sha(sdk.map(entry=>JSON.stringify(entry.data.message)+'\n').join(''))});
 const selected=select?collector.select():null;if(!select)collector.materialize();
 const entries=structuredClone(manager.getBranch()),expected={entryId:selected?.entryId,sessionId:manager.getSessionId(),launchId,role:'planner',stage:'planning',checkpointLeafId:selected?.entryId,nativeIntent:nativeRoleIntentReceipt(request)};
 return {manager,collector,request,input,entries,expected,selected};
}
const read=f=>readSelectedRoleOutput(f.entries,f.expected,f.selected.source);
function refresh(f){const sdk=f.entries.filter(entry=>entry.customType===nativeRoleEntries.sdk),settlement=f.entries.find(entry=>entry.customType===nativeRoleEntries.settlement);sdk.forEach((entry,i)=>entry.data.sequence=i+1);settlement.data.attestation.messages=sdk.length;settlement.data.attestation.messageDigest=sha(sdk.map(entry=>JSON.stringify(entry.data.message)+'\n').join(''));}
const sdk=f=>f.entries.filter(entry=>entry.customType===nativeRoleEntries.sdk);
test('source3 reads the exact historical provisional receipt and refuses modified completion guidance',()=>{
 const f=fixture();
 const content=sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].content[0];
 content.text=JSON.stringify({kind:'gitjig.role-submission/v1',rawSha256:sha(raw),requestDigest:sha(JSON.stringify(f.request)),provisional:true});
 refresh(f);
 assert.equal(read(f),raw);
 content.text=JSON.stringify({...JSON.parse(content.text),nextAction:'Submit a second role result.'});
 refresh(f);
 assert.throws(()=>read(f),/provisional receipt mismatch/);
});
test('current submission uses the shared mixed capture budget through selection and persisted cold replay',()=>{
 const f=fixture({policy:nativeEvidencePolicy.id,hookMiB:6,counterMiB:3});assert.equal(read(f),raw);
 assert.ok(sdk(f).reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0)>8*1024*1024);
 const rejected=nativeRoleMaterial(f.entries,f.selected.source.intentEntryId).materials.filter(m=>m.selector==='submission-arguments'&&m.toolUseId==='rejected');assert.equal(rejected.length,1);assert.ok(rejected[0].raw.includes('Rejected submission finding must survive'));
 f.entries=parseSessionEntries([f.manager.getHeader(),...f.entries].map(e=>JSON.stringify(e)).join('\n')+'\n');assert.equal(read(f),raw);
});
test('unmarked historical submission retains its literal combined trace bound',()=>{
 assert.throws(()=>fixture({hookMiB:6,counterMiB:3}),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
});
for(const extension of ['unknown','retracted_message_uuids'])test('current submission gives no scalar-counter credit to '+extension+' fields',()=>{
 const f=fixture({policy:nativeEvidencePolicy.id,hookMiB:6,counterMiB:3});
 for(const entry of sdk(f))if(entry.data.message.subtype==='thinking_tokens')entry.data.message[extension]=extension==='unknown'?true:[];
 refresh(f);assert.throws(()=>read(f),/original declared evidence policy exceeded: provider-evidence/);
});
test('current submission charges settlement after an exactly full ordinary SDK budget',()=>{
 const f=fixture({policy:nativeEvidencePolicy.id}),terminal=sdk(f).find(e=>e.data.message.type==='result');
 const sid=terminal.data.message.session_id;
 let remaining=nativeEvidencePolicy.normalBytes-sdk(f).reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0);
 while(remaining>0){
  const message={type:'system',subtype:'hook_progress',uuid:randomUUID(),session_id:sid,stdout:''},base=Buffer.byteLength(JSON.stringify(message)),size=Math.min(1024*1024,remaining);assert.ok(size>=base);message.stdout='x'.repeat(size-base);
  const entry=structuredClone(terminal);entry.id=randomUUID();entry.parentId=terminal.parentId;entry.data.message=message;terminal.parentId=entry.id;f.entries.splice(f.entries.indexOf(terminal),0,entry);remaining-=size;
 }
 refresh(f);assert.throws(()=>read(f),/original declared evidence policy exceeded: provider-evidence/);
});
for(const duplicateRejected of [false,true])test('source3 cold replay binds provisional receipt and preserves rejected original material, duplicateRejected='+duplicateRejected,()=>{
 const f=fixture({duplicateRejected});assert.equal(f.selected.source.kind,'claude-sdk-tool-submission/v1');assert.equal(f.selected.raw,raw);assert.equal(read(f),raw);
 const serialized=[f.manager.getHeader(),...f.entries].map(entry=>JSON.stringify(entry)).join('\n')+'\n';f.entries=parseSessionEntries(serialized);assert.equal(read(f),raw);
 const materials=nativeRoleMaterial(f.entries,f.selected.source.intentEntryId).materials;assert.equal(materials.filter(material=>material.selector==='submission-arguments').length,2);
 assert.ok(materials.some(material=>material.raw.includes('Rejected submission finding must survive')));assert.ok(!materials.some(material=>material.selector.startsWith('decoded-submission-input:')));
});
test('source3 refuses replacement by a second successful original submission',()=>assert.throws(()=>fixture({secondSuccess:true}),/one successful original submission/));
const mutations={
 'missing served tool':f=>{sdk(f).find(entry=>entry.data.message.type==='system').data.message.tools=[];},
 'missing connected MCP server':f=>{sdk(f).find(entry=>entry.data.message.type==='system').data.message.mcp_servers=[];},
 'deleted rejected material':f=>{const at=f.entries.findIndex(entry=>entry.customType===nativeRoleEntries.material&&entry.data.toolUseId==='rejected');f.entries.splice(at,1);},
 'wrong fresh input':f=>{f.entries.find(entry=>entry.type==='message'&&entry.message.role==='user').message.content+=' changed';},
 'missing receipt':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].content=[];},
 'assistant receipt cannot impersonate SDK user result':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.type='assistant';},
 'receipt payload drift':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].content[0].text+=' ';},
 'wrong result id':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].tool_use_id='different';},
 'receipt failure':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].is_error=true;},
 'receipt session drift':f=>{sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.session_id='different';},
 'native terminal failure':f=>{sdk(f).find(entry=>entry.data.message.type==='result').data.message.is_error=true;},
 'cleanup unknown':f=>{f.entries.find(entry=>entry.customType===nativeRoleEntries.settlement).data.attestation.nativeCleanup='unknown';},
 'raw frame drift':f=>{sdk(f).find(entry=>entry.data.message.event?.delta?.type==='input_json_delta').data.message.event.delta.partial_json+=' ';},
 'decoded argument drift':f=>{sdk(f).find(entry=>entry.data.message.type==='assistant'&&entry.data.message.message.id==='message-selected').data.message.message.content[0].input.summary='different';},
 'wrong served tool':f=>{sdk(f).find(entry=>entry.data.message.event?.content_block?.id==='selected').data.message.event.content_block.name='mcp__other__gitjig_submit_role_result';},
 'selected material drift':f=>{f.entries.find(entry=>entry.id===f.selected.source.argumentEntryId).data.raw+=' ';},
 'open owning cohort':f=>{const stop=sdk(f).filter(entry=>entry.data.message.event?.type==='message_stop').at(-1);stop.data.message.event.type='ping';},
 'conflicting envelope identity':f=>{const all=sdk(f);all[2].data.message.uuid=all[1].data.message.uuid;},
 'retracted message':f=>{sdk(f).find(entry=>entry.data.message.type==='result').data.message.retracted_message_uuids=['message-selected'];},
};
for(const [label,mutate]of Object.entries(mutations))test('source3 cold proof refuses '+label,()=>{const f=fixture();mutate(f);refresh(f);assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);});
test('prospective source3 checks the original text input independently of codec selection',()=>{
 const f=fixture();assert.doesNotThrow(()=>assertNativeResponseInput({messages:[{role:'user',content:f.input}]},f.request));assert.throws(()=>assertNativeResponseInput({messages:[{role:'user',content:f.input+' changed'}]},f.request),/INPUT_MISMATCH/);
});

for(const assistantEarly of [false,true])test('source3 supports typed assistant '+(assistantEarly?'before':'after')+' stream closure when receipt follows both',()=>assert.equal(read(fixture({assistantEarly})),raw));
for(const assistantEarly of [false,true])test('source3 selects the unique tool owner among split same-message typed packets, early='+assistantEarly,()=>{
 const f=fixture({splitAssistant:true,assistantEarly});assert.equal(read(f),raw);
 const owner=f.entries.find(entry=>entry.id===f.selected.source.assistantEntryId);
 assert.equal(owner.data.message.message.content[0].type,'tool_use');
 const materials=nativeRoleMaterial(f.entries,f.selected.source.intentEntryId).materials;
 assert.equal(materials.filter(material=>material.raw==='Narration accompanying a split submission.').length,2);
});
test('source3 refuses equal duplicate typed tool owners instead of choosing the first',()=>assert.throws(()=>fixture({splitAssistant:true,duplicateOwner:true}),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/));
for(const siblingFault of ['foreign-root','before-start'])test('source3 refuses invalid split typed sibling '+siblingFault,()=>assert.throws(()=>fixture({splitAssistant:true,siblingFault}),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/));
test('source3 refuses typed assistant predating original message start',()=>assert.throws(()=>fixture({assistantBeforeStart:true}),/owning assistant order/));
for(const input of [null,[],false,0,'malformed primitive'])test('source3 retains nonobject received submission input '+JSON.stringify(input),()=>{
 const manager=SessionManager.inMemory('/malformed-submission-material'),intent={version:3,carrier:'tool-submission/v1'};
 manager.appendCustomEntry(nativeRoleEntries.intent,{request:intent});const intentEntryId=manager.getLeafId();
 manager.appendCustomEntry(nativeRoleEntries.sdk,{intentEntryId,message:{type:'assistant',session_id:'native',message:{id:'material',content:[{type:'tool_use',id:'input',name:nativeSubmissionToolName,input}]}}});
 const {materials,diagnostics}=nativeRoleMaterial(manager.getBranch(),intentEntryId);assert.equal(diagnostics.extraction.count,0);assert.equal(diagnostics.prefix.count,0);assert.equal(materials.length,1);assert.equal(materials[0].selector,'decoded-submission-input:0');assert.equal(materials[0].raw,JSON.stringify(input));
});
test('source3 explicitly holds missing decoded submission input instead of inferring empty findings',()=>{
 const manager=SessionManager.inMemory('/missing-submission-material');manager.appendCustomEntry(nativeRoleEntries.intent,{request:{version:3,carrier:'tool-submission/v1'}});const intentEntryId=manager.getLeafId();
 manager.appendCustomEntry(nativeRoleEntries.sdk,{intentEntryId,message:{type:'assistant',message:{id:'material',content:[{type:'tool_use',id:'input',name:nativeSubmissionToolName}]}}});
 const {materials,diagnostics}=nativeRoleMaterial(manager.getBranch(),intentEntryId);assert.deepEqual(materials,[]);assert.equal(diagnostics.extraction.count,1);assert.deepEqual(diagnostics.extraction.sample.map(d=>d.reason),['original submission input is not JSON']);
});

test('source3 preserves a rejection after complete arguments and the typed call when message stop arrives later', async () =>{
 const f=fixture({assistantEarly:true,rejectedReceiptEarly:'before-message-stop'});
 assert.equal(read(f),raw);
 const {readRejectedSubmissionAttempt}=await import('../../dist/workflow/native-role-output.js');
 const entry=f.entries.find(item=>item.customType===nativeRoleEntries.material&&item.data.toolUseId==='rejected');
 const expected={sessionId:f.expected.sessionId,launchId:f.expected.launchId,role:f.expected.role,intent:f.expected.nativeIntent,checkpointLeafId:f.expected.checkpointLeafId};
 const rejected=readRejectedSubmissionAttempt([f.manager.getHeader(),...f.entries],expected,entry.data.sourceEntryId);
 assert.equal(rejected.material.toolUseId,'rejected');
 assert.ok(rejected.material.raw.includes('Rejected submission finding must survive'));
});
test('source3 still requires the successful receipt to follow message stop', () => {
 assert.throws(()=>fixture({assistantEarly:true,receiptEarly:'before-message-stop'}),/tool result origin\/order/);
});
for(const receiptEarly of ['before-stop','before-assistant'])test('source3 refuses receipt '+receiptEarly,()=>assert.throws(()=>fixture({receiptEarly,assistantEarly:receiptEarly==='before-stop'}),/tool result origin\/order/));
test('source3 refuses duplicate keys even with a matching successful provisional receipt',()=>assert.throws(()=>fixture({selectedRaw:raw.replace('"version":1','"version":2,"version":1')}),/not unique JSON/));

test('source3 accepts absent optional is_error only with the exact original receipt',()=>{
 const f=fixture();const message=sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected');delete message.data.message.message.content[0].is_error;refresh(f);assert.equal(read(f),raw);
});
for(const invalid of [null,'false',0,undefined])test('source3 rejects present nonboolean is_error '+String(invalid),()=>{
 const f=fixture();sdk(f).find(entry=>entry.data.message.type==='user'&&entry.data.message.message.content[0].tool_use_id==='selected').data.message.message.content[0].is_error=invalid;refresh(f);assert.throws(()=>read(f),/tool result origin\/order/);
});

for(const failed of [false,true])test('complete submission historical custody survives original query failure='+failed,async()=>{
 const {readHistoricalSubmissionAttempt,readRejectedSubmissionAttempt}=await import('../../dist/workflow/native-role-output.js');
 const f=fixture();if(failed){const result=sdk(f).find(entry=>entry.data.message.type==='result');result.data.message.is_error=true;result.data.message.subtype='error_during_execution';refresh(f);}
 const entries=[f.manager.getHeader(),...f.entries],expected={sessionId:f.expected.sessionId,launchId:f.expected.launchId,role:f.expected.role,intent:f.expected.nativeIntent,checkpointLeafId:f.expected.checkpointLeafId};
 const selected=entries.find(entry=>entry.id===f.selected.source.argumentEntryId),rejected=entries.find(entry=>entry.customType===nativeRoleEntries.material&&entry.data.toolUseId==='rejected');
 assert.equal(readHistoricalSubmissionAttempt(entries,expected,selected.data.sourceEntryId).material.raw,raw);
 const received=readRejectedSubmissionAttempt(entries,expected,rejected.data.sourceEntryId);assert.ok(received.material.raw.includes('Rejected submission finding must survive'));assert.equal(received.querySettlement,undefined);assert.ok(received.rejectionEntryId);
 if(failed)assert.throws(()=>read(f),/original SDK terminal/);
 for(const mutation of ['input','receipt','cleanup']){
  const altered=structuredClone(entries);
  if(mutation==='input')altered.find(entry=>entry.type==='message'&&entry.message.role==='user').message.content+=' drift';
  if(mutation==='receipt')altered.find(entry=>entry.data?.message?.type==='user'&&entry.data.message.message.content[0].tool_use_id==='rejected').data.message.message.content[0].is_error=false;
  if(mutation==='cleanup')altered.find(entry=>entry.customType===nativeRoleEntries.settlement).data.attestation.nativeCleanup='unknown';
  assert.throws(()=>readRejectedSubmissionAttempt(altered,expected,rejected.data.sourceEntryId));
 }
});

for(const assistantEarly of [false,true])test('rejected submission custody supports both typed/stream orders, early='+assistantEarly,async()=>{
 const {readRejectedSubmissionAttempt}=await import('../../dist/workflow/native-role-output.js');const f=fixture({assistantEarly}),entries=[f.manager.getHeader(),...f.entries];
 const material=entries.find(entry=>entry.customType===nativeRoleEntries.material&&entry.data.toolUseId==='rejected');
 assert.ok(readRejectedSubmissionAttempt(entries,{sessionId:f.expected.sessionId,launchId:f.expected.launchId,role:f.expected.role,intent:f.expected.nativeIntent,checkpointLeafId:f.expected.checkpointLeafId},material.data.sourceEntryId).rejectionEntryId);
});
for(const receiptEarly of ['before-stop','before-assistant'])test('rejected submission receipt refuses '+receiptEarly,async()=>{
 const {readRejectedSubmissionAttempt}=await import('../../dist/workflow/native-role-output.js');const f=fixture({receiptEarly,assistantEarly:receiptEarly==='before-stop',select:false}),entries=[f.manager.getHeader(),...f.entries];
 const material=entries.find(entry=>entry.customType===nativeRoleEntries.material&&entry.data.toolUseId==='rejected');
 assert.throws(()=>readRejectedSubmissionAttempt(entries,{sessionId:f.expected.sessionId,launchId:f.expected.launchId,role:f.expected.role,intent:f.expected.nativeIntent,checkpointLeafId:entries.at(-1).id},material.data.sourceEntryId),/rejected submission (receipt precedes|result identity or order mismatch)/);
});
