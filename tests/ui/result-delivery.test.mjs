// Controlled result/procedure premises test navigation, never qualify actual review or delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {browseIntegrationTargets} from '../../dist/ui/integration-target-browser.js';
import {browseFirstIntegration} from '../../dist/ui/integration-start-browser.js';
import {browseIntegrationDelegation} from '../../dist/ui/integration-delegation-browser.js';
import {captureResultDelivery} from '../../dist/ui/result-delivery.js';
import {uiText} from '../../dist/ui/i18n.js';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {integrationWorld,snapshot} from '../controller/integration-registry-fixture.mjs';

for(const locale of ['en','ko'])for(const accept of [false,true])test(`${locale} result handoff is explicit, scoped to the displayed foreign-project work; accept=${accept}`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep draft 한국어'});const ledger=workLedger(f.c),calls=[];
 let views=0;
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=>locale,show:async(_title,_text,primary)=>{if(++views===1)await primary.run();},choose:async(title,rows)=>{
  assert.ok(title.includes(id)&&title.includes('A'));assert.equal(rows[0],uiText(locale,'result.returnToResult'));
  return uiText(locale,accept?'result.reviewDelivery':'result.returnToResult');
 },execute:async(...args)=>{calls.push(args);return 'started';}}));
 assert.equal(await commands.execute('/result '+id,cid),accept?'started':'completed');assert.deepEqual(calls.map(row=>row.slice(0,2)),accept?[['/repo deliver '+id,cid]]:[]);
 assert.equal(views,accept?1:2);
 assert.equal(f.c.inspectConversation(cid).projectId,'B');assert.equal(f.c.inspectConversation(cid).draft.text,'Keep draft 한국어');assert.deepEqual(workLedger(f.c),ledger);
});

test('not-ready result exposes exact original work recovery, never a delivery action',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId,calls=[];
 const ui=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,show:async(_title,_text,primary)=>primary.run(),choose:async(_title,rows)=>{
  assert.ok(!rows.includes(uiText('en','result.reviewDelivery')));return uiText('en','result.recovery');
 },execute:async(...args)=>{calls.push(args);return 'completed';}}));
 await ui.execute('/result '+id,cid);assert.equal(calls[0][0],'/work '+id);
});

test('review-ready results distinguish new delivery and direct history for the same work', async t=>{
 const f=await integrationWorld(t),original=await f.prepare(),cid=f.c.createConversation().conversationId;
 const before=snapshot(f.c), inspect=f.c.inspectChangeResult.bind(f.c), history=uiText('en','result.deliveryHistory');
 f.c.inspectChangeResult=(...args)=>({...inspect(...args),reviewReady:true});
 let viewed=0, scoped=0, scopeReviews=0;
 const repo=repositoryCommands({
  controller:f.c,isCurrent:()=>true,notice(){},input:async()=>assert.fail('History opened a credential or setup prompt'),
  show:async()=>assert.fail('Back from retained list opened a detail'),
  choose:async(title,rows)=>{
   if (title.startsWith(uiText('en','result.receiverTitle'))) {
    scopeReviews++;
    assert.ok(rows.includes(uiText('en','result.receiverOpen')));
    assert.ok(rows.includes(history));
    return history;
   }
   assert.ok(title.startsWith(uiText('en','integration.workList',{id:original.workId})));
   assert.ok(rows.some(row=>row.includes(original.operationId)));
   scoped++;
   return uiText('en','integration.choice.listBack');
  },
 });
 const commands=new HostCommands([...repo.commands,...changeCommands({
  controller:f.c,isCurrent:()=>true,show:async(_title,_text,primary)=>{
   if (++viewed===1) await primary.run();
  },choose:async(_title,rows)=>{
   assert.ok(rows.includes(uiText('en','result.reviewDelivery')));
   assert.ok(rows.includes(history));
   return history;
  },execute:(command,target,context)=>commands.execute(command,target,context),
 })]);
 try {
  assert.equal(await commands.execute('/result '+original.workId,cid),'completed');
  assert.equal(viewed,2);
  assert.equal(scoped,1);
  assert.equal(scopeReviews,0);
  assert.equal(await commands.execute('/repo deliver '+original.workId,cid),'cancelled');
  assert.equal(scopeReviews,1);
  assert.equal(scoped,2);
  assert.deepEqual(snapshot(f.c),before);
 } finally {await repo.close();}
 f.pass();
});

