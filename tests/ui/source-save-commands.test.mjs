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
 const commands=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,locale:()=>locale,show:async(_title,_text,primary)=>primary.run(),choose:async(_title,rows)=>{assert.equal(rows[0],uiText(locale,'result.returnToResult'));return uiText(locale,'result.saveBranch');},execute:async(...args)=>{calls.push(args);return'completed';}}));
 await commands.execute('/result '+id,cid);assert.deepEqual(calls.map(c=>c.slice(0,2)),[['/save '+id,cid]]);assert.deepEqual(workLedger(f.c),before);assert.equal(f.c.inspectConversation(cid).draft.text,'KEEP 원래 초안');
});

function host(c,locale='en') {return{controller:c,locale:()=>locale,isCurrent:()=>true,choose:async()=>assert.fail('Stable values required'),chooseItems:async(_title,items)=>{assert.equal(items[0].value,'back');return'back';},show:async()=>{},input:async()=>assert.fail('Back does not input'),notice(){}};}

for (const locale of ['en','ko']) test(locale+' Back from source save returns to the same result and scroll position',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
 const read=f.c.inspectChangeResult.bind(f.c);
 f.c.inspectChangeResult=(work,options)=>({...read(work,options),reviewReady:true});
 const draft='Unsent 한국어 draft';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const before=workLedger(f.c),h=host(f.c,locale);
 let offered=0,shown=0,position;
 h.chooseItems=async(_title,items)=>{
  offered++;
  assert.deepEqual(items.map(item=>item.value),['back','new']);
  return 'back';
 };
 f.c.prepareSourceSnapshot=async()=>assert.fail('Back cannot prepare a source save');
 const save=sourceSaveCommands(h);t.after(()=>save.close());
 const commands=new HostCommands([...save.commands,...changeCommands({
  controller:f.c,isCurrent:()=>true,locale:()=>locale,execute:(...args)=>commands.execute(...args),
  choose:async(_title,rows)=>{
   assert.equal(rows[0],uiText(locale,'result.returnToResult'));
   return uiText(locale,'result.saveBranch');
  },
  show:async(_title,text,primary,scroll)=>{
   assert.ok(text.includes(id));
   if (++shown===1) {
    position=scroll;
    position.scrollTop=7;
    await primary.run();
   } else {
    assert.equal(scroll,position);
    assert.equal(scroll.scrollTop,7);
   }
  },
 })]);
 assert.equal(await commands.execute('/result '+id,cid),'completed');
 assert.deepEqual([shown,offered],[2,1]);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
 assert.deepEqual(workLedger(f.c),before);
});

for (const locale of ['en','ko']) for (const reviewReady of [true,false]) test(locale+' result reaches its exact save history and returns to the same position, ready='+reviewReady,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'B'}).conversationId,id=f.works[0].workId,h=host(f.c,locale);
 const inspect=f.c.inspectChangeResult.bind(f.c);
 f.c.inspectChangeResult=(...args)=>({...inspect(...args),reviewReady});
 const original={state:'RETAINED',operationId:'prepared-original',workId:id,recordedPhase:'PREPARED',
  nativeAttempt:null,nativeReads:[],binding:{destinationRef:'refs/heads/old',projectedCommit:'a'.repeat(40)}};
 const draft='Separate draft 한국어';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const before=workLedger(f.c);
 f.c.listSourceSnapshotOperations=({workId})=>{assert.equal(workId,id);return {operations:[original],nextCursor:null};};
 f.c.inspectSourceSnapshotOperation=({operationId})=>{assert.equal(operationId,original.operationId);return original;};
 f.c.listSourceSnapshotProposals=()=>assert.fail('History cannot open the prepared proposal menu');
 f.c.inspectSourceSnapshotProposal=()=>assert.fail('History cannot prepare a send');
 let shown=0,pickers=0,position;
 h.chooseItems=async(title,items,initial)=>{
  if(++pickers===1){
   assert.ok(title.includes(id));
   assert.deepEqual(items.map(item=>item.value),['back','operation:'+original.operationId]);
   return'operation:'+original.operationId;
  }
  if(pickers===2){
   assert.ok(title.includes('refs/heads/old'));
   assert.deepEqual(items.map(item=>item.value),['back','details']);
  }
  if(pickers===3) assert.equal(initial, 'operation:'+original.operationId);
  return'back';
 };
 const save=sourceSaveCommands(h);t.after(()=>save.close());
 const commands=new HostCommands([...save.commands,...changeCommands({
  controller:f.c,isCurrent:()=>true,locale:()=>locale,execute:(...args)=>commands.execute(...args),
  choose:async(_title,rows)=>{
   assert.equal(rows.includes(uiText(locale,'result.saveBranch')),reviewReady);
   assert.equal(rows.includes(uiText(locale,'result.reviewDelivery')),reviewReady);
   return uiText(locale,'save.workHistory');
  },
  show:async(_title,text,primary,scroll)=>{
   assert.ok(text.includes(uiText(locale,'save.workHistory')));
   if(++shown===1){
    position=scroll;position.scrollTop=6;
    await primary.run();
   }else{
    assert.equal(position,scroll);assert.equal(scroll.scrollTop,6);
   }
  },
 })]);
 await commands.execute('/result '+id,cid);
 assert.equal(shown,2);
 assert.equal(pickers,3);
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
});

