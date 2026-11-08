import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'pi-manual-')));
for(const n of ['state','artifacts','work'])await fs.mkdir(path.join(root,n),{mode:0o700});
process.env.TMPDIR=path.join(root,'artifacts');
const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');
const {initializePiHost,createPiSession}=await import('../../dist/pi/index.js');
const host=await initializePiHost({stateRoot:path.join(root,'state'),artifactRoot:path.join(root,'artifacts')});
const operations={workspaceRoot:path.join(root,'work'),validatePath:p=>path.resolve(root,'work',p),async exec(){throw Error('unused');},async readFile(){throw Error('unused');},async access(){throw Error('unused');},async writeFile(){throw Error('unused');},async mkdir(){throw Error('unused');}};
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let serial=0;
async function fixture(){let calls=0,guards=0,fail=false,stall=false,abortSeen=false;const contexts=[];
 const model={provider:'manual-fixture-'+(++serial),modelId:'fixture',definition:{baseUrl:'http://unused.invalid',apiKey:'fixture-only',api:'fixture-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:usage.cost,contextWindow:32000,maxTokens:1000}],streamSimple(model,context,opts){contexts.push(context);calls++;assert.ok(guards>=calls);const stream=createAssistantMessageEventStream();const end=aborted=>{const m={role:'assistant',content:aborted?[]:[{type:'text',text:'Actual native history summary '+calls}],api:model.api,provider:model.provider,model:model.id,usage,stopReason:aborted?'aborted':'stop',timestamp:Date.now()};stream.push(aborted?{type:'error',reason:'aborted',error:m}:{type:'done',reason:'stop',message:m});stream.end(m);};if(stall){opts.signal.addEventListener('abort',()=>{abortSeen=true;end(true);},{once:true});}else queueMicrotask(()=>end(false));return stream;}}};
 const pi=await createPiSession({host,operations,model,systemPrompt:'Manual history fixture',maxReadBytes:1024,beforeModelRequest:async manager=>{guards++;assert.ok(manager.getLeafId());if(fail)throw Error('durable-checkpoint-unavailable');}});
 // Public trusted fixture override avoids huge synthetic context; entries themselves
 // are produced only by actual native prompt/provider calls.
 pi.session.settingsManager.applyOverrides({compaction:{enabled:false,keepRecentTokens:20,reserveTokens:100}});
 for(let i=0;i<4;i++)await pi.session.prompt('Actual owner history '+i+' '+('history words '.repeat(60)));
 return {pi,contexts,get calls(){return calls;},get guards(){return guards;},get abortSeen(){return abortSeen;},fail(){fail=true;},stall(){stall=true;}};
}
test('owned native manual compaction dispatches after checkpoint; tree navigation uses no provider',async()=>{const f=await fixture();try{const nativeStream=f.pi.session.agent.streamFunction,before=f.calls;const result=await f.pi.compactOwned('Preserve actual decisions');assert.ok(result.summary.includes('Actual native history summary'));const summaryContext=JSON.stringify(f.contexts.at(-1));assert.match(summaryContext,/English is mandatory/);assert.match(summaryContext,/Retain the human conversation language/);assert.ok(f.calls>before&&f.calls<=before+2);assert.equal(f.pi.session.agent.streamFunction,nativeStream);assert.ok(f.pi.sessionManager.getEntries().some(e=>e.type==='compaction'));const target=f.pi.sessionManager.getEntries().find(e=>e.type==='message'&&e.message.role==='assistant').id;const count=f.calls;await f.pi.navigateTreeOwned(target);assert.equal(f.calls,count);assert.ok(f.pi.sessionManager.getBranch().some(e=>e.id===target));}finally{await f.pi.session.abort();f.pi.session.dispose();}});
test('manual compaction checkpoint failure makes no provider request and restores stream',async()=>{const f=await fixture();try{const stream=f.pi.session.agent.streamFunction,before=f.calls;f.fail();await assert.rejects(f.pi.compactOwned(),/durable-checkpoint-unavailable/);assert.equal(f.calls,before);assert.equal(f.pi.session.agent.streamFunction,stream);}finally{await f.pi.session.abort();f.pi.session.dispose();}});
test('manual compaction actual provider abort settles and restores stream',async()=>{const f=await fixture();try{const original=f.pi.session.agent.streamFunction,before=f.calls;f.stall();const abort=new AbortController();const pending=f.pi.compactOwned(undefined,abort.signal);while(f.calls===before)await new Promise(r=>setImmediate(r));abort.abort(Error('owner interrupted'));await assert.rejects(pending,/abort|cancel/i);assert.equal(f.abortSeen,true);assert.equal(f.pi.session.agent.streamFunction,original);}finally{await f.pi.session.abort();f.pi.session.dispose();}});
test.after(()=>console.log(JSON.stringify({manualFixture:root,externalCalls:0,historyCreatedBy:'native prompt/provider',treePersistence:'controller marker consumer separate'})));