for (const scenario of ['back','different work','result drift','record restored']) test('result-scoped original unavailable · '+scenario,async t=>{
 const f=await integrationWorld(t),{workId,operationId,targetId}=await f.prepare(),cid=f.c.createConversation().conversationId;
 const readResult=f.c.inspectChangeResult.bind(f.c),readOperation=f.c.inspectRetainedIntegration.bind(f.c);
 const saved=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',operationId).data;
 f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?','{malformed',operationId);
 assert.equal(readOperation(operationId).entry.state,'UNAVAILABLE');
 let drift=false,shown=0;
 f.c.inspectChangeResult=(...args)=>({...readResult(...args),reviewReady:true,...drift?{nextAction:'Result observation changed'}:{}});
 if(scenario==='different work') f.c.inspectRetainedIntegration=id=>{
  const original=readOperation(id);
  return {...original,entry:{...original.entry,workId:'unrelated-work'}};
 };
 const actions=['receivers','target:'+targetId,'continue'],before=snapshot(f.c);
 const ui=repositoryCommands({
  controller:f.c,isCurrent:()=>true,uiLocale:()=> 'ko',notice(){},
  input:async()=>assert.fail('Unavailable original must not ask for credentials or Native inputs'),
  choose:async()=>assert.fail('Stable choices required'),
  chooseItems:async(_title,items)=>{
   const action=actions.shift();
   assert.ok(items.some(item=>item.value===action),'No original write or reconciliation picker');
   return action;
  },
  show:async(title,body,primary)=>{
   shown++;
   assert.equal(title,uiText('ko','integration.unavailableTitle'));
   assert.ok(body.includes(operationId) && body.includes(workId) && body.includes(targetId));
   assert.equal(primary,undefined);
   if(scenario==='result drift') drift=true;
   if(scenario==='record restored') f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?',saved,operationId);
  },
 });
 try {
  const outcome=new HostCommands(ui.commands).execute('/repo deliver '+workId,cid);
  if(scenario==='different work') await assert.rejects(outcome,/does not match this result and receiver/);
  else if(scenario==='result drift') await assert.rejects(outcome,{message:uiText('ko','result.changed')});
  else if(scenario==='record restored') await assert.rejects(outcome,/selected original integration changed/i);
  else assert.equal(await outcome,'cancelled');
  assert.equal(shown,scenario==='different work'?0:1);
  assert.equal(actions.length,0);
  if(scenario==='record restored') f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?','{malformed',operationId);
  assert.deepEqual(snapshot(f.c),before);
 } finally {await ui.close();}
 f.pass();
});

test('typed delivery history uses stable work scope and refuses unrecognized suffixes', async t=>{
 const f=await registryWorld(t),id=f.works[0].workId,cid=f.c.createConversation().conversationId;
 const inspect=f.c.inspectChangeResult.bind(f.c);
 let reads=0, picks=0;
 f.c.inspectChangeResult=(...args)=>({...inspect(...args),nextAction:'Current assessment '+ ++reads});
 const repo=repositoryCommands({
  controller:f.c,isCurrent:()=>true,notice(){},input:async()=>assert.fail('History asked for setup'),
  show:async()=>assert.fail('Empty history opened a record'),
  choose:async(title,rows)=>{
   picks++;
   assert.ok(title.includes(uiText('en','integration.workList',{id})));
   assert.ok(title.includes(uiText('en','integration.empty')));
   return rows.at(-1);
  },
 });
 const commands=new HostCommands(repo.commands),before=workLedger(f.c);
 try {
  for (const suffix of ['historical','history extra'])
   await assert.rejects(commands.execute('/repo deliver '+id+' '+suffix,cid),/Unknown repository command/);
  assert.equal(reads,0);
  assert.equal(await commands.execute('/repo deliver '+id+' history',cid),'cancelled');
  assert.equal(reads,0);
  assert.equal(picks,1);
  assert.deepEqual(workLedger(f.c),before);
 } finally {await repo.close();}
});

test('retained delivery keeps working after the current assessment becomes unreadable', async t=>{
 const f=await integrationWorld(t), original=await f.prepare(), cid=f.c.createConversation().conversationId;
 const {workId,operationId}=original, captured=captureResultDelivery(f.c,workId);
 f.c.store.run("UPDATE change_state SET data='{' WHERE work=?",workId);
 assert.throws(()=>f.c.inspectChangeResult(workId),SyntaxError);
 const before=snapshot(f.c);
 let menus=0;
 const repo=repositoryCommands({
  controller:f.c,isCurrent:()=>true,notice(){},input:async()=>assert.fail('Retained inspection asked for setup'),
  show:async()=>assert.fail('Back from retained history opened a record'),
  choose:async(title,rows)=>{
   assert.ok(title.startsWith(uiText('en','integration.workList',{id:workId})));
   assert.ok(rows.some(row=>row.includes(operationId)));
   menus++;
   return rows.at(-1);
  },
 });
 const commands=new HostCommands(repo.commands);
 try {
  assert.equal(await commands.execute('/repo deliver '+workId+' history',cid),'cancelled');
  assert.equal(menus,1);
  captured.assertWorkCurrent();
  assert.throws(()=>captured.assertCurrent());
  assert.equal(snapshot(f.c),before);
 } finally {await repo.close();}
 f.pass();
});

test('historical delivery still checks exact source bytes and registered root', async t=>{
 const f=await registryWorld(t),workId=f.works[0].workId;
 const capture=captureResultDelivery(f.c,workId);
 const source=f.c.inspectWork(workId).source.id;
 f.c.store.run("UPDATE sources SET origin=origin||' ' WHERE id=?",source);
 assert.throws(()=>capture.assertWorkCurrent(),/original work or its source changed/i);
 const withSource=captureResultDelivery(f.c,workId);
 f.c.store.run("UPDATE projects SET root=root||'-replacement' WHERE id='A'");
 assert.throws(()=>withSource.assertWorkCurrent(),/original work or its source changed/i);
 f.c.store.run("UPDATE sources SET origin='{' WHERE id=?",source);
 assert.throws(()=>captureResultDelivery(f.c,workId),error=>error.message===uiText('en','result.correspondenceUnavailable'));
});

for(const at of ['viewer','menu'])test(`result drift at ${at} refuses before navigation`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;let current=true;
 const inspect=f.c.inspectChangeResult.bind(f.c);let changed=false;f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true,...changed?{candidate:{versionId:'different',path:'/changed',hash:'b'.repeat(64)}}:{}});
 const ui=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>current,show:async(_title,_text,primary)=>{if(at==='viewer')current=false;await primary.run();},choose:async()=>{changed=true;return uiText('en','result.reviewDelivery');},execute:async()=>assert.fail('Stale result cannot navigate')}));
 await assert.rejects(ui.execute('/result '+id,cid),/changed/);
});

