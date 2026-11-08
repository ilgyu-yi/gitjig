import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {HostCommands} from '../../dist/ui/host-commands.js';import {changeCommands} from '../../dist/ui/change-commands.js';
import {managedWorld} from './managed-change-fixture.mjs';
import {workLedger} from '../controller/change-registry-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
import {workAllowanceText} from '../../dist/ui/work-allowance-presentation.js';
function host(f,overrides={}){
 const tasks=[],notices=[],sources=[];let current=true;
 const h={controller:f.c,isCurrent:()=>current,choose:async(title,rows)=>rows[title.startsWith('Start managed work')?1:0],show:async(_title,_text,primary)=>{await primary?.run();},controls:{models:f.models,input:async()=>undefined,draft:()=>'',notice:text=>notices.push(text),activateSource:async cid=>{sources.push(cid);},launch:(cid,task,id)=>{tasks.push({cid,task,id});void task.catch(()=>{});}}};
 Object.assign(h,overrides);return{h,tasks,notices,sources,setCurrent:value=>current=value,registry:()=>new HostCommands(changeCommands(h))};
}
for(const state of ['criteria','activation','resolution','delivered','live'])
test('managed inspection keeps the current hold and original read-only evidence · '+state,async t=>{
 const f=await managedWorld(t),c=f.c,locale='ko',shown=[];
 const h=host(f,{locale:()=>locale,show:async(title,text)=>shown.push({title,text}),
  execute:async()=>assert.fail('Read-only inspection cannot navigate into recovery')});
 const draft='/help',request='Original evidence\nAppendix with \x1b[0m literal control';
 c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 const choice=c.getConversationModelChoice(f.cid);
 const original=await c.beginChange({projectId:'P',request,applicationModelBaseline:await f.models.baseline('P',choice)}),id=original.workId;
 if(state==='criteria')c.store.run("UPDATE change_state SET data=json_set(data,'$.contractsVersion','unavailable-original') WHERE work=?",id);
 if(state==='activation')c.store.run("UPDATE works SET data=json_set(data,'$.ownerRootActivation.state','PENDING') WHERE id=?",id);
 if(state==='resolution')c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='resolution'",id);
 if(state==='delivered')c.store.run("UPDATE works SET state='DELIVERED' WHERE id=?",id);
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 let active;
 if(state==='live'){
  c.changes.drive=async()=>{entered.resolve();await gate.promise;return c.inspectChange(id);};
  active=c.resumeConversationChange({conversationId:f.cid,expectedGeneration:c.inspectConversation(f.cid).generation,
   expectedModelRevision:choice.revision,workId:id,expectedEpoch:original.epoch});
 }
 try{
  if(active)await Promise.race([entered.promise,active]);
  const before=workLedger(c);
  assert.equal(await h.registry().execute('/change inspect '+id,f.cid),'completed');
  assert.equal(shown.length,1);
  const {title,text}=shown[0], label=(key,args)=>uiText(locale,key,args);
  assert.equal(title,label('change.inspectTitle'));
  const hold={criteria:label('criteria.recovery.unavailable'),activation:label('task.change.activation'),
   resolution:label('managedRepair.allowance.resolution',{command:'/work '+id}),live:label('workRecovery.live')};
  assert.ok(text.includes(label('change.inspectRecovery',{id})));
  if(hold[state])assert.ok(text.indexOf(hold[state])>=0&&text.indexOf(hold[state])<text.indexOf(label('change.inspectBlockers')));
  assert.ok(text.includes('Original evidence\nAppendix with \\u001b[0m literal control'));
  assert.ok(!text.includes('/change cancel '+id));
  const recorded=text.indexOf(label('result.recordedNextAction',{action:''}));
  const resume=text.indexOf('/change resume '+id);
  assert.ok(resume===-1||state==='resolution'&&resume>recorded&&recorded>=0);
  assert.equal(c.inspectConversation(f.cid).draft.text,draft);
  assert.deepEqual(workLedger(c),before);
  f.pass();
 }finally{
  gate.resolve();
  await active;
 }
});
for (const route of ['unbound','matching','mismatched']) test(`managed start keeps the explicit model route policy · ${route}`, async t => {
    const f = await managedWorld(t,null), cid = f.c.createConversation({projectId:'P'}).conversationId;
    if (route !== 'unbound') await f.c.setConversationModelChoice({conversationId:cid,expectedGeneration:0,expectedRevision:0,
        choice:{kind:'legacy-external',provider:'external',modelId:route==='matching'?'selected':'retained'}});
    const {h, registry, tasks} = host(f);
    h.controls.model = {provider:'external',modelId:'selected'};
    h.execute = async () => assert.fail('Back cannot open setup');
    h.choose = async (title, rows) => {
        assert.match(title, route==='mismatched' ? /matching external model profile/ : /needs an active runtime/);
        return rows[0];
    };
    assert.equal(await registry().execute('/change start Keep the request',cid),'cancelled');
    assert.equal(tasks.length,0);
    assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,0);
    f.pass();
});
for (const sourceChanged of [false,true]) test(`model repair posts its preserved-request notice only for the current source · ${sourceChanged}`, async t => {
    const f = await managedWorld(t,null), cid = f.c.createConversation({projectId:'P'}).conversationId;
    const {h, registry, notices, tasks} = host(f);
    h.choose = async (_title, rows) => rows[1];
    h.execute = async (command, target) => {
        assert.deepEqual([command,target],['/model',cid]);
        await f.c.setConversationModelChoice({conversationId:cid,expectedGeneration:0,expectedRevision:0,
            choice:await f.models.choice('managed-fixture','original')});
        if (sourceChanged) f.c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
        return 'completed';
    };
    assert.equal(await registry().execute('/change start Keep the request',cid),'cancelled');
    assert.equal(notices.length,sourceChanged?0:1);
    assert.equal(tasks.length,0);
    f.pass();
});
test('explicit start captures selected model rather than future default and returns launch acceptance separately',async t=>{
 const f=await managedWorld(t),h=host(f);
 let startReview;
 h.h.show=async(_title,text,primary)=>{startReview=text;await primary?.run();};
 h.h.choose=async(_title,rows)=>{
  await fs.writeFile(path.join(f.root,'project','file.txt'),'Updated during review');
  return rows[1];
 };
 const outcome=await h.registry().execute('/change start Original 한국어 request',f.cid);assert.equal(outcome,'started');assert.equal(h.tasks.length,1);const view=await h.tasks[0].task;
 assert.match(startReview,/New work allowance\nExecution: 0 consumed \+ 0 reserved \/ 32 · 32 available\nResolution: 0 consumed \+ 0 reserved \/ 8 · 8 available/);
 const base=view.versions.find(version=>version.kind==='base');
 assert.equal(await fs.readFile(path.join(base.artifact,'file.txt'),'utf8'),'Updated during review');
 assert.equal(f.c.inspectConversation(f.cid).label,'Original 한국어 request');
 assert.equal(f.c.getWorkApplicationModelBaseline(view.workId).choice.modelId,'original');assert.equal(f.c.inspectWork(view.workId).source.raw,'Original 한국어 request');assert.equal(f.calls.length,1);assert.equal(f.c.inspectChangeActivity(view.workId).recordedPhase,'BASE_CAPTURED');f.pass();
});
test('managed start review shows the inherited balance and refuses a later balance change',async t=>{
 const f=await managedWorld(t),h=host(f),s=f.c.store,workId='ordinary-source';
 s.run('INSERT INTO sources VALUES(?,?,?,?)','source',f.cid,'{}','Original work');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',workId,'P','source',null,workId,'ACTIVE',1,1,null,
  JSON.stringify({kind:'ordinary-conversation',conversation:f.cid,delegation:{rootWorkId:workId,projectIds:['P'],maxAssignments:4}}));
 s.run('UPDATE conversation_state SET work=? WHERE conversation=?',workId,f.cid);
 s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',workId,'execution',8,7,0);
 s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',workId,'resolution',4,4,0);
 const before=workLedger(f.c);
 h.h.show=async(_title,text,primary)=>{
  assert.ok(text.includes('Shared allowance · original work '+workId));
  assert.match(text,/Execution: 7 consumed \+ 0 reserved \/ 8 · 1 available/);
  assert.match(text,/Resolution: 4 consumed \+ 0 reserved \/ 4 · 0 available/);
  await primary?.run();
 };
 h.h.choose=async(_title,rows)=>{
  s.run("UPDATE budgets SET lim=9 WHERE lineage=? AND kind='execution'",workId);
  return rows[1];
 };
 await assert.rejects(h.registry().execute('/change start Retain original scope',f.cid),/work allowance changed during review/);
 assert.equal(h.tasks.length,0);
 s.run("UPDATE budgets SET lim=8 WHERE lineage=? AND kind='execution'",workId);
 assert.deepEqual(workLedger(f.c),before);
 const state=s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data;
 s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...JSON.parse(state),contextFamilyRoot:f.cid,
  contextFamily:{version:1,rootConversationId:f.cid,budgetAnchorWorkId:null,budgetLineage:null,delegationRootWorkId:null}}),f.cid);
 assert.throws(()=>f.c.inspectConversationChangeStart(f.cid),/empty family\/source binding/);
 f.pass();
});
test('the original managed request labels only its own conversation and respects title history',async t=>{
 const f=await managedWorld(t),h=host(f),s=f.c.store;
 const original='Original managed request';
 const addText=(id,text,source)=>{
  if(!source)s.run('INSERT INTO sources VALUES(?,?,?,?)',id,f.cid,'{}',text);
  s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',id,f.cid,0,null,source??id,'CONSUMED','idle',text,'{}');
 };
 s.run('INSERT INTO sources VALUES(?,?,?,?)','earlier-source',f.cid,'{}','Earlier ordinary request');
 assert.equal(await h.registry().execute('/change start '+original,f.cid),'started');
 const {workId}=await h.tasks[0].task;
 const label=(cid=f.cid)=>f.c.inspectConversation(cid).label;
 const rename=name=>f.c.setConversationName({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,name});
 const before=workLedger(f.c);
 assert.equal(f.c.listConversations().find(row=>row.conversationId===f.cid).label,original);
 assert.deepEqual(workLedger(f.c),before);
 rename('Owner title');assert.equal(label(),'Owner title');
 rename(null);assert.equal(label(),original);
 addText('later','Later ordinary request');assert.equal(label(),original);
 s.run('DELETE FROM conversation_inputs WHERE id=?','later');
 addText('earlier','Earlier ordinary request','earlier-source');assert.equal(label(),'Earlier ordinary request');
 s.run('DELETE FROM conversation_inputs WHERE id=?','earlier');
 const source=s.one('SELECT source FROM works WHERE id=?',workId).source;
 const origin=s.one('SELECT origin FROM sources WHERE id=?',source).origin;
 s.run('UPDATE sources SET origin=? WHERE id=?','{incomplete',source);assert.equal(label(),'Investigation');
 s.run('UPDATE sources SET origin=? WHERE id=?',origin,source);
 const otherProject=path.join(f.root,'other-project');await fs.mkdir(otherProject);
 await f.c.registerProject({id:'Other',sourceRoot:otherProject});
 s.run('UPDATE conversations SET project=? WHERE id=?','Other',f.cid);assert.equal(label(),'Investigation');
 s.run('UPDATE conversations SET project=? WHERE id=?','P',f.cid);
 s.run('UPDATE conversations SET project=? WHERE id=?','P',f.other);
 s.run('UPDATE conversation_state SET work=? WHERE conversation=?',workId,f.other);assert.equal(label(f.other),'Investigation');
 s.run("UPDATE conversation_state SET data=json_set(data,'$.role','planner') WHERE conversation=?",f.cid);
 assert.equal(label(),'planner');
 s.run("UPDATE conversation_state SET data=json_remove(data,'$.role') WHERE conversation=?",f.cid);
 assert.equal(label(),original);f.pass();
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
for(const sourceChange of ['missing at entry','replaced during confirmation'])test(`managed start keeps the draft when the registered folder is ${sourceChange}`,async t=>{
 const missingAtEntry=sourceChange==='missing at entry';
 const f=await managedWorld(t,missingAtEntry?null:undefined),h=host(f);
 const root=path.join(f.root,'project'),draft='/change start Keep this source request';
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 h.h.controls.draft=()=>draft;
 const before=workLedger(f.c);
 const move=()=>fs.rename(root,root+'-moved');
 if(missingAtEntry){
  await move();
  h.h.show=async()=>assert.fail('Start review opened for an unavailable project folder');
  h.h.choose=async()=>assert.fail('Runtime setup opened for an unavailable project folder');
  h.h.execute=async()=>assert.fail('Managed start navigated with an unavailable project folder');
 } else {
  h.h.choose=async(_title,rows)=>{
   await move();
   await fs.mkdir(root);
   return rows[1];
  };
 }
 await assert.rejects(h.registry().execute(draft,f.cid),error=>{
  assert.ok(error.message.includes(root));
  assert.match(error.message,missingAtEntry ? /use \/project to register/u : /Start a fresh review of the current folder/u);
  return true;
 });
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(f.c.inspectConversation(f.cid).draft.text,draft);
 assert.equal(h.tasks.length,0);
 assert.equal(f.calls.length,0);
 f.pass();
});
test('runtime repair opens independently and a changed effective route cannot launch from review',async t=>{
 const f=await managedWorld(t,null),h=host(f),before=workLedger(f.c),draft='Exact 한국어 draft for managed start',shown=[];
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 h.h.controls.draft=()=>draft;
 const runtime={dockerBinary:'/usr/bin/false',dockerContext:'MANAGED_APPLIED',image:'sha256:'+'a'.repeat(64)};
 const choices=['Configure execution runtime','Use current draft as the owner request'];
 h.h.choose=async(_title,rows)=>{
  const next=choices.shift();
  if(next)return rows.find(row=>row===next);
  f.c.options.runtimeProfile.dockerContext='OTHER_ROUTE';
  return rows[0];
 };
 h.h.show=async(_title,text,primary)=>{shown.push(text);await primary?.run();};
 h.h.execute=async(command,target,context)=>{
  assert.equal(command,'/setup runtime');
  assert.equal(target,f.cid);
  assert.equal(context,undefined);
  await f.c.applyRuntimeProfile(runtime);
  f.c.options.runtimeProfile={...f.c.options.runtimeProfile};
  return 'completed';
 };
 await assert.rejects(h.registry().execute('/change start',f.cid,{submission:{conversationId:f.cid,text:draft,revision:1}}),/active runtime changed/);
 assert.equal(shown.length,1);
 assert.ok(shown[0].includes('Active Docker context: "MANAGED_APPLIED"'));
 assert.ok(shown[0].includes(draft));
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(h.tasks.length,0);
 f.pass();
});

test('cancelling work refuses a result that finished at the reviewed epoch',async t=>{
 const f=await managedWorld(t),h=host(f);
 const first=await f.c.beginChange({projectId:'P',request:'Original work that finishes while cancellation is open'});
 const before=f.c.inspectWork(first.workId);
 h.h.choose=async(_title,rows)=>{
  f.c.store.tx(()=>{
   f.c.store.run("UPDATE works SET state='DELIVERED' WHERE id=?",first.workId);
   f.c.store.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work=?",first.workId);
  });
  return rows.find(row=>row==='Cancel this work and its delegated executions');
 };
 try {
  await assert.rejects(h.registry().execute('/change cancel '+first.workId,f.cid),/Original work changed/);
  const current=f.c.inspectWork(first.workId);
  assert.equal(current.state,'DELIVERED');
  assert.equal(current.epoch,before.epoch);
  assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM sources WHERE json_extract(origin,'$.kind')='owner-task-cancel'").n,0);
 } finally {f.pass();}
});

test('retained work opens its source resume review; cancelling it never dispatches and a new resume retains identity',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original intent',f.cid);const first=await h.tasks[0].task;
 const retained=workLedger(f.c);
 assert.equal(await h.registry().execute('/change resume '+first.workId,f.other),'cancelled');
 assert.deepEqual(h.sources,[]);assert.deepEqual(workLedger(f.c),retained);
 let reviews=0;h.h.choose=async(title,rows)=>{if(title.startsWith('Resume ·')){reviews++;assert.equal(rows[0],'Back without changes');return rows[0];}return rows.find(row=>row.startsWith('Open original conversation'));};
 assert.equal(await h.registry().execute('/change resume '+first.workId,f.other),'cancelled');assert.equal(reviews,1);assert.deepEqual(h.sources,[f.cid]);assert.equal(h.tasks.length,1);assert.equal(f.calls.length,1);
 h.h.choose=async(_title,rows)=>rows.find(row=>row==='Resume this original work');
 const before=workLedger(f.c);assert.equal(await h.registry().execute('/change resume '+first.workId,f.cid),'started');const second=await h.tasks[1].task;assert.equal(second.workId,first.workId);assert.equal(f.calls.length,2);assert.deepEqual(workLedger(f.c),before);f.pass();
});
test('a different start on a retained conversation guides new work without changing the original',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original intent',f.cid);
 const {workId}=await h.tasks[0].task;
 const draft='/change start New intent 한국어';
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 h.h.controls.draft=()=>draft;
 const retained=workLedger(f.c);
 h.h.choose=async()=>assert.fail('Retained start opened another review');
 h.h.execute=async()=>assert.fail('Retained start navigated automatically');
 for(const locale of ['en','ko']){
  h.h.locale=()=>locale;
  await assert.rejects(h.registry().execute(draft,f.cid),error=>{
   assert.ok(error.message.includes(workId));
   assert.match(error.message,/\/result/u);
   assert.match(error.message,/\/new project/u);
   assert.match(error.message,locale==='ko'?/새 작업/u:/For new work/u);
   return true;
  });
 }
 assert.deepEqual(workLedger(f.c),retained);
 assert.equal(f.c.inspectConversation(f.cid).draft.text,draft);
 assert.equal(f.calls.length,1);
 assert.equal(h.tasks.length,1);
 f.pass();
});
test('resume refuses an allowance change during runtime recovery before opening a review',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original resume request',f.cid);
 const {workId}=await h.tasks[0].task,profile=f.c.options.runtimeProfile;
 f.c.options.runtimeProfile=undefined;
 h.h.choose=async(title,rows)=>{
  assert.equal(title,'Managed work needs an active runtime');
  assert.equal(rows[0],'Cancel');
  return 'Configure execution runtime';
 };
 h.h.execute=async(command,target,context)=>{
  assert.equal(command,'/setup runtime');
  assert.equal(target,f.cid);
  assert.equal(context,undefined);
  await f.c.applyRuntimeProfile(profile);
  f.c.store.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='execution'",workId);
  return 'completed';
 };
 const before=f.c.inspectWork(workId);
 await assert.rejects(h.registry().execute('/change resume '+workId,f.cid),/Original work changed/);
 assert.equal(h.tasks.length,1);
 const after=f.c.inspectWork(workId);
 assert.deepEqual(after.runs,before.runs);
 assert.equal(after.allowance.consumed,before.allowance.consumed);
 f.pass();
});