for (const sourceDrift of [false,true]) test(sourceDrift
 ? 'an original result check refuses a changed assigned source at final handoff'
 : 'an explicit original result check exits history without returning to the stale result allowance',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);
 const original={state:'RETAINED',operationId:'uncertain-original',workId:id,recordedPhase:'UNKNOWN',
  nativeAttempt:{intent:{}},nativeReads:[],binding:{projectRoot:f.root,destinationRef:'refs/heads/old',projectedCommit:'a'.repeat(40)}};
 let checked=false,shown=0;
 f.c.listSourceSnapshotOperations=()=>({operations:[structuredClone(original)],nextCursor:null});
 f.c.inspectSourceSnapshotOperation=()=>structuredClone(original);
 f.c.inspectSourceSnapshotProposal=async()=>({nativeProfile:{gitBinary:'/trusted/git'}});
 f.c.reviewSourceSnapshotResult=async()=>({canRead:true,fingerprint:'same-original',holds:[]});
 f.c.checkSourceSnapshotResult=async(input,controls)=>{
  assert.deepEqual(input,{operationId:original.operationId,expectedReviewFingerprint:'same-original'});
  controls.validate();assert.equal(checked,false);checked=true;
  original.recordedPhase='CONFIRMED';original.nativeReads.push({});
  f.c.store.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='execution'",id);
  return structuredClone(original);
 };
 h.show=async(_title,_text,primary)=>primary?.run();
 h.chooseItems=async(_title,items)=>checked?'back':items.find(item=>item.value==='read')?.value??items[1].value;
 h.runPreparation=async(title,task)=>{
  if(sourceDrift&&title===uiText('en','save.checking'))
   f.c.store.run('UPDATE sources SET raw=raw||? WHERE id=(SELECT source FROM works WHERE id=?)','changed',id);
  return task(new AbortController().signal,()=>{});
 };
 const save=sourceSaveCommands(h);t.after(()=>save.close());
 const commands=new HostCommands([...save.commands,...changeCommands({
  controller:f.c,isCurrent:()=>true,execute:(...args)=>commands.execute(...args),
  choose:async()=>uiText('en','save.workHistory'),
  show:async(_title,_body,primary)=>{shown++;await primary.run();},
 })]);
 const action=commands.execute('/result '+id,cid);
 if(sourceDrift) await assert.rejects(action,/original work or its source changed/i);
 else assert.equal(await action,'completed');
 assert.equal(checked,!sourceDrift);
 assert.equal(shown,1);
});

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
 h.chooseItems=async(_title,items,initial)=>{assert.equal(items[0].value,'back');assert.equal(initial,undefined);if(step++===0)return'unavailable:1';if(step===2)return'next';return'back';};
 h.show=async(title,detail)=>{assert.equal(title,uiText('en','save.unavailable'));assert.match(detail,/Original missing identity/);};
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save list',cid);assert.deepEqual(requests,[{limit:25},{limit:25},{limit:25,after:1}]);
});

