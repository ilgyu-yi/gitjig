import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedRepositoryConfigurationFixture} from '../../.qualification/controller-testing.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {editRepositoryProfile} from '../../dist/ui/repository-profile.js';
import {nativeConfigurationFixture} from '../platform/repository-configuration-fixture.mjs';
async function world(t,options={}){const server=await nativeConfigurationFixture('gitea',options),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-repo-ui-'))),home=path.join(root,'home'),c=await openController({installationHome:home}),source=c.createConversation().conversationId,file=path.join(root,'credential.json');await fs.writeFile(file,'{"token":"fixture-native-token"}',{mode:0o600});configureOwnedRepositoryConfigurationFixture(c,{origin:server.origin,token:'fixture-native-token'});const registered=c.registerRepositoryConfigurationTarget({target:server.target});
 // Controlled owner transport seam; original controller journal and UI remain in use.
 c.configureRepositoryConfigurationCredential=options=>configureOwnedRepositoryConfigurationFixture(c,{...options,origin:server.origin});
 t.after(async()=>{await c.close();await server.close();await fs.rm(root,{recursive:true,force:true});});return {c,server,source,file,targetId:registered.targetId};}
function command(f,choices,inputs=[],hooks={}){const shown=[],notices=[],activity=[],choose=async(title,labels)=>{const next=choices.shift();if(typeof next==='function')return next(title,labels);if(next===undefined)return;const found=labels.find(label=>label.startsWith(next));assert.ok(found,'Missing '+next+' in '+JSON.stringify({title,labels}));return found;},ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose,input:async(title,value)=>{const next=inputs.shift();return typeof next==='function'?next(title,value):next;},show:async(title,text,primary)=>{shown.push({title,text,primary:primary?.label});await primary?.run();},notice:text=>notices.push(text),withActivity:async(target,describe,task)=>{assert.equal(target,f.source);activity.push(describe('en'));try{return await task();}finally{activity.push(null);}},...hooks});return {ui,shown,notices,activity,run:()=>ui.commands[0].run('',f.source)};}
const ledger=c=>JSON.stringify(['works','runs','sources','budgets','effect_operations','effect_receipts'].map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));

test('Korean repository navigation keeps the selected target from the captured page',async t=>{
 const f=await world(t),before=ledger(f.c),inputs=[];
 f.c.setDraft({conversationId:f.source,expectedRevision:0,text:'유지할 초안'});
 const selectedTarget='target:'+f.targetId;
 const replies=['targets',selectedTarget,'identity','back','back','close'];
 const shown=[];
 const h=command(f,[],inputs,{
  uiLocale:()=> 'ko',choose:async()=>assert.fail('Expected stable navigation values'),
  chooseItems:async(title,items,initial)=>{
   const value=replies.shift();
   if(value==='targets'){
    assert.match(title,/저장소 관리/);
    assert.equal(items.find(item=>item.value===value)?.label,'등록된 저장소');
   }
   if(value===selectedTarget){
    assert.match(title,/등록된 저장소 · 대화 프로젝트와 별개/);
    assert.ok(items.find(item=>item.value===value)?.label.includes(f.targetId));
   }
   if(value==='identity')assert.equal(items.find(item=>item.value===value)?.label,'저장소 식별 정보 보기');
   if(value==='back'&&title.includes('등록된 저장소 · 대화 프로젝트와 별개'))assert.equal(initial,selectedTarget);
   return value;
  },
  show:async(title,body)=>shown.push({title,body}),
 });
 assert.equal(await h.run(),'cancelled');
 assert.deepEqual(replies,[]);
 assert.match(shown[0].title,/등록된 저장소 식별 정보/);
 assert.ok(shown[0].body.includes(f.targetId));
 assert.equal(ledger(f.c),before);
 assert.equal(f.server.requests.length,0);
 assert.equal(f.c.inspectConversation(f.source).draft.text,'유지할 초안');
 await h.ui.close();
});