for(const mode of ['back','saved','applied','draft changed','read only','active drift','active back','active allowance drift','active draft drift'])
test('replan runtime review preserves exact original work · '+mode,async t=>{
 const f=await managedWorld(t),c=f.c,{h,registry,notices,tasks}=host(f);
 const {workId}=await c.beginChange({projectId:'P',request:'Original replan scope'});
 const profile=c.options.runtimeProfile, active=mode.startsWith('active ');
 if(!active)c.options.runtimeProfile=undefined;
 const kind=['saved','applied'].includes(mode)?'scope':'check';
 c.inspectChangeReplan=()=>({kind,fingerprint:JSON.stringify(c.options.runtimeProfile??null),failures:[{receiptId:'exact-test-receipt'}],heldDirections:[]});
 let shows=0,picks=0,setups=0;
 const tEn=(key,args)=>uiText('en',key,args);
 h.show=async(title,text,primary)=>{
  shows++;
  assert.match(text,/exact-test-receipt/);
  assert.ok(text.includes('Original replan scope'));
  const allowance=c.inspectWorkAllowance(workId);
  for(const kind of ['execution','resolution']) assert.ok(text.includes(workAllowanceText('en',kind,allowance[kind])));
  if(mode==='read only'){
   assert.ok(title.includes(tEn('change.replanRuntimeRequired')));
   assert.equal(primary,undefined);
   return;
  }
  assert.equal(primary.label,tEn(active?'change.openReplanConfirmation':'change.replanReviewRuntimeSetup'));
  assert.equal(text.includes(profile.dockerContext),active);
  if(mode==='active drift')c.options.runtimeProfile={...profile,dockerContext:'DRIFT'};
  await primary.run();
 };
 h.choose=async(title,rows)=>{
  picks++;
  if(active){
   assert.deepEqual(rows,[tEn('change.reviewBack'),tEn('change.scopeReplanAccept')]);
   if(mode==='active allowance drift'){
    c.store.run("UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind='resolution'",workId);
    return rows[1];
   }
   if(mode==='active draft drift'){
    c.setDraft({conversationId:f.cid,expectedRevision:0,text:'Newer unsent draft'});
    return rows[1];
   }
   return rows[0];
  }
  assert.equal(title,tEn('change.runtimeRequired'));
  assert.ok(!rows.includes(tEn('change.scopeReplanAccept')));
  return rows[mode==='back'?0:1];
 };
 if(mode!=='read only')h.execute=async(command,target)=>{
  setups++;
  assert.deepEqual([command,target],['/setup runtime',f.cid]);
  if(mode==='applied'||mode==='draft changed')await c.applyRuntimeProfile(profile);
  if(mode==='draft changed')c.setDraft({conversationId:f.cid,expectedRevision:0,text:'Newer unsent draft'});
  return 'completed';
 };
 const ledger=workLedger(c), action=registry().execute('/change replan '+workId,f.cid);
 if(mode==='draft changed'||mode==='active draft drift')await assert.rejects(action,/target changed/);
 else if(mode==='active drift')await assert.rejects(action,/active runtime changed/);
 else if(mode==='active allowance drift'){
  await assert.rejects(action,/Original work changed/);
  c.store.run("UPDATE budgets SET lim=lim-1 WHERE lineage=? AND kind='resolution'",workId);
 }
 else assert.equal(await action,mode==='applied'?'completed':'cancelled');
 assert.equal(shows,1);
 assert.equal(picks,mode==='read only'||mode==='active drift'?0:1);
 assert.equal(setups,['saved','applied','draft changed'].includes(mode)?1:0);
 assert.deepEqual(notices,mode==='applied'?[tEn('change.replanRuntimeApplied',{id:workId})]:[]);
 assert.equal(tasks.length,0);
 assert.deepEqual(workLedger(c),ledger);
 f.pass();
});

