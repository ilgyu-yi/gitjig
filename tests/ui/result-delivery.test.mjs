// Controlled result/procedure premises test navigation, never qualify actual review or delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {browseIntegrationTargets} from '../../dist/ui/integration-target-browser.js';
import {browseFirstIntegration} from '../../dist/ui/integration-start-browser.js';
import {browseIntegrationDelegation} from '../../dist/ui/integration-delegation-browser.js';
import {uiText} from '../../dist/ui/i18n.js';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';

for(const locale of ['en','ko'])for(const accept of [false,true])test(`${locale} result handoff is explicit, scoped to the displayed foreign-project work; accept=${accept}`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep draft 한국어'});const ledger=workLedger(f.c),calls=[];
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=>locale,show:async()=>{},choose:async(title,rows)=>{
  assert.ok(title.includes(id)&&title.includes('A'));assert.equal(rows[0],uiText(locale,'result.back'));
  return uiText(locale,accept?'result.reviewDelivery':'result.back');
 },execute:async(...args)=>{calls.push(args);return 'completed';}}));
 await commands.execute('/result '+id,cid);assert.deepEqual(calls.map(row=>row.slice(0,2)),accept?[['/repo deliver '+id,cid]]:[]);
 assert.equal(f.c.inspectConversation(cid).projectId,'B');assert.equal(f.c.inspectConversation(cid).draft.text,'Keep draft 한국어');assert.deepEqual(workLedger(f.c),ledger);
});

test('not-ready result exposes exact original work recovery, never a delivery action',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId,calls=[];
 const ui=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,show:async()=>{},choose:async(_title,rows)=>{
  assert.ok(!rows.includes(uiText('en','result.reviewDelivery')));return uiText('en','result.recovery');
 },execute:async(...args)=>{calls.push(args);return 'completed';}}));
 await ui.execute('/result '+id,cid);assert.equal(calls[0][0],'/work '+id);
});

for(const at of ['viewer','menu'])test(`result drift at ${at} refuses before navigation`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;let current=true;
 const inspect=f.c.inspectChangeResult.bind(f.c);let changed=false;f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true,...changed?{candidate:{versionId:'different',path:'/changed',hash:'b'.repeat(64)}}:{}});
 const ui=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>current,show:async()=>{if(at==='viewer')current=false;},choose:async()=>{changed=true;return uiText('en','result.reviewDelivery');},execute:async()=>assert.fail('Stale result cannot navigate')}));
 await assert.rejects(ui.execute('/result '+id,cid),/changed/);
});

for(const ready of [false,true])test(`direct repository result entry reviews foreign scope without querying receivers or credentials; ready=${ready}`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:ready});
 f.c.listIntegrationTargets=()=>assert.fail('Default Back must not enter delivery forms');const shown=[];
 const ui=repositoryCommands({controller:f.c,isCurrent:()=>true,show:async(title,text)=>shown.push(text),choose:async(_title,rows)=>{assert.equal(rows[0],'Back without action');return rows[0];},input:async()=>assert.fail('No credentials/Git/limits'),notice(){}});
 t.after(()=>ui.close());const ledger=workLedger(f.c);await new HostCommands(ui.commands).execute('/repo deliver '+id,cid);
 assert.ok(shown[0].includes(id)&&shown[0].includes('"projectId": "A"')&&shown[0].includes('"conversationProject": "B"'));
 assert.ok(shown[0].includes('does not apply files')&&shown[0].includes('merge a PR'));assert.deepEqual(workLedger(f.c),ledger);
});

function scopeFixture(){
 const work='older-result-work',target={state:'RETAINED',targetId:'chosen-target',projectId:'A',family:'local-git',ref:'refs/heads/main'};
 let fingerprint='original',prepared=0;const selected=()=>({workId:work,fingerprint,recordedPhase:'REVIEW_READY',eligible:true,existing:{operationLimit:2},target});
 const c={listIntegrationTargets:()=>({targets:[{...target,targetId:'foreign',projectId:'B'},target],nextCursor:null}),inspectIntegrationTarget:()=>target,
  inspectIntegrationDelegation:(id,tid)=>{assert.equal(id,work);assert.equal(tid,target.targetId);return selected();},
  listIntegrationDelegationWorks(){assert.fail('Exact work must not fall back to a recent page');},
  inspectFirstIntegrationPreparation:(id,tid)=>{assert.equal(id,work);assert.equal(tid,target.targetId);return{contextFingerprint:fingerprint,delegation:selected(),originals:[],holds:[]};},
  getWorkApplicationModelBaseline:()=>null};
 return{c,work,target,drift(){fingerprint='changed';},get prepared(){return prepared;},prepare:async id=>{assert.equal(id,work);prepared++;return{phase:'RESERVED'};}};
}

test('scoped receivers exclude other projects and first preparation retains exact older result without list fallback',async()=>{
 const f=scopeFixture();let phase=0;const host={guard(){},input:async()=>assert.fail('No registration input'),show:async()=>{},register:async()=>assert.fail('No registration'),choose:async(title,rows)=>{
  if(title.startsWith('Branch delivery')){assert.ok(!rows.some(row=>row.includes('foreign')));assert.ok(title.includes(f.work));return phase++===0?rows.find(row=>row.includes(f.target.targetId)):'Back';}
  if(title==='Original integration target · actions')return 'Prepare first integration for owner work';
  if(title==='Confirm first integration preparation'){assert.equal(rows[0],'Back without preparation');return rows[1];}
  assert.fail('Unexpected chooser '+title);
 }};host.first={...host,prepare:f.prepare,openOriginal:async()=>assert.fail('No original exists')};
 assert.equal(await browseIntegrationTargets(host,f.c,'A',{workId:f.work,assertCurrent(){}}),true);assert.equal(f.prepared,1);
});

test('pinned first-preparation Back and stale result never dispatch or expose another work',async()=>{
 const f=scopeFixture(),host={guard(){},show:async()=>{},choose:async()=> 'Back without preparation',prepare:async()=>assert.fail('Back cannot prepare'),openOriginal:async()=>assert.fail('No original')};
 assert.equal(await browseFirstIntegration(host,f.c,f.target.targetId,f.work),false);
 host.choose=async()=>{f.drift();return 'Prepare first integration for this work';};
 await assert.rejects(browseFirstIntegration(host,f.c,f.target.targetId,f.work),/changed/);
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


for(const entry of ['result','repository'])test(`reply-language drift during ${entry} review invalidates the old action before navigation or effects`,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 const before=workLedger(f.c);let shown=0;
 const changeLanguage=async()=>{shown++;f.c.setConversationLanguage({conversationId:cid,expectedGeneration:f.c.inspectConversation(cid).generation,expectedRevision:f.c.getConversationLanguage(cid).revision,replyLanguage:'ko'});};
 const host={controller:f.c,isCurrent:()=>true,show:changeLanguage,choose:async()=>assert.fail('Old-language review cannot offer its next action'),input:async()=>assert.fail('No native/credential input'),notice(){},execute:async()=>assert.fail('Old-language result cannot navigate')};
 const repository=entry==='repository'?repositoryCommands(host):undefined;t.after(()=>repository?.close());
 const registry=new HostCommands(repository?repository.commands:changeCommands(host));
 await assert.rejects(registry.execute(entry==='repository'?'/repo deliver '+id:'/result '+id,cid),/source changed|target changed/);
 assert.equal(shown,1);assert.deepEqual(workLedger(f.c),before);
});