for(const ready of [false,true])test(`direct repository result entry reviews foreign scope without querying receivers or credentials; ready=${ready}`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:ready});
 f.c.listIntegrationTargets=()=>assert.fail('Default Back must not enter delivery forms');const shown=[];let details=false;
 const ui=repositoryCommands({controller:f.c,isCurrent:()=>true,show:async(title,text)=>shown.push(text),choose:async(title,rows)=>{
  assert.ok(title.includes(id)&&title.includes('Result project "A" · current conversation project "B"'));
  assert.equal(rows[0],uiText('en','result.back'));
  assert.equal(rows.includes(uiText('en','result.receiverOpen')),ready);
  return details&&!shown.length?uiText('en','result.receiverDetails'):rows[0];
 },input:async()=>assert.fail('No credentials/Git/limits'),notice(){}});
 t.after(()=>ui.close());const ledger=workLedger(f.c),registry=new HostCommands(ui.commands);
 await registry.execute('/repo deliver '+id,cid);assert.deepEqual(shown,[]);
 details=true;await registry.execute('/repo deliver '+id,cid);
 assert.ok(shown[0].includes(id)&&shown[0].includes('Registered source'));
 assert.deepEqual(workLedger(f.c),ledger);
});

function scopeFixture(){
 const work='older-result-work',target={state:'RETAINED',targetId:'chosen-target',projectId:'A',family:'local-git',ref:'refs/heads/main',
  configuration:{target:{canonicalPath:'/fixtures/primary-receiver.git'}}};
 const operation={operationId:'prepared-original',workId:work,targetId:target.targetId,phase:'RESERVED',
  transportOutcome:null,observedOutcome:'not-observed',blocked:[],nextAction:'Review the prepared delivery'};
 const entry={state:'RETAINED',operationId:operation.operationId,workId:work,targetId:target.targetId,
  endpoint:target.configuration.target.canonicalPath,ref:target.ref};
 let fingerprint='original',workFingerprint='original-work',prepared=0,originals=[];const selected=()=>({workId:work,fingerprint,recordedPhase:'REVIEW_READY',eligible:true,existing:{operationLimit:2},target});
 const c={listIntegrationTargets:options=>{assert.equal(options.projectId,'A');return{targets:[target],nextCursor:null};},inspectIntegrationTarget:()=>target,
  inspectIntegrationDelegation:(id,tid)=>{assert.equal(id,work);assert.equal(tid,target.targetId);return selected();},
  listIntegrationDelegationWorks(){assert.fail('Exact work must not fall back to a recent page');},
  inspectFirstIntegrationPreparation:(id,tid)=>{assert.equal(id,work);assert.equal(tid,target.targetId);return{contextFingerprint:fingerprint,delegation:selected(),originals,holds:[],targetHolds:[]};},
  getWorkApplicationModelBaseline:()=>null,inspectDeliveryWork:id=>{assert.equal(id,work);return{workId:work,fingerprint:workFingerprint};},inspectRetainedIntegration:id=>{assert.equal(id,operation.operationId);return {entry,view:{...operation}};}};
 return{c,work,target,operation,changeSource(){workFingerprint='changed-source';},setOriginals(value){originals=value;fingerprint+='-retained';},drift(){fingerprint='changed';},get prepared(){return prepared;},prepare:async id=>{assert.equal(id,work);prepared++;return operation;}};
}