for (const [locale, withRuntime, kind] of [['en',true,'changed'],['ko',false,'changed'],['en',false,'unavailable']])
test(`criteria-held resume routes directly to original work recovery (${locale}, ${kind})`, async t => {
 const f=await managedWorld(t), h=host(f), shown=[], routes=[];
 assert.equal(await h.registry().execute('/change start Original request with changed rules',f.cid),'started');
 const {workId}=await h.tasks[0].task;
 const criteria=f.c.store.one("SELECT json_extract(data,'$.contractsVersion') AS id FROM change_state WHERE work=?",workId);
 if (kind==='changed') f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?','captured-different-rules',criteria.id);
 else f.c.store.run("UPDATE change_state SET data=json_set(data,'$.contractsVersion','missing-rules') WHERE work=?",workId);
 if (!withRuntime) f.c.options.runtimeProfile=undefined;
 const before=workLedger(f.c);
 h.h.locale=()=>locale;
 h.h.choose=async()=>assert.fail('Criteria-only hold entered runtime setup or confirmation');
 h.h.execute=async(command,target,context)=>{routes.push({command,target,context});return 'completed';};
 h.h.show=async(title,text,primary)=>{shown.push({title,text,label:primary?.label});await primary?.run();};
 try {
    assert.equal(await h.registry().execute('/change resume '+workId,f.cid),'completed');
    assert.equal(shown.length,1);
    assert.equal(shown[0].title,uiText(locale,`criteria.recovery.${kind}`));
    assert.ok(shown[0].text.includes(uiText(locale,kind==='changed'?'criteria.entry':'criteria.recovery.unavailableAction')));
    assert.equal(shown[0].label,uiText(locale,'result.recovery'));
    assert.deepEqual(routes,[{command:'/work '+workId,target:f.cid,context:undefined}]);
    assert.equal(h.tasks.length,1);
    assert.deepEqual(workLedger(f.c),before);
 } finally { f.pass(); }
});