test('Korean plan confirmation distinguishes Back from applying the exact registered destination',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});
 const before=ledger(f.c),requests=f.server.requests.length;
 const selectedPlan='plan:'+plan.planId;
 const replies=['plans',selectedPlan,'apply','back','apply','apply','back','back','close'];
 let credentials=0;
 const h=command(f,[],[],{
  uiLocale:()=> 'ko',choose:async()=>assert.fail('Expected stable consent choices'),
  chooseItems:async(title,items,initial)=>{
   const value=replies.shift();
   if(title.includes('설정 적용 확인')){
    assert.equal(items[0].value,'back');
    assert.ok(title.includes(plan.planId));
    assert.ok(title.includes(f.server.target.apiBase));
    assert.ok(title.includes('owner/repo'));
   }
   if(value==='back'&&items.some(item=>item.value===selectedPlan))assert.equal(initial,selectedPlan);
   return value;
  },
  input:async(title)=>{
   assert.match(title,/저장소 자격 증명 JSON 파일/);
   credentials++;
   return undefined;
  },
 });
 assert.equal(await h.run(),'cancelled');
 assert.equal(credentials,1);
 assert.deepEqual(replies,[]);
 assert.equal(ledger(f.c),before);
 assert.equal(f.server.requests.length,requests);
 await h.ui.close();
});
test('repository field forms preserve false/zero/empty/unmanaged and cancellation without admitting work',async()=>{
 const choices=['protection.fields.required_approvals','Edit value','protection.fields.dismiss_stale_approvals','false','repository.allow_merge_commits','false','repository.allow_merge_commits','Leave unmanaged','protection.fields.status_check_contexts','Edit value','Save list','Use staged profile'];
 const value=await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=> '0',choose:async(_t,rows)=>{const pick=choices.shift(),found=rows.find(r=>r.startsWith(pick));assert.ok(found,String(pick));return found;}},'gitea','main');assert.equal(value.protection.fields.required_approvals,0);assert.equal(value.protection.fields.dismiss_stale_approvals,false);assert.deepEqual(value.protection.fields.status_check_contexts,[]);assert.equal(value.repository,undefined);
 assert.equal(await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=>assert.fail(),choose:async()=>undefined},'gitlab','main'),undefined);
 const ghChoices=['ruleset.pullRequest.approvingCount','Edit value','Use staged profile'];const gh=await editRepositoryProfile({show:async()=>assert.fail('Unexpected validation error'),guard(){},input:async()=> '0',choose:async(_t,rows)=>{const pick=ghChoices.shift();return rows.find(r=>r.startsWith(pick));}},'github','main');assert.equal(gh.ruleset.pullRequest.approvingCount,0);
});
test('opening targets/plan inspection is pure and keeps unrelated draft/model/ledger and requests',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});f.c.setDraft({conversationId:f.source,expectedRevision:0,text:'한국어 original'});const before=ledger(f.c),requests=f.server.requests.length;
 const h=command(f,['Registered targets',(_t,rows)=>rows[0],'Inspect target identity','Back','Back','Retained configuration plans',(_t,rows)=>rows[0],'Inspect original plan','Back','Back','Close']);await h.run();assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);assert.equal(f.c.inspectConversation(f.source).draft.text,'한국어 original');assert.ok(h.shown.some(v=>v.text.includes(plan.planId)));await h.ui.close();
});

for(const drift of [false,true])test('an interrupted imported preview '+(drift?'refuses a changed original':'reuses the loaded profile and original'),{timeout:5000},async t=>{
 let first=true, enter;
 const entered=new Promise(resolve=>{enter=resolve;});
 const f=await world(t,{intercept({req,relative}){
  if(!first||req.method!=='GET'||relative!=='/user')return false;
  first=false;enter();return true;
 }});
 const file=path.join(path.dirname(f.file),'desired.json'),profile=structuredClone(f.server.profile);
 profile.protection.fields.required_approvals=3;
 await fs.writeFile(file,JSON.stringify(profile),{mode:0o600});
 let stopped, attempts=0, requestsAtStop;
 const retry=async(_title,rows)=>{
  [stopped]=f.c.listRepositoryConfigurationPlans().plans;
  assert.equal(stopped.recordedPhase,'REFUSED');
  requestsAtStop=f.server.requests.length;
  if(drift)f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.nextAction','Changed by another owner view') WHERE id=?",stopped.planId);
  await fs.writeFile(file,JSON.stringify({...profile,protection:{...profile.protection,fields:{required_approvals:7}}}));
  return rows.find(row=>row==='Review settings for another preview');
 };
 const h=command(f,['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Import private profile file',retry,'Back','Back','Back','Close'],[file,f.file,f.file],{
  withActivity:async(_target,_description,task,interrupt)=>{
   const pending=task();
   if(++attempts===1){await entered;interrupt.abort();}
   return pending;
  },
 });
 t.after(()=>h.ui.close());
 if(drift){
  await assert.rejects(h.run(),/Original configuration plan changed/);
  assert.equal(f.server.requests.length,requestsAtStop);
 }else{
  await h.run();
  const resumed=f.c.inspectRepositoryConfiguration(stopped.planId);
  assert.deepEqual([resumed.workId,resumed.revision,resumed.phase],[stopped.workId,2,'PREVIEWED']);
  assert.equal(resumed.plan.profile.protection.fields.required_approvals,3);
 }
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM works').n,1);
 assert.equal(f.c.store.one('SELECT COUNT(*) n FROM effect_delegations').n,1);
 assert.ok(f.server.requests.every(request=>request.method==='GET'));
 assert.ok(h.shown.some(item=>item.title==='Settings preview stop requested · original plan retained'&&item.text.includes(stopped.planId)));
});

test('stopping during credential file access keeps the imported settings before preview admission', async t => {
 const f=await world(t),before=ledger(f.c);
 const file=path.join(path.dirname(f.file),'desired.json');
 await fs.writeFile(file,JSON.stringify(f.server.profile),{mode:0o600});
 const retry=async(_title,rows)=>{
  assert.equal(ledger(f.c),before);
  assert.equal(f.server.requests.length,0);
  await fs.unlink(file);
  return rows.find(row=>row==='Review settings for another preview');
 };
 let activities=0;
 const h=command(f,['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Import private profile file',retry,'Back','Back','Back','Close'],
  [file,path.join(path.dirname(f.file),'missing-credential.json'),f.file],{
   withActivity:async(_target,_description,task,interrupt)=>{
    const pending=task();
    if(++activities===1)interrupt.abort();
    return pending;
   },
  });
 t.after(()=>h.ui.close());
 await h.run();
 const [plan]=f.c.listRepositoryConfigurationPlans().plans;
 assert.equal(plan?.recordedPhase,'PREVIEWED');
 assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).revision,1);
 assert.equal(activities,2);
 assert.equal(h.shown.some(item=>item.primary==='Choose another credential file'),false);
});

