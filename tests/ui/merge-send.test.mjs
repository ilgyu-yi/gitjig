import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {subject} from '../controller/merge-controller-fixture.mjs';
import {configureOwnedMergeFixture} from '../../.qualification/controller-testing.js';
import {readCommand as readRepositoryCommand} from './integration-command-fixture.mjs';
const readCommand=(f,choices,inputs=[],extra={})=>readRepositoryCommand(f,choices,inputs,{acceptReviewPages:true,...extra});
const tables=['works','sources','effect_operations','effect_delegations','effect_receipts','runs','budgets'];
const snapshot=c=>JSON.stringify(tables.map(table=>c.store.all('SELECT * FROM '+table+' ORDER BY rowid')));
async function world(t,options={}){const f=await subject(t,options);const grant=f.grant(),original=await f.c.prepareOwnerMerge(f.workId,f.targetId,f.branchOperationId),credential=path.join(f.native.root,'send-credential.json');await fs.writeFile(credential,JSON.stringify({token:'owned-native-merge-only'}),{mode:0o600});f.c.configureMergeCredential=options=>configureOwnedMergeFixture(f.c,{...options,origin:f.native.origin});return {...f,original,grant,credential,conversation:f.c.createConversation().conversationId};}
const picks=(mode,decision)=>['Retained PR merges','owner/repo',mode==='prepare'?'Review original merge preparation':'Review original merge send',decision??(mode==='prepare'?'Prepare this same original PR merge':'Send this prepared original PR merge'),'Back',...(decision?.startsWith('Back without')?[]:['Back']),'Close'];
const noReplay=(_title,rows)=>{
 for(const action of ['preparation','send','reauthorization'])assert.ok(!rows.includes('Review original merge '+action));
 return 'Back';
};
test('closing a send review returns to the exact retained record without confirmation or native work',async t=>{
 const f=await world(t),before=snapshot(f.c),requests=f.native.requests.length;
 const sequence=picks('send').slice(0,3).concat([title=>{assert.match(title,/^PR merge record/);assert.ok(title.includes(f.original.operationId));return 'Back';},'Back','Close']);
 const h=readCommand(f,sequence,[],{acceptReviewPages:false});
 await h.run();await h.ui.close();assert.match(h.shown[0].text,/PR merge record · "owner\/repo" #12 → "main"/);assert.match(h.shown[0].text,/Execution:.*available/);assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});
for(const mode of ['prepare','send'])test(mode+' defaults Back without procedure lookup, credential change, requests or spend',async t=>{
 const f=await world(t),before=snapshot(f.c),requests=f.native.requests.length;f.c.changes.currentEvidence=()=>{throw Error('Back cannot read current procedures');};f.c.changes.assertCurrentEvidence=()=>{throw Error('Preview cannot assert current procedure standing');};const sequence=picks(mode,mode==='prepare'?'Back without preparation':'Back without sending');sequence.splice(4,0,title=>{assert.match(title,/^PR merge record/);assert.ok(title.includes(f.original.operationId));return 'Back';});const h=readCommand(f,sequence,[],{input:()=>{throw Error('Back cannot ask for credentials');}});await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});
test('separate original reprepare uses fresh credential then separate owner send uses that session without another profile',async t=>{
 const f=await world(t),beforeWork=f.c.store.one('SELECT * FROM works WHERE id=?',f.workId),grant=f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.delegationId),spent=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,oldReceipts=f.c.store.all('SELECT * FROM effect_receipts WHERE operation=?',f.original.operationId);let inputs=0,prepared=false;
 const sequence=picks('prepare');sequence.splice(4,0,'Review original merge send','Send this prepared original PR merge');const h=readCommand(f,sequence,[],{input:async()=>{inputs++;assert.equal(inputs,1,'Sending cannot configure another session');return f.credential;},show:async(title,_text,primary)=>{await primary?.run();if(title.startsWith('Original PR merge preparation retained')){prepared=true;assert.equal(f.native.puts(),0);assert.equal(f.c.inspectMerge(f.original.operationId).phase,'RESERVED');}}});assert.equal(await h.run(),'completed');await h.ui.close();assert.equal(prepared,true);assert.equal(inputs,1);assert.equal(f.c.inspectMerge(f.original.operationId).phase,'CONFIRMED');assert.equal(f.native.puts(),1);assert.deepEqual(f.c.store.one('SELECT * FROM works WHERE id=?',f.workId),beforeWork);assert.deepEqual(f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',grant.id),grant);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,1);for(const row of oldReceipts)assert.deepEqual(f.c.store.one('SELECT * FROM effect_receipts WHERE id=?',row.id),row);assert.equal(f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,spent+2);f.native.pass();
});
test('replaced prepared credential holds owner Send without asking for replacement or spending',async t=>{
 const f=await world(t);configureOwnedMergeFixture(f.c,{token:'owned-native-merge-only',origin:f.native.origin});const before=snapshot(f.c),requests=f.native.requests.length,sequence=picks('send');sequence.splice(3,1);const h=readCommand(f,sequence,[],{input:()=>{throw Error('Held send must not replace credentials');}});await h.run();await h.ui.close();assert.equal(f.c.inspectMergeDispatch(f.original.operationId).eligible,false);assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.ok(h.shown.some(row=>row.text.includes('explicitly prepare this original again')));f.native.pass();
});
for(const mode of ['prepare','send'])test('execution exhaustion holds '+mode+' before credentials or native requests',async t=>{
 const f=await world(t);f.c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='execution'",f.workId);const before=snapshot(f.c),requests=f.native.requests.length,sequence=picks(mode);sequence.splice(3,1);const h=readCommand(f,sequence,[],{input:()=>{throw Error('Exhausted action cannot ask credentials');}});await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);f.native.pass();
});
test('possible handoff cannot reprepare or replay from owner retained actions',async t=>{
 const f=await world(t,{dropAcceptance:true});await f.c.dispatchMerge(f.original.operationId);const before=snapshot(f.c),requests=f.native.requests.length;
 const h=readCommand(f,['Retained PR merges','owner/repo',noReplay,'Back','Close'],[],{input:()=>{throw Error('Possible handoff cannot replace credentials');}});
 await h.run();await h.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),1);f.native.pass();
});

for(const mode of ['close','source'])test('held current evidence reprepare '+mode+' cannot allocate a late run or spend',async t=>{
 const f=await world(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),actual=f.c.changes.currentEvidence.bind(f.c.changes),beforeRuns=f.c.store.all('SELECT * FROM runs ORDER BY rowid'),beforeBudget=f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),original=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId),requests=f.native.requests.length;
 f.c.changes.currentEvidence=async id=>{entered.resolve();await release.promise;return actual(id);};const h=readCommand(f,picks('prepare'),[f.credential]),pending=h.run();void pending.catch(()=>{});await entered.promise;let closing;if(mode==='close')closing=h.ui.close();else f.c.store.run("UPDATE sources SET raw=raw||' changed' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);release.resolve();await assert.rejects(pending,error=>error.message.includes(f.original.operationId));await(closing??h.ui.close());assert.deepEqual(f.c.store.all('SELECT * FROM runs ORDER BY rowid'),beforeRuns);assert.deepEqual(f.c.store.all('SELECT * FROM budgets ORDER BY rowid'),beforeBudget);assert.deepEqual(f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId),original);assert.equal(f.native.requests.length,requests);f.native.pass();
});
for(const afterHandoff of [false,true])for(const mode of ['close','navigation','source'])test('owner Send held '+(afterHandoff?'after native response':'before intent')+' '+mode+' preserves causal boundary',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false,current=true;const f=await world(t,{intercept:async({req,options})=>{if(hold&&req.url==='/repos/owner/repo/pulls/12'&&!!options.merged===afterHandoff){hold=false;entered.resolve();await release.promise;}return false;}}),work=f.c.store.one('SELECT * FROM works WHERE id=?',f.workId),grant=f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.delegationId),spent=f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,h=readCommand(f,picks('send'),[],{isCurrent:()=>current,input:()=>{throw Error('Send cannot replace profile');}});hold=true;const pending=h.run();void pending.catch(()=>{});await entered.promise;let closing;if(mode==='close')closing=h.ui.close();if(mode==='navigation')current=false;if(mode==='source')f.c.store.run("UPDATE sources SET raw=raw||' drift' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);release.resolve();await assert.rejects(pending,error=>error.message.includes(f.original.operationId)&&error.message.includes(f.workId)&&error.message.includes(f.targetId));await(closing??h.ui.close());assert.deepEqual(f.c.store.one('SELECT * FROM works WHERE id=?',f.workId),work);assert.deepEqual(f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',grant.id),grant);assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM runs WHERE reservation='reserved'").n,0);assert.equal(f.c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",f.workId).consumed,spent+1);assert.equal(f.native.puts(),afterHandoff?1:0);const view=f.c.inspectMerge(f.original.operationId);assert.equal(view.phase,afterHandoff?'UNKNOWN':'REFUSED');if(afterHandoff){assert.equal(view.transportOutcome,'native-success');assert.equal(f.c.store.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='merge-send'",f.original.operationId).n,1);}f.native.pass();
});
for(const fault of ['evidence','grant'])test('current '+fault+' refusal does not gain owner sending authority',async t=>{
 const f=await world(t);if(fault==='evidence')f.invalidate();else f.c.store.run("UPDATE effect_delegations SET data=json_set(data,'$.rootEpoch',0) WHERE id=?",f.grant.delegationId);const requests=f.native.requests.length,runs=f.c.store.one('SELECT COUNT(*) AS n FROM runs').n;
 const sequence=picks('send');if(fault==='grant')sequence.splice(3,1);const h=readCommand(f,sequence);if(fault==='evidence')await assert.rejects(h.run(),/current evidence/);else await h.run();await h.ui.close();assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM runs').n,runs+(fault==='evidence'?1:0));f.native.pass();
});
for(const kind of ['lost','rejected'])test('owner Send '+kind+' native outcome stays retained and repeat cannot replay',async t=>{
 const f=await world(t,kind==='lost'?{dropAcceptance:true}:{beforeAccept:async({options})=>{options.stack=['controlled-late-native-stack'];}}),h=readCommand(f,picks('send'));await h.run();await h.ui.close();const view=f.c.inspectMerge(f.original.operationId);assert.equal(view.phase,kind==='lost'?'UNKNOWN':'REFUSED');assert.equal(view.transportOutcome,kind==='lost'?'uncertain':'native-rejection');assert.equal(f.native.puts(),1);
 const assertGuidance=text=>{
  if(kind==='rejected'){
   assert.match(text,/Receiver rejected the native send \(HTTP 405\)/);
   assert.match(text,/Open the original PR on GitHub/);
  }else{
   assert.doesNotMatch(text,/\(HTTP \d+\)|Open the original PR on GitHub/);
  }
 };
 const outcome=h.shown.find(row=>row.title.startsWith('Original PR merge send retained'));
 assertGuidance(outcome.text);
 const before=snapshot(f.c),repeat=readCommand(f,['Retained PR merges','owner/repo',(title,rows)=>{assertGuidance(title);return noReplay(title,rows);},'Back','Close']);await repeat.run();await repeat.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.puts(),1);f.native.pass();
});