for (const kind of ['execution','resolution'])
test('depleted '+kind+' allowance offers guarded original work recovery without attempting resume',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original request requiring execution',f.cid);
 const {workId}=await h.tasks[0].task;
 f.c.store.run('UPDATE budgets SET lim=consumed WHERE lineage=? AND kind=?',workId,kind);
 const before=workLedger(f.c),routes=[];
 let reviews=0,activateRecovery=false,drift=false;
 h.h.choose=async()=>assert.fail('Depleted allowance opened confirmation');
 h.h.execute=async (...args)=>{routes.push(args);return 'completed';};
 const context={submission:{conversationId:f.cid,text:'/change resume '+workId,revision:1}};
 h.h.show=async(_title,text,primary)=>{
  reviews++;
  assert.ok(text.includes('Original work '+kind+' allowance exhausted'));
  assert.ok(text.includes('/work '+workId));
  assert.equal(primary?.label,'Inspect original work and recovery');
  if(activateRecovery) await primary.run();
  if(drift) f.c.store.run('UPDATE budgets SET lim=lim+1 WHERE lineage=? AND kind=?',workId,kind);
 };
 assert.equal(await h.registry().execute('/change resume '+workId,f.cid,context),'cancelled');
 assert.deepEqual(routes,[]);
 activateRecovery=true;
 assert.equal(await h.registry().execute('/change resume '+workId,f.cid,context),'completed');
 assert.deepEqual(routes,[['/work '+workId,f.cid,context]]);
 assert.equal(reviews,2);assert.equal(h.tasks.length,1);assert.deepEqual(workLedger(f.c),before);
 drift=true;
 await assert.rejects(h.registry().execute('/change resume '+workId,f.cid,context),/Original work changed/);
 assert.equal(routes.length,1);
 assert.equal(h.tasks.length,1);
 f.pass();
});

