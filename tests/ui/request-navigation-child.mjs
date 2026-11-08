import fs from 'node:fs/promises';
import {existsSync,writeFileSync} from 'node:fs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {startConversationUI} from '../../dist/ui/index.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const controller=await openController({installationHome:cfg.home});
const hold=async(entered=cfg.entered,release=cfg.release)=>{
    await fs.writeFile(entered,'entered');
    while(!await fs.access(release).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
};
let dispatches=0,interrupts=0,cacheIds;
let models;
if(cfg.boundary==='managed-dispatch'){
    const install=controller.installApplicationModelResolver.bind(controller);
    controller.installApplicationModelResolver=resolver=>install({...resolver,resolveConversation:async request=>{
        dispatches++;
        await hold();
        return resolver.resolveConversation(request);
    }});
    controller.capacity.acquire=async()=>{
        await hold(cfg.reserved,cfg.settle);
        throw Error('Controlled stop after exact run reservation');
    };
    models=new ApplicationModels(controller);
    models.install();
}else if(cfg.boundary==='dispatch'||cfg.boundary==='retry-non-head'){
    const resolve=controller.resolveConversationOperation.bind(controller);
    controller.resolveConversationOperation=async(...args)=>{dispatches++;await hold();return resolve(...args);};
    const interrupt=controller.interruptConversation.bind(controller);
    controller.interruptConversation=(...args)=>{interrupts++;return interrupt(...args);};
}else if(cfg.boundary==='sync-refusal'){
    controller.runConversation=()=>{throw Error('Controlled synchronous admission refusal '+ ++dispatches);};
}else if(cfg.boundary==='routing-fault'){
    controller.interactions.route=async()=>{
        await hold();
        throw Object.assign(Error('Controlled after-commit routing failure'),{code:'EIO'});
    };
    controller.runConversation=async()=>{dispatches++;throw Error('The routing error must keep the original request held');};
}else if(cfg.boundary==='draft-ack-refusal'){
    controller.store.db.exec(`CREATE TEMP TRIGGER refuse_draft_clear BEFORE UPDATE OF draft ON conversation_views
        WHEN OLD.draft!='' AND NEW.draft='' BEGIN SELECT RAISE(ABORT,'Controlled draft clear write refusal'); END`);
    const repair=setInterval(()=>{
        if(!existsSync(cfg.release))return;
        clearInterval(repair);
        controller.store.db.exec('DROP TRIGGER temp.refuse_draft_clear');
        writeFileSync(cfg.entered,'draft clear writable');
    },10);
    repair.unref();
    controller.runConversation=async()=>{dispatches++;return {status:'unavailable',cleanup:'clean',failure:'Controlled stop after original input admission'};};
}else{
    const queue=controller.queueConversationInputWithContext.bind(controller);
    controller.queueConversationInputWithContext=async(...args)=>{
        const receipt=cfg.boundary==='accepted'?await queue(...args):undefined;
        await hold();
        return receipt??queue(...args);
    };
    // Stop after original admission: these draft tests must never invoke a model.
    controller.runConversation=async()=>{dispatches++;return {status:'unavailable',cleanup:'clean',failure:'Controlled stop after original input admission'};};
}
const model={provider:'unused-navigation-fixture',modelId:'fixture',definition:{api:'fixture-api',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(){throw Error('Provider must not run');}}};
try{
    const retention=cfg.boundary==='dispatch'?{
        retention:{completedLimit:1,idleGraceMs:60000},
        onViewCacheState:state=>{
            cacheIds=state.conversationIds;
            if(state.selectedConversationId===cfg.other&&!cacheIds.includes(cfg.source)&&existsSync(cfg.release))
                writeFileSync(cfg.release+'.pruned','settled view pruned');
        },
    }:{};
    await startConversationUI({controller,...models?{models}:{model},conversationId:cfg.source,...retention});
    await fs.writeFile(cfg.receipt,JSON.stringify({childPid:process.pid,dispatches,interrupts,cacheIds,inputs:controller.store.all('SELECT * FROM conversation_inputs'),runs:controller.store.all('SELECT * FROM runs'),source:controller.inspectConversation(cfg.source),other:controller.inspectConversation(cfg.other)}));
}finally{await controller.close();}
