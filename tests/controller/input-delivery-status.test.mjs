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
 const detailed=c.inspectConversationInputs(cid);
 assert.equal(status.preview,'Healthy first');assert.equal(detailed[0].queuedDeliveryIssue,undefined);
 assert.equal(detailed[1].failure.length,4096);assert.match(detailed[1].failure,/^SECOND_CAUSE/);
 assert.equal(detailed[1].queuedDeliveryIssue,detailed[1].failure);assert.equal(detailed[2].queuedDeliveryIssue,'THIRD_CAUSE');
 assert.equal(snapshot(),before);
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','NATIVE_PENDING',receipts[1].inputId);assert.deepEqual(c.inspectConversationInputStatus(cid).deliveryIssue,{count:1,reason:'THIRD_CAUSE'});
 assert.equal(c.inspectConversationInputs(cid)[1].queuedDeliveryIssue,undefined);assert.equal(c.inspectConversationInputs(cid)[1].failure,detailed[1].failure);
 for(const value of [null,{},7,'']){put(2,value);assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue,undefined);assert.equal(c.inspectConversationInputs(cid)[2].queuedDeliveryIssue,undefined);}
 c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?','not-json',receipts[2].inputId);assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue,undefined);
 put(2,'\u0000');assert.equal(c.inspectConversationInputStatus(cid).deliveryIssue.count,1);
 put(2,'UNCERTAIN_DELIVERY');
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','RECONCILIATION_REQUIRED',receipts[2].inputId);
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','QUEUED',receipts[1].inputId);
 c.store.run('UPDATE conversation_inputs SET state=? WHERE id=?','RECONCILIATION_REQUIRED',receipts[0].inputId);
 const mixed=c.inspectConversationInputStatus(cid);
 assert.deepEqual(mixed.deliveryIssue,{count:1,reason:detailed[1].failure.slice(0,160)});
 assert.equal(mixed.reconciliationCount,2);
 assert.equal(c.inspectConversationInputs(cid)[2].queuedDeliveryIssue,undefined);
 put(2,undefined);
 assert.equal(c.inspectConversationInputStatus(cid).reconciliationCount,2);
 passed=true;
});

test('a held original identifies the recorded protection update independently of epoch and model markers',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-protection-input-')));
 const source=path.join(root,'project'),home=path.join(root,'app');
 await fs.mkdir(source);
 await fs.writeFile(path.join(source,'protected.txt'),'original');
 const c=await openController({installationHome:home});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
 await c.registerProject({id:'P',sourceRoot:source});
 const {conversationId:cid}=c.createConversation({projectId:'P'});
 const {inputId}=await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Original request',mode:'idle'});
 const input=c.store.one('SELECT * FROM conversation_inputs WHERE id=?',inputId);
 const protection=c.inspectProjectProtection('P');
 const {version,configured,revision,hash,protectedPaths,sourceEventId}=protection;
 const original={kind:'ordinary-conversation',conversation:cid,initialInputId:inputId,attainedCapture:true,
  cleanup:'removed',nativePromptAttempted:true,nativeInputObserved:true,allocatedNative:true,
  projectProtection:{version,configured,revision,hash,protectedPaths,sourceEventId}};
 c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W','P',input.source,null,'W','INTERRUPTED',1,1,null,
  JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
 c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','R','W',1,1,'INTERRUPTED',path.join(home,'inputs/R'),'consumed',JSON.stringify(original));
 c.store.run("UPDATE conversation_inputs SET work='W',state='RECONCILIATION_REQUIRED' WHERE id=?",inputId);
 c.store.run("UPDATE conversation_state SET work='W',resource='UNKNOWN',data=json_set(data,'$.runId','R') WHERE conversation=?",cid);
 const inspect=()=>c.inspectConversationInputs(cid)[0];
 assert.equal(inspect().interruptedBoundary,'sessionInput');
 c.store.run("UPDATE works SET epoch=2 WHERE id='W'");
 assert.equal(inspect().interruptedBoundary,'sessionInput');
 c.store.run("UPDATE works SET epoch=1 WHERE id='W'");
 const changed=await c.setProjectProtection({projectId:'P',expectedRevision:0,protectedPaths:['protected.txt']});
 assert.equal(changed.revision,1);
 const held=inspect();
 assert.deepEqual([held.inputId,held.runId,held.interruptedBoundary,held.retryEligible,held.withdrawEligible],
  [inputId,'R','protectionChanged',false,false]);
 c.store.run("UPDATE runs SET data=? WHERE id='R'",JSON.stringify({...original,modelDispatchAttempted:true}));
 assert.equal(inspect().interruptedBoundary,'modelAttempt');
 c.store.run("UPDATE runs SET data=? WHERE id='R'",JSON.stringify(original));
 c.store.run("UPDATE sources SET origin=json_set(origin,'$.projectId','other') WHERE id=?",changed.sourceEventId);
 assert.equal(inspect().interruptedBoundary,'sessionInput');
 assert.notEqual(inspect().fingerprint,held.fingerprint);
});
