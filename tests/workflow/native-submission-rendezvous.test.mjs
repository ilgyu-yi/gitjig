import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeRoleCollector} from '../../dist/workflow/native-role-output.js';
import {nativeSubmissionToolName} from '../../dist/workflow/native-submission-source.js';
const raw=JSON.stringify({version:1,summary:'Original observed call',findings:[],assessedScope:[]});
function fixture(t){
 const manager=SessionManager.inMemory('/controlled-source-rendezvous'),launchId=randomUUID(),signal=new AbortController();t.after(()=>signal.abort(Error('Original test owner closed')));
 const collector=new NativeRoleCollector(manager,{version:3,carrier:'tool-submission/v1',requestId:launchId,binding:{launchId,role:'planner',stage:'planning',inputDigest:createHash('sha256').update('input').digest('hex')},schema:{type:'object'},maxNativeTurns:4});
 const sid='native-'+randomUUID(),observe=m=>collector.observe({uuid:randomUUID(),session_id:sid,parent_tool_use_id:null,...m}),event=e=>observe({type:'stream_event',event:e});
 observe({type:'system',subtype:'init',tools:[nativeSubmissionToolName],mcp_servers:[{name:'custom-tools',status:'connected'}],plugins:[]});
 const start=(id,name=nativeSubmissionToolName)=>{event({type:'message_start',message:{id:'message-'+id,role:'assistant',content:[]}});event({type:'content_block_start',index:0,content_block:{type:'tool_use',id,name,input:{}}});};
 const close=()=>{event({type:'content_block_stop',index:0});event({type:'message_stop'});};
 const submit=id=>collector.submitObserved(id,JSON.parse(raw),()=>[],signal.signal);
 return{collector,signal,observe,event,start,close,submit};
}
test('submission waits for original raw cohort and releases once its actual source is complete',{timeout:2000},async t=>{
 const f=fixture(t);let done=false;const waiting=f.submit('call').then(value=>{done=true;return value;});await Promise.resolve();assert.equal(done,false);
 f.start('call');f.event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});await Promise.resolve();assert.equal(done,false);
 f.close();assert.equal(JSON.parse(await waiting).provisional,true);
});
for(const kind of ['incomplete','wrong-tool'])test('closed owning cohort refuses '+kind+' without waiting for nonexistent future bytes',{timeout:2000},async t=>{
 const f=fixture(t),waiting=f.submit('call');f.start('call',kind==='wrong-tool'?'mcp__wrong__tool':nativeSubmissionToolName);
 if(kind==='wrong-tool')f.event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});
 f.close();await assert.rejects(waiting,/complete original submission arguments unavailable|Unsupported|unavailable/);
});
test('a never-observed RPC id is cancelled by its original owner and leaves no pending reservation',{timeout:2000},async t=>{
 const f=fixture(t),waiting=f.submit('never-observed');f.signal.abort(Error('Original query cancelled'));await assert.rejects(waiting,/Original query cancelled/);
 const next=new AbortController();f.start('next');f.event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});f.close();
 assert.equal(JSON.parse(await f.collector.submitObserved('next',JSON.parse(raw),()=>[],next.signal)).provisional,true);
});
test('original terminal observation closes an unbound source wait',{timeout:2000},async t=>{
 const f=fixture(t),waiting=f.submit('never-observed');f.observe({type:'result',subtype:'error_during_execution',is_error:true});await assert.rejects(waiting,/source closed/);
});
test('owned close ends a pending source wait without a successful submission',{timeout:2000},async t=>{
 const f=fixture(t),waiting=f.submit('never-observed');f.observe({type:'gitjig.native-query-settled/v1',nativeCleanup:'confirmed'});await assert.rejects(waiting,/source closed/);
});

test('RPC arriving after block closure still awaits original owning message closure',{timeout:2000},async t=>{
 const f=fixture(t);f.start('late');f.event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});f.event({type:'content_block_stop',index:0});
 let done=false;const waiting=f.submit('late').then(value=>{done=true;return value;});await Promise.resolve();await Promise.resolve();assert.equal(done,false);
 f.event({type:'message_stop'});assert.equal(JSON.parse(await waiting).provisional,true);
});

test('an already accepted submission rejects another RPC without waiting for new source bytes',{timeout:2000},async t=>{
 const f=fixture(t);f.start('first');f.event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:raw}});f.close();assert.equal(JSON.parse(await f.submit('first')).provisional,true);
 await assert.rejects(f.submit('never-received-second'),/already submitted/);
});