test('a late stop request preserves the confirmed settings outcome in the terminal', async t => {
 const f = await world(t, {intercept({req, relative, body, state, res}) {
  if (req.method !== 'PATCH' || relative !== '/repos/owner/repo') return false;
  Object.assign(state.repository, body);
  res.destroy();
  return true;
 }});
 const {protection, ...profile} = f.server.profile;
 const plan = await f.c.previewRepositoryConfiguration({targetId:f.targetId, profile});
 assert.equal((await f.c.applyRepositoryConfiguration({planId:plan.planId})).phase,'UNKNOWN');
 const h = command(f,['Retained configuration plans',(_title,rows)=>rows[0],'Reconcile original request','Back','Back','Close'],[f.file],{
  withActivity:async(_target,_describe,task,interrupt)=>{
   const result=await task();
   assert.equal(result.phase,'CONFIRMED');
   interrupt.abort();
   return result;
  },
 });
 t.after(()=>h.ui.close());
 await h.run();
 assert.equal(h.shown.at(-1).title,'Repository outcome · inspect actual scope and next action');
 assert.equal(f.server.requests.filter(request=>request.method==='PATCH').length,1);
});

test('a refused preview reports the retained operation without offering an original preview',async t=>{
 const f=await world(t);f.server.state.actorId=8;
 const h=command(f,['Registered targets',(_t,rows)=>rows[0],'New configuration preview','Edit recommendation fields',
  'Update existing rule','Use staged profile','Back','Back','Close'],['main',f.file]);
 await h.run();
 const [entry]=f.c.listRepositoryConfigurationPlans().plans;
 const result=h.shown.find(item=>item.title==='Retained configuration · preview unavailable');
 assert.equal(result?.primary,undefined);
 assert.match(result?.text??'',/^REFUSED/);
 assert.ok(result.text.includes(entry.planId));
 assert.ok(h.notices.some(notice=>notice.startsWith('Preview unavailable')&&notice.includes(entry.planId)));
 assert.ok(f.server.requests.every(request=>request.method==='GET'));
 await h.ui.close();
});
test('the selected target menu refuses an action if its identity changed while open',async t=>{
 const f=await world(t),before=ledger(f.c);
 const h=command(f,['Registered targets',(_t,rows)=>rows[0],()=>{
  f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);
  return 'Inspect target identity';
 }],[],{show:async()=>assert.fail('Changed target opened an inspection')});
 await assert.rejects(h.run(),/Selected repository target changed/);
 assert.equal(ledger(f.c),before);
 assert.equal(f.server.requests.length,0);
 await h.ui.close();
});
test('staged field preview needs no desired JSON and retains original plan without applying',async t=>{
 const f=await world(t),h=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile','Back','Back','Back','Close'],['main',f.file]);await h.run();const plans=f.c.listRepositoryConfigurationPlans().plans;assert.equal(plans.length,1);assert.equal(plans[0].recordedPhase,'PREVIEWED');assert.ok(h.notices.some(n=>n.includes(plans[0].planId)));assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);assert.ok(h.shown.some(v=>v.title.startsWith('Staged profile · no work or requests yet')));assert.doesNotMatch(JSON.stringify(h.shown)+JSON.stringify(h.notices),/fixture-native-token/);await h.ui.close();
});
test('imported profile cancellation and target replacement stop before preview',async t=>{
 for(const stage of ['dismiss','cancel-credential','review','credential']){
  const f=await world(t),profile=path.join(path.dirname(f.file),'desired.json');
  await fs.writeFile(profile,JSON.stringify(f.server.profile),{mode:0o600});
  const before=ledger(f.c),requests=f.server.requests.length;
  const replaceTarget=()=>f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);
  const choices=['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Import private profile file','Back','Back','Close'];
  const h=command(f,choices,[profile],{
   input:async title=>{
    if(title.startsWith('Private desired profile'))return profile;
    assert.match(title,/Private repository credential/);
    if(stage==='cancel-credential')return;
    assert.equal(stage,'credential','Credential entry was not selected');
    replaceTarget();
    return f.file;
   },
   show:async(title,text,primary)=>{
    assert.match(title,/Staged profile/);
    assert.match(text,/Repository: "owner\/repo"/);
    assert.match(text,/Registered actor ID: 7/);
    assert.equal(primary?.label,'Continue to preview credentials');
    if(stage==='dismiss')return;
    await primary.run();
    if(stage==='review')replaceTarget();
   },
  });
  if(stage==='dismiss'||stage==='cancel-credential')await h.run();
  else await assert.rejects(h.run(),/Selected repository target changed/);
  assert.equal(ledger(f.c),before);
  assert.equal(f.server.requests.length,requests);
  await h.ui.close();
 }
});

