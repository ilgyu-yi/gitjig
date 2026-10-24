import test from 'node:test';import assert from 'node:assert/strict';
import {managedWorld} from './managed-change-fixture.mjs';
import {workLedger} from '../controller/change-registry-fixture.mjs';
import {newConversationAction} from '../../dist/ui/new-conversation.js';import {commandDiscovery} from '../../dist/ui/command-discovery.js';import {HostCommands} from '../../dist/ui/host-commands.js';import {CommandMenu} from '../../dist/ui/command-menu.js';
function newHost(f,overrides={}){const activated=[],notices=[];let current=true;return{activated,notices,setCurrent:v=>current=v,host:{controller:f.c,isCurrent:()=>current,ready:()=>true,choose:async(_title,rows)=>rows[0],create:(projectId,validate)=>f.models.newConversation({projectId},validate),activate:async id=>{activated.push(id);},notice:t=>notices.push(t),...overrides}};}
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
 const f=await managedWorld(t),calls=[];let selected='action',current=true,registry;
 const discovery=commandDiscovery({controller:f.c,registry:()=>registry,isCurrent:()=>current,choose:async(_title,rows)=>{assert.equal(rows[0],'Close · no command run');assert.ok(!rows.some(row=>row.startsWith('/help')));return selected==='close'?rows[0]:rows.find(row=>row.startsWith('/action'));}});
 registry=new HostCommands([discovery,{name:'action',argumentHint:'[request]',description:'Original registered action',run:async(arg,target,context)=>{calls.push({arg,target,context});return 'started';}}]);
 const submission={conversationId:f.cid,text:'/help',revision:4};assert.equal(await registry.execute('/help',f.cid,{submission}),'started');assert.deepEqual(calls,[{arg:'',target:f.cid,context:{submission}}]);assert.equal(await registry.execute('/help',f.cid),'started');assert.equal(calls[1].context,undefined);
 selected='close';assert.equal(await registry.execute('/help',f.cid),'cancelled');assert.equal(calls.length,2);current=false;await assert.rejects(registry.execute('/help',f.cid),/target changed/);assert.equal(calls.length,2);
 let key;new CommandMenu(k=>key=k,()=>{}).handleInput('/');assert.equal(key,'/');f.pass();
});
