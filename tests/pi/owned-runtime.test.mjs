import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {createProvider,InMemoryCredentialStore} from '@earendil-works/pi-ai';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {ownChatRuntime} from '../../dist/pi/owned-runtime.js';
import {createPiSession,initializePiHost} from '../../dist/pi/index.js';

const root=await realpath(await mkdtemp(join(tmpdir(),'gitjig-common-owner-')));
const state=join(root,'state'),artifacts=join(root,'artifacts'),work=join(root,'work');
for(const dir of [state,artifacts,work])await mkdir(dir,{mode:0o700});
const originalTemp=process.env.TMPDIR,originalFetch=globalThis.fetch;
process.env.TMPDIR=artifacts;
let external=0;globalThis.fetch=async()=>{external++;throw Error('External fetch forbidden');};
after(async()=>{globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;await rm(root,{recursive:true,force:true});assert.equal(external,0);});
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
const operations={workspaceRoot:work,validatePath:p=>resolve(work,p),async exec(){throw Error('No project execution');},async readFile(){throw Error('No project read');},async access(){},async writeFile(){throw Error('No project write');},async mkdir(){throw Error('No project mkdir');}};
const tick=()=>new Promise(r=>setImmediate(r));
const barrier=()=>{let enter,release;return{started:new Promise(r=>enter=r),waiting:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};};
const model={id:'owned-chat',name:'owned-chat',api:'fixture-api',provider:'owned-protocol',baseUrl:'https://unused.invalid',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000};
function message(selected,reason='stop'){return{role:'assistant',content:[{type:'text',text:'owned result'}],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:reason,timestamp:Date.now()};}
async function fixture(){
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 let checkBarrier,checkFailure=false,streamBarrier,reason='stop',checkSignal,streamSignal,streams=0;
 const owner=ownChatRuntime(runtime,{assertModel(selected){assert.equal(selected.provider,model.provider);assert.equal(selected.id,model.id);assert.equal(selected.api,model.api);},beforeAuth(target){assert.equal(typeof target==='string'?target:target.provider,model.provider);}});
 function stream(selected,_context,options){streams++;streamSignal=options.signal;const result=createAssistantMessageEventStream();void(async()=>{if(streamBarrier){streamBarrier.enter();await streamBarrier.waiting;}const final=message(selected,reason);result.push({type:reason==='stop'?'done':'error',reason,...(reason==='stop'?{message:final}:{error:final})});result.end(final);})();return result;}
 runtime.registerNativeProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'owned check',async check({signal}){checkSignal=signal;if(checkBarrier){checkBarrier.enter();await checkBarrier.waiting;}if(checkFailure)throw Error('ORIGINAL_AUTH_CHECK_FAILURE');return{type:'api_key',source:'owned synthetic'};},async resolve(){return{auth:{apiKey:'DUMMY_OWNED'}};}}},api:{stream,streamSimple:stream}}));
 await owner.join();
 return{runtime,owner,selected:runtime.getModel(model.provider,model.id),delayCheck:()=>checkBarrier=barrier(),failCheck:()=>checkFailure=true,delayStream:(stop='stop')=>{reason=stop;return streamBarrier=barrier();},signals:()=>({check:checkSignal,stream:streamSignal}),streams:()=>streams};
}

test('original public setModel auth check survives owner cancellation until its actual tail settles',{timeout:10000},async()=>{
 const f=await fixture(),pi=await createPiSession({host,operations,model:{provider:model.provider,modelId:model.id,runtime:f.runtime},systemPrompt:'Owned check consumer only.',maxReadBytes:1024});
 let gate;
 try{
  await pi.session.setModel(f.selected); // healthy same public consumer
  gate=f.delayCheck();const setting=Promise.allSettled([pi.session.setModel(f.selected)]);await gate.started;
  let closed=false;const closing=f.owner.close().then(()=>closed=true);await tick();assert.equal(closed,false);assert.equal(f.signals().check.aborted,false);
  assert.throws(()=>f.runtime.streamSimple(f.selected,{messages:[]}),/abort|sealed/i);assert.equal(f.streams(),0);
  gate.release();const [result]=await setting;assert.equal(result.status,'rejected');await closing;assert.equal(closed,true);await assert.rejects(f.owner.joinIdle(),/idle/);
 }finally{gate?.release();await pi.closeOwned();await f.owner.close();}
});