test('preview credential correction prefills the path and checks the original target again',async t=>{
 for(const drift of [false,true]){
  const f=await world(t),missing=path.join(path.dirname(f.file),'missing-credential.json');
  const before=ledger(f.c),requests=f.server.requests.length;
  const choices=['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile','Back','Back','Close'];
  let corrections=0;
  const h=command(f,choices,['main',missing,(title,value)=>{
   assert.equal(drift,false,'Changed target opened another credential prompt');
   assert.match(title,/Private repository credential/);assert.equal(value,missing);
   return f.file;
  }],{
   show:async(title,text,primary)=>{
    if(title==='Credential file could not be read'){
     corrections++;
     assert.match(text,/still waiting for a credential file/);
     assert.ok(!text.includes(missing));
     assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);
     assert.equal(primary?.label,'Choose another credential file');
     if(drift)f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);
    }
    if(title.startsWith('Retained preview')){
     assert.equal(primary?.label,'Open original configuration plan');
     return;
    }
    await primary?.run();
   },
  });
  if(drift){
   await assert.rejects(h.run(),/Selected repository target changed/);
   assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);
  }else{
   await h.run();
   assert.equal(f.c.listRepositoryConfigurationPlans().plans.length,1);
   assert.equal(f.c.listRepositoryConfigurationPlans().plans[0].recordedPhase,'PREVIEWED');
   assert.ok(f.server.requests.every(request=>request.method==='GET'));
  }
  assert.equal(corrections,1);await h.ui.close();
 }
});

test('the preview result cannot open a changed original plan or target',async t=>{
 for(const changed of ['plan','target']){
  const f=await world(t);
  const choices=['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile',()=>assert.fail('Changed preview opened a plan')];
  let requests, retained;
  const h=command(f,choices,['main',f.file],{show:async(title,_text,primary)=>{
   assert.ok(primary);
   if(title.startsWith('Retained preview')){
    assert.equal(primary.label,'Open original configuration plan');
    const [plan]=f.c.listRepositoryConfigurationPlans().plans;
    if(changed==='plan')
     f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.revision',2) WHERE id=?",plan.planId);
    else
     f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);
    requests=f.server.requests.length;
    retained=ledger(f.c);
   }
   await primary.run();
  }});
  await assert.rejects(h.run(),changed==='plan'?/Retained preview changed/:/Selected repository target changed/);
  assert.equal(ledger(f.c),retained);
  assert.equal(f.server.requests.length,requests);
  await h.ui.close();
 }
});

test('a refused admitted preview retains its original once and leaves the staged editor',async t=>{
 const f=await world(t,{intercept:({send})=>{send({message:'Fixture denied preview'},403);return true;}});
 const choices=['Registered targets',(_title,rows)=>rows[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile','Back','Back','Close'];
 const h=command(f,choices,['main',f.file],{show:async(title,text,primary)=>{
  if(title.startsWith('Retained preview')){
   assert.match(text,/^REFUSED ·/);
   assert.equal(primary,undefined);
  }else await primary?.run();
 }});await h.run();
 const plans=f.c.listRepositoryConfigurationPlans().plans;
 assert.equal(plans.length,1);assert.equal(plans[0].recordedPhase,'REFUSED');
 assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,1);
 assert.equal(f.server.requests.length,1);assert.equal(f.server.requests[0].method,'GET');
 assert.equal(choices.length,0);await h.ui.close();
});

test('explicit selected original apply/audit uses existing journal and does not reset allowance',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),h=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original','Audit selected','Back','Back','Close'],[f.file,f.file]);await h.run();assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.c.inspectWork(plan.workId).allowance.consumed,5);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,2);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);
 const outcomes=h.shown.filter(value=>value.title.startsWith('Repository outcome'));
 assert.match(outcomes[0].text,/^CONFIRMED · Selected settings were observed matching/);
 assert.match(outcomes[1].text,/^AUDIT MATCH · This audit observed all selected settings matching/);
 assert.match(outcomes[1].text,/Historical operation phase \(separate from this audit\): "CONFIRMED"/);
 await h.ui.close();
});

test('valid long native contexts refuse incomplete application review before confirmation or controller dispatch',async t=>{
 const f=await world(t),contexts=prefix=>Array.from({length:100},(_,index)=>(prefix+String(index).padStart(3,'0')).padEnd(256,'x'));
 f.server.state.protection.status_check_contexts=contexts('old-');
 const profile={provider:'gitea',version:'complete-review/v1',protection:{name:'main',fields:{status_check_contexts:contexts('new-')}}};
 const plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile});assert.equal(plan.phase,'PREVIEWED');
 assert.equal(plan.plan.steps[0].fields.find(value=>value.path==='protection.status_check_contexts'||value.path==='status_check_contexts').intended.length,100);
 const before=ledger(f.c),requests=f.server.requests.length;let confirmations=0,dispatches=0;
 const apply=f.c.applyRepositoryConfiguration.bind(f.c);f.c.applyRepositoryConfiguration=(...args)=>{dispatches++;return apply(...args);};
 const h=command(f,['Retained configuration plans',(_t,rows)=>rows[0],'Review changes',()=>{confirmations++;return 'Apply original';}],[()=>assert.fail('Incomplete review must refuse before credentials')]);
 await assert.rejects(h.run(),error=>/Complete repository application review.*36000/u.test(error.message)&&error.message.includes(plan.planId)&&error.message.includes(plan.workId)&&error.message.includes('repo plan --plan'));
 assert.equal(confirmations,0);assert.equal(dispatches,0);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,requests);
 assert.equal(f.c.listRepositoryConfigurationPlans().plans[0].planId,plan.planId);assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'PREVIEWED');await h.ui.close();
});

