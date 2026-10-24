import test from 'node:test';import assert from 'node:assert/strict';
import {HostCommands} from '../../dist/ui/host-commands.js';import {changeCommands} from '../../dist/ui/change-commands.js';
import {managedWorld} from './managed-change-fixture.mjs';
import {workLedger} from '../controller/change-registry-fixture.mjs';
function host(f,overrides={}){
 const tasks=[],notices=[],sources=[];let current=true;
 const h={controller:f.c,isCurrent:()=>current,choose:async(_title,rows)=>rows[0],show:async()=>{},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice:text=>notices.push(text),activateSource:async cid=>{sources.push(cid);},launch:(cid,task,id)=>{tasks.push({cid,task,id});void task.catch(()=>{});}}};
 Object.assign(h,overrides);return{h,tasks,notices,sources,setCurrent:value=>current=value,registry:()=>new HostCommands(changeCommands(h))};
}
test('explicit start captures selected model rather than future default and returns launch acceptance separately',async t=>{
 const f=await managedWorld(t),h=host(f),outcome=await h.registry().execute('/change start Original 한국어 request',f.cid);assert.equal(outcome,'started');assert.equal(h.tasks.length,1);const view=await h.tasks[0].task;
 assert.equal(f.c.getWorkApplicationModelBaseline(view.workId).choice.modelId,'original');assert.equal(f.c.inspectWork(view.workId).source.raw,'Original 한국어 request');assert.equal(f.calls.length,1);assert.equal(f.c.inspectChangeActivity(view.workId).recordedPhase,'BASE_CAPTURED');f.pass();
});
test('explicit multiline draft use preserves literal draft and request; opening inspect never dispatches',async t=>{
 const f=await managedWorld(t),request='Owner intent 한국어\nPreserve the second line';f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:request});const h=host(f);h.h.controls.draft=()=>request;
 assert.equal(await h.registry().execute('/change start',f.cid),'started');const view=await h.tasks[0].task;assert.equal(f.c.inspectWork(view.workId).source.raw,request);assert.equal(f.c.inspectConversation(f.cid).draft.text,request);
 const before=workLedger(f.c);await h.registry().execute('/change inspect '+view.workId,f.cid);assert.deepEqual(workLedger(f.c),before);assert.equal(h.tasks.length,1);f.pass();
});
test('the command itself is never offered as owner intent; cancellation and stale confirmation create no work',async t=>{
 const f=await managedWorld(t),h=host(f),before=workLedger(f.c);h.h.controls.draft=()=>'/change start';h.h.choose=async(title,rows)=>{assert.ok(!rows.includes('Use current draft as the owner request'));return undefined;};
 assert.equal(await h.registry().execute('/change start',f.cid),'cancelled');assert.deepEqual(workLedger(f.c),before);
 h.h.choose=async(_title,rows)=>{h.setCurrent(false);return rows[0];};await assert.rejects(h.registry().execute('/change start Stale intent',f.cid),/target changed/);assert.deepEqual(workLedger(f.c),before);assert.equal(h.tasks.length,0);f.pass();
});
test('retained work opens its source resume review; cancelling it never dispatches and a new resume retains identity',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original intent',f.cid);const first=await h.tasks[0].task;
 let reviews=0;h.h.choose=async(title,rows)=>{if(title.startsWith('Resume ·')){reviews++;return 'Cancel';}return rows[0];};
 assert.equal(await h.registry().execute('/change resume '+first.workId,f.other),'cancelled');assert.equal(reviews,1);assert.deepEqual(h.sources,[f.cid]);assert.equal(h.tasks.length,1);assert.equal(f.calls.length,1);
 h.h.choose=async(_title,rows)=>rows[0];
 const before=workLedger(f.c);assert.equal(await h.registry().execute('/change resume '+first.workId,f.cid),'started');const second=await h.tasks[1].task;assert.equal(second.workId,first.workId);assert.equal(f.calls.length,2);assert.deepEqual(workLedger(f.c),before);f.pass();
});
test('cancel requires explicit exact-work confirmation and retains consumed allowance',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Keep identity',f.cid);const first=await h.tasks[0].task,before=workLedger(f.c);
 h.h.choose=async()=>undefined;assert.equal(await h.registry().execute('/change cancel '+first.workId,f.cid),'cancelled');assert.deepEqual(workLedger(f.c),before);
 let sawScope=false;h.h.choose=async(_title,rows)=>{sawScope=rows[0]==='Cancel this work and its delegated executions';return rows[0];};await h.registry().execute('/change cancel '+first.workId,f.cid);assert.equal(sawScope,true);assert.equal(f.c.inspectWork(first.workId).state,'CANCELLED');assert.deepEqual(workLedger(f.c).budgets,before.budgets);f.pass();
});
test('resume handoff rechecks the opened owner and does not transfer another conversation draft acknowledgement',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Retain both drafts',f.cid);const id=(await h.tasks[0].task).workId;
 for(const [cid,text] of [[f.cid,'Owner draft'],[f.other,'Other draft']])f.c.setDraft({conversationId:cid,expectedRevision:0,text});
 const launches=[];h.h.controls.launch=(cid,task,workId,submission)=>{launches.push({cid,task,workId,submission});void task.catch(()=>{});};
 const context={submission:{conversationId:f.other,text:'Other draft',revision:1},acknowledgeSubmission:()=>assert.fail('Foreign draft acknowledgement')};
 assert.equal(await h.registry().execute('/change resume '+id,f.other,context),'started');assert.equal(launches.length,1);assert.equal(launches[0].cid,f.cid);assert.equal(launches[0].workId,id);assert.equal(launches[0].submission,undefined);await launches[0].task;
 assert.equal(f.c.inspectConversation(f.cid).draft.text,'Owner draft');assert.equal(f.c.inspectConversation(f.other).draft.text,'Other draft');
 const before=f.calls.length;h.h.controls.activateSource=async()=>{f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);};
 await assert.rejects(h.registry().execute('/change resume '+id,f.other),/changed while opening resume/);assert.equal(f.calls.length,before);assert.equal(launches.length,1);f.pass();
});
test('post-creation failure stays on captured source and exposes original work for recovery',async t=>{
 const f=await managedWorld(t),h=host(f);f.c.changes.drive=async()=>{throw Error('Controlled post-admission failure');};
 assert.equal(await h.registry().execute('/change start Recover original',f.cid),'started');h.setCurrent(false);await assert.rejects(h.tasks[0].task,e=>{assert.ok(e.workId);assert.equal(f.c.inspectWork(e.workId).source.raw,'Recover original');return e.code==='MANAGED_CHANGE_FAILED';});assert.equal(h.tasks[0].cid,f.cid);assert.equal(f.c.listChanges().changes.length,1);f.pass();
});

