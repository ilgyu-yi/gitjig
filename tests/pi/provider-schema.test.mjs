/** Portable current-package regression: actual2020 validators, original Pi and original MCP transport. No native/query. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {createCoordinationTools} from '../../dist/pi/coordination.js';
const entry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',entry)));assert.equal(pkg.version,'0.9.0-gitjig.11','Use only reviewed current package; no historical-host fallback');
const{hostedProviderParameters:lower}=await import(new URL('./provider-schema.js',entry));
const{createToolServer}=await import(new URL('./mcp-server.js',entry));
const validator=new AjvJsonSchemaValidator(new Ajv2020({strict:true,validateSchema:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false}));
const json=x=>JSON.parse(JSON.stringify(x)),base={projectId:'P-owned',instructions:'Inspect actual bounded source'};
const cases=[
 ['new',base,true],['shared-optionals',{...base,resultDependency:true,operation:'change'},true],['existing',{...base,conversationId:'child',observedDirectionRevision:0},true],['max-revision',{...base,conversationId:'child',observedDirectionRevision:Number.MAX_SAFE_INTEGER},true],
 ['only-id',{...base,conversationId:'child'},false],['only-revision',{...base,observedDirectionRevision:0},false],['id-null',{...base,conversationId:null,observedDirectionRevision:0},false],['revision-null',{...base,conversationId:'child',observedDirectionRevision:null},false],['both-null',{...base,conversationId:null,observedDirectionRevision:null},false],
 ['id-alone-null',{...base,conversationId:null},false],['revision-alone-null',{...base,observedDirectionRevision:null},false],['empty-project',{...base,projectId:''},false],['empty-instructions',{...base,instructions:''},false],['missing-common',{instructions:'bounded'},false],['missing-instructions',{projectId:'P-owned'},false],['unknown-key',{...base,unknown:true},false],['negative-revision',{...base,conversationId:'child',observedDirectionRevision:-1},false],['fractional-revision',{...base,conversationId:'child',observedDirectionRevision:0.5},false],['over-id',{...base,conversationId:'x'.repeat(513),observedDirectionRevision:0},false],['over-revision',{...base,conversationId:'child',observedDirectionRevision:Number.MAX_SAFE_INTEGER+1},false],['operation',{...base,operation:'bypass'},false],['boolean-null',{...base,resultDependency:null},false],['operation-null',{...base,operation:null},false],['raw-string-revision',{...base,conversationId:'child',observedDirectionRevision:'0'},false],['raw-string-bool',{...base,resultDependency:'false'},false],['non-object',[],false],
];
function subject(){const calls=[],tools=createCoordinationTools({status:()=>({}),address:()=>({}),assign(input){calls.push(json(input));return{assignmentId:'owned',state:'QUEUED'};},acknowledgeInput:()=>({})},()=>{});return{calls,tool:tools.find(t=>t.name==='conversation_assign')};}
const call=(t,input)=>({type:'toolCall',name:t.name,id:'owned-call',arguments:input});
function originalPi(t,input){try{return{valid:true,args:validateToolArguments(t,call(t,input))};}catch{return{valid:false};}}
test('strict2020 raw equivalence including singleton refusal; metadata request preserves original Pi refs/symbols/coercion',()=>{
 const{tool}=subject(),parameters=tool.parameters,keys=Reflect.ownKeys(parameters),descriptors=Object.getOwnPropertyDescriptors(parameters),body=JSON.stringify(parameters),baseline=cases.map(([,input])=>originalPi(tool,input)),flat=lower(parameters);
 assert.notEqual(flat,parameters);assert.equal(flat.anyOf,undefined);assert.equal(flat.oneOf,undefined);assert.equal(flat.allOf,undefined);assert.equal(flat.type,'object');assert.equal(flat.additionalProperties,false);assert.deepEqual(json(flat.required),['projectId','instructions']);assert.deepEqual(json(flat.dependentRequired),{conversationId:['observedDirectionRevision'],observedDirectionRevision:['conversationId']});
 const oldCheck=validator.getValidator(json(parameters)),newCheck=validator.getValidator(json(flat));
 for(const[label,input,expected]of cases){const original=json(input),a=json(input),b=json(input);assert.equal(oldCheck(a).valid,expected,'original raw '+label);assert.equal(newCheck(b).valid,expected,'flat raw '+label);assert.deepEqual(a,original);assert.deepEqual(b,original);}
 assert.equal(tool.parameters,parameters);assert.equal(JSON.stringify(parameters),body);assert.equal(parameters.properties,undefined);assert.deepEqual(Reflect.ownKeys(parameters),keys);assert.deepEqual(Object.getOwnPropertyDescriptors(parameters),descriptors);assert.deepEqual(cases.map(([,input])=>originalPi(tool,input)),baseline,'Pi normalized argument/error outcomes remain original, separately from raw schema');
 const originalLeaves=parameters.anyOf.find(x=>'conversationId' in x.properties).properties;for(const key of Object.keys(originalLeaves))assert.deepEqual(json(flat.properties[key]),json(originalLeaves[key]));
 assert.equal(originalPi(tool,cases[2][1]).valid,true);for(const label of ['only-id','only-revision','both-null','id-alone-null','revision-alone-null','unknown-key'])assert.equal(originalPi(tool,cases.find(x=>x[0]===label)[1]).valid,false,'Known actual Pi refusal '+label);
});
test('unsupported structural class refuses without mutation; ordinary schema exact and own prototype-named keys safe',()=>{
 const{tool}=subject(),seed=json(tool.parameters),large=seed.anyOf.find(x=>'conversationId'in x.properties),small=seed.anyOf.find(x=>!('conversationId'in x.properties));
 const edits=[
 x=>x.anyOf.push(json(x.anyOf[0])),x=>{x.oneOf=x.anyOf;delete x.anyOf;},x=>{x.allOf=x.anyOf;delete x.anyOf;},x=>x.properties={},
 x=>x.minProperties=1,x=>x.anyOf[0].additionalProperties=true,x=>x.anyOf[0].minProperties=1,x=>x.anyOf[0].properties.instructions.maxLength=1,
 x=>x.anyOf.find(b=>'conversationId'in b.properties).required=x.anyOf.find(b=>'conversationId'in b.properties).required.filter(k=>k!=='observedDirectionRevision'),
 x=>x.anyOf.find(b=>!('conversationId'in b.properties)).required=['projectId'],x=>x.anyOf[0].properties.instructions={$ref:'#/$defs/thing'},
 x=>x.anyOf[0].properties.instructions.$id='https://unselected.invalid/context',x=>x.anyOf[0].title='conditional-annotation-unhandled',
 x=>x.anyOf[0].required.push(x.anyOf[0].required[0]),x=>x.anyOf=[json(large),json(large)],
 ];
 for(const edit of edits){const value=json(seed);edit(value);const before=json(value);assert.throws(()=>lower(value),/BRIDGE_HOST_PROVIDER_SCHEMA_UNSUPPORTED/);assert.deepEqual(value,before);}
 const ordinary={type:'object',properties:{value:{type:'string'}},required:['value']};assert.equal(lower(ordinary),ordinary);
 const safe={type:'object',anyOf:[{type:'object',properties:JSON.parse('{"value":{"type":"number"},"__proto__":{"type":"string"},"paired":{"type":"integer"}}'),required:['value','__proto__','paired'],additionalProperties:false},{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}]};const result=lower(safe);assert.equal(Object.getPrototypeOf(result.properties),null);assert.ok(Object.hasOwn(result.properties,'__proto__'));assert.deepEqual(result.dependentRequired.__proto__,['paired']);assert.equal(Object.prototype.polluted,undefined);assert.deepEqual(small.required,['projectId','instructions']);
});
test('original MCP tools/list carries exact flat metadata and ID-bound original Pi execution/abort authority closure',async()=>{
 const s=subject(),parameters=s.tool.parameters,before=JSON.stringify(parameters),metadata=lower(parameters),pending=new Map();let callbackAttempts=0;
 const server=createToolServer('metadata194',[{name:s.tool.name,description:s.tool.description,inputSchema:metadata,handler:async id=>{assert.ok(pending.has(id));callbackAttempts++;try{return await s.tool.execute(id,validateToolArguments(s.tool,call(s.tool,pending.get(id))),new AbortController().signal);}catch{return{content:[{type:'text',text:'Original Pi validation refused'}],isError:true};}}}]);
 const client=new Client({name:'metadata194',version:'1'},{capabilities:{}}),[a,b]=InMemoryTransport.createLinkedPair();
 try{await Promise.all([server.instance.connect(b),client.connect(a)]);const listing=await client.listTools();assert.equal(listing.tools.length,1);assert.deepEqual(json(listing.tools[0].inputSchema),json(metadata));const check=validator.getValidator(listing.tools[0].inputSchema);assert.equal(check({...base,conversationId:'unpaired'}).valid,false);assert.equal(check({...base,observedDirectionRevision:0}).valid,false);
  for(const [index,input]of[base,{...base,conversationId:'actual-child',observedDirectionRevision:0}].entries()){const id='actual-healthy-'+index;pending.set(id,input);assert.notEqual((await client.callTool({name:s.tool.name,arguments:input,_meta:{'claudecode/toolUseId':id}})).isError,true);assert.deepEqual(s.calls.at(-1),input);}
  const n=s.calls.length;for(const label of['only-id','only-revision','both-null','id-alone-null','revision-alone-null','unknown-key']){const input=cases.find(x=>x[0]===label)[1],id='actual-refused-'+label;pending.set(id,input);assert.equal((await client.callTool({name:s.tool.name,arguments:input,_meta:{'claudecode/toolUseId':id}})).isError,true);}assert.equal(s.calls.length,n);assert.equal(callbackAttempts,8);
  const aborted=new AbortController();aborted.abort();await assert.rejects(s.tool.execute('abort',base,aborted.signal));assert.equal(s.calls.length,n);assert.equal(s.tool.parameters,parameters);assert.equal(JSON.stringify(parameters),before);assert.equal(parameters.properties,undefined);
 }finally{await Promise.allSettled([client.close(),server.instance.close()]);}
});
