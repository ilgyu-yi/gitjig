/** Historical received-call proof, never selected output or completion authority. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {SessionManager,parseSessionEntries} from '@earendil-works/pi-coding-agent';
import {NativeRoleCollector,nativeRoleEntries,nativeRoleIntentReceipt,nativeRoleMaterial,readHistoricalFormatterAttempt,readRejectedFormatterAttempt,readTerminatedFormatterPrefix} from '../../dist/workflow/native-role-output.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
function captured({settled=false,laterOpen=false,narration=false,open=false,rejected=false,rawValue}={}) {
 const manager=SessionManager.inMemory('/controlled-historical-formatter'),launchId=randomUUID(),sid=randomUUID(),mid=randomUUID(),tool=randomUUID();
 const intent={version:1,requestId:launchId,binding:{launchId,role:'planner',stage:'planning',inputDigest:sha('original input')},schema:{type:'object'},maxNativeTurns:4};
 manager.appendMessage({role:'user',content:'original input',timestamp:0});
 const collector=new NativeRoleCollector(manager,intent);
 const observe=m=>collector.observe({uuid:randomUUID(),session_id:sid,...m}),event=e=>observe({type:'stream_event',parent_tool_use_id:null,event:e});
 observe({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]});
 event({type:'message_start',message:{id:mid,type:'message',role:'assistant',content:[]}});
 if(narration)observe({type:'assistant',parent_tool_use_id:null,message:{id:mid,role:'assistant',content:[{type:'text',text:'I will inspect the original input.'}]}});
 event({type:'content_block_start',index:0,content_block:{type:'tool_use',name:'StructuredOutput',id:tool,input:{}}});
 const raw=open?JSON.stringify({assessedScope:[],alternatives:[]}).slice(0,-1):JSON.stringify(rawValue??{value:{findings:[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'Retain original received claim',evidence:['original']}]}});
 for(let i=0;i<raw.length;i+=13)event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw.slice(i,i+13)}});
 if(!open){
 event({type:'content_block_stop',index:0});event({type:'message_delta',delta:{stop_reason:'tool_use'}});event({type:'message_stop'});
 observe({type:'assistant',parent_tool_use_id:null,message:{id:mid,role:'assistant',content:[{type:'tool_use',name:'StructuredOutput',id:tool,input:JSON.parse(raw)}]}});
 }
 if(rejected)observe({type:'user',parent_tool_use_id:null,message:{role:'user',content:[{type:'tool_result',tool_use_id:tool,is_error:true,content:'Rejected formatter arguments'}]}});
 if(laterOpen){event({type:'message_start',message:{id:'later-unfinished',type:'message',role:'assistant',content:[]}});event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});}
 if(settled){
  observe({type:'result',subtype:'success',is_error:false,result:'A later result is not this attempt',num_turns:2,permission_denials:[]});
  const sdk=manager.getBranch().filter(e=>e.customType===nativeRoleEntries.sdk);
  collector.observe({type:'gitjig.native-query-settled/v1',ownerSessionId:manager.getSessionId(),queryId:randomUUID(),nativeSessionId:sid,nativeCleanup:'confirmed',format:{request:intent,requestDigest:sha(JSON.stringify(intent)),schemaDigest:sha(JSON.stringify(intent.schema))},messages:sdk.length,messageDigest:sha(sdk.map(e=>JSON.stringify(e.data.message)+'\n').join(''))});
 }
 const entries=parseSessionEntries([manager.getHeader(),...manager.getBranch()].map(e=>JSON.stringify(e)).join('\n'));
 const source=nativeRoleMaterial(entries,collector.intentEntryId).materials.find(m=>m.selector==='formatter-arguments');
 return {manager,collector,intent,entries,raw,source,expected:{sessionId:manager.getSessionId(),launchId,role:'planner',intent:nativeRoleIntentReceipt(intent),checkpointLeafId:entries.at(-1).id}};
}
const sdk=f=>f.entries.filter(e=>e.customType===nativeRoleEntries.sdk);
const frame=(f,type)=>sdk(f).find(e=>e.data.message.event?.type===type);
const read=f=>readHistoricalFormatterAttempt(f.entries,f.expected,f.source.sourceEntryId);
function refresh(f){const messages=sdk(f);messages.forEach((e,i)=>{if(e.data)e.data.sequence=i+1;});const settlement=f.entries.find(e=>e.customType===nativeRoleEntries.settlement);if(settlement?.data?.attestation){settlement.data.attestation.messages=messages.length;settlement.data.attestation.messageDigest=sha(messages.map(e=>JSON.stringify(e.data?.message)+'\n').join(''));}}
for(const settled of [false,true])for(const laterOpen of [false,true])for(const narration of [false,true])test(`historical complete formatter call survives codec: settled=${settled}, later unfinished=${laterOpen}, narration=${narration}`,()=>{
 const f=captured({settled,laterOpen,narration}),proof=read(f);assert.equal(proof.material.raw,f.raw);assert.equal(proof.querySettlement,settled?'verified':'not-attested');assert.deepEqual(proof.material,f.source);
});

test('rejected formatter proof binds complete original call and unique later settled user error result',()=>{
 const f=captured({settled:true,rejected:true,rawValue:{input:'opaque'}});
 const proof=readRejectedFormatterAttempt(f.entries,f.expected,f.source.sourceEntryId);
 assert.deepEqual(proof.material,f.source);assert.equal(proof.material.raw,f.raw);
 assert.equal(sdk(f).find(e=>e.id===proof.rejectionEntryId).data.message.message.content[0].is_error,true);
});
for(const mutation of ['no-settlement','no-result','successful-result','foreign-session','subagent','wrong-role','wrong-tool',
 'duplicate-result','duplicate-uuid','result-before-call','aborted-result','retracted-result','result-after-checkpoint'])test('rejected formatter proof refuses '+mutation,()=>{
 const f=captured({settled:mutation!=='no-settlement',rejected:true,rawValue:{input:'opaque'}});
 const result=sdk(f).find(e=>e.data.message.type==='user'),message=result.data.message;
 if(mutation==='no-result')f.entries=f.entries.filter(e=>e!==result);
 if(mutation==='successful-result')message.message.content[0].is_error=false;
 if(mutation==='foreign-session')message.session_id='foreign';
 if(mutation==='subagent')message.parent_tool_use_id='other';
 if(mutation==='wrong-role')message.message.role='assistant';
 if(mutation==='wrong-tool')message.message.content[0].tool_use_id='other';
 if(mutation==='aborted-result')message.aborted=true;
 if(mutation==='duplicate-uuid')message.uuid=sdk(f)[0].data.message.uuid;
 if(mutation==='retracted-result')sdk(f).at(-1).data.message.retracted_message_uuids=[message.uuid];
 if(mutation==='result-after-checkpoint'){
  f.entries.splice(f.entries.indexOf(result),1);refresh(f);f.entries.push(result);
  assert.throws(()=>readRejectedFormatterAttempt(f.entries,f.expected,f.source.sourceEntryId),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);return;
 }
 if(mutation==='duplicate-result'){const copy=structuredClone(result);copy.id=randomUUID();copy.data.message.uuid=randomUUID();f.entries.splice(f.entries.indexOf(result),0,copy);}
 if(mutation==='result-before-call'){f.entries.splice(f.entries.indexOf(result),1);f.entries.splice(f.entries.indexOf(frame(f,'content_block_start')),0,result);}
 refresh(f);
 assert.throws(()=>readRejectedFormatterAttempt(f.entries,f.expected,f.source.sourceEntryId),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
});
const mutations={
 'missing checkpoint':f=>f.expected.checkpointLeafId='missing',
 'checkpoint before owning message stop':f=>f.expected.checkpointLeafId=frame(f,'content_block_stop').id,
 'foreign session':f=>f.expected.sessionId='foreign',
 'foreign launch':f=>f.expected.launchId='foreign',
 'changed schema commitment':f=>f.expected.intent={...f.expected.intent,schemaDigest:'0'.repeat(64)},
 'missing intent':f=>f.entries=f.entries.filter(e=>e.customType!==nativeRoleEntries.intent),
 'foreign SDK intent':f=>frame(f,'content_block_delta').data.intentEntryId='foreign',
 'foreign native frame session':f=>frame(f,'content_block_delta').data.message.session_id='foreign',
 'subagent frame':f=>frame(f,'content_block_delta').data.message.parent_tool_use_id='subagent',
 'open owning block':f=>frame(f,'content_block_stop').data.message.event.type='ping',
 'open owning message':f=>frame(f,'message_stop').data.message.event.type='ping',
 'wrong formatter name':f=>frame(f,'content_block_start').data.message.event.content_block.name='OtherTool',
 'missing tool identity':f=>delete frame(f,'content_block_start').data.message.event.content_block.id,
 'wrong block index':f=>frame(f,'content_block_start').data.message.event.index=-1,
 'conflicting typed alias':f=>sdk(f).find(e=>e.data.message.type==='assistant').data.message.message.content[0].input={different:true},
 'renamed typed owning tool':f=>sdk(f).find(e=>e.data.message.type==='assistant').data.message.message.content[0].name='OtherTool',
 'nonassistant typed owning role':f=>sdk(f).find(e=>e.data.message.type==='assistant').data.message.message.role='user',
 'opaque owning tool collision':f=>{const start=frame(f,'content_block_start'),copy=structuredClone(start),stop=structuredClone(frame(f,'content_block_stop'));copy.id=randomUUID();copy.data.message.uuid=randomUUID();copy.data.message.event.index=1;copy.data.message.event.content_block.name='Bash';stop.id=randomUUID();stop.data.message.uuid=randomUUID();stop.data.message.event.index=1;f.entries.splice(f.entries.indexOf(start)+1,0,copy,stop);},
 'extra malformed tagged intent':f=>{const copy=structuredClone(f.entries.find(e=>e.customType===nativeRoleEntries.intent));copy.id=randomUUID();copy.data=null;f.entries.splice(1,0,copy);},
 'null tagged SDK message':f=>sdk(f).find(e=>e.data.message.type==='assistant').data.message=null,
 'malformed tagged SDK wrapper':f=>sdk(f)[1].data=null,
 'missing request schema':f=>delete f.entries.find(e=>e.customType===nativeRoleEntries.intent).data.request.schema,
 'missing request binding':f=>delete f.entries.find(e=>e.customType===nativeRoleEntries.intent).data.request.binding,
 'invalid native turn bound':f=>f.entries.find(e=>e.customType===nativeRoleEntries.intent).data.request.maxNativeTurns=0,
 'wrong present settlement type':f=>f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.type='unknown',
 'nonobject present settlement':f=>f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data=null,
 'malformed present settlement':f=>f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation.nativeCleanup='unknown',
 'retracted owning frame':f=>sdk(f).at(-1).data.message.retracted_message_uuids=[frame(f,'content_block_start').data.message.uuid],
 'retracted owning message':f=>sdk(f).at(-1).data.message.retracted_message_uuids=[f.source.nativeMessageId],
 'aborted owning frame':f=>frame(f,'content_block_delta').data.message.aborted=true,
 'errored initialization':f=>sdk(f)[0].data.message.error='failed',
 'subagent initialization':f=>sdk(f)[0].data.message.parent_tool_use_id='subagent',
 'missing owning frame UUID':f=>delete frame(f,'content_block_start').data.message.uuid,
 'duplicate owning frame UUID':f=>frame(f,'content_block_delta').data.message.uuid=frame(f,'content_block_start').data.message.uuid,
 'repeated block stop':f=>{const original=frame(f,'content_block_stop'),copy=structuredClone(original);copy.id=randomUUID();copy.data.message.uuid=randomUUID();f.entries.splice(f.entries.indexOf(original),0,copy);},
 'retracted typed owning assistant':f=>{const assistant=sdk(f).find(e=>e.data.message.type==='assistant');sdk(f).at(-1).data.message.retracted_message_uuids=[assistant.data.message.uuid];},
};
for(const [name,mutate]of Object.entries(mutations))test('historical formatter refuses '+name+' even with refreshed settlement digest',()=>{const f=captured({settled:true});mutate(f);refresh(f);assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);});
test('historical formatter refuses sparse sequence without depending on settlement digest',()=>{const f=captured();sdk(f)[2].data.sequence=99;assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);});

// The caller separately proves terminated host ownership. This reader grants
// only exact received-source provenance, never complete-call authority.
test('terminated formatter prefix retains exact arguments while complete-call reading stays strict',()=>{
 const f=captured({open:true}),result=readTerminatedFormatterPrefix(f.entries,f.expected,f.source.sourceEntryId);
 assert.equal(result.material.raw,f.raw);assert.equal(result.material.complete,false);assert.equal(result.material.invalid,true);
 assert.equal(Object.hasOwn(result,'querySettlement'),false);assert.throws(()=>read(f),/incomplete or foreign/);
 const complete=captured();assert.throws(()=>readTerminatedFormatterPrefix(complete.entries,complete.expected,complete.source.sourceEntryId),/incomplete or foreign/);
});
for(const name of ['missing checkpoint','foreign session','foreign launch','changed schema commitment','missing intent','foreign SDK intent','foreign native frame session','subagent frame','wrong formatter name','missing tool identity','wrong block index','extra malformed tagged intent','null tagged SDK message','malformed tagged SDK wrapper','missing request schema','missing request binding','invalid native turn bound','retracted owning message','aborted owning frame','errored initialization','subagent initialization','missing owning frame UUID','duplicate owning frame UUID'])test('terminated formatter prefix rejects '+name,()=>{
 const f=captured({open:true});
 if(name==='null tagged SDK message')sdk(f)[1].data.message=null;else mutations[name](f);
 assert.throws(()=>readTerminatedFormatterPrefix(f.entries,f.expected,f.source.sourceEntryId),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
});
test('terminated formatter prefix refuses resumed owning messages and incomplete foreign blocks',()=>{
 const resumed=captured({open:true,laterOpen:true});assert.throws(()=>readTerminatedFormatterPrefix(resumed.entries,resumed.expected,resumed.source.sourceEntryId),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/);
 const f=captured({open:true}),start=structuredClone(frame(f,'content_block_start'));start.id=randomUUID();start.data.message.uuid=randomUUID();start.data.message.event.index=1;start.data.message.event.content_block={type:'text',text:''};f.entries.push(start);refresh(f);f.expected.checkpointLeafId=start.id;
 assert.throws(()=>readTerminatedFormatterPrefix(f.entries,f.expected,f.source.sourceEntryId),/one open owning argument block/);
});

test('malformed control retained after capture stop cannot downgrade to absent prefix proof',()=>{
 const f=captured();assert.equal(read(f).querySettlement,'not-attested');
 let remaining=8*1024*1024-sdk(f).reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.message)),0);
 while(remaining){const amount=Math.min(1024*1024,remaining),message={type:'system',subtype:'capture-fill',uuid:randomUUID(),session_id:sdk(f)[0].data.message.session_id,data:''};message.data='x'.repeat(amount-Buffer.byteLength(JSON.stringify(message)));f.collector.observe(message);remaining-=amount;}
 assert.throws(()=>f.collector.observe({type:'system',subtype:'crossing',uuid:randomUUID(),session_id:sdk(f)[0].data.message.session_id}),/NATIVE_CAPTURE_LIMIT_RETAINED/);
 f.entries=parseSessionEntries([f.manager.getHeader(),...f.manager.getBranch()].map(e=>JSON.stringify(e)).join('\n'));f.expected.checkpointLeafId=f.entries.at(-1).id;
 assert.equal(read(f).querySettlement,'not-attested','Earlier complete original claims remain readable as unattested prefix');
 const messages=sdk(f),receipt={type:'gitjig.native-query-settled/v1',ownerSessionId:f.manager.getSessionId(),queryId:randomUUID(),nativeSessionId:messages[0].data.message.session_id,nativeCleanup:'confirmed',format:{request:f.intent,requestDigest:sha(JSON.stringify(f.intent)),schemaDigest:sha(JSON.stringify(f.intent.schema))},messages:messages.length,messageDigest:'0'.repeat(64)};
 assert.throws(()=>f.collector.observe(receipt),/original cleanup receipt is invalid/);
 f.entries=parseSessionEntries([f.manager.getHeader(),...f.manager.getBranch()].map(e=>JSON.stringify(e)).join('\n'));f.expected.checkpointLeafId=f.entries.at(-1).id;
 assert.deepEqual(f.entries.find(e=>e.customType===nativeRoleEntries.settlement).data.attestation,receipt);
 assert.throws(()=>read(f),/NATIVE_FORMAT_SOURCE_UNAVAILABLE/,'Present bad control is never treated as absent');
 assert.throws(()=>f.collector.select(),/capture stopped/);
});