test('multiple application review pages require the named final action and reject revision drift',async t=>{
 const f=await world(t);
 const contexts=prefix=>Array.from({length:65},(_,index)=>(prefix+index).padEnd(247,'x'));
 f.server.state.protection.status_check_contexts=contexts('old-');
 const plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:{provider:'gitea',version:'paged-review',protection:{name:'main',fields:{status_check_contexts:contexts('new-')}}}});
 const before=ledger(f.c),requests=f.server.requests.length;
 for(const scenario of ['first-dismissal','last-dismissal','revision-drift']){
  const pages=[];
  const choices=['Retained configuration plans',(_title,rows)=>rows[0],'Review changes','Back','Back','Close'];
  const h=command(f,choices,[],{
   input:async()=>assert.fail('Review must not read credentials'),
   show:async(title,_text,primary)=>{
    pages.push(title);
    assert.ok(primary);
    if(pages.length===1){
     assert.equal(primary.label,'Review the next page');
     if(scenario==='first-dismissal')return;
     await primary.run();
     if(scenario==='revision-drift')
      f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.revision',2) WHERE id=?",plan.planId);
    }else{
     assert.equal(primary.label,'Open Apply confirmation');
    }
   },
  });
  if(scenario==='revision-drift')await assert.rejects(h.run(),/Original configuration plan changed/);
  else{
   await h.run();
   assert.equal(choices.length,0);
   assert.equal(ledger(f.c),before);
  }
  assert.equal(pages.length,scenario==='last-dismissal'?2:1);
  assert.equal(f.server.requests.length,requests);
  await h.ui.close();
 }
});

test('a fresh native audit conflict is readable while the original confirmed phase stays historical',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});
 await f.c.applyRepositoryConfiguration({planId:plan.planId});f.server.state.protection.required_approvals=3;
 const writes=f.server.requests.filter(value=>value.method!=='GET').length,h=command(f,['Retained configuration plans',(_t,r)=>r[0],(title,rows)=>{
  assert.match(title,/CONFIRMED/);assert.ok(!rows.includes('Review changes for application'));return 'Audit selected settings (read only)';
 },'Back','Back','Close'],[f.file]);
 const beforeAudit=ledger(f.c),beforeRequests=f.server.requests.length;
 const unavailable=command(f,['Retained configuration plans',(_title,rows)=>rows[0],()=>'Review changes for application'],[],{
  input:async()=>assert.fail('Unlisted Apply choice must refuse before credentials'),
 });
 await assert.rejects(unavailable.run(),/Unknown UI choice label/);
 assert.equal(unavailable.shown.length,0);
 assert.equal(f.server.requests.length,beforeRequests);
 assert.equal(ledger(f.c),beforeAudit);
 await unavailable.ui.close();
 await h.run();const result=h.shown.find(value=>value.title.startsWith('Repository outcome')),outcome=result.text.split('Original observation · details')[0];
 assert.equal(result.primary,undefined);
 assert.match(outcome,/^AUDIT INCOMPLETE/);assert.match(outcome,/Historical operation phase \(separate from this audit\): "CONFIRMED"/);
 assert.match(outcome,/required_approvals: "conflicting" · current actual 3/);
 assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.server.requests.filter(value=>value.method!=='GET').length,writes);
 await h.ui.close();
});

for (const drift of ['plan','target']) test('audit guidance refuses '+drift+' drift before dispatch',async t=>{
 const f=await world(t),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});
 await f.c.applyRepositoryConfiguration({planId:plan.planId});
 let requestsAtAudit;
 const h=command(f,['Retained configuration plans',(_title,rows)=>rows[0],'Audit selected settings'],[
  f.file,
  (title,value)=>{assert.match(title,/Existing branch/);assert.equal(value,'');return 'main';},
  (title,value)=>{
   assert.match(title,/Private repository credential/);
   assert.equal(value,'');
   if(drift==='plan')
    f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.nextAction','Refreshed original observations') WHERE id=?",plan.planId);
   else
    f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);
   return f.file;
  },
 ],{show:async(title,text,primary)=>{
  assert.match(title,/Repository outcome/);
  assert.match(text,/^AUDIT MATCH/);
  assert.equal(primary?.label,'Inspect current branch policy');
  requestsAtAudit=f.server.requests.length;
  await primary.run();
 }});
 await assert.rejects(h.run(), drift==='plan'?/Original configuration plan changed/:/Selected repository target changed/);
 assert.equal(f.server.requests.length,requestsAtAudit);
 await h.ui.close();
});