for (const [locale, expected] of [
 ['en',['Saved','Awaiting confirmation','Outcome uncertain','Outcome uncertain','Outcome uncertain','Outcome uncertain','Stopped before sending','Record unavailable']],
 ['ko',['저장됨','저장 확인 대기','결과 미확인','결과 미확인','결과 미확인','결과 미확인','전송 전 중단','기록 확인 불가']],
]) test(locale+' save catalogue displays recorded outcomes consistently and keeps exact identities',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c,locale);
 const phases=[['CONFIRMED','confirmed'],['PREPARED',null],['RESERVED',null],['INVOKING',null],['UNKNOWN','unknown'],['CONFIRMED',null],['REFUSED','definitely-unsent']];
 const rows=phases.map(([recordedPhase,recordedOutcome],i)=>({
  state:'RETAINED',operationId:'original-'+i,workId:f.works[0].workId,recordedPhase,recordedOutcome,
  nativeAttempt:recordedPhase==='PREPARED'?null:{},nativeReads:[],
  binding:{destinationRef:'refs/heads/topic/'+i,projectedCommit:'a'.repeat(40)},
 }));
 const unavailable={state:'UNAVAILABLE',operationId:'original-7',position:8,reason:'Retained record unavailable'};
 let visits=0,shown=0;
 f.c.listSourceSnapshotOperations=()=>({operations:[...(visits<2?rows:[...rows].reverse()),unavailable],nextCursor:null});
 f.c.inspectSourceSnapshotOperation=({operationId})=>{
  assert.equal(operationId,rows[2].operationId);
  return rows[2];
 };
 f.c.inspectSourceSnapshotProposal=async()=>assert.fail('Listing and reading cannot prepare a Native profile');
 h.chooseItems=async(title,items,initial)=>{
  if (++visits===1) {
   for (const [i,status] of expected.entries()) {
    const item=items.find(row=>row.value==='operation:original-'+i);
    assert.ok(item?.label.startsWith(status+' · '),item?.label);
    assert.ok(item.label.includes('original-'+i));
    if (i<rows.length) assert.ok(item.label.includes('refs/heads/topic/'+i));
   }
   return 'operation:'+rows[2].operationId;
  }
  if (visits===2) {
   assert.ok(title.startsWith(uiText(locale,'save.uncertain')));
   assert.deepEqual(items.map(item=>item.value),['back','details']);
   return 'back';
  }
  if (visits===3) {
   assert.equal(initial,'operation:'+rows[2].operationId);
   assert.ok(items.findIndex(item=>item.value===initial)>items.findIndex(item=>item.value==='operation:'+rows[3].operationId));
   return 'operation:'+unavailable.operationId;
  }
  assert.equal(initial,'operation:'+unavailable.operationId);
  return 'back';
 };
 h.show=async(title,body)=>{
  assert.equal(title,uiText(locale,'save.unavailable'));
  assert.ok(body.includes(unavailable.operationId)&&body.includes(unavailable.reason));
  shown++;
 };
 const save=sourceSaveCommands(h);t.after(()=>save.close());
 await new HostCommands(save.commands).execute('/save list',cid);
 assert.equal(visits,4);
 assert.equal(shown,1);
});

