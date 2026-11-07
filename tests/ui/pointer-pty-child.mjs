import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {startConversationUI} from '../../dist/ui/index.js';

const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const controller=await openController({installationHome:cfg.home});
process.env.TMPDIR=path.join(cfg.home,'artifacts');
const left=controller.createConversation(),right=controller.createConversation();
controller.setDraft({conversationId:left.conversationId,expectedRevision:0,text:'LEFT_DRAFT'});
controller.setDraft({conversationId:right.conversationId,expectedRevision:0,text:'RIGHT_DRAFT'});
let latest,queue=Promise.resolve(),providerCalls=0,failedSaves=0,lastAttempt=null,recovering=false;
const setDraft=controller.setDraft.bind(controller);
controller.setDraft=input=>{
 lastAttempt={conversationId:input.conversationId,text:input.text};
 if(cfg.persistenceRefusal&&!recovering&&input.conversationId===left.conversationId&&input.text.includes('UNSAVED')){failedSaves++;throw Error('INJECTED_POINTER_DRAFT_SAVE_UNAVAILABLE');}
 return setDraft(input);
};
const snapshot=()=>({left:left.conversationId,right:right.conversationId,selected:latest?.selectedConversationId,second:latest?.secondConversationId,visibleSecond:latest?.visibleSecondConversationId,leftDraft:controller.inspectConversation(left.conversationId).draft.text,rightDraft:controller.inspectConversation(right.conversationId).draft.text,failedSaves,lastAttempt});
const write=()=>{queue=queue.then(async()=>{await fs.writeFile(cfg.control+'.next',JSON.stringify(snapshot()));await fs.rename(cfg.control+'.next',cfg.control);});};
const abort=new AbortController();
const poll=setInterval(()=>{if(existsSync(cfg.finish)){recovering=true;clearInterval(poll);abort.abort();}else write();},5);
const model={provider:'unused-pointer-fixture',modelId:'fixture',definition:{api:'fixture-api',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(){providerCalls++;throw Error('Pointer-only control must not call a provider');}}};
try{
 await startConversationUI({controller,model,conversationId:left.conversationId,...(cfg.commandKey?{commandKey:cfg.commandKey}:{}),signal:abort.signal,onViewCacheState:value=>{latest=value;write();}});
 clearInterval(poll);await queue;
 await fs.writeFile(cfg.receipt,JSON.stringify({...snapshot(),providerCalls,normalUiReturn:true}));
}finally{clearInterval(poll);await controller.close();}