test('empty target discovery offers existing registration and cancellation returns without effects or lost draft',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-empty-repo-ui-'))),c=await openController({installationHome:path.join(root,'home')}),source=c.createConversation().conversationId;let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained empty-target command evidence: '+root);});
 c.setDraft({conversationId:source,expectedRevision:0,text:'  Keep original 한국어 draft  '});
 const before=ledger(c),targets=c.listRepositoryConfigurationTargets();let emptyVisits=0;
 c.configureRepositoryConfigurationCredential=()=>assert.fail('Cancelled registration must not configure credentials');
 const h=command({c,source},['Registered targets',(title,labels)=>{emptyVisits++;assert.match(title,/none registered/);assert.deepEqual(labels,['Register repository','Back']);return 'Register repository';},undefined,(title,labels)=>{emptyVisits++;assert.match(title,/none registered/);assert.deepEqual(labels,['Register repository','Back']);return 'Back';},'Close']);
 await h.run();assert.equal(emptyVisits,2);assert.deepEqual(c.listRepositoryConfigurationTargets(),targets);assert.equal(ledger(c),before);
 assert.equal(c.inspectConversation(source).draft.text,'  Keep original 한국어 draft  ');assert.equal(h.shown.length,0);await h.ui.close();passed=true;
});
test('late source/profile and original revision changes refuse before credential configuration or requests',async t=>{
 const f=await world(t);let current=true;const cancelled=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule'],[()=>{current=false;return 'main';}],{isCurrent:()=>current});await assert.rejects(cancelled.run(),/source changed/);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);assert.equal(f.server.requests.length,0);await cancelled.ui.close();
 const p=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),requests=f.server.requests.length,stale=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[()=>{f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.revision',2) WHERE id=?",p.planId);return f.file;}]);await assert.rejects(stale.run(),/plan changed/);assert.equal(f.server.requests.length,requests);await stale.ui.close();
});
test('competing UI actions cannot replace an in-flight configuration credential session',async t=>{
 let hold=false,enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);const f=await world(t,{intercept:async({req})=>{if(hold&&req.method==='GET'){hold=false;enter();await gate;}return false;}}),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});hold=true;
 const first=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original','Back','Back','Close'],[f.file]),task=first.run();await entered;
 const second=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[f.file]);try{await assert.rejects(second.run(),/owns the credential session/);}finally{release();}await task;assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'CONFIRMED');assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,2);await first.ui.close();await second.ui.close();
});
test('UI shutdown after native handoff joins exact original request and retains UNKNOWN without later writes',async t=>{
 let enter;const entered=new Promise(r=>enter=r);const f=await world(t,{intercept:({req,body,state})=>{if(req.method==='PATCH'){Object.assign(state.repository,body);enter();return true;}return false;}}),plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile}),h=command(f,['Retained configuration plans',(_t,r)=>r[0],'Review changes','Apply original'],[f.file]);const task=h.run();void task.catch(()=>{});await entered;await h.ui.close();await assert.rejects(task);assert.equal(f.c.inspectRepositoryConfiguration(plan.planId).phase,'UNKNOWN');assert.equal(f.c.inspectWork(plan.workId).allowance.reserved,0);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,1);
});
test('source navigation after preview admission preserves discoverable original work and names it in recovery',async t=>{
 let current=true;const f=await world(t,{intercept:()=>{current=false;return false;}}),h=command(f,['Registered targets',(_t,r)=>r[0],'New configuration preview','Edit recommendation fields','Update existing rule','Use staged profile'],['main',f.file],{isCurrent:()=>current});
 await assert.rejects(h.run(),error=>{const original=f.c.listRepositoryConfigurationPlans().plans[0];assert.ok(original);assert.equal(original.recordedPhase,'PREVIEWED');return error.message.includes(original.planId)&&error.message.includes(original.workId);});assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,1);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);assert.equal(h.notices.some(n=>n.startsWith('Preview retained')),false);await h.ui.close();
});