for (const locale of ['en','ko']) test(locale+' selects a prepared preview by recorded destination without opening its neighbors',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c,locale);
 const proposals=[
  {proposalId:'previous-preview',metadata:'retained',destinationRef:'refs/heads/topic/first',artifactHash:'a'.repeat(64)},
  {proposalId:'selected-preview',metadata:'retained',destinationRef:'refs/heads/topic/second',artifactHash:'b'.repeat(64)},
  {proposalId:'unavailable-preview',metadata:'unavailable'},
 ];
 const reads=[];let step=0,missingShown=0,failedOpenShown=0;
 f.c.listSourceSnapshotOperations=()=>({operations:[],nextCursor:null});
 f.c.listWorks=()=>({works:[{workId:id,projectId:'A',recordedPhase:'REVIEW_READY',requestPreview:'Original'}],nextCursor:null});
 f.c.listSourceSnapshotProposals=options=>{assert.equal(options.workId,id);return{proposals,nextCursor:null};};
 f.c.inspectSourceSnapshotProposalOperation=()=>null;
 f.c.openSourceSnapshotPublication=async(input)=>{reads.push(input);throw Error('ORIGINAL_PREVIEW_PROBE');};
 f.c.reviewSourceSnapshotSave=async()=>assert.fail('An unreadable preview cannot start save eligibility review');
 h.chooseItems=async(_title,items,initial)=>{
  if (++step===1) return'mode';
  if (step===2) return'work:'+id;
  if (step===4) assert.equal(initial, 'proposal:'+proposals[1].proposalId);
  if (step>3) return'back';
  const rows=items.filter(item=>item.value.startsWith('proposal:'));
  assert.equal(rows.length,3);
  assert.ok(rows[0].label.includes(proposals[0].destinationRef));
  assert.ok(rows[1].label.includes(proposals[1].destinationRef) && rows[1].label.includes(proposals[1].proposalId));
  assert.equal(rows[2].label,uiText(locale,'save.proposalUnavailableRow',{id:proposals[2].proposalId}));
  assert.equal(reads.length,0);
  return rows[1].value;
 };
 const before=workLedger(f.c);
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 const commands=new HostCommands(ui.commands);
 h.show=async(title,body)=>{
  assert.equal(title,uiText(locale,'save.previewUnavailable',{id:JSON.stringify(proposals[1].proposalId)}));
  assert.ok(body.includes(id) && body.includes('ORIGINAL_PREVIEW_PROBE'));
  failedOpenShown++;
 };
 await commands.execute('/save list',cid);
 assert.equal(failedOpenShown,1);
 assert.equal(step,5);
 h.chooseItems=async()=>missingShown?'back':'proposal:'+proposals[2].proposalId;
 h.show=async(title,body)=>{
  assert.equal(title,uiText(locale,'save.unavailable'));
  assert.ok(body.includes(proposals[2].proposalId));
  missingShown++;
 };
 assert.equal(await commands.execute('/save '+id,cid),'cancelled');
 assert.equal(missingShown,1);
 assert.deepEqual(reads,[{workId:id,proposalId:proposals[1].proposalId,expectedArtifactHash:proposals[1].artifactHash}]);
 assert.deepEqual(workLedger(f.c),before);
});

for(const replaced of [false,true])test('work history '+(replaced?'refuses a replaced operation':'remains available after current review changes'),async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);
 const operationId='original-operation',draft='Separate unsent draft 한국어';
 f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const before=workLedger(f.c),original={operationId,workId:id,state:'RETAINED',recordedPhase:'UNKNOWN',
  nativeAttempt:{intent:{}},nativeReads:[],binding:{destinationRef:'refs/heads/original',projectedCommit:'a'.repeat(40)}};
 const unavailable={state:'UNAVAILABLE',operationId:'unavailable-original',position:2,reason:'Original provenance unavailable'};
 const requests=[],shown=[],inspect=f.c.inspectChangeResult.bind(f.c);
 let currentResultChanged=false,visits=0;
 f.c.inspectChangeResult=(work,options)=>({...inspect(work,options),reviewReady:false,...currentResultChanged?{nextAction:'Review no longer current'}:{}});
 f.c.listSourceSnapshotOperations=options=>{
  requests.push(options);assert.equal(options.workId,id);
  return {operations:options.limit===1?[original]:[original,unavailable],nextCursor:null};
 };
 f.c.inspectSourceSnapshotOperation=({operationId:received})=>{
  assert.equal(received,operationId);return replaced?{...original,workId:'different-work'}:original;
 };
 f.c.inspectSourceSnapshotProposal=async()=>assert.fail('Browsing cannot prepare or inspect native prerequisites');
 f.c.checkSourceSnapshotResult=async()=>assert.fail('Browsing cannot check Git');
 h.chooseItems=async(title,items)=>{
  visits++;
  if(visits===1){
   assert.deepEqual(items.map(item=>item.value),['back','history']);
   currentResultChanged=true;return'history';
  }
  if(visits===2){
   assert.ok(title.includes(id));
   assert.deepEqual(items.map(item=>item.value),['back','operation:'+operationId,'operation:'+unavailable.operationId]);
   return'operation:'+operationId;
  }
  if(visits===4)return'operation:'+unavailable.operationId;
  shown.push(title);
  return'back';
 };
 h.show=async(_title,text)=>shown.push(text);
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 const action=new HostCommands(ui.commands).execute('/save '+id,cid);
 if(replaced){
  await assert.rejects(action,/Original save changed/);
  assert.equal(visits,2);
 }else{
  await action;
  assert.equal(visits,6);
  assert.ok(shown[0].includes('refs/heads/original')&&shown[0].includes(operationId));
  assert.ok(shown.some(text=>text.includes(unavailable.operationId)&&text.includes(unavailable.reason)));
 }
 assert.deepEqual(requests.slice(0,2),[{workId:id,limit:1},{workId:id,limit:25}]);
 assert.deepEqual(workLedger(f.c),before);
 assert.equal(f.c.inspectConversation(cid).draft.text,draft);
});