test('scoped receivers exclude other projects and first preparation retains exact older result without list fallback',async()=>{
 const f=scopeFixture();let phase=0;const host={guard(){},input:async()=>assert.fail('No registration input'),show:async(title,_text,primary)=>{
  if(title!==uiText('en','integration.firstOutcomeTitle')) await primary?.run();
 },register:async()=>assert.fail('No registration'),choose:async(title,rows)=>{
  if(title.startsWith('Branch delivery')){assert.ok(!rows.some(row=>row.includes('foreign')));assert.ok(title.includes(f.work));return phase++===0?rows.find(row=>row.startsWith('"/fixtures/primary-receiver.git"')):'Back';}
  if(title.startsWith('Receiver actions')){assert.ok(title.includes('/fixtures/primary-receiver.git'));return uiText('en','integration.receiverPrepare');}
  if(title==='Confirm first integration preparation'){assert.equal(rows[0],'Back without preparation');return rows[1];}
  assert.fail('Unexpected chooser '+title);
 }};host.first={...host,prepare:f.prepare,openOriginal:async()=>assert.fail('No original exists')};
 assert.equal(await browseIntegrationTargets(host,f.c,'A',{workId:f.work,assertCurrent(){}}),true);assert.equal(f.prepared,1);
});

for (const circumstance of ['back','cancelled','changed','source changed','unavailable','foreign unavailable']) test('first preparation outcome keeps exact original · '+circumstance,async()=>{
 const f=scopeFixture(),opened=[];
 const read=f.c.inspectRetainedIntegration;
 if(circumstance.endsWith('unavailable')) {
  f.c.inspectRetainedIntegration=id=>{
   const {entry}=read(id);
   return {entry:{...entry,state:'UNAVAILABLE',workId:circumstance==='unavailable'?f.work:'foreign-work'},view:undefined};
  };
 }
 const host={
  guard(){},choose:async(_title,rows)=>rows[1],prepare:f.prepare,
  async show(title,text,primary){
   if(title===uiText('en','integration.firstOutcomeTitle')){
    assert.ok(text.includes(f.operation.operationId)&&text.includes(f.target.ref));
    if(circumstance==='unavailable') {assert.equal(primary,undefined);return;}
    if(circumstance==='back')return;
    if(circumstance==='changed')f.operation.phase='UNKNOWN';
    if(circumstance==='source changed')f.changeSource();
   }
   await primary.run();
  },
  openOriginal:async(...operands)=>{opened.push(operands);return 'cancelled';},
 };
 const review=browseFirstIntegration(host,f.c,f.target.targetId,f.work);
 if(circumstance==='changed'||circumstance==='foreign unavailable')await assert.rejects(review,/original branch delivery changed/i);
 else if(circumstance==='source changed')await assert.rejects(review,/original work or its source changed/i);
 else assert.equal(await review,true);
 assert.equal(f.prepared,1);
 assert.deepEqual(opened,circumstance==='cancelled'?[[f.operation.operationId,f.target.targetId,true]]:[]);
});

