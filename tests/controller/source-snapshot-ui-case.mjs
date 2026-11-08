import {uiText} from '../../dist/ui/i18n.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareSourceSave,inspectSourceSave} from '../../dist/ui/source-save.js';

// Actual owner UI consumer and Controller/Native; scripted choices, not a PTY.
export async function qualifySourceSaveUi({c,root,workId,git,setup,source,head,index,sourceBytes,status,locale,lost}) {
 const before=c.store.one('SELECT * FROM works WHERE id=?',workId),evidence=await c.changeCore.currentEvidence(workId),shown=[],notices=[],choices=[];
 let sends=0,checked=false;
 const execute=c.sourceActions.executeDispatch.bind(c.sourceActions);
 c.sourceActions.executeDispatch=(dispatch,client,signal)=>execute(dispatch,{
  prepareSourceBranchCreate:client.prepareSourceBranchCreate.bind(client),preparedSourceReference:client.preparedSourceReference.bind(client),
  async spawnPreparedSourceBranchCreate(handle){sends++;const result=await client.spawnPreparedSourceBranchCreate(handle);if(lost&&result.handoff==='started')throw Error('CONTROLLED_OWNER_UI_LOST_REPLY');return result;},
  reconcileSourceBranchCreate:client.reconcileSourceBranchCreate.bind(client),
 },signal);
 const host={locale,signal:new AbortController().signal,guard(){},notice(message){notices.push(message);},
  input:async(_title,value)=>value||'owner-ui-'+locale,
  show:async(title,text)=>{assert.ok(text.length<65536);shown.push({title,text});},choose:async()=>assert.fail('Stable action values required'),
  async chooseItems(title,items){choices.push({title,items});assert.equal(items[0].value,'back');
   if(items.some(i=>i.value==='prepare'))return'prepare';
   if(items.some(i=>i.value==='whole')){assert.ok(!items.some(i=>i.value==='save'));return'whole';}
   if(items.some(i=>i.value==='next'))return'next';
   if(items.some(i=>i.value==='save')){assert.ok(shown.some(s=>s.text.endsWith('\n\nmodule.exports=3;\n')));return'save';}
   if(title===uiText(locale,'save.checkScope')&&items.some(i=>i.value==='read')){checked=true;return'read';}
   if(items.some(i=>i.value==='details')){assert.ok(!items.some(i=>i.value==='send'));return checked?'back':'read';}
   if(items.some(i=>i.value==='read')){checked=true;return'read';}
   assert.fail('Unknown owner UI state '+title);
  }};
 // Explicit existing suggestion only; no PATH discovery or profile mutation.
 assert.equal(c.sourceSnapshotProfileSuggestion().gitBinary,git);
 let outcome;
 if(lost){const retained=await prepareSourceSave(host,c,workId);assert.equal(retained.recordedPhase,'UNKNOWN');assert.match(retained.nativeAttempt.settlement.reason,/CONTROLLED_OWNER_UI_LOST_REPLY/);const page=c.listSourceSnapshotOperations({limit:25});assert.equal(page.operations.length,1);const original=page.operations[0];assert.equal(original.recordedPhase,'UNKNOWN');assert.equal(sends,1);outcome=await inspectSourceSave(host,c,original.operationId);assert.equal(checked,true);}
 else outcome=await prepareSourceSave(host,c,workId);
 assert.equal(outcome.state,'RETAINED');assert.equal(outcome.recordedPhase,'CONFIRMED');assert.equal(sends,1);
 assert.equal((await setup(['rev-parse','refs/heads/owner-ui-'+locale])).stdout.trim(),outcome.binding.projectedCommit);
 assert.deepEqual(c.store.one('SELECT * FROM works WHERE id=?',workId),before);assert.deepEqual(await c.changeCore.currentEvidence(workId),evidence);
 const spend=c.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId);assert.deepEqual({...spend},{lim:lost?10:9,consumed:lost?10:9,reserved:0});
 assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
 assert.ok(notices.some(n=>n.includes(locale==='ko'?'미리보기 준비 중':'Preparing the save preview')));assert.ok(notices.some(n=>n.includes(locale==='ko'?'스냅샷 저장 중':'Saving the reviewed snapshot')));
 if(lost)assert.ok(notices.some(n=>n.includes(locale==='ko'?'저장 결과 확인 중':'Checking the original save result')));
 await fs.writeFile(path.join(root,'source-owner-ui-result.json'),JSON.stringify({scope:'Actual owner UI module with scripted choices, normal procedure and Native; no terminal/installed claim',locale,lost,workId,before,spend,outcome,sends,shown,notices,choices},null,2));
}