test('managed resume requires named review and refuses in-place runtime drift',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original exact resume',f.cid);
 const {workId}=await h.tasks[0].task;
 const runtime={...f.c.options.runtimeProfile};
 f.c.options.runtimeProfile=runtime;
 const before=workLedger(f.c);
 let reviews=0;
 h.h.choose=async()=>assert.fail('An incomplete or stale review reached confirmation');
 h.h.show=async(_title,text,primary)=>{
  assert.match(text,/Original exact resume/);
  assert.match(text,/Exact active runtime settings/);
  assert.equal(primary?.label,'Open resume confirmation');
  if(++reviews===1)return;
  await primary.run();
  runtime.dockerContext='CHANGED_IN_PLACE';
 };
 assert.equal(await h.registry().execute('/change resume '+workId,f.cid),'cancelled');
 await assert.rejects(h.registry().execute('/change resume '+workId,f.cid),/active runtime changed/);
 assert.equal(reviews,2);
 assert.equal(h.tasks.length,1);
 assert.deepEqual(workLedger(f.c),before);
 f.pass();
});

for(const changed of ['text','origin'])test('resume review describes held owner feedback and refuses changed '+changed,async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original managed scope',f.cid);
 const {workId}=await h.tasks[0].task;
 const feedback=await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'Clarify the existing scope',mode:'idle'});
 assert.ok(f.c.interactionCore.impacts(workId).some(row=>row.input_id===feedback.inputId&&row.data.effectHold));
 f.c.store.run("UPDATE conversation_inputs SET state='CONFLICTED' WHERE id=?",feedback.inputId);
 const originalDirections=f.c.inspectChangeResumeDirections(workId);
 h.h.show=async(_title,text,primary)=>{
  assert.match(text,/1 retained direction requires independent assessment/);
  assert.match(text,/may stop before implementation/);
  await primary.run();
 };
 h.h.choose=async(_title,rows)=>{
  if(changed==='text')f.c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?','Different text with the same input and direction IDs',feedback.inputId);
  else f.c.store.run("UPDATE sources SET origin=json_set(origin,'$.kind','agent-conversation-input') WHERE id=(SELECT source FROM conversation_inputs WHERE id=?)",feedback.inputId);
  return rows[1];
 };
 await assert.rejects(h.registry().execute('/change resume '+workId,f.cid),/Original work changed/);
 const current=f.c.inspectConversation(f.cid);
 const before=workLedger(f.c);
 await assert.rejects(f.c.resumeConversationChange({conversationId:f.cid,expectedGeneration:current.generation,
   expectedModelRevision:f.c.getConversationModelChoice(f.cid).revision,workId,expectedEpoch:f.c.inspectWork(workId).epoch,
   expectedResumeDirections:originalDirections.fingerprint}),/Retained directions changed before resume/);
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(h.tasks.length,1);
 assert.ok(f.c.interactionCore.impacts(workId)[0].data.effectHold);
 f.pass();
});

for (const state of ['UNKNOWN','QUARANTINED']) test('held '+state+' resume offers exact original cleanup inspection without setup',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original unknown cleanup',f.cid);
 const {workId}=await h.tasks[0].task;
 f.c.options.runtimeProfile=undefined;
 f.c.store.run('UPDATE works SET state=? WHERE id=?',state,workId);
 const routes=[],context={submission:{conversationId:f.cid,text:'/change resume '+workId,revision:1}};
 h.h.execute=async(...args)=>{routes.push(args);return 'cancelled';};
 h.h.choose=async()=>assert.fail('Unknown cleanup must not reach resume confirmation');
 let open=false;
 h.h.show=async(title,detail,primary)=>{
  assert.ok(title.includes('Resume')&&title.includes(state));
  assert.match(detail,/Original cleanup needs recovery/);
  assert.equal(primary?.label,'Inspect original work and recovery');
  if(open)await primary.run();
 };
 const before=workLedger(f.c);
 assert.equal(await h.registry().execute('/change resume '+workId,f.cid,context),'cancelled');
 assert.deepEqual(routes,[]);
 open=true;
 assert.equal(await h.registry().execute('/change resume '+workId,f.cid,context),'cancelled');
 assert.deepEqual(routes,[['/work '+workId,f.cid,context]]);
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(h.tasks.length,1);
 f.pass();
});

