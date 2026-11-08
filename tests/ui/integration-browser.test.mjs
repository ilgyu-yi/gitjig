import test from 'node:test';
import assert from 'node:assert/strict';
import {integrationWorld,snapshot} from '../controller/integration-registry-fixture.mjs';
import {pickLocalIntegration} from './integration-command-fixture.mjs';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
async function world(t){const f=await integrationWorld(t);f.op=await f.prepare();f.conversation=f.c.createConversation().conversationId;return f;}
function command(f,choices,extra={}){const shown=[],ui=repositoryCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next===undefined)return;const pick=rows.find(row=>row.startsWith(next));assert.ok(pick,'Missing '+next+' in '+JSON.stringify(rows));return pick;},input:async()=>assert.fail('No credentials for inspection'),show:async(title,text,primary)=>{shown.push({title,text});await primary?.run();},notice(){},...extra});return {shown,ui,run:()=>ui.commands[0].run('',f.conversation)};}
test('repository integration browser inspects original facts without granting authority or altering any ledger',async t=>{const f=await world(t),before=snapshot(f.c),h=command(f,['Retained integrations',pickLocalIntegration,'Inspect original integration facts',(title)=>{assert.ok(title.includes(f.op.operationId));return 'Back without action';},'Back','Close']);await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.match(h.shown[0].text,/^Preparation review required\nNext: review preparation/);const detail=JSON.parse(h.shown[0].text.slice(h.shown[0].text.indexOf('\n{')+1));assert.equal(detail.integration.operationId,f.op.operationId);assert.match(h.shown[0].text,/not a fresh native check or current permission/);assert.equal(detail.integration.transportOutcome,null);f.pass();});
test('same receiver and phase stay distinguishable by the assigned request',async t=>{
 const f=await world(t),other=await f.prepare(),picked=f.op,terms=['Ship Korean checkout fix','Fix cache restoration'];
 for(const [record,term] of [[picked,terms[0]],[other,terms[1]]]) {
  f.c.store.run('UPDATE sources SET raw=? WHERE id=(SELECT source FROM works WHERE id=?)',
   term+'\n\u001b[31mAdditional private context '+('x'.repeat(1024)),record.workId);
 }
 const before=snapshot(f.c);
 const h=command(f,['Retained integrations',(_title,rows)=>{
  const retained=rows.filter(row=>row.includes(' · local-git'));
  assert.equal(retained.length,2);
  for(const [i,record] of [picked,other].entries()) {
   const row=retained.find(label=>label.includes(record.operationId));
   assert.ok(row && row.includes(terms[i]) && !row.includes(terms[1-i]));
   assert.ok(row.indexOf(terms[i])<row.indexOf(f.receiver));
   assert.doesNotMatch(row,/\u001b|x{100}/u);
  }
  return retained.find(row=>row.includes(terms[0]));
 },'Inspect original integration facts','Back without action','Back','Close']);
 await h.run();await h.ui.close();
 assert.ok(h.shown[0].text.includes(picked.operationId)&&h.shown[0].text.includes(picked.workId));
 assert.ok(!h.shown[0].text.includes(other.operationId));
 assert.ok(!h.shown[0].text.includes('Additional private context'));
 assert.deepEqual(snapshot(f.c),before);
 const stale=command(f,['Retained integrations',(_title,rows)=>{
  f.c.store.run('UPDATE sources SET raw=? WHERE id=(SELECT source FROM works WHERE id=?)','Updated assigned source preview',picked.workId);
  return rows.find(row=>row.includes(terms[0]));
 },(_title,rows)=>{
  assert.ok(rows.find(row=>row.includes(picked.operationId)).includes('Updated assigned source preview'));
  return 'Back';
 },'Close']);
 await stale.run();
 await stale.ui.close();
 assert.equal(stale.shown.length,1);
 assert.equal(stale.shown[0].title,'Selected integration record changed');
 assert.ok(stale.shown[0].text.includes(picked.operationId));
 f.pass();
});

