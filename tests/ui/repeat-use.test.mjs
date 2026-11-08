import test from 'node:test';import assert from 'node:assert/strict';
import {managedWorld} from './managed-change-fixture.mjs';
import {scripted} from '../controller/effect-fixture.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {workLedger} from '../controller/change-registry-fixture.mjs';
import {newConversationAction} from '../../dist/ui/new-conversation.js';import {commandDiscovery} from '../../dist/ui/command-discovery.js';import {HostCommands} from '../../dist/ui/host-commands.js';import {CommandMenu} from '../../dist/ui/command-menu.js';
function newHost(f,overrides={}){const activated=[],notices=[];let current=true;return{activated,notices,setCurrent:v=>current=v,host:{controller:f.c,hostLanguage:'en',isCurrent:()=>current,ready:()=>true,choose:async(_title,rows)=>rows[0],create:(projectId,validate)=>f.models.newConversation({projectId},validate),activate:async id=>{activated.push(id);},notice:t=>notices.push(t),...overrides}};}
test('independent root survives an unrelated ordinary generation change during saved-default preparation',async t=>{
 const f=await managedWorld(t),source=f.c.createConversation(),choice=f.c.getConversationModelChoice(source.conversationId),catalogue=f.models.catalogue.bind(f.models);let advanced=false;
 f.models.catalogue=async()=>{
  const result=await catalogue();
  if(!advanced){
   advanced=true;const oldTemp=process.env.TMPDIR;process.env.TMPDIR=f.home+'/artifacts';
   try{await f.c.queueConversationInput({conversationId:source.conversationId,expectedGeneration:source.generation,text:'An original ordinary turn completes while opening another conversation',mode:'idle'});const turn=await f.c.runConversation({conversationId:source.conversationId,model:scripted(()=>({text:'Original ordinary result retained'}))});assert.equal(turn.status,'delivered',JSON.stringify(turn));}
   finally{if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;}
  }
  return result;
 };
 const h=newHost(f);assert.equal(await newConversationAction(h.host,'root',source.conversationId),'completed');
 assert.equal(advanced,true);const original=f.c.inspectConversation(source.conversationId);assert.equal(original.generation,source.generation+1);assert.equal(original.projectId,source.projectId);assert.deepEqual(f.c.getConversationModelChoice(source.conversationId),choice);assert.ok(original.historyRef);
 const created=f.c.inspectConversation(h.activated[0]);assert.equal(created.projectId,null);assert.equal(created.parentId,null);assert.equal(created.workId,null);assert.equal(created.historyRef,null);assert.equal(f.c.getConversationModelChoice(created.conversationId).modelId,'future');f.pass();
});
for(const change of ['project','model','archive','delete'])test('independent entry still refuses relevant source change during defaults: '+change,async t=>{
 const f=await managedWorld(t),catalogue=f.models.catalogue.bind(f.models),before=f.c.listConversations().length,choice=await f.models.choice('managed-fixture','future');let changed=false;
 const q=path.join(f.root,'Q');await fs.mkdir(q);await f.c.registerProject({id:'Q',sourceRoot:q});
 f.models.catalogue=async()=>{
  const result=await catalogue();
  if(!changed){changed=true;const view=f.c.inspectConversation(f.cid);
   if(change==='project')f.c.setConversationProject({conversationId:f.cid,expectedGeneration:view.generation,projectId:'Q'});
   if(change==='model')await f.c.setConversationModelChoice({conversationId:f.cid,expectedGeneration:view.generation,expectedRevision:f.c.getConversationModelChoice(f.cid).revision,choice});
   if(change==='archive')await f.c.archiveConversation({conversationId:f.cid,expectedGeneration:view.generation});
   if(change==='delete')await f.c.deleteConversation({conversationId:f.cid,expectedGeneration:view.generation});
  }
  return result;
 };
 const h=newHost(f);await assert.rejects(newConversationAction(h.host,'root',f.cid),/source changed/);assert.equal(changed,true);assert.equal(h.activated.length,0);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversations').n,before);f.pass();
});
for(const locale of ['en','ko'])for(const state of ['queued','running','complete-unconfirmed'])test('pending task keeps its ledger while independent root selects another project: '+locale+' '+state,async t=>{
 const f=await managedWorld(t),child=f.c.createConversation({projectId:'P'}),q=path.join(f.root,'Q');await fs.mkdir(q);await f.c.registerProject({id:'Q',sourceRoot:q});
 const retained=state==='queued'?null:await f.c.beginChange({projectId:'P',request:'Controlled retained task; no producer or successful completion claimed'});
 f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','retained-assignment',f.cid,child.conversationId,retained?.workId??null,state==='queued'?'QUEUED':state==='running'?'RUNNING':'COMPLETE','{}');
 if(state==='complete-unconfirmed')f.c.store.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','retained-wait',f.cid,child.conversationId,'retained-assignment','PENDING','{}');
 const source=f.c.inspectConversation(f.cid),ledger=workLedger(f.c),assignments=f.c.store.all('SELECT * FROM conversation_assignments'),dependencies=f.c.store.all('SELECT * FROM conversation_dependencies');
 const command=()=>new HostCommands(projectCommands({controller:f.c,hostLanguage:locale,isCurrent:()=>true,choose:async()=>undefined,input:async()=>undefined,notice(){},refresh:async()=>{}}));
 await assert.rejects(command().execute('/project Q',f.cid),e=>e.code==='PROJECT_DEPENDENCY_PENDING'&&e.recovery.includes('/new root')&&e.recovery.includes('/project'));
 const h=newHost(f);assert.equal(await newConversationAction(h.host,'root',f.cid),'completed');const id=h.activated[0],created=f.c.inspectConversation(id);assert.equal(created.projectId,null);assert.equal(created.parentId,null);assert.equal(created.workId,null);assert.equal(created.historyRef,null);
 assert.equal(await command().execute('/project Q',id),'completed');assert.equal(f.c.inspectConversation(id).projectId,'Q');assert.equal(f.c.inspectConversation(id).workId,null);
 assert.deepEqual(f.c.inspectConversation(f.cid),source);assert.deepEqual(f.c.store.all('SELECT * FROM conversation_assignments'),assignments);assert.deepEqual(f.c.store.all('SELECT * FROM conversation_dependencies'),dependencies);
 const after=workLedger(f.c);for(const key of Object.keys(ledger))if(key!=='sources')assert.deepEqual(after[key],ledger[key]);assert.deepEqual(after.sources.slice(0,ledger.sources.length),ledger.sources);const added=after.sources.slice(ledger.sources.length);assert.equal(added.length,1);assert.equal(added[0].conversation,id);assert.equal(JSON.parse(added[0].origin).kind,'owner-scope-transition');assert.equal(f.calls.length,0);
 await assert.rejects(command().execute('/project Q',f.cid),e=>e.code==='PROJECT_DEPENDENCY_PENDING');f.pass();
});
test('new project context uses saved future choice and keeps source draft, work, history and parentage separate',async t=>{
 const f=await managedWorld(t),draft='Original 한국어 draft';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});const retained=await f.c.beginChange({projectId:'P',request:'Retain unresolved original managed work'});f.c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',retained.workId,f.cid);f.c.store.run('INSERT INTO obligations VALUES(?,?,?)','retained-pending',retained.workId,JSON.stringify({kind:'diagnostic',state:'pending',fixture:'Existing original obligation'}));const ledger=workLedger(f.c);const before=f.c.inspectConversation(f.cid),h=newHost(f);
 assert.equal(await newConversationAction(h.host,'',f.cid),'completed');const next=f.c.inspectConversation(h.activated[0]);assert.equal(next.projectId,'P');assert.equal(next.parentId,null);assert.equal(next.workId,null);assert.equal(next.historyRef,null);assert.equal(next.draft.text,'');assert.equal(f.c.getConversationModelChoice(next.conversationId).modelId,'future');assert.deepEqual(f.c.inspectConversation(f.cid),before);assert.deepEqual(workLedger(f.c),ledger);
 const root=newHost(f);await newConversationAction(root.host,'root',f.cid);assert.equal(f.c.inspectConversation(root.activated[0]).projectId,null);f.pass();
});
test('cancel and stale source during async default preparation create no conversation; root project action diagnoses',async t=>{
 const f=await managedWorld(t),before=f.c.listConversations().length;
 assert.equal(await newConversationAction(newHost(f,{choose:async()=>undefined}).host,'',f.cid),'cancelled');assert.equal(f.c.listConversations().length,before);
 const h=newHost(f),original=f.models.catalogue.bind(f.models);f.models.catalogue=async()=>{const value=await original();h.setCurrent(false);return value;};await assert.rejects(newConversationAction(h.host,'project',f.cid),/source changed/);assert.equal(f.c.listConversations().length,before);
 await assert.rejects(newConversationAction(newHost(f).host,'project',f.other),/Select a project/);f.pass();
});
test('postcreation activation failure retains the allocated identity in recovery rather than duplicate creation',async t=>{
 const f=await managedWorld(t),before=f.c.listConversations().length;
 await assert.rejects(newConversationAction(newHost(f,{activate:async()=>{throw Error('Controlled activation failure');}}).host,'root',f.cid),e=>e.code==='CONVERSATION_CREATED'&&e.recovery.includes('/resume ')&&e.message.includes('Controlled activation failure'));assert.equal(f.c.listConversations().length,before+1);f.pass();
});
test('searchable help reuses exact registry outcomes and real submission context, and cancellation/stale views do not dispatch',async t=>{
 const f=await managedWorld(t),calls=[];let selected='/action',current=true,registry,changeLanguage=false,openedIn='en';
 const discovery=commandDiscovery({controller:f.c,hostLanguage:'en',registry:()=>registry,isCurrent:()=>current,
  choose:async()=>assert.fail('Production selects stable values'),
  chooseItems:async(title,items)=>{
   assert.equal(title,openedIn==='en'?'Gitjig commands · search, then Enter runs the selected action':'gitjig 명령 검색 · Enter로 선택한 명령 실행');
   assert.deepEqual(items.map(item=>item.value),['close','/action']);
   assert.equal(items[0].label,openedIn==='en'?'Close · no command run':'실행하지 않고 닫기');
   assert.equal(items[1].label,openedIn==='en'?'/action [request] — Search commands and run the selected action':'/action [request] — 명령을 검색하고 선택한 동작 실행');
   if(changeLanguage){
    const language=f.c.getConversationLanguage(f.cid);
    f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:0,expectedRevision:language.revision,replyLanguage:'ko'});
   }
   return selected;
  },
 });
 registry=new HostCommands([discovery,{name:'action',argumentHint:'[request]',descriptionId:'command.description.help',run:async(arg,target,context)=>{calls.push({arg,target,context});return 'started';}}]);
 const submission={conversationId:f.cid,text:'/help',revision:4};assert.equal(await registry.execute('/help',f.cid,{submission}),'started');assert.deepEqual(calls,[{arg:'',target:f.cid,context:{submission}}]);assert.equal(await registry.execute('/help',f.cid),'started');assert.equal(calls[1].context,undefined);
 selected='close';assert.equal(await registry.execute('/help',f.cid),'cancelled');assert.equal(calls.length,2);
 selected='/action';current=false;await assert.rejects(registry.execute('/help',f.cid),/target changed/);assert.equal(calls.length,2);
 current=true;changeLanguage=true;await assert.rejects(registry.execute('/help',f.cid),/target changed/);assert.equal(calls.length,2);
 openedIn='ko';changeLanguage=false;assert.equal(await registry.execute('/help',f.cid),'started');assert.equal(calls.length,3);
 let key;new CommandMenu(k=>key=k,()=>{}).handleInput('/');assert.equal(key,'/');f.pass();
});
