/** Controlled retained input faults; no model, runtime, dispatch or recovery action. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
test('pending delivery issues stay bounded, attributed and distinct from healthy/native-pending input',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-input-status-'))),c=await openController({installationHome:root});let passed=false;
 t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained input status '+root);});
 const cid=c.createConversation().conversationId;
 const receipts=[];for(const text of ['Healthy first','Failed second','Failed third'])receipts.push(await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text,mode:'idle'}));
 const put=(index,value)=>c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify({routeError:value}),receipts[index].inputId);
 put(1,'SECOND_CAUSE '+ 'x'.repeat(5000));put(2,'THIRD_CAUSE');
 const snapshot=()=>JSON.stringify(['conversation_inputs','sources','works','runs','budgets','conversation_views'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
 const before=snapshot(),status=c.inspectConversationInputStatus(cid);
 assert.deepEqual(status.deliveryIssue,{count:2,reason:('SECOND_CAUSE '+'x'.repeat(5000)).slice(0,160)});
 assert.equal(status.preview,'Healthy first');assert.equal(c.inspectConversationInputs(cid)[1].failure.length,4096);assert.match(c.inspectConversationInputs(cid)[1].failure,/^SECOND_CAUSE/);assert.equal(snapshot(),before);
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','NATIVE_PENDING',receipts[1].inputId);assert.deepEqual(c.inspectConversationInputStatus(cid).deliveryIssue,{count:1,reason:'THIRD_CAUSE'});
 for(const value of [null,{},7,'']){put(2,value);assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue,undefined);}
 c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?','not-json',receipts[2].inputId);assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue,undefined);
 put(2,'\u0000');assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue.count,1);
 put(2,'\u001b[31m\u0000');c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','RECONCILIATION_REQUIRED',receipts[2].inputId);assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue.count,1);assert.equal(c.inspectConversationInputStatus(cid).reconciliation,true);
 passed=true;
});