test('a rejection status requires a single attributed native PUT on the original PR',async t=>{
 const f=await world(t,{beforeAccept({options}){options.stack=['controlled-late-native-stack'];}});
 const id=f.original.operationId;
 assert.equal((await f.c.dispatchMerge(id)).rejectionStatus,405);
 const requestCount=f.native.requests.length;
 const row=f.c.store.one("SELECT * FROM effect_receipts WHERE operation=? AND kind='merge-send'",id);
 const update=data=>f.c.store.run('UPDATE effect_receipts SET data=? WHERE id=?',data,row.id);
 const expectNoStatus=()=>{
  const retained=f.c.inspectRetainedMerge(id);
  assert.equal(retained.state,'RETAINED');
  assert.equal(retained.view.rejectionStatus,undefined);
  assert.equal(f.c.inspectMergeDispatch(id).eligible,false);
 };
 for(const mutate of [
  attempt=>{attempt.handoff='not-started';},
  attempt=>{attempt.result=null;},
  (attempt,put)=>{put.route=put.route.replace('/12/','/13/');},
  (attempt,put)=>{put.status=409;},
  (attempt,put)=>{attempt.responseStatus=put.status=504;},
  (attempt,put)=>{attempt.receipts.push(put);},
 ]){
  const attempt=JSON.parse(row.data);
  mutate(attempt,attempt.receipts.find(receipt=>receipt.method==='PUT'));
  update(JSON.stringify(attempt));
  expectNoStatus();
 }
 update('malformed');expectNoStatus();
 update(row.data);
 f.c.store.run("UPDATE effect_receipts SET kind='other' WHERE id=?",row.id);expectNoStatus();
 f.c.store.run("UPDATE effect_receipts SET kind='merge-send' WHERE id=?",row.id);
 const op=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',id);
 f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.mergedCommit',?) WHERE id=?",'f'.repeat(40),id);expectNoStatus();
 f.c.store.run("UPDATE effect_operations SET phase='RESERVED',data=json_remove(?,'$.transportOutcome','$.dispatchRun') WHERE id=?",op.data,id);
 assert.equal(f.c.inspectRetainedMerge(id).state,'UNAVAILABLE');
 assert.equal(f.c.inspectMergeDispatch(id).eligible,false);
 assert.equal(f.native.requests.length,requestCount);
 assert.equal(f.native.puts(),1);
 f.native.pass();
});
test('restart holds old session then explicit reprepare and separate Send preserve the same original and usage',async t=>{
 const f=await world(t),{openController}=await import('../../dist/controller/index.js'),old=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId),grant=f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',f.grant.delegationId),evidence=JSON.parse(old.data).evidence;await f.c.close();f.c=await openController({installationHome:f.home});t.after(()=>f.c.close());
 // Controlled standing restored solely for restart/session mechanics, not actual procedure production.
 f.c.changes.currentEvidence=async id=>{assert.equal(id,f.workId);return structuredClone(evidence);};f.c.changes.assertCurrentEvidence=value=>assert.deepEqual(value,evidence);f.c.configureMergeCredential=options=>configureOwnedMergeFixture(f.c,{...options,origin:f.native.origin});assert.equal(f.c.inspectMergeDispatch(f.original.operationId).eligible,false);const sequence=picks('prepare');sequence.splice(4,0,'Review original merge send','Send this prepared original PR merge');const h=readCommand(f,sequence,[f.credential]);await h.run();await h.ui.close();assert.equal(f.c.inspectMerge(f.original.operationId).phase,'CONFIRMED');assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,1);assert.deepEqual(f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',grant.id),grant);assert.equal(f.native.puts(),1);f.native.pass();
});

