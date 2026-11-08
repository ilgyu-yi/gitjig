import test from 'node:test';
import assert from 'node:assert/strict';
import {shared,target} from '../contributions/publication-fixture.mjs';
const snapshot=c=>JSON.stringify(c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,c.store.all('SELECT * FROM "'+name+'" ORDER BY rowid')]));
export async function publicationWorld(t){const f=await shared();t.after(()=>f.close());f.target=f.c.registerPublicationTarget({target,visibility:'public'}).targetId;
    f.prepare=body=>f.c.prepareOwnerPublication({targetId:f.target,action:{kind:'create-comment',purpose:'bootstrap',parent:{kind:'issue',number:8,nodeId:'I8'},body}});return f;}
test('publication registry pages original prepared/confirmed/unknown facts without spending, recovering or reading native state',async t=>{
    const f=await publicationWorld(t),a=await f.prepare('First retained original'),b=await f.prepare('Confirmed original');await f.c.dispatchPublication({operationId:b.operationId});const c=await f.prepare('Uncertain original'),held=f.holdDrop(),send=f.c.dispatchPublication({operationId:c.operationId});await held.entered;held.release();assert.equal((await send).phase,'UNKNOWN');
    const before=snapshot(f.c),calls=f.requests.length,page=f.c.listPublications({limit:2});assert.deepEqual(page.operations.map(row=>row.operationId),[c.operationId,b.operationId]);assert.equal(page.operations[0].recordedPhase,'UNKNOWN');assert.equal(page.operations[0].transportOutcome,'uncertain');assert.equal(page.operations[1].recordedPhase,'CONFIRMED');assert.equal(page.operations[1].observedOutcome,'resource-matches');
    const older=f.c.listPublications({limit:2,before:page.nextCursor});assert.deepEqual(older.operations.map(row=>row.operationId),[a.operationId]);assert.equal(older.nextCursor,null);assert.equal(f.c.inspectRetainedPublication(a.operationId).view.phase,'RESERVED');assert.equal(snapshot(f.c),before);assert.equal(f.requests.length,calls);
    for(const options of [{limit:0},{limit:101},{before:'missing'},{other:true}])assert.throws(()=>f.c.listPublications(options));assert.equal(snapshot(f.c),before);
});
test('malformed, oversized and contradictory operation or related evidence is unavailable without hiding other originals',async t=>{
    const f=await publicationWorld(t),a=await f.prepare('Older healthy original'),b=await f.prepare('Selected original');
    const data=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',b.operationId).data,targetData=f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.target).data;
    for(const raw of ['{',JSON.stringify({...JSON.parse(data),kind:'unsupported-family'}),JSON.stringify({...JSON.parse(data),payloadHash:'0'.repeat(64)}),' '.repeat(1048577)]){
        f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?',raw,b.operationId);const before=snapshot(f.c),page=f.c.listPublications();assert.equal(page.operations.find(row=>row.operationId===b.operationId).state,'UNAVAILABLE');assert.equal(page.operations.find(row=>row.operationId===a.operationId).state,'RETAINED');assert.equal(snapshot(f.c),before);
    }
    f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?',data,b.operationId);
    f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?','{',f.target);assert.equal(f.c.inspectRetainedPublication(b.operationId).entry.state,'UNAVAILABLE');f.c.store.run('UPDATE effect_targets SET data=? WHERE id=?',targetData,f.target);
    const grant=f.c.store.one('SELECT grant_id FROM effect_operations WHERE id=?',b.operationId).grant_id,grantData=f.c.store.one('SELECT data FROM effect_delegations WHERE id=?',grant).data;f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?','x'.repeat(65537),grant);assert.equal(f.c.inspectRetainedPublication(b.operationId).entry.state,'UNAVAILABLE');f.c.store.run('UPDATE effect_delegations SET data=? WHERE id=?',grantData,grant);
    f.c.store.run('INSERT INTO effect_receipts VALUES(?,?,?,?)','oversized',b.operationId,'publication-send','x'.repeat(1048577));assert.equal(f.c.inspectRetainedPublication(b.operationId).entry.state,'UNAVAILABLE');f.c.store.run('DELETE FROM effect_receipts WHERE id=?','oversized');assert.equal(f.c.inspectRetainedPublication(b.operationId).entry.state,'RETAINED');
    f.c.store.run('UPDATE works SET state=? WHERE id=?','CANCELLED',b.workId);assert.equal(f.c.inspectRetainedPublication(b.operationId).entry.state,'RETAINED');
});
test('recognized other effect families remain outside publication cursor scope',async t=>{
    const f=await publicationWorld(t),a=await f.prepare('Publication'),b=await f.prepare('Controlled other family');f.c.store.run('UPDATE effect_operations SET data=? WHERE id=?','{"kind":"configuration"}',b.operationId);assert.equal(f.c.listPublications().operations.find(row=>row.operationId===b.operationId).state,'UNAVAILABLE');
    const other=f.c.registerRepositoryConfigurationTarget({target:{...target,visibility:'public'}}).targetId;f.c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','other-grant',b.workId,other,1,'{"kind":"configuration"}');f.c.store.run('UPDATE effect_operations SET target=?,grant_id=? WHERE id=?',other,'other-grant',b.operationId);
    const before=snapshot(f.c);assert.deepEqual(f.c.listPublications().operations.map(row=>row.operationId),[a.operationId]);assert.throws(()=>f.c.listPublications({before:b.operationId}),/cursor/);assert.equal(snapshot(f.c),before);
});

test('unrelated grant roots refuse; captured assignment lineage survives cancellation without granting current authority',async t=>{
    const f=await publicationWorld(t),a=await f.prepare('Child original'),b=await f.prepare('Grant root original'),grant=f.c.store.one('SELECT grant_id FROM effect_operations WHERE id=?',b.operationId).grant_id;
    f.c.store.run('UPDATE effect_operations SET grant_id=? WHERE id=?',grant,a.operationId);assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'UNAVAILABLE');
    f.c.store.run("UPDATE effect_delegations SET data=json_set(data,'$.scope','delegation-lineage') WHERE id=?",grant);assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'UNAVAILABLE');
    // Controlled retained assignment graph, not evidence of an actual delegated model judgment.
    const source=f.c.createConversation().conversationId,destination=f.c.createConversation().conversationId;
    f.c.store.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','historical-child',source,destination,a.workId,'CANCELLED',JSON.stringify({operation:'task',source:{workId:b.workId}}));
    f.c.store.run("UPDATE works SET data=json_set(data,'$.assignmentId','historical-child'),state='CANCELLED' WHERE id=?",a.workId);f.c.store.run("UPDATE works SET state='CANCELLED',epoch=epoch+1 WHERE id=?",b.workId);
    assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'RETAINED');f.c.store.run("UPDATE effect_delegations SET data=json_set(data,'$.scope','work') WHERE id=?",grant);assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'UNAVAILABLE');
});