test('an unavailable receiver stays visible and an emptied older page keeps its way back',async()=>{
 const f=scopeFixture(),row={state:'UNAVAILABLE',targetId:'unavailable-a',projectId:'A'};
 f.c.listIntegrationTargets=({projectId,before})=>{
  assert.equal(projectId,'A');
  return before?{targets:[],nextCursor:null}:{targets:[row],nextCursor:row.targetId};
 };
 f.c.inspectIntegrationTarget=id=>{assert.equal(id,row.targetId);return row;};
 const decisions=['target:'+row.targetId,'back','older','newer','back'];
 const host={locale:'ko',guard(){},choose:async()=>assert.fail('Typed picker required'),
  chooseItems:async(title,items)=>{
   assert.ok(!title.includes(uiText('ko','integration.receiverListEmpty')));
   const next=decisions.shift();
   assert.ok(items.some(item=>item.value===next));
   if(next==='target:'+row.targetId)assert.equal(items[0].label,uiText('ko','integration.receiverListUnavailable',{id:'"unavailable-a"'}));
   if(title===uiText('ko','integration.receiverUnavailable',{id:row.targetId}))
    assert.ok(!items.some(item=>['delegate','continue'].includes(item.value)));
   return next;
  },
  input:async()=>assert.fail('No registration input'),register:async()=>assert.fail('No registration'),
  show:async()=>assert.fail('Back does not enter inspection')};
 assert.equal(await browseIntegrationTargets(host,f.c,'A',{workId:f.work,assertCurrent(){}}),false);
 assert.deepEqual(decisions,[]);
});

test('pinned first-preparation Back and stale result never dispatch or expose another work',async()=>{
 const f=scopeFixture(),host={guard(){},show:async(_title,_text,primary)=>{await primary?.run();},choose:async()=> 'Back without preparation',prepare:async()=>assert.fail('Back cannot prepare'),openOriginal:async()=>assert.fail('No original')};
 assert.equal(await browseFirstIntegration(host,f.c,f.target.targetId,f.work),false);
 host.choose=async()=>{f.drift();return 'Prepare first integration for this work';};
 await assert.rejects(browseFirstIntegration(host,f.c,f.target.targetId,f.work),/changed/);
});

