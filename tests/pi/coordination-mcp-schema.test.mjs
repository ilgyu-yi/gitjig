/** Original packaged MCP transport plus original Pi validation; no provider/native/SDK query or engine. */
import test from 'node:test';import assert from 'node:assert/strict';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createCoordinationTools} from '../../dist/pi/coordination.js';
// Resolve the import-only public package entry, then read its exact packaged MCP sibling.
const hostEntry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {createToolServer}=await import(new URL('./mcp-server.js',hostEntry).href);
const base={projectId:'P-owned',instructions:'Inspect exact bounded owner source'};
function subject(){const calls=[],callbacks={status:()=>({}),address:()=>({}),assign(input){calls.push(input);return{assignmentId:'owned-result',state:'QUEUED'}},acknowledgeInput:()=>({}),result:()=>({}),integrate:()=>({}),publish:()=>({}),publishContribution:()=>({}),effectInspect:()=>({}),effectReconcile:()=>({}),recoverAssignment:()=>({}),cancel:()=>({}),parent:()=>({}),wait:()=>({})};const tools=createCoordinationTools(callbacks,()=>{}),assign=tools.find(t=>t.name==='conversation_assign');return{calls,tools,assign};}
const good=[{...base},{...base,resultDependency:true,operation:'change'},{...base,conversationId:'existing-child',observedDirectionRevision:0,operation:'investigate'}];
const bad=[{...base,conversationId:'missing-revision'},{...base,observedDirectionRevision:0},{...base,conversationId:'mixed',observedDirectionRevision:0,unknown:'reject'}, {...base,unknown:'reject'}, {...base,operation:'bypass-review'}, {...base,conversationId:'existing',observedDirectionRevision:-1}, {...base,conversationId:null,observedDirectionRevision:null}, {...base,conversationId:null}, {...base,observedDirectionRevision:null}];
const toolCall=(args,id='test-call')=>({type:'toolCall',name:'conversation_assign',id,arguments:args});
test('coordination assignment remains the exact strict two-branch Pi grammar with MCP object root',async()=>{const s=subject();assert.equal(s.assign.parameters.type,'object');assert.equal(s.assign.parameters.anyOf.length,2);assert.equal(s.assign.parameters.properties,undefined,'Do not flatten optionals and change Pi optional-null normalization');assert.ok(s.assign.parameters.anyOf.every(x=>x.type==='object'&&x.additionalProperties===false));
 for(const input of good){const before=s.calls.length,validated=validateToolArguments(s.assign,toolCall(input));await s.assign.execute('actual-call',validated,new AbortController().signal);assert.equal(s.calls.length,before+1);assert.deepEqual(s.calls.at(-1),input);}
 for(const input of bad){const before=s.calls.length;assert.throws(()=>validateToolArguments(s.assign,toolCall(input)));assert.equal(s.calls.length,before,'Invalid arguments never reach captured assignment closure');}
 const aborted=new AbortController();aborted.abort();await assert.rejects(s.assign.execute('aborted',good[0],aborted.signal));assert.equal(s.calls.length,good.length);
});
test('original packaged MCP tools/list preserves object+anyOf and transports healthy/invalid Pi arguments by exact tool-use ID',async()=>{const s=subject(),pending=new Map();let calls=0;const definitions=s.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.parameters,handler:async id=>{const item=pending.get(id);assert.ok(item,'Actual captured tool-use ID required');calls++;try{const args=validateToolArguments(t,{type:'toolCall',id,name:t.name,arguments:item});return await t.execute(id,args,new AbortController().signal)}catch{return{content:[{type:'text',text:'Pi argument validation refused'}],isError:true}}}}));const server=createToolServer('coordination-schema',definitions),client=new Client({name:'coordination-schema-consumer',version:'1'},{capabilities:{}}),[left,right]=InMemoryTransport.createLinkedPair();
 try{await Promise.all([server.instance.connect(right),client.connect(left)]);const listing=await client.listTools();assert.equal(listing.tools.length,s.tools.length);for(const t of listing.tools){assert.equal(t.inputSchema.type,'object');assert.deepEqual(t.inputSchema,JSON.parse(JSON.stringify(s.tools.find(x=>x.name===t.name).parameters)))}
  for(const [i,input]of good.entries()){const id='healthy-'+i;pending.set(id,input);const result=await client.callTool({name:'conversation_assign',arguments:input,_meta:{'claudecode/toolUseId':id}});assert.notEqual(result.isError,true);assert.deepEqual(s.calls.at(-1),input)}
  const count=s.calls.length;for(const [i,input]of bad.entries()){const id='refused-'+i;pending.set(id,input);const result=await client.callTool({name:'conversation_assign',arguments:input,_meta:{'claudecode/toolUseId':id}});assert.equal(result.isError,true)}assert.equal(s.calls.length,count);assert.equal(calls,good.length+bad.length);
 }finally{await Promise.allSettled([client.close(),server.instance.close()])}
});


test('reconciliation tool forwards its actual cancellation signal through captured native controls',async()=>{
 const abort=new AbortController();let entered,received;
 const started=new Promise(resolve=>entered=resolve);
 const tools=createCoordinationTools({status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),effectReconcile:async(input,signal)=>{
  received={input,signal};entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }},()=>{}),tool=tools.find(t=>t.name==='effect_reconcile');
 const task=tool.execute('actual-reconciliation-tool',{operationId:'original-op'},abort.signal);void task.catch(()=>{});await started;
 assert.equal(received.signal,abort.signal);assert.deepEqual(received.input,{operationId:'original-op'});abort.abort(new Error('Cancel original read'));await assert.rejects(task,/Cancel original read/);
});

test('task recovery tool accepts only explicit original operands; actor and source come from the captured host',async()=>{
 const calls=[],tools=createCoordinationTools({status:()=>({}),address:()=>({}),assign:()=>({}),acknowledgeInput:()=>({}),recoverAssignment(input){calls.push(input);return {state:'RECOVERY_READY'};}},()=>{}),tool=tools.find(t=>t.name==='conversation_recover_assignment');assert.ok(tool);assert.equal(tool.parameters.additionalProperties,false);assert.deepEqual([...tool.parameters.required].sort(),['assignmentId','expectedWorkEpoch','observedDirectionRevision','reason']);
 const good={assignmentId:'original-assignment',expectedWorkEpoch:2,observedDirectionRevision:0,reason:'Restore exactly this task'},call=args=>({type:'toolCall',name:tool.name,id:'recover',arguments:args});
 await tool.execute('recover',validateToolArguments(tool,call(good)),new AbortController().signal);assert.deepEqual(calls,[good]);
 for(const input of [{...good,actor:{runId:'forged'}},{...good,sourceId:'replacement'},{...good,expectedWorkEpoch:0},{...good,observedDirectionRevision:-1},{...good,reason:''},{...good,reason:'x'.repeat(4097)},(({reason,...rest})=>rest)(good)])assert.throws(()=>validateToolArguments(tool,call(input)));assert.equal(calls.length,1);
});