test('cancel requires explicit exact-work confirmation and retains consumed allowance',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Keep identity',f.cid);const first=await h.tasks[0].task,before=workLedger(f.c);
 const show=h.h.show;
 h.h.show=async(_title,text,primary)=>{
  assert.ok(text.includes('Keep identity'));
  assert.equal(primary?.label,uiText('en','change.openCancelConfirmation'));
 };
 h.h.choose=async()=>assert.fail('Closing cancellation review must not open confirmation');
 assert.equal(await h.registry().execute('/change cancel '+first.workId,f.cid),'cancelled');
 assert.deepEqual(workLedger(f.c),before);
 h.h.show=show;
 h.h.choose=async(_title,rows)=>rows[0];assert.equal(await h.registry().execute('/change cancel '+first.workId,f.cid),'cancelled');assert.deepEqual(workLedger(f.c),before);
 let sawScope=false;h.h.choose=async(_title,rows)=>{const exact=rows.find(row=>row==='Cancel this work and its delegated executions');sawScope=!!exact;return exact;};await h.registry().execute('/change cancel '+first.workId,f.cid);assert.equal(sawScope,true);assert.equal(f.c.inspectWork(first.workId).state,'CANCELLED');assert.deepEqual(workLedger(f.c).budgets,before.budgets);f.pass();
});
test('backing out of catalogue Resume after an owner handoff keeps the new pane',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Retain the owner pane',f.cid);
 const {workId}=await h.tasks[0].task;
 f.c.setDraft({conversationId:f.cid,expectedRevision:0,text:'Original owner draft'});
 f.c.setDraft({conversationId:f.other,expectedRevision:0,text:'Other pane draft'});
 let selected=f.other,menus=0;
 h.h.isCurrent=id=>id===selected;
 h.h.controls.activateSource=async id=>{selected=id;};
 h.h.controls.draft=id=>f.c.inspectConversation(id).draft.text;
 h.h.choose=async(title,rows)=>{
  if(title.startsWith('Managed changes')){menus++;return rows.find(row=>row==='Resume a retained change');}
  if(title.startsWith('Resume managed change')){menus++;return rows.find(row=>row.includes(workId));}
  if(title.startsWith('Resume review only'))return rows.find(row=>row.startsWith('Open original conversation'));
  if(title.startsWith('Resume ·'))return rows[0];
  assert.fail('Unexpected catalogue step: '+title);
 };
 const before=workLedger(f.c);
 assert.equal(await h.registry().execute('/change',f.other),'cancelled');
 assert.equal(menus,2);
 assert.equal(selected,f.cid);
 assert.equal(h.tasks.length,1);
 assert.equal(f.c.inspectConversation(f.cid).draft.text,'Original owner draft');
 assert.equal(f.c.inspectConversation(f.other).draft.text,'Other pane draft');
 assert.deepEqual(workLedger(f.c),before);
 f.pass();
});

for(const mode of ['unrelated error','result also unavailable','restored during review','same-work recovery'])
test('direct managed recovery corroborates exact assessment failure · '+mode,async t=>{
 const f=await managedWorld(t),c=f.c,h=host(f);
 const {workId}=await c.beginChange({projectId:'P',request:'Original unavailable assessment'});
 const original=c.store.one('SELECT phase,plan FROM change_state WHERE work=?',workId);
 const draft='Keep this separate unsent draft';
 c.setDraft({conversationId:f.cid,expectedRevision:0,text:draft});
 h.h.controls.draft=()=>draft;
 const error=Error('Original assessment exception');
 if(mode!=='unrelated error')
  c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",workId);
 if(mode==='unrelated error'||mode==='result also unavailable')
  t.mock.method(c,'inspectChange',()=>{throw error;});
 if(mode==='result also unavailable')t.mock.method(c,'inspectChangeResult',()=>{throw Error('Secondary result read failure');});
 const old=workLedger(c),routes=[];
 h.h.execute=async(command,target)=>{
  routes.push([command,target]);return 'cancelled';
 };
 h.h.show=async(_title,text,primary)=>{
  assert.ok(text.includes('/work '+workId));
  assert.ok(text.includes('Required immutable version absent'));
  if(mode==='restored during review')
   c.store.run('UPDATE change_state SET phase=?,plan=? WHERE work=?',original.phase,original.plan,workId);
  if(primary)await primary.run();
 };
 const command='/change '+(mode==='result also unavailable'?'inspect':'resume')+' '+workId;
 const outcome=h.registry().execute(command,f.cid);
 if(mode==='unrelated error'||mode==='result also unavailable')await assert.rejects(outcome,cause=>cause===error);
 else if(mode==='restored during review')await assert.rejects(outcome,/Original result changed|Original work changed/);
 else assert.equal(await outcome,'cancelled');
 if(mode==='restored during review')
  c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",workId);
 assert.deepEqual(routes,mode==='same-work recovery'?[['/work '+workId,f.cid]]:[]);
 assert.deepEqual(workLedger(c),old);
 assert.equal(c.inspectConversation(f.cid).draft.text,draft);
 assert.equal(h.tasks.length,0);
 f.pass();
});