test('source movement and late original fact changes refuse stale inspection',async t=>{const f=await world(t);let current=true;const h=command(f,['Retained integrations',(_title,rows)=>{current=false;return rows[0];}],{isCurrent:()=>current});await assert.rejects(h.run(),/source changed/);await h.ui.close();assert.deepEqual(h.shown,[]);const stale=command(f,['Retained integrations',pickLocalIntegration,()=>{f.c.store.run("UPDATE effect_operations SET phase='REFUSED' WHERE id=?",f.op.operationId);return 'Inspect original integration facts';}]);await assert.rejects(stale.run(),/facts changed/);await stale.ui.close();assert.deepEqual(stale.shown,[]);f.pass();});
test('unavailable original remains discoverable and retains ID without repair',async t=>{const f=await world(t);f.c.store.run("UPDATE effect_operations SET data='{' WHERE id=?",f.op.operationId);const before=snapshot(f.c),h=command(f,['Retained integrations','Unavailable retained','Back','Close']);await h.run();await h.ui.close();assert.match(h.shown[0].title,/no repair performed/);assert.ok(h.shown[0].text.includes(f.op.operationId));assert.equal(snapshot(f.c),before);f.pass();});

test('unavailability does not admit a substituted original receiver',async t=>{
 const f=await world(t),id=f.op.operationId,original=f.c.store.one('SELECT target FROM effect_operations WHERE id=?',id);
 f.c.store.run('INSERT INTO effect_targets SELECT ?,project,data FROM effect_targets WHERE id=?','different-target',original.target);
 const before=snapshot(f.c),h=command(f,['Retained integrations',(_title,rows)=>{
  f.c.store.run('UPDATE effect_operations SET target=? WHERE id=?','different-target',id);
  assert.equal(f.c.inspectRetainedIntegration(id).entry.state,'UNAVAILABLE');
  return rows.find(row=>row.includes(id));
 }]);
 try {await assert.rejects(h.run(),/Original integration changed/);assert.deepEqual(h.shown,[]);}
 finally {f.c.store.run('UPDATE effect_operations SET target=? WHERE id=?',original.target,id);await h.ui.close();}
 assert.equal(snapshot(f.c),before);f.pass();
});

test('readable drift does not admit a changed receiver path under the same target ID',async t=>{
 const f=await world(t),id=f.op.operationId,target=f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.target);
 const changed=JSON.parse(target.data);
 changed.target.canonicalPath=f.receiver+'-different';
 const before=snapshot(f.c),h=command(f,['Retained integrations',(_title,rows)=>{
  f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?',JSON.stringify(changed),f.target);
  assert.equal(f.c.inspectRetainedIntegration(id).entry.state,'RETAINED');
  return rows.find(row=>row.includes(id));
 }]);
 try {await assert.rejects(h.run(),/Original integration changed/);assert.deepEqual(h.shown,[]);}
 finally {f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?',target.data,f.target);await h.ui.close();}
 assert.equal(snapshot(f.c),before);f.pass();
});

test('integration original-work recovery preserves started and the original submission without native execution',async t=>{
 const f=await world(t),before=snapshot(f.c),id=f.c.inspectRetainedIntegration(f.op.operationId).view.workId,context={submission:{conversationId:f.conversation,text:'/repo',revision:2}};
 const h=command(f,['Retained integrations',pickLocalIntegration,'Open original work recovery','Open original work recovery'],{execute:async(command,target,ctx)=>{assert.equal(command,'/work '+id);assert.equal(target,f.conversation);assert.equal(ctx,context);return 'started';}});
 assert.equal(await h.ui.commands[0].run('',f.conversation,context),'started');await h.ui.close();assert.equal(snapshot(f.c),before);f.pass();
});

test('Korean retained status and stable action values preserve the exact original ledger',async t=>{
 const f=await world(t),language=f.c.getConversationLanguage(f.conversation),view=f.c.inspectConversation(f.conversation);f.c.setConversationLanguage({conversationId:f.conversation,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});
 const before=snapshot(f.c),actions=['integrations',f.op.operationId,'Inspect original integration facts','Back without action','Back','close'],menus=[];
 const h=command(f,['Retained integrations','Close'],{uiLocale:()=> 'ko',chooseItems:async(title,items)=>{menus.push({title,items});const value=actions.shift();const item=items.find(item=>item.value.startsWith(value)||value===f.op.operationId&&item.value.includes(value));assert.ok(item);return item.value;}});
 await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.match(menus[0].title,/저장소 관리/);assert.match(menus[1].title,/저장된 통합 요청/);assert.match(menus[2].title,/^준비 검토가 필요합니다/);assert.ok(menus[2].items.some(item=>item.value==='Inspect original integration facts'&&item.label==='원래 통합 요청의 상태와 기록 확인'));assert.match(h.shown[0].text,/^준비 검토가 필요합니다\n다음:/);assert.ok(h.shown[0].text.includes(f.op.operationId));f.pass();
});

