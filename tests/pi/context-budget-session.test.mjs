import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {initializePiHost,createPiSession} from '../../dist/pi/index.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'context-budget-session-'))),stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts'),workspace=path.join(root,'work');
for(const dir of [stateRoot,artifactRoot,workspace])await fs.mkdir(dir,{mode:0o700});
process.env.TMPDIR=artifactRoot;const host=await initializePiHost({stateRoot,artifactRoot});
const usage={input:4,output:3,cacheRead:0,cacheWrite:0,totalTokens:7,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let serial=0;
function fixture(){
 const calls=[],checkpoints=[];let entries=0;
 const operations={workspaceRoot:workspace,validatePath(value){const full=path.resolve(workspace,value),rel=path.relative(workspace,full);if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('outside owned fixture');return full;},
  async access(){},async readFile(){return Buffer.from('actual source');},async exec(_command,_cwd,{onData}){onData(Buffer.from('bounded fixture'));return{exitCode:0};},async writeFile(){},async mkdir(){}};
 const model={provider:'context-fixture-'+(++serial),modelId:'original',definition:{api:'context-fixture-api',baseUrl:'http://unused.invalid',apiKey:'fixture-only',models:[{id:'original',name:'original',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(selected,context){
  calls.push({selected,budget:assertModelContextBudget(selected,context),wire:JSON.stringify(context)});const stream=createAssistantMessageEventStream();
  queueMicrotask(()=>{const message={role:'assistant',content:[{type:'text',text:'bounded result'}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;
 }}};
 return{calls,checkpoints,entries:()=>entries,options:{host,operations,model,systemPrompt:'Use the owned fixture only.',maxReadBytes:1024,roleContextBudget:{assertEntry(){entries++;}},beforeModelRequest:async manager=>{checkpoints.push(manager.getLeafId());}}};
}
function lastError(product){return product.session.messages.filter(message=>message.role==='assistant').at(-1)?.errorMessage??'';}
test('actual post-transform SDK context reaches one checkpoint and original stream without rewriting',async()=>{
 const f=fixture();let finalContext,checkpointBudget,checkpointWire;
 const p=await createPiSession({...f.options,requestLanguagePolicy:()=> 'Owned language policy marker',beforeModelRequest:async manager=>{f.checkpoints.push(manager.getLeafId());checkpointBudget=assertModelContextBudget(p.session.agent.state.model,finalContext);checkpointWire=JSON.stringify(finalContext);}});
 const transform=p.session.agent.transformContext;
 p.session.agent.transformContext=async(messages,signal)=>[...(transform?await transform(messages,signal):messages),{role:'system',content:'Post-prepare projection marker',timestamp:Date.now()}];
 const guarded=p.session.agent.streamFunction;p.session.agent.streamFunction=(model,context,options)=>{finalContext=context;return guarded(model,context,options);};
 try{await p.session.prompt('Original owner input 한국어 {request}');assert.equal(f.calls.length,1);assert.equal(f.checkpoints.length,1);assert.ok(f.checkpoints[0]);assert.deepEqual(f.calls[0].budget,checkpointBudget);assert.equal(f.calls[0].wire,checkpointWire);assert.match(f.calls[0].wire,/Owned language policy marker/);assert.match(f.calls[0].wire,/Post-prepare projection marker/);assert.match(f.calls[0].wire,/Original owner input 한국어/);}finally{await p.closeOwned();}
});
test('oversize original input and post-prepare projection hold before checkpoint or provider',async()=>{
 for(const projected of [false,true]){
  const f=fixture(),p=await createPiSession(f.options);
  if(projected){const transform=p.session.agent.transformContext;p.session.agent.transformContext=async(messages,signal)=>[...(transform?await transform(messages,signal):messages),{role:'user',content:[{type:'text',text:'x'.repeat(150000)}],timestamp:Date.now()}];}
  try{await p.session.prompt(projected?'small':'x'.repeat(150000));assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,0);assert.match(lastError(p),/HOST_CONTEXT_GUARD:.*MODEL_CONTEXT_LIMIT/);}finally{await p.closeOwned();}
 }
});
test('checkpoint growth and model-window widening cannot bypass the final fit guard',async()=>{
 for(const widen of [false,true]){
  const f=fixture();let target,selected;
  const p=await createPiSession({...f.options,beforeModelRequest:async manager=>{f.checkpoints.push(manager.getLeafId());target.messages.push({role:'user',content:[{type:'text',text:'x'.repeat(150000)}],timestamp:Date.now()});if(widen)selected.contextWindow=1000000;}});
  const guarded=p.session.agent.streamFunction;p.session.agent.streamFunction=(model,context,options)=>{selected={...model};target=context;return guarded(selected,context,options);};
  try{await p.session.prompt('small');assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,1,'Original admitted checkpoint must not be erased');assert.match(lastError(p),widen?/MODEL_CONTEXT_UNAVAILABLE:.*changed/:/MODEL_CONTEXT_LIMIT/);}finally{await p.closeOwned();}
 }
});
test('cancellation after checkpoint prevents the original model stream',async()=>{
 const f=fixture();let aborting;
 const p=await createPiSession({...f.options,beforeModelRequest:async manager=>{f.checkpoints.push(manager.getLeafId());aborting=p.session.abort();}});
 try{await p.session.prompt('small');await aborting;assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,1);assert.equal(p.session.messages.filter(m=>m.role==='assistant').at(-1)?.stopReason,'aborted');}finally{await p.closeOwned();}
});
test('the original request tail is owned before a reentrant entry guard seals and closes',async()=>{
 const f=fixture();let closing,p,inFinalStream=false;
 p=await createPiSession({...f.options,roleContextBudget:{assertEntry(){if(inFinalStream&&!closing)closing=p.closeOwned();}}});
 const guarded=p.session.agent.streamFunction;p.session.agent.streamFunction=(...args)=>{inFinalStream=true;return guarded(...args);};
 try{await p.session.prompt('small');assert.ok(closing);await closing;assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,0);}finally{await p.closeOwned();}
});
test('ordinary request checkpoint policy remains available without the governed-role flag',async()=>{
 const f=fixture(),options={...f.options};delete options.roleContextBudget;
 const p=await createPiSession(options);try{await p.session.prompt('ordinary request');assert.equal(f.calls.length,1);assert.equal(f.checkpoints.length,1);assert.equal(f.entries(),0);}finally{await p.closeOwned();}
});

test('governed roles require the original checkpoint before asynchronous construction',async()=>{
 const f=fixture();delete f.options.beforeModelRequest;
 await assert.rejects(createPiSession(f.options),/requires the original request checkpoint/);
});
test('original provider failures keep their attribution after dispatch begins',async()=>{
 const f=fixture();let dispatched=0;
 f.options.model.definition.streamSimple=()=>{dispatched++;throw Error('ORIGINAL_PROVIDER_THROW');};
 const p=await createPiSession(f.options);
 try{await p.session.prompt('small');assert.equal(dispatched,1);assert.equal(f.checkpoints.length,1);assert.match(lastError(p),/ORIGINAL_PROVIDER_THROW/);assert.doesNotMatch(lastError(p),/HOST_CONTEXT_GUARD/);}finally{await p.closeOwned();}
});
test('signal-only cancellation in either final entry callback prevents dispatch',async()=>{
 for(const abortAt of [1,2]){
  const f=fixture();let p,inFinalStream=false,finalEntries=0;
  p=await createPiSession({...f.options,roleContextBudget:{assertEntry(){if(inFinalStream&&++finalEntries===abortAt)p.session.agent.abort();}}});
  const guarded=p.session.agent.streamFunction;p.session.agent.streamFunction=(...args)=>{inFinalStream=true;return guarded(...args);};
  try{await p.session.prompt('small');assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,abortAt-1);assert.equal(finalEntries,abortAt);}finally{await p.closeOwned();}
 }
});

test('checkpoint cannot replace the original request cancellation signal',async()=>{
 const f=fixture();let requestOptions;
 const p=await createPiSession({...f.options,beforeModelRequest:async manager=>{f.checkpoints.push(manager.getLeafId());requestOptions.signal=new AbortController().signal;}});
 const guarded=p.session.agent.streamFunction;p.session.agent.streamFunction=(model,context,options)=>{requestOptions=options;return guarded(model,context,options);};
 try{await p.session.prompt('small');assert.equal(f.calls.length,0);assert.equal(f.checkpoints.length,1);assert.match(lastError(p),/HOST_CONTEXT_GUARD:.*cancellation signal changed/);}finally{await p.closeOwned();}
});