for(const drift of ['head','receipt','handoff rollback'])test('an accepted send refuses reentry after retained '+drift+' drift',async t=>{
 const f=await world(t),id=f.original.operationId;
 const h=readCommand(f,picks('send'),[],{show:async(title,_text,page)=>{
  await page?.run();
  if(title.startsWith('Original PR merge send retained')){
   const sent=f.c.inspectMerge(id);
   assert.equal(sent.phase,'CONFIRMED');
   if(drift==='head')
    f.c.store.run("UPDATE effect_operations SET data=json_set(data,'$.headCommit',?) WHERE id=?",'f'.repeat(40),id);
   else if(drift==='receipt'){
    assert.ok(sent.receiptIds.length);
    f.c.store.run('DELETE FROM effect_receipts WHERE id=? AND operation=?',sent.receiptIds.at(-1),id);
   }
   else{
    f.c.store.run("UPDATE effect_operations SET phase='RESERVED',data=json_remove(data,'$.transportOutcome','$.dispatchRun','$.mergedCommit','$.correspondence') WHERE id=?",id);
    assert.deepEqual(f.c.inspectMerge(id).receiptIds,sent.receiptIds);
   }
  }
 }});
 await assert.rejects(h.run(),error=>error.message.includes(id)&&/current record is unavailable or has changed/.test(error.message));
 assert.equal(f.native.puts(),1);
 await h.ui.close();
 f.native.pass();
});