import {workCommands} from '../../dist/ui/work-commands.js';
import {inputCommands} from '../../dist/ui/input-commands.js';
test('held request routes through original work details to existing resume confirmation; Back never executes',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Retained blocker',f.cid);const view=await h.tasks[0].task,id=view.workId;
 const pending={inputId:'held',text:'Retained follow-up',workId:null,eligible:false,undispatched:true,blockingWorkIds:[id],fingerprint:'held-context',explanation:'Earlier managed work blocks recovery'};
 f.c.inspectConversationInputs=()=>[pending]; // Controlled retained input; actual work/action/registry remain original.
 const before=workLedger(f.c),shown=[],submission={conversationId:f.cid,text:'/inputs',revision:7},context={submission};let workMenus=0,confirmations=0,registry;
 const choose=async(title,rows)=>{
  if(title.startsWith('Sent requests'))return rows[0];
  if(title==='Retained request · recovery held')return rows[1];
  if(title.startsWith('Work recovery')){assert.equal(rows[0],'Back to all works');workMenus++;return rows.find(row=>row.startsWith(workMenus===1?'Review managed change':'Review resume'));}
  if(title.startsWith('Resume ·')){confirmations++;return 'Cancel';}
  assert.fail('Unexpected dialog '+title);
 };
 const show=async(title,text)=>shown.push({title,text});
 registry=new HostCommands([
  ...inputCommands({controller:f.c,isCurrent:()=>true,choose,show,notice(){},retry:async()=>assert.fail('Held input retried'),inspectWork:async(target,workId,ctx)=>{assert.equal(ctx,context);return registry.execute('/work '+workId,target,ctx);}}),
  ...workCommands({controller:f.c,isCurrent:()=>true,choose,show,input:async()=>undefined,notice(){},activate:async()=>assert.fail('Unexpected redirect'),execute:async(command,target,ctx)=>{assert.equal(ctx,context);return registry.execute(command,target,ctx);}}),
  ...changeCommands({...h.h,choose,show}),
 ]);
 assert.equal(await registry.execute('/inputs',f.cid,context),'cancelled');assert.equal(workMenus,2);assert.equal(confirmations,1);
 assert.ok(shown.some(row=>row.text.includes('/change resume '+id)));assert.ok(shown.some(row=>row.text.includes('/work '+id)));
 assert.deepEqual(workLedger(f.c),before);assert.equal(h.tasks.length,1);f.pass();
});
test('work navigation preserves original resume launch and submission; stale work refuses before routing',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original identity',f.cid);const id=(await h.tasks[0].task).workId;
 let registry,mutate=false,registryPicks=0;const context={submission:{conversationId:f.cid,text:'/work '+id,revision:4}},choose=async(title,rows)=>{
  if(title.startsWith('Sent requests'))return rows[0];
  if(title==='Retained request · recovery held')return rows[1];
  if(title.startsWith('Original work and allowances')){registryPicks++;assert.equal(registryPicks,1);return rows.find(row=>row.includes(id));}
  if(title.startsWith('Work recovery')){if(mutate)f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);return rows.find(row=>row.startsWith('Review resume'));}
  return rows[0];
 };
 f.c.inspectConversationInputs=()=>[{inputId:'held',text:'Follow-up',eligible:false,undispatched:true,blockingWorkIds:[id],fingerprint:'fixed',explanation:'Retained blocker'}];
 const launches=[];registry=new HostCommands([
  ...inputCommands({controller:f.c,isCurrent:()=>true,choose,show:async()=>{},notice(){},retry:async()=>assert.fail('Held input retried'),inspectWork:(target,workId,ctx)=>registry.execute('/work '+workId,target,ctx)}),
  ...workCommands({controller:f.c,isCurrent:()=>true,choose,show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async(command,target,ctx)=>registry.execute(command,target,ctx)}),
  ...changeCommands({...h.h,choose,controls:{...h.h.controls,launch:(target,task,workId,submission)=>{launches.push({target,task,workId,submission});void task.catch(()=>{});}}}),
 ]);
 assert.equal(await registry.execute('/inputs',f.cid,context),'started');assert.equal(launches.length,1);assert.equal(launches[0].submission,context.submission);assert.equal(launches[0].workId,id);await launches[0].task;
 assert.equal(await registry.execute('/work',f.cid,context),'started');assert.equal(registryPicks,1);assert.equal(launches.length,2);assert.equal(launches[1].submission,context.submission);await launches[1].task;
 mutate=true;await assert.rejects(registry.execute('/work '+id,f.cid,context),/Original work changed/);assert.equal(launches.length,2);f.pass();
});
test('work resume carries its intent to original source review and refuses a changed conversation before routing',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original source',f.cid);const id=(await h.tasks[0].task).workId;
 let registry,current=true,reviews=0;const choose=async(title,rows)=>{if(title.startsWith('Work recovery'))return rows.find(row=>row.startsWith('Review resume'));if(title.startsWith('Resume ·')){reviews++;return 'Cancel';}return rows[0];};
 registry=new HostCommands([
  ...workCommands({controller:f.c,isCurrent:()=>current,choose,show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async(command,target,ctx)=>registry.execute(command,target,ctx)}),
  ...changeCommands({...h.h,choose}),
 ]);
 assert.equal(await registry.execute('/work '+id,f.other),'cancelled');assert.equal(reviews,1);assert.deepEqual(h.sources,[f.cid]);assert.equal(h.tasks.length,1);
 const stale=new HostCommands(workCommands({controller:f.c,isCurrent:()=>current,choose:async(_title,rows)=>{current=false;return rows.find(row=>row.startsWith('Review resume'));},show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async()=>assert.fail('Stale source routed')}));
 await assert.rejects(stale.execute('/work '+id,f.cid),/Recovery source changed/);f.pass();
});
