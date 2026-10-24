import fs from 'node:fs/promises';
import {openController} from '../../dist/controller/index.js';
import {startConversationUI} from '../../dist/ui/index.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const controller=await openController({installationHome:cfg.home});
// Pause only the receipt boundary; native UI and input capture/admission stay original.
const queue=controller.queueConversationInputWithContext.bind(controller);
controller.queueConversationInputWithContext=async(...args)=>{
    const receipt=cfg.boundary==='accepted'?await queue(...args):undefined;
    await fs.writeFile(cfg.entered,'entered');
    while(!await fs.access(cfg.release).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
    return receipt??queue(...args);
};
let dispatches=0;
// Stop after original admission: these draft tests must never invoke a model.
controller.runConversation=async()=>{dispatches++;return {status:'unavailable',cleanup:'clean',failure:'Controlled stop after original input admission'};};
const model={provider:'unused-navigation-fixture',modelId:'fixture',definition:{api:'fixture-api',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(){throw Error('Provider must not run');}}};
try{
    await startConversationUI({controller,model,conversationId:cfg.source});
    await fs.writeFile(cfg.receipt,JSON.stringify({dispatches,inputs:controller.store.all('SELECT * FROM conversation_inputs'),runs:controller.store.all('SELECT * FROM runs'),source:controller.inspectConversation(cfg.source),other:controller.inspectConversation(cfg.other)}));
}finally{await controller.close();}