for(const contained of [true,false])test('fresh original base '+(contained?'contained in unchanged reviewed head can prepare':'outside unchanged reviewed head refuses')+' without replacement',async t=>{
 const {mergeFixture}=await import('../platform/merge-fixture.mjs'),native=await mergeFixture(t),oldBase=native.subject.expectedBase,futureBase=native.subject.expectedHead,head=await native.native('--git-dir='+native.bare,'commit-tree',native.subject.expectedTree,'-p',futureBase,'-m','Controlled same-tree reviewed descendant');await native.native('--git-dir='+native.bare,'update-ref','refs/heads/feature/path',head,futureBase);
 const f=await world(t,{nativeRepository:{bare:native.bare}}),before=f.c.inspectMerge(f.original.operationId),prior=f.c.store.all('SELECT * FROM effect_receipts WHERE operation=?',f.original.operationId);const newBase=contained?futureBase:await native.native('--git-dir='+native.bare,'commit-tree',native.subject.expectedTree,'-p',oldBase,'-m','Controlled unrelated base candidate');await native.native('--git-dir='+native.bare,'update-ref','refs/heads/main',newBase,oldBase);
 const h=readCommand(f,picks('prepare'),[f.credential]);if(contained)await h.run();else await assert.rejects(h.run());await h.ui.close();const op=f.c.store.one('SELECT * FROM effect_operations WHERE id=?',f.original.operationId),data=JSON.parse(op.data);assert.equal(op.phase,contained?'RESERVED':'REFUSED');assert.equal(data.headCommit,before.headCommit);assert.equal(data.subject.expectedHead,head);assert.equal(data.subject.expectedTree,native.subject.expectedTree);assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',f.targetId).n,1);for(const row of prior)assert.deepEqual(f.c.store.one('SELECT * FROM effect_receipts WHERE id=?',row.id),row);assert.equal(f.native.puts(),0);if(contained){assert.deepEqual(data.baseChange,{previous:oldBase,current:newBase});const send=readCommand(f,picks('send'));await send.run();await send.ui.close();assert.equal(f.c.inspectMerge(f.original.operationId).phase,'CONFIRMED');assert.equal(f.native.puts(),1);}f.native.pass();native.pass();
});

