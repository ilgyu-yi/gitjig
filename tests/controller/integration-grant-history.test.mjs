import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {integrationWorld,snapshot} from './integration-registry-fixture.mjs';
import {integrationGrantHistory} from '../../dist/controller/integration-grant-history.js';

const row=f=>f.c.store.one('SELECT * FROM effect_delegations WHERE id=?',f.grantId);
async function world(t){const f=await integrationWorld(t),op=await f.prepare();return {...f,op,grantId:f.c.store.one('SELECT grant_id FROM effect_operations WHERE id=?',op.operationId).grant_id};}
// Deliberately authored ledger fixture: admission proof only, not owner recovery.
function renewal(f,{used=1,padding=''}={}){
 const previous=row(f),data=JSON.parse(previous.data),sourceId=randomUUID(),nextRootEpoch=data.rootEpoch+2;
 const origin={kind:'owner-effect-grant-renewal',uid:process.getuid?.(),root:previous.root,grantId:previous.id,targetId:previous.target};
 const event={version:1,grantId:previous.id,workId:previous.root,targetId:previous.target,reason:'Explicit owner decision; fixture admission proof',used,fromRootEpoch:data.rootEpoch,toRootEpoch:nextRootEpoch,previous};
 // Whitespace exercises total byte bounds without adding unknown event fields.
 f.c.store.run('INSERT INTO sources VALUES(?,?,?,?)',sourceId,null,JSON.stringify(origin),JSON.stringify(event)+padding);
 f.c.store.run('UPDATE effect_delegations SET epoch=epoch+1,data=? WHERE id=?',JSON.stringify({...data,rootEpoch:nextRootEpoch,renewal:{version:1,sourceId}}),previous.id);
 f.c.store.run('UPDATE works SET epoch=? WHERE id=?',nextRootEpoch,previous.root);
 return sourceId;
}
function proof(f){return integrationGrantHistory(f.c.store,row(f));}

test('legacy integration admission retains omitted local kind, lineage and hosted override semantics; foreign grant families have no integration proof',async t=>{
 const f=await world(t),original=row(f),data=JSON.parse(original.data);
 for(const overrides of [{kind:undefined},{scope:'delegation-lineage'},{kind:'github-existing-ref',mode:'owner-override'}]){
  const value={...data,...overrides},candidate={...original,data:JSON.stringify(value)},before=snapshot(f.c);assert.equal(integrationGrantHistory(f.c.store,candidate).events,0);assert.equal(snapshot(f.c),before);
 }
 for(const kind of ['configuration','publication'])assert.throws(()=>integrationGrantHistory(f.c.store,{...original,epoch:4,data:JSON.stringify({...data,kind})}),/family/);
 f.pass();
});

test('multi-event renewal proof admits only its exact original; later consumption and reordered JSON preserve history',async t=>{
 const f=await world(t);renewal(f);renewal(f);const before=snapshot(f.c),context=f.c.inspectIntegrationDelegation(f.op.workId,f.target),proofBefore=proof(f);assert.equal(proofBefore.events,2);assert.equal(context.eligible,true);assert.equal(context.existing.used,1);assert.equal(f.c.effects.grant(f.op.workId,f.target,f.grantId).id,f.grantId);assert.equal(snapshot(f.c),before);
 f.c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','later-original-use',f.op.workId,f.target,f.grantId,'REFUSED','{}');assert.equal(proof(f).events,2);assert.equal(f.c.inspectIntegrationDelegation(f.op.workId,f.target).existing.used,2);
 const current=row(f),data=JSON.parse(current.data);f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify(Object.fromEntries(Object.entries(data).reverse())),f.grantId);assert.equal(proof(f).events,2);
 const pointer=data.renewal.sourceId,source=f.c.store.one('SELECT * FROM sources WHERE id=?',pointer),origin=JSON.parse(source.origin);f.c.store.run('UPDATE sources SET origin=? WHERE id=?',JSON.stringify(Object.fromEntries(Object.entries(origin).reverse())),pointer);assert.equal(proof(f).events,2);assert.notEqual(proof(f).fingerprint,proofBefore.fingerprint);
 f.pass();
});

