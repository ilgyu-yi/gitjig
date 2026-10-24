import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {resetCommands} from '../../dist/ui/reset-commands.js';

async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-ui-')));
 const controller=await openController({installationHome:path.join(root,'app')});
 const target=controller.createConversation().conversationId;
 let passed=false;t.after(async()=>{await controller.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root);});
 return {controller,target,pass(){passed=true;}};
}
for(const scope of ['settings','all'])for(const disposition of ['backup','delete'])for(const locale of ['en','ko'])test('reset '+scope+' '+disposition+' handoff is explicit and localized: '+locale,async t=>{
 const f=await fixture(t),choices=[scope,disposition,'close'],shown=[],requests=[];
 const result=await resetCommands({controller:f.controller,locale:()=>locale,isCurrent:()=>true,
 choose:async()=>assert.fail('Stable choices required'),chooseItems:async(_title,items)=>{assert.equal(items[0].value,'back');const pick=choices.shift();assert.ok(items.some(item=>item.value===pick));return pick;},
 show:async(title,text)=>shown.push({title,text}),request:(value,language,policy)=>{requests.push([value,language,policy]);return true;}})[0].run('',f.target);
 assert.equal(result,'completed');assert.deepEqual(requests,[[scope,locale,disposition]]);assert.equal(shown.length,1);assert.ok(shown[0].text.includes(f.controller.applicationHome()));assert.match(shown[0].text,locale==='ko'?/최종 확인/:/separate final confirmation/);assert.match(shown[0].text,disposition==='delete'?(locale==='ko'?/영구 삭제/:/permanently deleted/):(locale==='ko'?/백업으로 이동/:/owner-private backup/));assert.equal(f.controller.listConversations().length,1);f.pass();
});
for(const stage of ['scope','policy','confirm','close-refused'])test('reset keeps data when '+stage,async t=>{
 const f=await fixture(t),choices=stage==='scope'?['back']:stage==='policy'?['all','back']:stage==='confirm'?['all','delete','back']:['all','delete','close'];let calls=0;
 const result=await resetCommands({controller:f.controller,locale:()=> 'en',isCurrent:()=>true,choose:async()=>assert.fail(),chooseItems:async()=>choices.shift(),show:async()=>{},request:()=>{calls++;return false;}})[0].run('',f.target);
 assert.equal(result,'cancelled');assert.equal(calls,stage==='close-refused'?1:0);assert.equal(f.controller.listConversations().length,1);f.pass();
});
for(const drift of ['view','language'])test('reset refuses '+drift+' drift before handoff',async t=>{
 const f=await fixture(t);let current=true;
 await assert.rejects(resetCommands({controller:f.controller,locale:()=> 'en',isCurrent:()=>current,choose:async()=>assert.fail(),chooseItems:async()=>{
  if(drift==='view')current=false;
  else{const language=f.controller.getConversationLanguage(f.target);f.controller.setConversationLanguage({conversationId:f.target,expectedGeneration:0,expectedRevision:language.revision,replyLanguage:'ko'});}
  return 'all';},show:async()=>assert.fail('Stale review'),request:()=>assert.fail('Stale handoff')})[0].run('',f.target),/Reset source changed/);
 f.pass();
});