test('Escape on first preparation review never opens the confirmation',async()=>{
 const f=scopeFixture(),host={guard(){},show:async()=>{},choose:async()=>assert.fail('Escape opened confirmation'),
  prepare:async()=>assert.fail('Escape prepared work'),openOriginal:async()=>assert.fail('No original')};
 assert.equal(await browseFirstIntegration(host,f.c,f.target.targetId,f.work),false);
});

for(const exitPage of [1,2])test('first preparation identifies holds first and Escape exits page '+exitPage,async()=>{
 const f=scopeFixture(),read=f.c.inspectFirstIntegrationPreparation;
 f.c.inspectFirstIntegrationPreparation=(...args)=>({...read(...args),holds:['Missing original grant'],longRecord:'x'.repeat(65000)});
 let shown=0;
 const host={locale:'ko',guard(){},show:async(_title,body,primary)=>{
  shown++;
  assert.ok(shown<=exitPage);
  if(shown===1)assert.ok(body.indexOf('Missing original grant')>=0&&body.indexOf('Missing original grant')<300);
  assert.equal(primary?.label,uiText('ko','integration.reviewNext'));
  if(shown<exitPage)await primary.run();
 },choose:async()=>assert.fail('Escape opened a decision'),prepare:async()=>assert.fail('No preparation'),
 openOriginal:async()=>assert.fail('No original')};
 assert.equal(await browseFirstIntegration(host,f.c,f.target.targetId,f.work),false);
 assert.equal(shown,exitPage);
});

for(const scenario of ['open','back','context-changed','operation-changed','unavailable'])test('first preparation recovery preserves exact blocking operation: '+scenario,async()=>{
 const f=scopeFixture(),read=f.c.inspectFirstIntegrationPreparation;
 const blocking={id:'original-operation',work:'different-work',target:'receiver-alias',phase:'UNKNOWN',unavailable:0};
 const command='/repo operation original-operation different-work';
 f.c.inspectFirstIntegrationPreparation=(...args)=>({...read(...args),holds:['Original transmission held'],targetHolds:[blocking]});
 let reads=0, navigated;
 const host={locale:'en',guard(){},
  show:async(_title,body,primary)=>{
   const blocker=body.indexOf(uiText('en','integration.firstBlocker',{id:'"original-operation"'}));
   assert.ok(blocker>=0&&blocker<body.indexOf('Original transmission held'));
   await primary.run();
  },
  choose:async(_title,rows)=>{
   assert.equal(rows[0],uiText('en','integration.choice.back'));
   const operation=uiText('en','integration.firstBlockerOpen',{id:'"original-operation"'});
   assert.equal(rows.includes(operation),scenario!=='unavailable');
   if(scenario==='context-changed')f.drift();
   return scenario==='back'||scenario==='unavailable'?rows[0]:operation;
  },
  operationRecovery:row=>{
   assert.deepEqual(row,blocking);
   reads++;
   return scenario==='unavailable'||(scenario==='operation-changed'&&reads>1)?undefined:command;
  },
  navigate:async value=>{navigated=value;return 'cancelled';},
  prepare:async()=>assert.fail('Held work cannot prepare'),openOriginal:async()=>assert.fail('Different work cannot use selected receiver route')};
 const opened=browseFirstIntegration(host,f.c,f.target.targetId,f.work);
 if(scenario.endsWith('changed'))await assert.rejects(opened,/changed/i);
 else assert.equal(await opened,false);
 assert.equal(navigated,scenario==='open'?command:undefined);
});

test('pinned delegation Back returns without exposing an unrelated work list',async()=>{
 const f=scopeFixture();f.c.delegateOwnerIntegration=()=>assert.fail('No grant on Back');
 const host={guard(){},show:async()=>{},input:async()=>assert.fail('Existing finite grant needs no limit'),choose:async(_title,rows)=>{assert.equal(rows[0],'Back without delegation');return rows[0];}};
 assert.equal(await browseIntegrationDelegation(host,f.c,f.target.targetId,f.work,true),false);
});