test('malformed renewal history refuses owner preview and shared execution admission without changing history',async t=>{
 const f=await world(t);renewal(f);const sid=renewal(f),original=row(f),source=f.c.store.one('SELECT * FROM sources WHERE id=?',sid),event=JSON.parse(source.raw),data=JSON.parse(original.data);
 const cases={
  'missing pointer':()=>{const {renewal,...rest}=data;f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify(rest),f.grantId);},
  'null pointer':()=>f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify({...data,renewal:null}),f.grantId),
  'missing source':()=>f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify({...data,renewal:{version:1,sourceId:'missing'}}),f.grantId),
  'foreign owner':()=>f.c.store.run("UPDATE sources SET origin=json_set(origin,'$.uid',-1) WHERE id=?",sid),
  'conversation provenance':()=>f.c.store.run('UPDATE sources SET conversation=? WHERE id=?',f.c.createConversation().conversationId,sid),
  'skipped epoch':()=>f.c.store.run('UPDATE effect_delegations SET epoch=epoch+1 WHERE id=?',f.grantId),
  'widened scope':()=>f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify({...data,scope:'delegation-lineage'}),f.grantId),
  'changed limit':()=>f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify({...data,operationLimit:9}),f.grantId),
  'changed original source':()=>f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',JSON.stringify({...data,source:'other'}),f.grantId),
  'wrong previous grant':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,previous:{...event.previous,id:'foreign'}}),sid),
  'root epoch regression':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,toRootEpoch:event.fromRootEpoch}),sid),
  'usage regression':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,used:0}),sid),
  'future use count':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,used:2}),sid),
  'blank reason':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,reason:' '}),sid),
  'cycle':()=>{const previous={...event.previous,data:JSON.stringify({...JSON.parse(event.previous.data),renewal:{version:1,sourceId:sid}})};f.c.store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify({...event,previous}),sid);},
  'oversized event':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?',source.raw+' '.repeat(131072),sid),
  'oversized origin':()=>f.c.store.run('UPDATE sources SET origin=? WHERE id=?',source.origin+' '.repeat(65536),sid),
  'invalid JSON':()=>f.c.store.run('UPDATE sources SET raw=? WHERE id=?','{',sid),
 };
 for(const [name,corrupt]of Object.entries(cases)){
  corrupt();const before=snapshot(f.c);assert.throws(()=>proof(f),undefined,name);assert.equal(f.c.inspectIntegrationDelegation(f.op.workId,f.target).eligible,false,name);assert.throws(()=>f.c.effects.grant(f.op.workId,f.target,f.grantId),undefined,name);assert.equal(snapshot(f.c),before,name);
  f.c.store.run('UPDATE effect_delegations SET epoch=?,data=? WHERE id=?',original.epoch,original.data,original.id);f.c.store.run('UPDATE sources SET conversation=?,origin=?,raw=? WHERE id=?',source.conversation,source.origin,source.raw,sid);
 }
 f.pass();
});

test('renewal admission bounds full history by event count and total source bytes',async t=>{
 for(const [count,padding]of [[65,''],[9,' '.repeat(120000)]]){
  const f=await world(t);for(let i=0;i<count;i++)renewal(f,{padding});const before=snapshot(f.c);assert.throws(()=>proof(f),/history/);assert.equal(f.c.inspectIntegrationDelegation(f.op.workId,f.target).eligible,false);assert.equal(snapshot(f.c),before);f.pass();
 }
});

test('renewed grant never silently reauthorizes an existing operation or replaces its evidence during preparation',async t=>{
 const f=await world(t),{scripted}=await import('./effect-fixture.mjs');renewal(f);let evidenceReads=0;f.c.changeCore.currentEvidence=async()=>{evidenceReads++;throw Error('Stale original must refuse before current evidence');};f.c.effects.trustedProfile=async()=>{throw Error('Stale original must refuse before native trust');};f.c.effects.client=()=>{throw Error('Stale original must not launch Git');};
 const request={workId:f.op.workId,targetId:f.target,operationId:f.op.operationId,model:scripted()},before=snapshot(f.c);
 await assert.rejects(f.c.prepareIntegration(request),/Delegation epoch changed/);assert.equal(snapshot(f.c),before);
 const context=f.c.inspectIntegrationPreparation(f.op.operationId);await assert.rejects(f.c.prepareRetainedIntegration({...request,expectedContext:context.contextFingerprint}),/Delegation epoch changed/);assert.equal(evidenceReads,0);assert.equal(snapshot(f.c),before);f.pass();
});

test('legacy original preparation rechecks authority after awaiting evidence and retains prior original on drift',async t=>{
 const f=await world(t),{scripted}=await import('./effect-fixture.mjs');let entered,release;const entry=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);f.c.changeCore.currentEvidence=async()=>{entered();await held;return {changed:'Must never replace original evidence'};};
 const pending=f.c.prepareIntegration({workId:f.op.workId,targetId:f.target,operationId:f.op.operationId,model:scripted()});void pending.catch(()=>{});await entry;renewal(f);const before=snapshot(f.c);release();await assert.rejects(pending,/Delegation epoch changed/);assert.equal(snapshot(f.c),before);f.pass();
});

test('shared grant admission bounds applicable rows in SQL before oversized JSON crosses into JavaScript',async t=>{
 const f=await world(t),original=row(f),oversized=JSON.stringify({...JSON.parse(original.data),padding:'x'.repeat(65536)});f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',oversized,original.id);
 const all=f.c.store.all.bind(f.c.store);let observations=0;f.c.store.all=(sql,...args)=>{const rows=all(sql,...args);if(/FROM effect_delegations/u.test(sql)){observations++;assert.ok(rows.length<=129);assert.ok(rows.every(row=>row.data===null||Buffer.byteLength(row.data)<=65536),'oversized grant crossed the SQLite projection');}return rows;};
 const before=snapshot(f.c);for(const id of [undefined,original.id])assert.throws(()=>f.c.effects.grant(f.op.workId,f.target,id),/bounded admission/);assert.equal(observations,2);assert.equal(snapshot(f.c),before);f.c.store.all=all;f.pass();
});

test('exact grant admission excludes foreign roots; unqualified selection refuses excessive applicable records',async t=>{
 const f=await world(t),original=row(f),other=await f.c.beginChange({projectId:'P',request:'Independent owner root; not subject ancestry'});
 for(let i=0;i<130;i++)f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','unrelated-grant-'+i,other.workId,f.target,1,'x'.repeat(65537));
 assert.equal(f.c.effects.grant(f.op.workId,f.target).id,f.grantId);
 for(let i=0;i<129;i++)f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','applicable-grant-'+i,original.root,f.target,1,original.data);
 const before=snapshot(f.c);assert.throws(()=>f.c.effects.grant(f.op.workId,f.target),/bounded admission/);assert.equal(f.c.effects.grant(f.op.workId,f.target,f.grantId).id,f.grantId);assert.equal(snapshot(f.c),before);f.pass();
});
