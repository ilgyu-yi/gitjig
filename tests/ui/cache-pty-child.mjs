import fs from 'node:fs/promises';
import path from 'node:path';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {openController}=await import('../../dist/controller/index.js');
const controller=await openController({installationHome:config.home});process.env.TMPDIR=path.join(config.home,'artifacts');
const {createAssistantMessageEventStream}=await import('@earendil-works/pi-ai/compat');
const {startConversationUI}=await import('../../dist/ui/index.js');
let serial=0;const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
let enter;const entered=new Promise(resolve=>enter=resolve);
function model(first=false){return {provider:'cache-probe-'+(++serial),modelId:'fixture',definition:{api:'cache-probe',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(m){if(first)enter();const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:'assistant',content:[{type:'text',text:'Actual native background response complete'}],api:m.api,provider:m.provider,model:m.id,usage,stopReason:'stop',timestamp:Date.now()};stream.push({type:'done',reason:'stop',message});stream.end(message);});return stream;}}};}
const primary=controller.createConversation();let cache,lastCache;const receipts=[],children=[];
const background=(async()=>{await entered;
 for(let i=0;i<7;i++){
  const child=controller.createConversation();controller.setConversationParent({childId:child.conversationId,parentId:primary.conversationId,expectedRevision:0});
  await controller.queueConversationInput({conversationId:child.conversationId,expectedGeneration:0,text:`Actual background child ${i}`,mode:'idle'});
  const result=await controller.runConversation({conversationId:child.conversationId,model:model()});
  const view=controller.inspectConversation(child.conversationId);children.push({id:child.conversationId,state:view.state,status:result.status,historyRef:view.historyRef});
 }
 if(config.retention){while(cache.conversationIds.length>1)await new Promise(resolve=>setTimeout(resolve,5));}
 lastCache=cache;process.stdout.write('\nCACHE_BACKGROUND_FINISHED\n');
})().catch(error=>{process.stdout.write('\nCACHE_BACKGROUND_FAILED\n');throw error;});
try{
 await startConversationUI({controller,model:model(true),conversationId:primary.conversationId,...(config.retention?{retention:config.retention}:{}),onViewCacheState:receipt=>{cache=receipt;receipts.push(receipt);}});
 await background;await fs.writeFile(config.receipt,JSON.stringify({primary:primary.conversationId,children,finalCache:lastCache,observed:receipts.length,allHistories:(await Promise.all(children.map(async child=>(await fs.readFile(child.historyRef,'utf8')).includes('Actual native background response complete')))).every(Boolean),syntheticProvider:true,actualOsPty:true,humanImeAcceptance:false,externalCalls:0}));
}finally{await controller.close();}