test('explicit cancellation uses owned custody even when the selected plan is unavailable',async t=>{
 const f=await managedWorld(t),c=f.c,h=host(f);
 const {workId}=await c.beginChange({projectId:'P',request:'Original cancellation target'});
 c.store.run("UPDATE change_state SET phase='PLAN_READY',plan='missing-original-plan' WHERE work=?",workId);
 assert.equal(c.inspectWorkRecovery(workId).recoveryHold.kind,'unavailable');
 const prior=c.inspectWork(workId),allowance=c.inspectWorkAllowance(workId);
 let read=false;
 h.h.show=async(_title,text,primary)=>{read=true;assert.ok(text.includes('Original cancellation target'));await primary?.run();};
 h.h.choose=async(_title,rows)=>rows[0];
 assert.equal(await h.registry().execute('/change cancel '+workId,f.cid),'cancelled');
 assert.equal(c.inspectWork(workId).state,'ACTIVE');
 assert.equal(read,true);
 h.h.choose=async(_title,rows)=>rows[1];
 assert.equal(await h.registry().execute('/change cancel '+workId,f.cid),'completed');
 const cancelled=c.inspectWork(workId);
 assert.equal(cancelled.state,'CANCELLED');
 assert.deepEqual(cancelled.runs,prior.runs);
 assert.deepEqual(c.inspectWorkAllowance(workId).execution,allowance.execution);
 assert.deepEqual(c.inspectWorkAllowance(workId).resolution,allowance.resolution);
 assert.equal(c.store.one('SELECT plan FROM change_state WHERE work=?',workId).plan,'missing-original-plan');
 assert.equal(h.tasks.length,0);
 f.pass();
});

test('resume handoff rechecks the opened owner and does not transfer another conversation draft acknowledgement',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Retain both drafts',f.cid);const id=(await h.tasks[0].task).workId;
 for(const [cid,text] of [[f.cid,'Owner draft'],[f.other,'Other draft']])f.c.setDraft({conversationId:cid,expectedRevision:0,text});
 const launches=[];h.h.controls.launch=(cid,task,workId,submission)=>{launches.push({cid,task,workId,submission});void task.catch(()=>{});};
 const context={submission:{conversationId:f.other,text:'Other draft',revision:1},acknowledgeSubmission:()=>assert.fail('Foreign draft acknowledgement')};
 h.h.choose=async(title,rows)=>title.startsWith('Resume ·')?rows.find(row=>row==='Resume this original work'):rows.find(row=>row.startsWith('Open original conversation'));
 assert.equal(await h.registry().execute('/change resume '+id,f.other,context),'started');assert.equal(launches.length,1);assert.equal(launches[0].cid,f.cid);assert.equal(launches[0].workId,id);assert.equal(launches[0].submission,undefined);await launches[0].task;
 assert.equal(f.c.inspectConversation(f.cid).draft.text,'Owner draft');assert.equal(f.c.inspectConversation(f.other).draft.text,'Other draft');
 const before=f.calls.length;
 const pick=h.h.choose;h.h.choose=async(title,rows)=>{
  const view=f.c.inspectConversation(f.cid),language=f.c.getConversationLanguage(f.cid);
  f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});
  return pick(title,rows);
 };
 await assert.rejects(h.registry().execute('/change resume '+id,f.other),/changed while opening resume/);
 assert.deepEqual(h.sources,[f.cid]);assert.equal(h.tasks.length,1);assert.equal(launches.length,1);
 h.h.choose=pick;h.h.controls.activateSource=async()=>{f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);};
 await assert.rejects(h.registry().execute('/change resume '+id,f.other),/changed while opening resume/);assert.equal(f.calls.length,before);assert.equal(launches.length,1);
 f.c.store.run('UPDATE conversations SET project=NULL WHERE id=?',f.cid);
 h.h.choose=async()=>assert.fail('Incompatible original project must refuse before offering navigation');
 await assert.rejects(h.registry().execute('/change resume '+id,f.other),/Reopen the original conversation in project P/);
 assert.equal(f.calls.length,before);assert.equal(launches.length,1);f.pass();
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
 const before=workLedger(f.c),shown=[],submission={conversationId:f.cid,text:'/inputs',revision:7},context={submission};let workMenus=0,heldMenus=0,requestMenus=0,requestViews=0,confirmations=0,registry;
 const choose=async(title,rows)=>{
  if(title.startsWith('Retained requests'))return ++requestMenus===1?rows[0]:undefined;
  if(title==='Retained request · recovery held')return ++heldMenus===1?rows[1]:rows[0];
  if(title.startsWith('Work recovery')){assert.equal(rows[0],'Back');workMenus++;return workMenus===3?undefined:rows.find(row=>row.startsWith(workMenus===1?'Review managed change':'Review resume'));}
  if(title.startsWith('Resume ·')){confirmations++;assert.equal(rows[0],'Back without changes');return rows[0];}
  assert.fail('Unexpected dialog '+title);
 };
 const show=async(title,text)=>shown.push({title,text});
 registry=new HostCommands([
  ...inputCommands({controller:f.c,isCurrent:()=>true,choose,show:async(title,text,primary)=>{await show(title,text);if(++requestViews===1)await primary.run();},notice(){},retry:async()=>assert.fail('Held input retried'),inspectWork:async(target,workId,ctx)=>{assert.equal(ctx,context);return registry.execute('/work '+workId,target,ctx);}}),
  ...workCommands({controller:f.c,isCurrent:()=>true,choose,show,input:async()=>undefined,notice(){},activate:async()=>assert.fail('Unexpected redirect'),execute:async(command,target,ctx)=>{assert.equal(ctx,context);return registry.execute(command,target,ctx);}}),
  ...changeCommands({...h.h,choose,show:async(title,text,primary)=>{await show(title,text);await primary?.run();}}),
 ]);
 assert.equal(await registry.execute('/inputs',f.cid,context),'cancelled');assert.equal(workMenus,3);assert.equal(confirmations,1);
 assert.equal(heldMenus,2);assert.equal(requestViews,2);assert.equal(requestMenus,2);
 assert.ok(shown.some(row=>row.text.includes(uiText('en','change.inspectRecovery',{id}))));
 assert.deepEqual(workLedger(f.c),before);assert.equal(h.tasks.length,1);f.pass();
});
test('work navigation preserves original resume launch and submission; stale work refuses before routing',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original identity',f.cid);const id=(await h.tasks[0].task).workId;
 let registry,mutate=false,registryPicks=0;const context={submission:{conversationId:f.cid,text:'/work '+id,revision:4}},choose=async(title,rows)=>{
  if(title.startsWith('Retained requests'))return rows[0];
  if(title==='Retained request · recovery held')return rows[1];
  if(title.startsWith('Original work and allowances')){registryPicks++;assert.equal(registryPicks,1);return rows.find(row=>row.includes(id));}
  if(title.startsWith('Work recovery')){
   if(title.includes('Work changed while this menu was open'))return undefined;
   if(mutate)f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);
   return rows.find(row=>row.startsWith('Review resume'));
  }
  if(title.startsWith('Resume ·'))return rows.find(row=>row==='Resume this original work');
  return rows[0];
 };
 f.c.inspectConversationInputs=()=>[{inputId:'held',text:'Follow-up',eligible:false,undispatched:true,blockingWorkIds:[id],fingerprint:'fixed',explanation:'Retained blocker'}];
 const launches=[];registry=new HostCommands([
  ...inputCommands({controller:f.c,isCurrent:()=>true,choose,show:async(_title,_text,primary)=>primary.run(),notice(){},retry:async()=>assert.fail('Held input retried'),inspectWork:(target,workId,ctx)=>registry.execute('/work '+workId,target,ctx)}),
  ...workCommands({controller:f.c,isCurrent:()=>true,choose,show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async(command,target,ctx)=>registry.execute(command,target,ctx)}),
  ...changeCommands({...h.h,choose,controls:{...h.h.controls,launch:(target,task,workId,submission)=>{launches.push({target,task,workId,submission});void task.catch(()=>{});}}}),
 ]);
 assert.equal(await registry.execute('/inputs',f.cid,context),'started');assert.equal(launches.length,1);assert.equal(launches[0].submission,context.submission);assert.equal(launches[0].workId,id);await launches[0].task;
 assert.equal(await registry.execute('/work',f.cid,context),'started');assert.equal(registryPicks,1);assert.equal(launches.length,2);assert.equal(launches[1].submission,context.submission);await launches[1].task;
 mutate=true;assert.equal(await registry.execute('/work '+id,f.cid,context),'cancelled');assert.equal(launches.length,2);f.pass();
});
test('work recovery offers a delivered task resume only while held feedback remains',async t=>{
 const f=await managedWorld(t),h=host(f);
 await h.registry().execute('/change start Original delivered task',f.cid);
 const {workId:id}=await h.tasks[0].task;
 let feedback=false, reviewOpened=false;
 f.c.store.run("UPDATE works SET state='DELIVERED' WHERE id=?",id);
 f.c.store.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work=?",id);
 const choose=async(title,rows)=>{
  if(title.startsWith('Work recovery')){
   const resume=rows.find(row=>row.startsWith('Review resume'));
   assert.equal(!!resume,feedback);
   if(feedback)assert.match(title,/Retained directions awaiting independent assessment/);
   return reviewOpened ? undefined : resume;
  }
  assert.match(title,/^Resume/);
  reviewOpened=true;
  return rows[0];
 };
 const registry=new HostCommands([
  ...workCommands({controller:f.c,isCurrent:()=>true,choose,input:async()=>undefined,show:async()=>{},notice(){},activate:async()=>{},
   execute:(cmd,target,ctx)=>registry.execute(cmd,target,ctx)}),
  ...changeCommands({...h.h,choose}),
 ]);
 assert.equal(await registry.execute('/work '+id,f.cid),'cancelled');
 await f.c.queueConversationInput({conversationId:f.cid,expectedGeneration:f.c.inspectConversation(f.cid).generation,text:'Retained follow-up for delivered work',mode:'idle'});
 feedback=true;
 const before=workLedger(f.c);
 assert.equal(await registry.execute('/work '+id,f.cid),'cancelled');
 assert.equal(h.tasks.length,1);
 assert.deepEqual(workLedger(f.c),before);
 f.pass();
});