test('language drift while an integration picker is open refuses before another view or action',async t=>{
 const f=await world(t);let changed;const h=command(f,['Retained integrations'],{chooseItems:async(title,items)=>{if(title.startsWith('Repository management'))return 'integrations';const view=f.c.inspectConversation(f.conversation),language=f.c.getConversationLanguage(f.conversation);f.c.setConversationLanguage({conversationId:f.conversation,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});changed=snapshot(f.c);return items[0].value;}});
 await assert.rejects(h.run(),/source changed/);await h.ui.close();assert.equal(snapshot(f.c),changed);assert.deepEqual(h.shown,[]);f.pass();
});

test('picker labels escape C1 controls while stable original choices retain exact bytes',async()=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');const id='opaque-\x9b-id',entry={state:'RETAINED',operationId:id,workId:'W',targetId:'T',family:'local-git',endpoint:'/original/\x85receiver\u202e',ref:'refs/heads/main',recordedPhase:'UNKNOWN'},view={operationId:id,workId:'W',phase:'UNKNOWN',transportOutcome:'uncertain',observedOutcome:'unknown',blocked:[],nextAction:''},original={entry,view};const before=JSON.stringify(original);let picks=0,shown;
 const controller={listIntegrations:()=>({operations:[entry],nextCursor:null}),inspectRetainedIntegration:value=>{assert.equal(value,id);return original;}};await browseIntegrations({locale:'ko',guard(){},choose:async()=>assert.fail('Typed picker required'),chooseItems:async(title,items)=>{assert.doesNotMatch(title,/[\x85\x9b\u202e]/u);assert.ok(items.every(item=>!/[\x85\x9b\u202e]/u.test(item.label)));if(picks++===0){assert.equal(items[0].value,'operation:'+id);assert.ok(items[0].label.includes('\\u0085'));return items[0].value;}return picks===2?'Inspect original integration facts':items[0].value==='Back without action'?'Back without action':'Back';},show:async(_title,text)=>shown=text},controller);assert.ok(shown.includes('opaque-\\u009b-id'));assert.equal(JSON.stringify(original),before);
});

for (const restored of [false, true]) test('unavailable preparation returns to the pinned parent even if the record returns: '+restored, async()=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');
 const id='retained-after-action', workId='W', targetId='T';
 const entry={state:'RETAINED',operationId:id,workId,targetId,family:'local-git',endpoint:'/receiver',ref:'refs/heads/main',recordedPhase:'PREPARED'};
 const view={operationId:id,workId,targetId,phase:'PREPARED',receiptIds:[],transportOutcome:null,observedOutcome:'not-observed',blocked:[],nextAction:''};
 const effect={...view,phase:'RESERVED',reason:'Accepted original outcome'};
 const unavailable={entry:{state:'UNAVAILABLE',operationId:id,workId,targetId,reason:'Original metadata became unavailable'},view:null};
 const shown=[], choices=['Review original integration preparation','Prepare this original integration'];
 const context={reviewed:{work:{id:workId}},context:{holds:[]},contextFingerprint:'original-context'};
 let accepted=false, outcomeShown=false;
 const controller={
  inspectDeliveryWork:()=>({fingerprint:'work'}),
  inspectRetainedIntegration:()=>!accepted ? {entry,view}
   : restored&&outcomeShown ? {entry:{...entry,recordedPhase:effect.phase},view:effect} : unavailable,
  inspectIntegrationPreparation:()=>context,
  getWorkApplicationModelBaseline:()=>undefined,
 };
 const completed=await browseIntegrations({
  locale:'ko',guard(){},choose:async()=>assert.fail('Typed choices required'),
  chooseItems:async()=>{assert.ok(choices.length,'Pinned operation must not reopen');return choices.shift();},
  prepare:async()=>{accepted=true;return effect;},
  show:async(_title,text,primary)=>{shown.push(text);if(text.includes(effect.reason))outcomeShown=true;await primary?.run();},
 },controller,id,{pinned:true});
 assert.equal(completed,true);
 const diagnostics=shown.filter(text=>text.includes('확인할 수 없는 저장된 통합 요청'));
 assert.equal(diagnostics.length,1);
 assert.ok(diagnostics[0].includes(effect.reason)&&diagnostics[0].includes(id));
});