test('direct save history reads original records with an unavailable current assessment', async t => {
 const {c,works}=await registryWorld(t), cid=c.createConversation().conversationId, id=works[0].workId, h=host(c);
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",id);
 c.inspectWork=()=>assert.fail('History requires only the retained work scope');
 let shown=false;
 h.chooseItems=async title=>{ assert.ok(title.includes(id)); shown=true; return 'back'; };
 const ui=sourceSaveCommands(h); t.after(()=>ui.close());
 assert.equal(await new HostCommands(ui.commands).execute('/save history '+id,cid),'cancelled');
 assert.equal(shown,true);
});

test('direct save history explains when the original scope cannot be verified', async t => {
 const {c,works}=await registryWorld(t), cid=c.createConversation().conversationId, id=works[0].workId, h=host(c);
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",id);
 c.store.run("UPDATE sources SET origin='{' WHERE id=(SELECT source FROM works WHERE id=?)",id);
 h.chooseItems=async()=>assert.fail('Unverified scope may not open history');
 const ui=sourceSaveCommands(h); t.after(()=>ui.close());
 await assert.rejects(new HostCommands(ui.commands).execute('/save history '+id,cid),/registered source could not be verified/);
});

for (const entry of ['direct','work menu']) test(`${entry} save history refuses stale work custody`, async t => {
 const {c,works}=await registryWorld(t), cid=c.createConversation({projectId:'A'}).conversationId, id=works[0].workId, h=host(c);
 const original={operationId:'original-operation',workId:id,state:'RETAINED',recordedPhase:'UNKNOWN',
  nativeAttempt:{intent:{}},nativeReads:[],binding:{destinationRef:'refs/heads/original',projectedCommit:'a'.repeat(40)}};
 c.listSourceSnapshotOperations=()=>({operations:[original],nextCursor:null});
 c.inspectSourceSnapshotOperation=()=>{
  assert.equal(entry,'work menu','Stale list may not inspect a selected original');
  return original;
 };
 c.inspectSourceSnapshotProposal=async()=>assert.fail('Stale original may not start Native preparation');
 h.chooseItems=async (_title,items)=>{
  if(items.some(item=>item.value==='history')) return 'history';
  if(items.some(item=>item.value==='operation:'+original.operationId)) {
   if(entry==='direct') c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);
   return 'operation:'+original.operationId;
  }
  c.store.run('UPDATE projects SET root=root||? WHERE id=?','-moved','A');
  return 'read';
 };
 const ui=sourceSaveCommands(h); t.after(()=>ui.close());
 const argument=entry==='direct'?'history '+id:id;
 await assert.rejects(new HostCommands(ui.commands).execute('/save '+argument,cid),/original work or its source changed/i);
});

test('host close seals open picker admission without joining the unresolved picker',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId,h=host(f.c);let release,entered;
 const ready=new Promise(resolve=>entered=resolve);h.chooseItems=()=>new Promise(resolve=>{release=resolve;entered();});
 const ui=sourceSaveCommands(h),running=new HostCommands(ui.commands).execute('/save '+id,cid);void running.catch(()=>{});await ready;await ui.close();release('back');await assert.rejects(running,/abort/i);
});

test('malformed reserved command operands refuse without profile/Native access',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation().conversationId,ui=sourceSaveCommands(host(f.c));t.after(()=>ui.close());
 for(const argument of ['operation','proposal','history','history one extra','proposal work','operation one extra','list extra'])await assert.rejects(new HostCommands(ui.commands).execute('/save '+argument,cid),/Use \/save/);
});

