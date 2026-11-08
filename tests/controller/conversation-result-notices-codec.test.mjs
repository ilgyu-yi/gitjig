import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../../dist/controller/store.js';
import {Ordinary} from '../../dist/controller/ordinary.js';
import {publishConversationResult,inspectConversationResult} from '../../dist/controller/conversation-results.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Private owned ledger codec only. These seeded producer operands are NOT native execution evidence.
function fixture(text='answer'){
 const s=new Store(':memory:');s.run('INSERT INTO projects(id,root,profile) VALUES(?,?,?)','P','/unused','{}');const delegation={rootWorkId:'W1',projectIds:['P'],maxAssignments:4};
 for(const [cid,wid,project] of [['parent','W1',null],['child','W2','P']]){s.run('INSERT INTO sources VALUES(?,?,?,?)','S'+wid,cid,'{}','input');s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',wid,project,'S'+wid,null,wid,'ACTIVE',1,1,null,JSON.stringify({delegation}));s.run('INSERT INTO conversations VALUES(?,?,NULL,1,?)',cid,project,'IDLE');s.run('INSERT INTO conversation_state(conversation,work,data) VALUES(?,?,?)',cid,wid,'{}');s.run('INSERT INTO conversation_relations(child,parent) VALUES(?,?)',cid,cid==='child'?'parent':null);}
 const answer={kind:'ordinary-answer/v1',state:'delivered',producer:{runId:'R',generation:1,inputId:'I',sessionId:'N',nativeEntryId:'E',checkpoint:{sessionId:'N',leafId:'E',bytes:10,sha256:'private-codec-fixture'}},text:[{type:'text',text}],textSha256:hash([{type:'text',text}])};
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','R','W2',1,1,'SETTLED','/unused','consumed',JSON.stringify({cleanup:'removed',nativeSessionId:'N',ordinaryAnswerEntryId:'E',ordinaryAnswerHash:hash(answer)}));s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','A','parent','child','W2','RUNNING',JSON.stringify({delegation,delegationRoot:'W1'}));s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)','D','parent','child','A','PENDING','{}');
 return{s,result:{conversationId:'child',workId:'W2',runId:'R',status:'delivered',cleanup:'removed',answer},delegation};
}
test('new assigned publication exposes only separately attested coordinator report; missing/foreign/unknown producers cannot complete it',()=>{
 for(const mode of ['healthy','missing','foreign','unknown','late','oversize']){
  const f=fixture('사용자 전용 한국어 응답');try{
   f.s.run("UPDATE conversation_state SET direction=1 WHERE conversation='child'");
   const report={kind:'ordinary-coordinator-report/v1',state:'delivered',producer:{...f.result.answer.producer,nativeEntryId:'REPORT',toolCallId:'TC',toolResultEntryId:'TR',inputEntryId:'I',directionRevision:1},text:[{type:'text',text:mode==='oversize'?'x'.repeat(128*1024):'English coordinator report'}],textSha256:'hash'};
   const run=JSON.parse(f.s.one('SELECT data FROM runs WHERE id=?','R').data);Object.assign(run,{outcome:'delivered',ordinaryCoordinatorReportRequired:true,ordinaryReportEntryId:'REPORT',ordinaryReportToolResultEntryId:'TR',ordinaryReportHash:hash(report)});f.s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(run),'R');if(mode!=='missing')f.result.coordinatorReport=report;
   if(mode==='late')f.s.run("UPDATE conversation_state SET direction=2 WHERE conversation='child'");if(mode==='foreign')report.producer.runId='FOREIGN';if(mode==='unknown')f.s.run("UPDATE runs SET phase='UNKNOWN' WHERE id='R'");
   if(['foreign','unknown'].includes(mode)){assert.throws(()=>f.s.tx(()=>publishConversationResult(f.s,'child','A',f.result)),/exact settled producer/);assert.equal(f.s.all('SELECT * FROM conversation_results').length,0);continue;}
   const ordinary=new Ordinary({store:f.s});ordinary.settleAssignments('child',f.result,'A');const view=inspectConversationResult(f.s,f.s.one('SELECT id FROM conversation_results').id);assert.equal(view.version,2);assert.equal(view.result.answer,undefined);assert.ok(!JSON.stringify(view).includes('사용자 전용'));assert.equal(f.s.one('SELECT state FROM conversation_assignments').state,mode==='healthy'?'COMPLETE':'UNAVAILABLE');if(mode==='healthy')assert.equal(view.result.coordinatorReport.text[0].text,'English coordinator report');
  }finally{f.s.close();}
 }
});
test('codec publication is idempotent, conflicting repeat refuses and complete result envelope obeys128KiB',()=>{
 const f=fixture();try{const id=f.s.tx(()=>publishConversationResult(f.s,'child','A',f.result));const before=f.s.all('SELECT * FROM conversation_results');assert.equal(f.s.tx(()=>publishConversationResult(f.s,'child','A',f.result)),id);assert.deepEqual(f.s.all('SELECT * FROM conversation_results'),before);assert.equal(f.s.all('SELECT * FROM conversation_notifications').length,1);
 const changed=structuredClone(f.result);changed.answer.text[0].text='different';f.s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({cleanup:'removed',nativeSessionId:'N',ordinaryAnswerEntryId:'E',ordinaryAnswerHash:hash(changed.answer)}),'R');assert.throws(()=>f.s.tx(()=>publishConversationResult(f.s,'child','A',changed)),/Conflicting/);assert.deepEqual(f.s.all('SELECT * FROM conversation_results'),before);
 assert.ok(Buffer.byteLength(JSON.stringify(inspectConversationResult(f.s,id)))<=128*1024);assert.throws(()=>inspectConversationResult(f.s,id,{identity:{conversationId:'parent'},delegation:{...f.delegation,projectIds:[]}}),/scope/);
 }finally{f.s.close();}
});
test('codec unavailable/overflow result cannot resolve dependency; failed notice insert rolls back assignment/result/outbox',()=>{
 for(const text of ['x'.repeat(140000),'ordinary']){const f=fixture(text);try{const ordinary=new Ordinary({store:f.s});if(text==='ordinary')f.s.db.exec("CREATE TEMP TRIGGER reject_notice BEFORE INSERT ON conversation_notifications BEGIN SELECT RAISE(ABORT,'fixture-failure'); END;");
 if(text==='ordinary'){assert.throws(()=>ordinary.settleAssignments('child',f.result,'A'),/fixture-failure/);assert.equal(f.s.one('SELECT state FROM conversation_assignments').state,'RUNNING');assert.equal(f.s.all('SELECT * FROM conversation_results').length,0);assert.equal(f.s.all('SELECT * FROM conversation_notifications').length,0);}else{ordinary.settleAssignments('child',f.result,'A');assert.equal(f.s.one('SELECT state FROM conversation_assignments').state,'UNAVAILABLE');const row=f.s.one('SELECT id FROM conversation_results'),view=inspectConversationResult(f.s,row.id);assert.equal(view.result.answer.state,'unavailable');assert.ok(Buffer.byteLength(JSON.stringify(view))<=128*1024);}
 assert.equal(f.s.one('SELECT state FROM conversation_dependencies').state,'PENDING');
 }finally{f.s.close();}}
});