test('original checkAuth retains its tail after caller abort and close is idempotent',{timeout:10000},async()=>{
 const f=await fixture(),gate=f.delayCheck(),caller=new AbortController();
 const checked=Promise.allSettled([f.runtime.checkAuth(model.provider,{signal:caller.signal})]);await gate.started;caller.abort();
 const closing=f.owner.close();assert.equal(closing,f.owner.close());let done=false;void closing.then(()=>done=true);await tick();assert.equal(done,false);assert.equal(f.signals().check.aborted,false);
 gate.release();assert.equal((await checked)[0].status,'rejected');await closing;await assert.rejects(f.owner.joinIdle(),/idle/);
});

test('both original public stream variants cancel but close waits original result; abort never becomes successful idle',{timeout:10000},async()=>{
 for(const method of ['streamSimple','stream']){
  const f=await fixture(),gate=f.delayStream('aborted'),stream=f.runtime[method](f.selected,{messages:[]});await gate.started;
  let done=false;const closing=f.owner.close().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(f.signals().stream.aborted,true);
  gate.release();assert.equal((await stream.result()).stopReason,'aborted');await closing;await assert.rejects(f.owner.joinIdle(),/idle/);
 }
});

test('healthy actual original stop permits sealed idle; returned registration refresh failure does not',{timeout:10000},async()=>{
 const healthy=await fixture();assert.equal((await healthy.runtime.completeSimple(healthy.selected,{messages:[]})).stopReason,'stop');healthy.owner.seal();await healthy.owner.joinIdle();await healthy.owner.close();
 const failed=await fixture();failed.failCheck();const result=await failed.runtime.refresh({providers:[model.provider]});assert.ok(result.errors.has(model.provider));failed.owner.seal();await assert.rejects(failed.owner.join(),/refresh/);await assert.rejects(failed.owner.joinIdle(),/refresh/);await failed.owner.close();
});

test('fire-and-forget original registration refresh tail is observed through close and unsupported async paths refuse',{timeout:10000},async()=>{
 const f=await fixture(),gate=barrier();
 f.runtime.registerNativeProvider(createProvider({id:'additional-availability',models:[],auth:{apiKey:{name:'registration check',async resolve(){gate.enter();await gate.waiting;throw Error('ORIGINAL_REGISTRATION_FAILURE');}}},api:{stream(){throw Error('No generation');},streamSimple(){throw Error('No generation');}}}));
 await gate.started;let done=false;const closing=f.owner.close().then(()=>done=true);await tick();assert.equal(done,false);gate.release();await closing;await assert.rejects(f.owner.join(),/refresh/);
 for(const method of ['streamDeferred','fetchDeferred','generateImages','classify','resolveModel','login','getAvailable'])assert.throws(()=>f.runtime[method](),/unavailable/);
 assert.throws(()=>ownChatRuntime(f.runtime,{}),/already/);
});

test('borrowed public runtime remains caller owned after its Pi session closes',{timeout:10000},async()=>{
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 runtime.registerProvider('borrowed-fixture',{api:'fixture-api',apiKey:'DUMMY_LITERAL',baseUrl:'https://unused.invalid',models:[{...model,id:'borrowed'}],streamSimple(selected){const stream=createAssistantMessageEventStream(),final=message(selected);stream.push({type:'done',reason:'stop',message:final});stream.end(final);return stream;}});
 const pi=await createPiSession({host,operations,model:{provider:'borrowed-fixture',modelId:'borrowed',runtime},systemPrompt:'Borrowed runtime consumer.',maxReadBytes:1024});
 assert.equal(pi.canRetainOwned,false);await pi.closeOwned();assert.ok(await runtime.getAuth('borrowed-fixture'));
});