test('declining an explicit source proposal cancels the command and closes its reader',async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
 const h=host(f.c),before=workLedger(f.c);
 let closed=0;
 f.c.inspectSourceSnapshotProposalOperation=()=>null;
 f.c.openSourceSnapshotPublication=async input=>{
  assert.deepEqual(input,{workId:id,proposalId:'retained'});
  return {review:{nativeProfile:{gitBinary:'/trusted/git'},sourceRoot:f.root,destinationRef:'refs/heads/kept',
   projectedCommit:'a'.repeat(40),productCount:1,wholeFileAdditionCount:0,omissionCount:0},close:async()=>{closed++;}};
 };
 f.c.reviewSourceSnapshotSave=async()=>({kind:'review',canAdopt:true,holds:[]});
 f.c.adoptSourceSnapshotSave=async()=>assert.fail('Back cannot adopt a proposal');
 f.c.inspectSourceSnapshotOperation=()=>assert.fail('Back cannot inspect a new operation');
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 assert.equal(await new HostCommands(ui.commands).execute('/save proposal '+id+' retained',cid),'cancelled');
 assert.equal(closed,1);
 assert.deepEqual(workLedger(f.c),before);
});

for (const direct of [false,true]) test('an adopted preview opens its original record from ' + (direct ? 'the exact command' : 'its original menu'), async t => {
 const f = await registryWorld(t), cid = f.c.createConversation({projectId:'A'}).conversationId, workId = f.works[0].workId;
 const h = host(f.c), before = workLedger(f.c), proposalId = 'prepared-preview', artifactHash = 'a'.repeat(64);
 const original = {
  state:'RETAINED', workId, operationId:'original-save', recordedPhase:'PREPARED', nativeAttempt:null, nativeReads:[],
  binding:{proposalId,destinationRef:'refs/heads/kept',projectedCommit:'a'.repeat(40)},
 };
 f.c.listSourceSnapshotProposals = () => ({proposals:[{proposalId,metadata:'retained',destinationRef:'refs/heads/kept',artifactHash}],nextCursor:null});
 f.c.inspectSourceSnapshotProposalOperation = input => {
  assert.deepEqual(input,direct ? {workId,proposalId} : {workId,proposalId,expectedArtifactHash:artifactHash});
  return original;
 };
 f.c.openSourceSnapshotPublication = async () => assert.fail('Historical review needs no publication bytes');
 f.c.inspectSourceSnapshotProposal = async () => assert.fail('Back cannot read the proposal');
 f.c.reviewSourceSnapshotSave = async () => assert.fail('Historical review cannot enter eligibility');
 f.c.inspectSourceSnapshotOperation = ({operationId}) => {
  assert.equal(operationId,original.operationId);
  return original;
 };
 h.notice = () => assert.fail('History cannot announce a new save');
 let visits = 0, history = 0;
 h.chooseItems = async (title, items) => {
  if (items.some(row => row.value==='proposal:'+proposalId))
   return ++visits===1 ? 'proposal:'+proposalId : 'back';
  assert.ok(title.includes(original.operationId));
  assert.ok(title.includes(original.binding.destinationRef));
  assert.deepEqual(items.map(row=>row.value),['back','details','send']);
  history++;
  return 'back';
 };
 const ui = sourceSaveCommands(h); t.after(()=>ui.close());
 const argument = direct ? 'proposal '+workId+' '+proposalId : workId;
 assert.equal(await new HostCommands(ui.commands).execute('/save '+argument,cid),'cancelled');
 assert.equal(history,1);
 assert.equal(visits,direct ? 0 : 2);
 assert.deepEqual(workLedger(f.c),before);
});

