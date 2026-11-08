// Original Pi protocol codecs through the shared owned definition path. Synthetic transport only.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createPiSession,initializePiHost} from '../../dist/pi/index.js';
const root=await realpath(await mkdtemp(join(tmpdir(),'gitjig-provider-codecs-'))),work=join(root,'work'),state=join(root,'state'),artifacts=join(root,'artifacts');
for(const dir of [work,state,artifacts])await mkdir(dir,{mode:0o700});
const originalFetch=globalThis.fetch,originalTemp=process.env.TMPDIR;process.env.TMPDIR=artifacts;
after(async()=>{globalThis.fetch=originalFetch;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;await rm(root,{recursive:true,force:true});});
const host=await initializePiHost({stateRoot:state,artifactRoot:artifacts});
const operations={workspaceRoot:work,validatePath:p=>resolve(work,p),async exec(){throw Error('No execution expected');},async readFile(){throw Error('No read expected');},async access(){},async writeFile(){throw Error('No write expected');},async mkdir(){throw Error('No mkdir expected');}};
const sse=events=>new Response(events.map(event=>'data: '+(typeof event==='string'?event:JSON.stringify(event))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
for(const route of [{provider:'openai',api:'openai-responses',baseUrl:'https://api.openai.com/v1',suffix:'/responses'},{provider:'openrouter',api:'openai-completions',baseUrl:'https://openrouter.ai/api/v1',suffix:'/chat/completions'}]){
 test('same owner reaches original '+route.provider+'/'+route.api+' codec and native history',{timeout:10000},async()=>{
  const id='owned-'+route.provider,text='SYNTHETIC '+route.provider+' original codec',key='DUMMY_'+route.provider.toUpperCase();let calls=0;
  const definition={baseUrl:route.baseUrl,api:route.api,apiKey:key,models:[{id,name:id,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}]};
  globalThis.fetch=async(url,init)=>{
   assert.equal(String(url),route.baseUrl+route.suffix,'No other transport is admitted');calls++;
   const headers=new Headers(init.headers);assert.equal(headers.get('authorization'),'Bearer '+key);
   const request=JSON.parse(init.body);assert.equal(request.model,id);assert.equal(request.stream,true);assert.equal(request.tools.length,4);
   if(route.api==='openai-responses'){
    assert.ok(Array.isArray(request.input));assert.equal(request.messages,undefined);
    const item={id:'owned-message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
    return sse([{type:'response.created',response:{id:'owned-response'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'owned-response',status:'completed',output:[item],usage:{input_tokens:4,output_tokens:3,total_tokens:7,input_tokens_details:{cached_tokens:0}}}}]);
   }
   assert.ok(Array.isArray(request.messages));assert.equal(request.input,undefined);
   return sse([{id:'owned-completion',object:'chat.completion.chunk',created:1,model:id,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]},{id:'owned-completion',object:'chat.completion.chunk',created:1,model:id,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7}},'[DONE]']);
  };
  const pi=await createPiSession({host,operations,model:{provider:route.provider,modelId:id,definition},systemPrompt:'Owned codec consumer; never use external resources.',maxReadBytes:1024});
  try{
   await pi.session.prompt('Exercise the selected original parser.');assert.equal(calls,1);
   const final=pi.session.messages.filter(message=>message.role==='assistant').at(-1);
   assert.equal(final.stopReason,'stop');assert.equal(final.provider,route.provider);assert.equal(final.api,route.api);assert.equal(final.model,id);assert.equal(final.content.find(block=>block.type==='text').text,text);
   const native=pi.sessionManager.getEntries().find(entry=>entry.type==='message'&&entry.message.role==='assistant');assert.equal(native.message.content.find(block=>block.type==='text').text,text);
   pi.sealOwned();await pi.joinIdleOwned();await pi.closeOwned();
   assert.throws(()=>pi.modelRuntime.streamSimple(pi.session.model,{messages:[]}),/abort|sealed/i);assert.equal(calls,1);
  }finally{await pi.closeOwned();globalThis.fetch=async()=>{throw Error('No transport outside selected codec lane');};}
 });
}