test('codec same-project idle parent receives result metadata without a graph-derived content audience',()=>{
 const f=fixture();try{f.s.run('INSERT INTO conversations VALUES(?,?,NULL,0,?)','idle','P','IDLE');f.s.run('INSERT INTO conversation_state(conversation,data) VALUES(?,?)','idle','{}');f.s.run('UPDATE conversation_relations SET parent=? WHERE child=?','idle','child');const id=f.s.tx(()=>publishConversationResult(f.s,'child','A',f.result));const notice=f.s.one('SELECT * FROM conversation_notifications WHERE target=?','idle');assert.equal(JSON.parse(notice.data).resultId,id);assert.equal(JSON.parse(notice.data).kind,'result-ready');assert.ok(!inspectConversationResult(f.s,id).audience.some(a=>a.conversationId==='idle'));
 assert.throws(()=>inspectConversationResult(f.s,id,{identity:{conversationId:'idle'},delegation:f.delegation}),/scope/);
 }finally{f.s.close();}
});

test('private fair cursor skips no receipt validation: next batch/re-entry holds on recorded-but-missing native entry',async()=>{
 const f=fixture();try{const {Interactions}=await import('../../dist/controller/interaction.js');const {writeNotice}=await import('../../dist/controller/conversation-results.js');const entries=[];
 for(let i=0;i<65;i++){const data={kind:'parent-changed',eventKey:'seeded.'+i,conversationId:'child'};const id=f.s.tx(()=>writeNotice(f.s,'parent',data));if(i<64)entries.push({type:'custom_message',id:'E'+i,customType:'gitjig.coordination-notice',content:JSON.stringify({noticeId:id,...data}),details:{noticeId:id,eventKey:data.eventKey}});f.s.run('UPDATE conversation_notifications SET data=? WHERE id=?',JSON.stringify({...data,delivery:{sessionId:'N',entryId:'E'+i,checkpoint:{private:'seeded codec receipt, not native proof'}}}),id);}
 const identity={conversationId:'parent',workId:'W1',runId:'R-codec',launchId:null,generation:1,directionRevision:0,initialInputId:'I-codec'};let sends=0;const registration={identity,session:{subscribe(){return()=>{};},async sendCustomMessage(){sends++;throw Error('Unexpected send');}},sessionManager:{getSessionId(){return'N';},getSessionFile(){return'/unused';},getEntries(){return entries;}},executeUserBash(){throw Error('Unused');}};
 let interactions=new Interactions(f.s,()=>{});interactions.lifecycle.ready(registration);await interactions.deliverNotices('parent');assert.equal(JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?','parent').data).noticeDeliveryCursor,64);
 // New Interactions instance reads its cursor from durable state; no ACK/private cursor reset.
 interactions=new Interactions(f.s,()=>{});interactions.lifecycle.ready(registration);await assert.rejects(interactions.deliverNotices('parent'),/Recorded native notice entry unavailable/);assert.equal(sends,0);assert.equal(JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?','parent').data).noticeDeliveryCursor,64);assert.equal(f.s.one("SELECT COUNT(*) AS n FROM conversation_notifications WHERE state='PENDING'").n,65);
 }finally{f.s.close();}
});

test('private recorded entry/session mismatch holds before checkpoint or update; only absent receipt may recover',async()=>{
 for(const delivery of [{entryId:'wrong-E',sessionId:'N'},{entryId:'actual-E',sessionId:'wrong-N'}]){
  const f=fixture();try{const {Interactions}=await import('../../dist/controller/interaction.js');const {writeNotice}=await import('../../dist/controller/conversation-results.js');const data={kind:'parent-changed',eventKey:'mismatch',conversationId:'child'},id=f.s.tx(()=>writeNotice(f.s,'parent',data));const stored={...data,delivery:{...delivery,checkpoint:{private:'codec fixture only'}}};f.s.run('UPDATE conversation_notifications SET data=? WHERE id=?',JSON.stringify(stored),id);const before=f.s.one('SELECT data FROM conversation_notifications WHERE id=?',id).data;let sends=0,checkpointPathReads=0;
  const i=new Interactions(f.s,()=>{});i.lifecycle.ready({identity:{conversationId:'parent',workId:'W1',runId:'R-codec',launchId:null,generation:1,directionRevision:0,initialInputId:'I-codec'},session:{subscribe(){return()=>{};},async sendCustomMessage(){sends++;}},sessionManager:{getSessionId(){return'N';},getSessionFile(){checkpointPathReads++;return'/unused';},getEntries(){return[{type:'custom_message',id:'actual-E',customType:'gitjig.coordination-notice',content:JSON.stringify({noticeId:id,...data}),details:{noticeId:id,eventKey:data.eventKey}}];}},executeUserBash(){throw Error('Unused');}});
  const baselinePathReads=checkpointPathReads;await assert.rejects(i.deliverNotices('parent'),/Recorded native notice receipt identity mismatch/);assert.equal(sends,0);assert.equal(checkpointPathReads,baselinePathReads,'No checkpoint access may overwrite a mismatched recorded identity');assert.equal(f.s.one('SELECT data FROM conversation_notifications WHERE id=?',id).data,before);assert.equal(JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?','parent').data).noticeDeliveryCursor,0);
  }finally{f.s.close();}
 }
});