for (const change of ['result before adoption','allowance after adoption','work after adoption'])
test('exact source save distinguishes '+change,async t=>{
 const f=await registryWorld(t),cid=f.c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
 const h=host(f.c),inspect=f.c.inspectChangeResult.bind(f.c);
 let changedResult=false,allocated=0,sends=0,closed=0;
 f.c.inspectChangeResult=(work,options)=>{
  const original=inspect(work,options);
  return changedResult?{...original,nextAction:'source save holds one execution unit'}:original;
 };
 const binding={proposalId:'retained',destinationRef:'refs/heads/kept',projectedCommit:'a'.repeat(40)};
 const original={state:'RETAINED',workId:id,operationId:'original-save',recordedPhase:'CONFIRMED',recordedOutcome:'confirmed',binding};
 f.c.inspectSourceSnapshotProposalOperation=()=>null;
 f.c.openSourceSnapshotPublication=async()=>({review:{...binding,nativeProfile:{gitBinary:'/trusted/git'},sourceRoot:f.root,
  productCount:1,wholeFileAdditionCount:0,omissionCount:0},close:async()=>{closed++;}});
 f.c.reviewSourceSnapshotSave=async()=>({kind:'review',fingerprint:'review',canAdopt:true,holds:[]});
 h.show=async(_title,_body,primary)=>{await primary?.run();};
 h.chooseItems=async(_title,items)=>items.some(item=>item.value==='save')?'save':'back';
 f.c.adoptSourceSnapshotSave=async(input,controls)=>{
  assert.equal(input.expectedReviewFingerprint,'review');
  if (change==='result before adoption') changedResult=true;
  controls.validate();
  allocated++;
  controls.onAllocated(original.operationId);
  return original;
 };
 f.c.sendSourceSnapshotSave=async(operationId,controls)=>{
  assert.equal(operationId,original.operationId);
  changedResult=true;
  if (change==='work after adoption') f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);
  controls.validate();
  sends++;
  return original;
 };
 f.c.inspectSourceSnapshotOperation=({operationId})=>{
  assert.equal(operationId,original.operationId);
  return original;
 };
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 const command=new HostCommands(ui.commands).execute('/save proposal '+id+' retained',cid);
 if (change==='allowance after adoption') assert.equal(await command,'completed');
 else await assert.rejects(command,change==='result before adoption'?/Original result changed/:/original work or its source changed/i);
 assert.equal(allocated,change==='result before adoption'?0:1);
 assert.equal(sends,change==='allowance after adoption'?1:0);
 assert.equal(closed,1);
});

test('no-argument save from ordinary current work opens retained discovery without managed-result inspection',async t=>{const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c),inspect=f.c.inspectConversation.bind(f.c);let listed=0;f.c.inspectConversation=id=>({...inspect(id),workId:'ordinary-work'});f.c.inspectChangeActivity=()=>undefined;f.c.inspectChangeResult=()=>assert.fail('Ordinary work has no managed result');f.c.listSourceSnapshotOperations=()=>{listed++;return{operations:[],nextCursor:null};};const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save',cid);assert.equal(listed,1);});

test('explicit ordinary work explains its scope without substituting another result',async t=>{const f=await registryWorld(t),cid=f.c.createConversation().conversationId,h=host(f.c),shown=[];f.c.inspectChangeActivity=()=>undefined;f.c.inspectChangeResult=()=>assert.fail('Ordinary work has no managed result');h.show=async(title,text)=>shown.push({title,text});const ui=sourceSaveCommands(h);t.after(()=>ui.close());await new HostCommands(ui.commands).execute('/save ordinary-work',cid);assert.equal(shown[0].title,uiText('en','save.notManagedWork'));assert.ok(shown[0].text.includes('ordinary-work'));});

test('unreadable original result closes to the same older work page',async t=>{
 const f=await registryWorld(t),{c}=f;const cid=c.createConversation({projectId:'A'}).conversationId;
 const broken=f.works[1].workId,healthy=f.works[0].workId,draft='Keep this exact draft 한국어';
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",broken);
 const list=c.listWorks.bind(c);c.listWorks=options=>list({...options,limit:1});
 const before=workLedger(c),h=host(c),shown=[],picked=[];
 h.show=async(title,_body,primary)=>{assert.equal(primary,undefined);shown.push(title);};
 h.chooseItems=async(title,items)=>{
  picked.push({title,items});
  switch(picked.length) {
   case 1:return 'mode';
   case 2:return 'next';
   case 3:assert.ok(items.some(item=>item.label.includes(broken)));return 'work:'+broken;
   case 4:assert.deepEqual(picked[3],picked[2]);return 'next';
   case 5:assert.ok(items.some(item=>item.label.includes(healthy)));return 'work:'+healthy;
   case 6:assert.ok(title.includes(healthy));return 'back';
   case 7:return 'back';
   default:assert.fail('Unexpected picker');
  }
 };
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 await new HostCommands(ui.commands).execute('/save list',cid);
 assert.deepEqual(shown,['Work result unavailable · '+broken]);
 assert.equal(picked.length,7);
 assert.deepEqual(workLedger(c),before);
 assert.equal(c.inspectConversation(cid).draft.text,draft);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,0);
});

