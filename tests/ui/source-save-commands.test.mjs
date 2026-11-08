import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSaveCommands} from '../../dist/ui/source-save-commands.js';
import {changeCommands} from '../../dist/ui/change-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';

for(const locale of ['en','ko'])test(locale+' result action targets the displayed older foreign-project work and preserves draft',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId;
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:'KEEP 원래 초안'});const before=workLedger(f.c),calls=[];
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=>locale,show:async()=>{},choose:async(_title,rows)=>{assert.equal(rows[0],uiText(locale,'result.back'));return uiText(locale,'result.saveBranch');},execute:async(...args)=>{calls.push(args);return'completed';}}));
 await commands.execute('/result '+id,cid);assert.deepEqual(calls.map(c=>c.slice(0,2)),[['/save '+id,cid]]);assert.deepEqual(workLedger(f.c),before);assert.equal(f.c.inspectConversation(cid).draft.text,'KEEP 원래 초안');
});

function host(c,locale='en') {return{controller:c,locale:()=>locale,isCurrent:()=>true,choose:async()=>assert.fail('Stable values required'),chooseItems:async(_title,items)=>{assert.equal(items[0].value,'back');return'back';},show:async()=>{},input:async()=>assert.fail('Back does not input'),notice(){}};}

for(const locale of ['en','ko'])test(locale+' exact foreign-work default Back discloses both projects without preparation or authority changes',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId,h=host(f.c,locale),shown=[];
 h.show=async(title,text)=>shown.push({title,text});f.c.prepareSourceSnapshot=async()=>assert.fail('Back cannot prepare');const before=workLedger(f.c),ui=sourceSaveCommands(h);t.after(()=>ui.close());
 await new HostCommands(ui.commands).execute('/save '+id,cid);assert.ok(shown[0].text.includes('A')&&shown[0].text.includes('B')&&shown[0].text.includes(id));assert.deepEqual(workLedger(f.c),before);
});

for(const drift of ['project','language','model'])test(drift+' change during the source picker refuses before preparation',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=work=>({...inspect(work),reviewReady:true});
 h.chooseItems=async()=>{if(drift==='language'){const view=f.c.inspectConversation(cid),lang=f.c.getConversationLanguage(cid);f.c.setConversationLanguage({conversationId:cid,expectedGeneration:view.generation,expectedRevision:lang.revision,replyLanguage:'ko'});}else if(drift==='project')f.c.setConversationProject({conversationId:cid,projectId:'B',expectedGeneration:f.c.inspectConversation(cid).generation});else{const original=f.c.getConversationModelChoice.bind(f.c);f.c.getConversationModelChoice=id=>({...original(id),revision:999});}return'new';};
 f.c.prepareSourceSnapshot=async()=>assert.fail('Stale picker cannot prepare');const ui=sourceSaveCommands(h);t.after(()=>ui.close());await assert.rejects(new HostCommands(ui.commands).execute('/save '+id,cid),/changed|project|generation/i);
});

test('retained lookup keeps unknown rows and original cursor, with no profile or send on Back',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c),requests=[];let step=0;
 f.c.listSourceSnapshotOperations=options=>{requests.push(options);return options.after?{operations:[],nextCursor:null}:{operations:[{position:1,state:'UNAVAILABLE',operationId:null,reason:'Original missing identity'}],nextCursor:1};};
 h.chooseItems=async(_title,items)=>{assert.equal(items[0].value,'back');if(step++===0){assert.ok(items.some(i=>i.value==='operation:0'));return'next';}return'back';};
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save list',cid);assert.deepEqual(requests,[{limit:25},{limit:25,after:1}]);
});

test('prepared proposals remain discoverable through original work selection without an operation',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);let step=0,seen=false;
 f.c.listSourceSnapshotOperations=()=>({operations:[],nextCursor:null});f.c.listWorks=()=>({works:[{workId:id,projectId:'A',recordedPhase:'REVIEW_READY',requestPreview:'Original'}],nextCursor:null});
 f.c.listSourceSnapshotProposals=options=>{assert.equal(options.workId,id);return{proposals:[{proposalId:'original-preview',metadata:'retained'}],nextCursor:null};};
 h.chooseItems=async(_title,items)=>{if(step++===0)return'mode';if(step===2)return'work:0';if(items.some(i=>i.value==='proposal:0'))seen=true;return'back';};
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save list',cid);assert.equal(seen,true);
});

test('host close seals open picker admission without joining the unresolved picker',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);let release,entered;
 const ready=new Promise(resolve=>entered=resolve);h.chooseItems=()=>new Promise(resolve=>{release=resolve;entered();});
 const ui=sourceSaveCommands(h),running=new HostCommands(ui.commands).execute('/save '+id,cid);void running.catch(()=>{});await ready;await ui.close();release('back');await assert.rejects(running,/abort/i);
});

test('malformed reserved command operands refuse without profile/Native access',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,ui=sourceSaveCommands(host(f.c));t.after(()=>ui.close());
 for(const argument of ['operation','proposal','proposal work','operation one extra','list extra'])await assert.rejects(new HostCommands(ui.commands).execute('/save '+argument,cid),/Use \/save/);
});

test('no-argument save from ordinary current work opens retained discovery without managed-result inspection',async t=>{const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c),inspect=f.c.inspectConversation.bind(f.c);let listed=0;f.c.inspectConversation=id=>({...inspect(id),workId:'ordinary-work'});f.c.inspectChangeActivity=()=>undefined;f.c.inspectChangeResult=()=>assert.fail('Ordinary work has no managed result');f.c.listSourceSnapshotOperations=()=>{listed++;return{operations:[],nextCursor:null};};const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save',cid);assert.equal(listed,1);});

test('explicit ordinary work explains its scope without substituting another result',async t=>{const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c),shown=[];f.c.inspectChangeActivity=()=>undefined;f.c.inspectChangeResult=()=>assert.fail('Ordinary work has no managed result');h.show=async(title,text)=>shown.push({title,text});const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save ordinary-work',cid);assert.equal(shown[0].title,uiText('en','save.notManagedWork'));assert.ok(shown[0].text.includes('ordinary-work'));});
