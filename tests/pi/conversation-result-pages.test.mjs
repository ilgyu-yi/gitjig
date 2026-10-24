import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { nativeConversationResult, nativeResultBytes } from '../../dist/pi/conversation-result.js';
import { createCoordinationTools } from '../../dist/pi/coordination.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const { createToolServer } = await import(new URL('./mcp-server.js', import.meta.resolve('@gitjig/pi-claude-bridge-host')).href);
const value = { resultId:'exact-result', conversationId:'original-child', workId:'original-work', assignmentId:'original-assignment', publicationHash:'a'.repeat(64), result:{ phase:'BLOCKED', epoch:4, reviewReady:false, blocked:['Independent source-fit decision omitted actual input exact-input'], nextAction:'Request fresh independent original procedure', detail:'한😀\\\"\u0000'.repeat(3000) } };
function subject(read=()=>value) { let calls=0; const tool=createCoordinationTools({status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),result(input){calls++;assert.deepEqual(input,{resultId:'exact-result'});return read();}},()=>{}).find(t=>t.name==='conversation_result'); return {tool,get calls(){return calls}}; }
const validated=(tool,args)=>validateToolArguments(tool,{type:'toolCall',name:tool.name,id:'original-call',arguments:args});
const text=result=>{assert.equal(result.content.length,1);const s=result.content[0].text;assert.ok(Buffer.byteLength(s)<=nativeResultBytes);return s};
test('small legacy result is byte-identical and large summary preserves full blockers and paging identity',()=>{
 const small={resultId:'x',result:{phase:'BLOCKED',blocked:['reason']}};assert.equal(nativeConversationResult(small,{resultId:'x'}),JSON.stringify(small));
 const s=JSON.parse(nativeConversationResult(value,{resultId:'exact-result'}));assert.equal(s.kind,'conversation-result-summary/v1');assert.deepEqual(s.result.blocked,value.result.blocked);assert.equal(s.result.nextAction,value.result.nextAction);assert.equal(s.result.reviewReady,false);assert.equal(s.omitted.blocked,0);assert.equal(s.fullJSON.bytes,Buffer.byteLength(JSON.stringify(value)));assert.equal(s.fullJSON.fingerprint,createHash('sha256').update(JSON.stringify(value)).digest('hex'));
});
test('worst-case escaping pages reconstruct exact UTF8 JSON through original Pi validation and scoped callback per page',async()=>{
 const s=subject(),summary=JSON.parse(text(await s.tool.execute('summary',validated(s.tool,{resultId:'exact-result'}))));let cursor=0,body='',count=0;
 do {const page=JSON.parse(text(await s.tool.execute('page-'+count,validated(s.tool,{resultId:'exact-result',cursor,fingerprint:summary.fullJSON.fingerprint}))));assert.equal(page.cursor,cursor);assert.equal(page.fingerprint,summary.fullJSON.fingerprint);body+=page.text;cursor=page.nextCursor;count++;assert.ok(count<150);}while(cursor!==null);
 assert.equal(body,JSON.stringify(value));assert.deepEqual(JSON.parse(body),value);assert.equal(s.calls,count+1);
});
test('summary omits whole oversized diagnostics explicitly rather than cutting opaque text',()=>{
 const large={...value,result:{...value.result,blocked:['ID'.repeat(10000),'another blocker'],nextAction:'action'.repeat(3000)}};const s=JSON.parse(nativeConversationResult(large,{resultId:'exact-result'}));assert.deepEqual(s.result.blocked,[]);assert.equal(s.omitted.blocked,2);assert.equal(s.omitted.nextAction,1);assert.equal(s.result.nextAction,null);assert.ok(Buffer.byteLength(JSON.stringify(s))<=nativeResultBytes);
});
test('strict hash/cursor, scope drift and cancellation refuse without callback operand widening',async()=>{
 let allowed=true;const s=subject(()=>{if(!allowed)throw Error('outside captured scope');return value});const hash=JSON.parse(nativeConversationResult(value,{resultId:'exact-result'})).fullJSON.fingerprint;
 for(const args of [{cursor:0},{fingerprint:hash},{cursor:1,fingerprint:'b'.repeat(64)},{cursor:Buffer.byteLength(JSON.stringify(value)),fingerprint:hash}])await assert.rejects(s.tool.execute('bad',{resultId:'exact-result',...args}),/fingerprint|cursor/);
 const utf8=Buffer.from(JSON.stringify(value)),continuation=utf8.findIndex(x=>(x&0xc0)===0x80);await assert.rejects(s.tool.execute('utf8',{resultId:'exact-result',cursor:continuation,fingerprint:hash}),/cursor/);
 for(const args of [{cursor:-1,fingerprint:hash},{cursor:0.5,fingerprint:hash},{cursor:0,fingerprint:'no'},{cursor:0,fingerprint:hash,actor:'forged'}])assert.throws(()=>validated(s.tool,{resultId:'exact-result',...args}));
 allowed=false;await assert.rejects(s.tool.execute('scope',{resultId:'exact-result',cursor:0,fingerprint:hash}),/outside captured scope/);
 const abort=new AbortController();abort.abort();const before=s.calls;await assert.rejects(s.tool.execute('aborted',{resultId:'exact-result'},abort.signal));assert.equal(s.calls,before);
const during=new AbortController();const late2=subject(()=>{during.abort();return value});await assert.rejects(late2.tool.execute('late',{resultId:'exact-result'},during.signal));
});
test('original packaged MCP transport preserves flat strict page schema and bounded exact page text',async()=>{
 const s=subject(),pending=new Map(),server=createToolServer('result-pages',[{name:s.tool.name,description:s.tool.description,inputSchema:s.tool.parameters,handler:async id=>s.tool.execute(id,validated(s.tool,pending.get(id)))}]),client=new Client({name:'result-pages',version:'1'},{capabilities:{}}),[left,right]=InMemoryTransport.createLinkedPair();
 try{await Promise.all([server.instance.connect(right),client.connect(left)]);const listed=(await client.listTools()).tools[0];assert.equal(listed.inputSchema.additionalProperties,false);assert.deepEqual(listed.inputSchema.required,['resultId']);pending.set('summary',{resultId:'exact-result'});const summary=JSON.parse(text(await client.callTool({name:s.tool.name,arguments:pending.get('summary'),_meta:{'claudecode/toolUseId':'summary'}})));pending.set('page',{resultId:'exact-result',cursor:0,fingerprint:summary.fullJSON.fingerprint});const page=JSON.parse(text(await client.callTool({name:s.tool.name,arguments:pending.get('page'),_meta:{'claudecode/toolUseId':'page'}})));assert.equal(page.kind,'conversation-result-page/v1');assert.equal(page.cursor,0);assert.equal(s.calls,2);}finally{await Promise.allSettled([client.close(),server.instance.close()])}
});
test('full native read retains the original128KiB ceiling and changed content refuses an old fingerprint',async()=>{
 assert.throws(()=>nativeConversationResult(undefined,{resultId:'exact-result'}),/128KiB|undefined/);
 assert.throws(()=>nativeConversationResult({payload:'x'.repeat(128*1024)},{resultId:'exact-result'}),/128KiB/);
 const hash=JSON.parse(nativeConversationResult(value,{resultId:'exact-result'})).fullJSON.fingerprint;
 const changed=subject(()=>({...value,previous:'new-original-result'}));await assert.rejects(changed.tool.execute('changed',{resultId:'exact-result',cursor:0,fingerprint:hash}),/fingerprint/);assert.equal(changed.calls,1);
});
test('summary uses the one captured serialization and preserves bounded ordinary unavailable metadata',()=>{
 const ordinary={...value,result:{status:'failed',failure:'Original producer unavailable',cleanup:'removed',coordinatorReport:{kind:'ordinary-coordinator-report/v1',state:'unavailable',code:'REPORT_NOT_SUBMITTED',text:[{type:'text',text:'large'.repeat(4000)}]}}};
 const summary=JSON.parse(nativeConversationResult({toJSON(){return ordinary}},{resultId:'exact-result'}));assert.equal(summary.result.outcome.status,'failed');assert.equal(summary.result.outcome.failure,'Original producer unavailable');assert.equal(summary.result.outcome.cleanup,'removed');assert.equal(summary.result.outcome.coordinatorReport.state,'unavailable');assert.equal(summary.result.outcome.coordinatorReport.code,'REPORT_NOT_SUBMITTED');assert.equal(summary.result.outcome.coordinatorReport.omittedFields,2);assert.deepEqual(summary.omitted.outcomeFields,[]);
 const huge={...ordinary,result:{...ordinary.result,failure:'fault'.repeat(3000)}};const omitted=JSON.parse(nativeConversationResult(huge,{resultId:'exact-result'}));assert.ok(omitted.omitted.outcomeFields.includes('failure'));assert.equal(omitted.result.outcome.failure,undefined);
});
