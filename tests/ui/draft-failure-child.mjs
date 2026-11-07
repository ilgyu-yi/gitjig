import fs from 'node:fs/promises';import path from 'node:path';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const {openController}=await import('../../dist/controller/index.js');const controller=await openController({installationHome:cfg.home});process.env.TMPDIR=path.join(cfg.home,'artifacts');const {startConversationUI}=await import('../../dist/ui/index.js');
const a=controller.createConversation(),b=controller.createConversation();let recovering=false,failed=0,createFailed=0,splitFailed=0,cache,ackText=null;let q=Promise.resolve();
const write=()=>{q=q.then(()=>fs.writeFile(cfg.control,JSON.stringify({selected:cache?.selectedConversationId,views:cache?.conversationIds,primary:a.conversationId,secondary:b.conversationId,failed,createFailed,splitFailed,recovering,ackText})));};
// Explicit controlled host state-write fault. Actual terminal/editor/controller
// are used; this is not a claim that physical disk permissions were exercised.
const setDraft=controller.setDraft.bind(controller),create=controller.createConversation.bind(controller),setView=controller.setConversationView.bind(controller);
controller.setDraft=opts=>{if(opts.conversationId===a.conversationId&&opts.text.includes('UNSAVED')&&!recovering){failed++;write();throw Error('INJECTED_STATE_WRITE_UNAVAILABLE');}const r=setDraft(opts);if(opts.text.includes('UNSAVED'))ackText=opts.text;write();return r;};
controller.createConversation=opts=>{if(!recovering){createFailed++;write();throw Error('INJECTED_CREATE_WRITE_UNAVAILABLE');}return create(opts);};
controller.setConversationView=opts=>{if(opts.secondId&&!recovering){splitFailed++;write();throw Error('INJECTED_VIEW_WRITE_UNAVAILABLE');}return setView(opts);};
const poll=setInterval(()=>{if(!recovering&&fsSync.existsSync(cfg.recover)){recovering=true;write();}},5);
const model={provider:'unused-draft-fixture',modelId:'fixture',definition:{api:'fixture-api',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(){throw Error('No provider should run in draft-only fixture');}}};
try{await startConversationUI({controller,model,conversationId:a.conversationId,retention:{completedLimit:0,idleGraceMs:0},onViewCacheState:r=>{cache=r;write();}});await q;await fs.writeFile(cfg.receipt,JSON.stringify({failed,createFailed,splitFailed,ackText,draft:controller.inspectConversation(a.conversationId).draft,conversations:controller.listConversations().length,fixtureFault:'controlled host method throw',providerCalls:0}));}finally{clearInterval(poll);await controller.close();}
import fsSync from 'node:fs';