async function policyWorld(t,options={}){
 const f=await world(t,{intercept:async args=>{if(await options.intercept?.(args))return true;if(args.relative==='/repos/owner/repo/branches/main'){args.send({name:'main',commit:{id:'1'.repeat(40)},protected:true,effective_branch_protection_name:'main',required_approvals:0});return true;}return false;}});f.server.state.repository.default_branch='main';return f;
}
const policyChoices=()=>['Registered targets',(_t,r)=>r[0],'Inspect current branch policy','Back','Back','Close'];
test('current policy UI reads original target and branch without changing a pending write or its allowance',async t=>{
 const f=await policyWorld(t,{intercept:({req,res,body,state})=>{if(req.method==='PATCH'){Object.assign(state.repository,body);res.destroy();return true;}return false;}}),p=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});assert.equal((await f.c.applyRepositoryConfiguration({planId:p.planId})).phase,'UNKNOWN');const before=ledger(f.c),writes=f.server.requests.filter(r=>r.method!=='GET').length,h=command(f,policyChoices(),['main',f.file]);await h.run();assert.equal(ledger(f.c),before);assert.equal(f.server.requests.filter(r=>r.method!=='GET').length,writes);const result=h.shown.find(v=>v.title.startsWith('Current branch policy'));assert.ok(result);assert.match(result.text,new RegExp(f.targetId));assert.match(result.text,/Selected branch: main/);assert.match(result.text,/UNAVAILABLE/);assert.match(result.text,/required_approvals/);assert.match(result.text,/not complete|Visible current observations/);assert.doesNotMatch(result.text,/fixture-native-token|fixture-private-native/);await h.ui.close();
});
test('policy form cancellation sends no requests or credential substitution and pure target inspection allocates nothing',async t=>{
 const f=await policyWorld(t),before=ledger(f.c);let configurations=0;f.c.configureRepositoryConfigurationCredential=()=>configurations++;
 const acceptInitialValue=(_title,seed)=>{
     assert.equal(seed,'');
     return seed;
 };
 for(const inputs of [[undefined],['main',undefined],[acceptInitialValue,'x'.repeat(1025),undefined]]){
     const h=command(f,policyChoices(),inputs);
     await h.run();
     assert.deepEqual(h.activity,[]);
     await h.ui.close();
 }
 assert.equal(configurations,0);assert.equal(f.server.requests.length,0);assert.equal(ledger(f.c),before);assert.equal(f.c.inspectRepositoryConfigurationTarget(f.targetId).state,'RETAINED');assert.equal(ledger(f.c),before);assert.throws(()=>f.c.inspectRepositoryConfigurationTarget('missing'),/unavailable/);
});
test('changed selected target refuses before configuring credentials and remote actor substitution cannot yield policy',async t=>{
 const f=await policyWorld(t);let configurations=0;const configure=f.c.configureRepositoryConfigurationCredential;f.c.configureRepositoryConfigurationCredential=options=>{configurations++;configure(options);};
 const row=f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.targetId),h=command(f,policyChoices(),['main',()=>{f.c.store.run("UPDATE effect_targets SET data=json_set(data,'$.target.repositoryId',10) WHERE id=?",f.targetId);return f.file;}]);await assert.rejects(h.run(),/Selected repository target changed/);assert.equal(configurations,0);assert.equal(f.server.requests.length,0);await h.ui.close();f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?',row.data,f.targetId);
 f.server.state.actorId=8;const substituted=command(f,policyChoices(),['main',f.file]);await assert.rejects(substituted.run(),/registered|identity|target/i);assert.equal(substituted.shown.length,0);assert.deepEqual(substituted.activity,['Reading the current branch policy',null]);assert.deepEqual(substituted.notices,[]);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM works').n,0);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);await substituted.ui.close();
});
test('concurrent policy reads share the configuration credential lease without replacing original request',async t=>{
 let enter,release,hold=true;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),f=await policyWorld(t,{intercept:async({req})=>{if(hold&&req.method==='GET'){hold=false;enter();await gate;}return false;}}),h=command(f,policyChoices(),['main',f.file]),task=h.run();await entered;assert.deepEqual(h.activity,['Reading the current branch policy']);const competing=command(f,policyChoices(),['main',f.file]);try{await assert.rejects(competing.run(),/owns the credential session/);}finally{release();}await task;assert.deepEqual(h.activity,['Reading the current branch policy',null]);assert.deepEqual(h.notices,[]);assert.equal(h.shown.length,1);assert.equal(competing.shown.length,0);await h.ui.close();await competing.ui.close();
});
test('navigation during policy observation suppresses results for another view and names original target and branch',async t=>{
 let current=true;const f=await policyWorld(t,{intercept:()=>{current=false;return false;}}),h=command(f,policyChoices(),['main',f.file],{isCurrent:()=>current}),before=ledger(f.c);await assert.rejects(h.run(),error=>error.message.includes(f.targetId)&&error.message.includes('main')&&error.message.includes('source changed'));assert.equal(h.shown.length,0);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.some(r=>r.method!=='GET'),false);await h.ui.close();
});
test('UI shutdown aborts and joins an in-flight read without settling existing ledger or dispatching writes',async t=>{
 let enter;const entered=new Promise(r=>enter=r),f=await policyWorld(t,{intercept:({req})=>{if(req.method==='GET'){enter();return true;}return false;}}),before=ledger(f.c),h=command(f,policyChoices(),['main',f.file]),task=h.run();void task.catch(()=>{});await entered;await h.ui.close();await assert.rejects(task,/Policy read/);assert.equal(ledger(f.c),before);assert.equal(f.server.requests.length,1);assert.equal(h.shown.length,0);
});