test('pinned existing integration opens only its original, with no allocation or work list',async()=>{
 const f=scopeFixture();f.c.inspectFirstIntegrationPreparation=(id,tid)=>({contextFingerprint:'original',delegation:f.c.inspectIntegrationDelegation(id,tid),originals:[{id:'retained-operation',phase:'REFUSED'}],holds:[]});let opened;
 const host={guard(){},show:async()=>{},choose:async(_title,rows)=>rows[0],prepare:async()=>assert.fail('Retained original cannot allocate'),openOriginal:async id=>{opened=id;return true;}};
 assert.equal(await browseFirstIntegration(host,f.c,f.target.targetId,f.work),true);assert.equal(opened,'retained-operation');
});

for(const scenario of ['one','one-back','multiple','changed'])test(`scoped Korean receiver offers the original directly when unambiguous; ${scenario}`,async()=>{
 const f=scopeFixture();
 if(scenario!=='changed')f.setOriginals([{id:'saved',phase:'RESERVED'},...scenario==='multiple'?[{id:'sent',phase:'CONFIRMED'}]:[]]);
 const opened=[];let pages=0;
 const host={locale:'ko',guard(){},input:async()=>assert.fail('No input'),show:async()=>{},register:async()=>assert.fail('No registration'),
  choose:async()=>assert.fail('Scoped receiver actions must use stable IDs'),
  chooseItems:async(title,items)=>{
   if(title.startsWith('브랜치 전달 수신처')){
    assert.equal(++pages,1,'Existing original review owns its exit');
    return 'target:'+f.target.targetId;
   }
   assert.match(title,/수신 저장소/);assert.ok(title.includes(f.target.ref)&&title.includes(f.target.targetId));
   assert.equal(items[0].value,'back');
   const action=items.find(item=>item.value==='continue');
   assert.equal(action.label,uiText('ko',scenario==='changed'?'integration.receiverPrepare':'integration.receiverOpen'));
   if(scenario==='changed')f.setOriginals([{id:'appeared',phase:'CONFIRMED'}]);
   return action.value;
  }
 };
 host.first={...host,choose:async(title,rows)=>{
  assert.equal(scenario,'multiple');assert.match(title,/Existing original integration/);return rows.find(row=>row.endsWith('sent'));
 },openOriginal:async(id,target)=>{opened.push([id,target]);return scenario!=='one-back';},prepare:async()=>assert.fail('Existing or changed context cannot prepare')};
 const invoke=()=>browseIntegrationTargets(host,f.c,'A',{workId:f.work,assertCurrent(){}});
 if(scenario==='changed')await assert.rejects(invoke(),/context changed/);
 else assert.equal(await invoke(),scenario!=='one-back');
 assert.deepEqual(opened,scenario==='changed'?[]:[[scenario==='multiple'?'sent':'saved',f.target.targetId]]);
});

for(const entry of ['result','repository'])test(`reply-language drift during ${entry} review invalidates the old action before navigation or effects`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 const before=workLedger(f.c);let shown=0;
 const changeLanguage=async()=>{shown++;f.c.setConversationLanguage({conversationId:cid,expectedGeneration:f.c.inspectConversation(cid).generation,expectedRevision:f.c.getConversationLanguage(cid).revision,replyLanguage:'ko'});};
 let choices=0;
 const host={controller:f.c,isCurrent:()=>true,show:async(_title,_text,primary)=>{await changeLanguage();await primary?.run();},choose:async()=>{
  assert.equal(entry,'repository','Old-language result review cannot offer its next action');
  assert.equal(choices++,0,'A stale decisions menu cannot reopen');
  return uiText('en','result.receiverDetails');
 },input:async()=>assert.fail('No native/credential input'),notice(){},execute:async()=>assert.fail('Old-language result cannot navigate')};
 const repository=entry==='repository'?repositoryCommands(host):undefined;t.after(()=>repository?.close());
 const registry=new HostCommands(repository?repository.commands:changeCommands(host));
 await assert.rejects(registry.execute(entry==='repository'?'/repo deliver '+id:'/result '+id,cid),/source changed|target changed/);
 assert.equal(shown,1);assert.deepEqual(workLedger(f.c),before);
});