test('work resume carries its intent to original source review and refuses a changed conversation before routing',async t=>{
 const f=await managedWorld(t),h=host(f);await h.registry().execute('/change start Original source',f.cid);const id=(await h.tasks[0].task).workId;
 let registry,current=true,reviews=0;const choose=async(title,rows)=>{if(title.startsWith('Work recovery'))return rows.find(row=>row.startsWith('Review resume'));if(title.startsWith('Resume ·')){reviews++;assert.equal(rows[0],'Back without changes');return rows[0];}return rows.find(row=>row.startsWith('Open original conversation'));};
 registry=new HostCommands([
  ...workCommands({controller:f.c,isCurrent:target=>target===(h.sources.at(-1)??f.other),choose,show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async(command,target,ctx)=>registry.execute(command,target,ctx)}),
  ...changeCommands({...h.h,choose}),
 ]);
 assert.equal(await registry.execute('/work '+id,f.other),'cancelled');assert.equal(reviews,1);assert.deepEqual(h.sources,[f.cid]);assert.equal(h.tasks.length,1);
 const stale=new HostCommands(workCommands({controller:f.c,isCurrent:()=>current,choose:async(_title,rows)=>{current=false;return rows.find(row=>row.startsWith('Review resume'));},show:async()=>{},input:async()=>undefined,notice(){},activate:async()=>{},execute:async()=>assert.fail('Stale source routed')}));
 await assert.rejects(stale.execute('/work '+id,f.cid),/Recovery source changed/);f.pass();
});
test('Korean start confirmation localizes fixed controls and preserves exact owner operands',async t=>{
 const f=await managedWorld(t),request='  원래 요청 {project}\n둘째 줄  ',menus=[],details=[];
 const h=host(f,{locale:()=> 'ko',choose:async(title,rows)=>{menus.push({title,rows});return rows[title==='관리형 작업 요청'?0:1];},
  show:async(title,text,primary)=>{details.push({title,text});assert.equal(primary?.label,'시작 확인 열기');await primary.run();}});
 h.h.controls.draft=()=>request;
 assert.equal(await h.registry().execute('/change start',f.cid),'started');
 const view=await h.tasks[0].task;assert.equal(f.c.inspectWork(view.workId).source.raw,request);
 const menu=menus.find(row=>row.title.startsWith('관리형 작업 시작'));assert.ok(menu);assert.ok(menu.title.includes('original'));assert.equal(menu.rows[0],'변경 없이 돌아가기');
 assert.match(menu.rows[1],/리뷰 준비 완료까지 진행/);assert.ok(details[0].text.includes(JSON.stringify(request)));assert.match(details[0].text,/프로젝트:/);
 assert.equal(h.tasks.length,1);f.pass();
});