test('policy number and unsafe text correction stay in the same field and preserve the rest of the profile',async()=>{
 const choices=['ruleset.pullRequest.approvingCount','Edit value','ruleset.name','Edit value','Use staged profile'];
 const inputs=['11','2','Owned\u2028policy','Corrected policy'];
 let priorName;
 const result=await editRepositoryProfile({
  guard(){},show:async()=>assert.fail('Correction belongs in the field'),
  input:async(title,value,issue)=>{
   if(inputs.length===3){assert.equal(value,'11');assert.match(issue,/whole number from 0 to 10/);}
   if(inputs.length===2)priorName=value;
   if(inputs.length===1){assert.equal(value,priorName);assert.match(issue,/without control characters/);}
   assert.ok(title.startsWith(inputs.length>2?'ruleset.pullRequest.approvingCount':'ruleset.name'));
   return inputs.shift();
  },
  choose:async(_title,rows)=>{
   const next=choices.shift();
   if(next==='Use staged profile')assert.ok(rows.includes('ruleset.pullRequest.approvingCount · 2'));
   const row=rows.find(r=>r.startsWith(next));
   assert.ok(row,next);
   return row;
  },
 },'github','main');
 assert.equal(result.ruleset.name,'Corrected policy');
 assert.equal(result.ruleset.pullRequest.approvingCount,2);
 assert.deepEqual([inputs,choices],[[],[]]);
});

test('failed policy preview retains staged values for correction',async()=>{
 const choices=['ruleset.name','Edit value','Use staged profile','ruleset.name','Edit value','Use staged profile'];
 const inputs=['','Corrected policy'];
 let errors=0;
 const result=await editRepositoryProfile({
  guard(){},show:async title=>{errors++;assert.match(title,/retained/);},
  input:async()=>inputs.shift(),choose:async(_title,rows)=>{
   const next=choices.shift();
   return rows.find(row=>row.startsWith(next));
  },
 },'github','main');
 assert.equal(errors,1);
 assert.equal(result.ruleset.name,'Corrected policy');
});

test('duplicate policy context retains staged list and source failures still escape',async()=>{
 const picks=['protection.fields.status_check_contexts','Edit value','Add context','Add context','Save list','Use staged profile'];
 const inputs=['lint','ci\u0085check','lint',undefined],descriptions=[];
 const forms={guard(){},show:async()=>assert.fail('Correction belongs in the field'),input:async(_title,value,description)=>{
  descriptions.push([value,description]);return inputs.shift();
 },choose:async(_title,rows)=>{const next=picks.shift();assert.ok(next);const value=rows.find(r=>r.startsWith(next));assert.ok(value,next);return value;}};
 const result=await editRepositoryProfile(forms,'gitea','main');assert.deepEqual(result.protection.fields.status_check_contexts,['lint']);
 assert.deepEqual(descriptions.slice(0,2),[['',undefined],['',undefined]]);
 assert.equal(descriptions[2][0],'');assert.match(descriptions[2][1],/without control characters/);
 assert.equal(descriptions[3][0],'lint');assert.match(descriptions[3][1],/distinct printable context/);
 const changed=Error('Source changed');await assert.rejects(editRepositoryProfile({...forms,guard(){throw changed;}},'gitea','main'),e=>e===changed);
});

test('policy credential correction keeps the selected branch and leaves a non-path retry blank',async t=>{
    const f=await policyWorld(t);
    const before=ledger(f.c);
    const h=command(f,policyChoices(),['main','NOT_AN_ABSOLUTE_FILE',(_title,seed)=>{
        assert.equal(seed,'');
        assert.equal(f.server.requests.length,0);
        assert.equal(ledger(f.c),before);
        return f.file;
    }]);
    await h.run();
    const correction=h.shown.find(item=>item.title==='Credential file could not be read');
    assert.ok(correction);
    assert.doesNotMatch(correction.text,/NOT_AN_ABSOLUTE_FILE/);
    assert.ok(h.shown.some(item=>item.text.includes('Selected branch: main')));
    assert.ok(f.server.requests.some(item=>item.path.endsWith('/branches/main')));
    assert.ok(f.server.requests.every(item=>item.method==='GET'));
    assert.equal(ledger(f.c),before);
    await h.ui.close();
});

for (const boundary of ['catalogue', 'unreadable catalogue row', 'detail', 'audit outcome']) test('repository plan refuses changed original after '+boundary, async t=>{
 const f=await world(t);
 const plan=await f.c.previewRepositoryConfiguration({targetId:f.targetId,profile:f.server.profile});
 if(boundary==='audit outcome')await f.c.applyRepositoryConfiguration({planId:plan.planId});
 const fromCatalogue=boundary.includes('catalogue');
 let actions=0, changed;
 const drift=()=>{
  if(boundary==='unreadable catalogue row')f.c.store.run("UPDATE effect_operations SET data='{' WHERE id=?",plan.planId);
  else f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.nextAction','Changed in another view') WHERE id=?",plan.planId);
  changed={ledger:ledger(f.c),requests:f.server.requests.length};
 };
 const h=command(f,['Retained configuration plans',(_title,rows)=>{
  if(fromCatalogue)drift();
  return rows[0];
 },(_title,rows)=>{
  actions++;
  return rows.find(row=>row.startsWith(boundary==='detail'?'Inspect original plan':'Audit selected settings'));
 }], [f.file], {show:async()=>drift()});
 try { await assert.rejects(h.run(), /Original configuration plan changed/); }
 finally { await h.ui.close(); }
 assert.equal(actions,Number(!fromCatalogue));
 assert.deepEqual({ledger:ledger(f.c),requests:f.server.requests.length},changed);
});
