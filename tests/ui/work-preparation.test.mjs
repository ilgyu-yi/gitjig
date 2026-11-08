import test from 'node:test';import assert from 'node:assert/strict';
import {managedWorld} from './managed-change-fixture.mjs';import {workLedger} from '../controller/change-registry-fixture.mjs';
test('same-lineage extension refuses immediately while managed preparation has no allocated work ID',async t=>{
 const f=await managedWorld(t),work=await f.c.beginChange({projectId:'P',request:'Retained source work'}),id=work.workId;
 // Controlled source pointer exercises the leased pre-admission boundary without granting a fresh task.
 f.c.store.run('DELETE FROM change_state WHERE work=?',id);f.c.store.run('UPDATE works SET data=? WHERE id=?',JSON.stringify({kind:'ordinary-conversation',conversation:f.cid,fixture:'controlled settled ordinary predecessor; no execution claim'}),id);
 f.c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',id,f.cid);const view=f.c.inspectConversation(f.cid),choice=f.c.getConversationModelChoice(f.cid),baseline={...await f.models.baseline('P',choice),source:{kind:'conversation',conversationId:f.cid,choiceRevision:choice.revision}},snapshot=f.c.inspectWorkAllowance(id),before=workLedger(f.c),abort=new AbortController();
 const operation=f.c.startConversationChange({conversationId:f.cid,expectedGeneration:view.generation,expectedModelRevision:choice.revision,projectId:'P',request:'No fresh allowance while preparing',applicationModelBaseline:baseline,signal:abort.signal});void operation.catch(()=>{});
 assert.equal(f.c.managedOperations.size,1);assert.equal(f.c.managedOperations.get(f.cid).workId,null);
 assert.throws(()=>f.c.extendWorkAllowance({expected:snapshot,kind:'execution',additional:1,reason:'Cannot slip into preparation gap'}),/active/);assert.deepEqual(workLedger(f.c),before);abort.abort();await assert.rejects(operation);f.pass();
});