test('foreign or oversized obligations followed by own finding IDs refuse before the original inspector reads them',async t=>{
    const f=await publicationWorld(t),a=await f.prepare('Own finding original'),b=await f.prepare('Foreign obligation original');
    const run=f.c.store.one('SELECT id FROM runs WHERE work=? LIMIT 1',a.workId).id;
    f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','own-launch',a.workId,run,'reviewer',1,'COMPLETE','settled',JSON.stringify({stage:'publication-payload-fit',operationId:a.operationId}));
    f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)','own-output','own-launch',null,'COMPLETE','{}');f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)','own-finding','own-output',0,a.workId,'{"launchId":"own-launch","finding":{"description":"Original observation"}}');
    const engine=f.c.publicationEngine,inspect=engine.inspectInternal.bind(engine);let calls=0;engine.inspectInternal=(...args)=>{calls++;return inspect(...args);};
    for(const bytes of [0,2097153]){
        f.c.store.run('INSERT OR REPLACE INTO obligations VALUES(?,?,?)','own-finding',b.workId,JSON.stringify({state:'pending',unused:'x'.repeat(bytes)}));calls=0;const before=snapshot(f.c);assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'UNAVAILABLE');assert.equal(calls,0);assert.equal(snapshot(f.c),before);
    }
    f.c.store.run('UPDATE obligations SET work=?,data=? WHERE id=?',a.workId,'{"state":"resolved"}','own-finding');assert.equal(f.c.inspectRetainedPublication(a.operationId).entry.state,'RETAINED');
});