test('held owner Send keeps the shared credential lease against a separate repository registration attempt',{timeout:10000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false;const f=await world(t,{intercept:async({req})=>{if(hold&&req.url==='/repos/owner/repo/pulls/12'){hold=false;entered.resolve();await release.promise;}return false;}}),first=readCommand(f,picks('send'));hold=true;const pending=first.run();void pending.catch(()=>{});await entered.promise;
 try{const before=snapshot(f.c),requests=f.native.requests.length,second=readCommand(f,['PR merge targets','Register existing PR merge target','Source branch target ·','P · owner/repo','Tracked pull request ·','owner/repo #12','Review registration','Register this existing PR identity'],[path.join(f.native.root,'MUST_NOT_READ_SECOND_CREDENTIAL.json')]);await assert.rejects(second.run(),/owns the credential session/);await second.ui.close();assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);}finally{release.resolve();}await pending;await first.ui.close();assert.equal(f.c.inspectMerge(f.original.operationId).phase,'CONFIRMED');assert.equal(f.native.puts(),1);f.native.pass();
});
for(const action of ['prepare','send'])for(const drift of ['abort','source'])test('final '+action+' TX owner callback '+drift+' rolls back without run, spend or native request',async t=>{
 const f=await world(t),context=action==='prepare'?f.c.inspectRetainedMergePreparation(f.original.operationId):f.c.inspectMergeDispatch(f.original.operationId),before=snapshot(f.c),requests=f.native.requests.length,abort=new AbortController();let inside=false;
 const validate=()=>{if(f.c.store.db.isTransaction){inside=true;if(drift==='abort')abort.abort();else f.c.store.run("UPDATE sources SET raw=raw||' changed inside TX' WHERE id=(SELECT source FROM works WHERE id=?)",f.workId);}};
 await assert.rejects(action==='prepare'?f.c.prepareRetainedOwnerMerge({operationId:f.original.operationId,expectedContext:context.fingerprint,signal:abort.signal},validate):f.c.dispatchOwnerMerge({operationId:f.original.operationId,expectedContext:context.fingerprint,signal:abort.signal},validate));assert.equal(inside,true);assert.equal(snapshot(f.c),before);assert.equal(f.native.requests.length,requests);assert.equal(f.native.puts(),0);f.native.pass();
});