test('oversized picker rows and titles omit displays whole while selecting exact original values',async()=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');const id='long-id-'+ 'x'.repeat(9000),entry={state:'RETAINED',operationId:id,family:'local-git',endpoint:'/receiver',ref:'refs/heads/main',recordedPhase:'UNKNOWN'},view={operationId:id,workId:'W',phase:'UNKNOWN',transportOutcome:'uncertain',observedOutcome:'unknown',blocked:[],nextAction:''},original={entry,view};let step=0,selected=0,shown;const controller={listIntegrations:()=>({operations:[entry],nextCursor:null}),inspectRetainedIntegration:value=>{assert.equal(value,id);selected++;return original;}};
 await browseIntegrations({locale:'ko',guard(){},choose:async()=>assert.fail('Typed picker required'),chooseItems:async(title,items)=>{assert.ok(Buffer.byteLength(title)<=8192);assert.ok(items.every(item=>Buffer.byteLength(item.label)<=8192));if(step++===0){assert.match(items[0].label,/1번 기록: 표시를 통째로 생략/);assert.ok(items[0].value.includes(id));return items[0].value;}if(step===2){assert.match(title,/긴 표시를 생략/);return 'Inspect original integration facts';}return items[0].value==='Back without action'?'Back without action':'Back';},show:async(_title,text)=>shown=text},controller);assert.ok(selected>0);assert.ok(shown.includes('원래 식별자를 통째로 생략'));assert.ok(!shown.split('원래 저장된 기록 · 상세')[0].includes('x'.repeat(100)));
});

test('long receiver and ref leave the exact operation searchable',async()=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');
 const operationId='searchable-operation',entry={state:'RETAINED',operationId,workId:'W',targetId:'T',family:'local-git',
  endpoint:'/'+ '한'.repeat(4000),ref:'refs/heads/'+ '국'.repeat(4000),recordedPhase:'UNKNOWN',requestPreview:'Find the original'};
 const view={operationId,workId:'W',phase:'UNKNOWN',transportOutcome:'uncertain',observedOutcome:'unknown',blocked:[],nextAction:''};
 const c={listIntegrations:()=>({operations:[entry],nextCursor:null}),
  inspectRetainedIntegration:id=>{assert.equal(id,operationId);return {entry,view};}};
 let choices=0,shown=false;
 await browseIntegrations({locale:'ko',guard(){},choose:async()=>assert.fail('Typed choices required'),chooseItems:async(_title,items)=>{
  if(choices++===0){
   assert.ok(items[0].label.includes('Find the original') && items[0].label.includes(operationId));
   assert.ok(Buffer.byteLength(items[0].label)<8192);
   return items[0].value;
  }
  return shown?items[0].value==='Back without action'?'Back without action':'Back':'Inspect original integration facts';
 },show:async(_title,text)=>{shown=true;assert.ok(text.includes(operationId));}},c);
 assert.equal(shown,true);
});

test('a pinned repository operation checks its work and never opens a registry',async t=>{
 const f=await world(t),before=snapshot(f.c),id=f.op.operationId,work=f.c.inspectRetainedIntegration(id).view.workId,titles=[],notices=[];
 const h=command(f,[],{choose:async(title)=>{titles.push(title);return undefined;},notice:text=>notices.push(text)});
 assert.equal(await h.ui.commands[0].run('operation '+id+' other-work',f.conversation),'cancelled');
 assert.deepEqual(titles,[]);assert.match(notices[0],/Original operation unavailable/);
 assert.equal(await h.ui.commands[0].run('operation '+id+' '+work,f.conversation),'cancelled');
 assert.equal(titles.length,1);
 const [heading,...context]=titles[0].split('\n');
 assert.equal(heading,'Original integration · #'+id);
 assert.deepEqual(context,['Preparation review required','Original work · '+work,'Branch ref · refs/heads/main','Receiver · '+f.receiver]);
 assert.equal(snapshot(f.c),before);await h.ui.close();f.pass();
});

test('opening an integration directly does not choose a row in the later catalogue',async()=>{
 const {browseIntegrations}=await import('../../dist/ui/integration-browser.js');
 const entry={state:'RETAINED',operationId:'direct',workId:'W',targetId:'T',family:'local-git',
  endpoint:'/receiver',ref:'refs/heads/main',recordedPhase:'PREPARED'};
 const view={operationId:entry.operationId,workId:'W',phase:'PREPARED',transportOutcome:null,observedOutcome:'not-observed'};
 let catalogues=0;
 const c={
  listIntegrations:()=>({operations:[{...entry,operationId:'another'},entry],nextCursor:null}),
  inspectRetainedIntegration:()=>({entry,view}),
 };
 await browseIntegrations({guard(){},choose:async()=>assert.fail('Typed choices required'),show:async()=>{},
  chooseItems:async(_title,items,initialValue)=>{
   if(items[0].value==='Back without action')return 'Back without action';
   catalogues++;
   assert.equal(initialValue,undefined);
   return 'Back';
  },
 },c,entry.operationId);
 assert.equal(catalogues,1);
});