test('no-argument save keeps the exact current work when its result is unreadable',async t=>{
 const {c,works}=await registryWorld(t),cid=c.createConversation({projectId:'A'}).conversationId,id=works[0].workId;
 const inspect=c.inspectConversation.bind(c),h=host(c),shown=[];
 c.inspectConversation=target=>({...inspect(target),workId:id});
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",id);
 c.listSourceSnapshotOperations=options=>{
  assert.deepEqual(options,{workId:id,limit:1});
  return {operations:[],nextCursor:null};
 };
 h.chooseItems=async()=>assert.fail('Current work may not fall back to global discovery');
 h.show=async(title,_body,primary)=>{assert.equal(primary,undefined);shown.push(title);};
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 assert.equal(await new HostCommands(ui.commands).execute('/save',cid),'cancelled');
 assert.deepEqual(shown,['Work result unavailable · '+id]);
});

for(const circumstance of ['verified','invalid custody','changed custody','unavailable history'])test('unavailable save result preserves independently verified history only · '+circumstance,async t=>{
 const f=await registryWorld(t),{c}=f,cid=c.createConversation({projectId:'A'}).conversationId,id=f.works[0].workId;
 c.store.run("UPDATE change_state SET phase='BLOCKED',data='{' WHERE work=?",id);
 if(circumstance==='invalid custody')c.store.run("UPDATE sources SET origin='{' WHERE id=(SELECT source FROM works WHERE id=?)",id);
 const original={state:'RETAINED',workId:id,operationId:'prepared-original',recordedPhase:'PREPARED',nativeAttempt:null,nativeReads:[],
  binding:{destinationRef:'refs/heads/original',projectedCommit:'a'.repeat(40)}};
 const h=host(c),reads=[];
 c.prepareSourceSnapshot=async()=>assert.fail('Unavailable result started new preparation');
 c.sendSourceSnapshotSave=async()=>assert.fail('Historical fallback started a first send');
 c.listSourceSnapshotOperations=options=>{
  assert.equal(options.workId,id);
  reads.push(options);
  if(circumstance==='unavailable history')throw Error('History catalogue unreadable');
  return {operations:[original],nextCursor:null};
 };
 c.inspectSourceSnapshotOperation=({operationId})=>{assert.equal(operationId,original.operationId);return original;};
 let diagnostics=0,pickers=0,expected=workLedger(c);
 h.show=async(title,body,primary)=>{
  diagnostics++;assert.equal(title,'Work result unavailable · '+id);assert.match(body,/current result/i);
  if(circumstance==='verified'||circumstance==='changed custody'){
   assert.equal(primary?.label,uiText('en','save.workHistory'));
   if(circumstance==='changed custody'){
    c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',id);expected=workLedger(c);
   }
   await primary.run();
  }else assert.equal(primary,undefined);
 };
 h.chooseItems=async(title,items)=>{
  assert.equal(circumstance,'verified','Only verified scope may enter history');
  pickers++;
  if(pickers===2){assert.deepEqual(items.map(item=>item.value),['back','details']);return 'back';}
  assert.ok(title.includes(id));
  assert.deepEqual(items.map(item=>item.value),['back','operation:'+original.operationId]);
  return pickers===1?'operation:'+original.operationId:'back';
 };
 const ui=sourceSaveCommands(h);t.after(()=>ui.close());
 const outcome=new HostCommands(ui.commands).execute('/save '+id,cid);
 if(circumstance==='changed custody')await assert.rejects(outcome,/original work or its source changed/i);
 else assert.equal(await outcome,'cancelled');
 assert.equal(diagnostics,1);
 assert.equal(pickers,circumstance==='verified'?3:0);
 assert.equal(reads.length,circumstance==='verified'?3:circumstance==='invalid custody'?0:1);
 assert.deepEqual(workLedger(c),expected);
 assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_operations').n,0);
});
