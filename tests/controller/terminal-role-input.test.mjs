import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationModels} from '../../dist/app/models.js';

async function fixture(t,{unallocated=false}={}){
 const root=await temporaryDirectory('terminal-role-input'),c=await openController({installationHome:path.join(root,'home')}),s=c.store;
 let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root);});
 const work=randomUUID(),run=randomUUID(),launch=randomUUID(),source=randomUUID(),lease=randomUUID(),output=randomUUID();
 s.run('INSERT INTO sources VALUES(?,?,?,?)',source,null,'{}','Original task retained');
 s.run('INSERT INTO works(id,source,lineage,state,epoch,generation,data) VALUES(?,?,?,?,?,?,?)',work,source,work,'ACTIVE',38,2,'{"kind":"governed-change"}');
 s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',work,'execution',101,100,0);
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,work,35,1,'INTERRUPTED',path.join(root,'staging'),'consumed',JSON.stringify(unallocated?{kind:'governed-role',role:'planner',launchId:launch,cleanup:'not-allocated'}:{kind:'governed-role',role:'planner',launchId:launch,capacityId:lease,attainedCapture:true,manifest:{files:[]},cleanup:'removed'}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,work,run,'planner',35,'UNUSABLE','none',JSON.stringify({stage:'planning',cleanup:'quarantined-unreturned-scope',historyRef:null,nativeSessionId:null}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',output,launch,null,'unusable',JSON.stringify({protocol:null,providerRequests:0,terminal:'error',historyRef:null,nativeSource:null,issues:['Original preparation failed']}));
 if(!unallocated)s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',lease,work,run,35,1,'RELEASED',JSON.stringify({admitted:true,kind:'role',receipt:{cleanup:'removed',settled:true}}));
 const identity=c.interactions.allocateRole({workId:work,runId:run,launchId:launch,role:'planner'}),cid=identity.conversationId,input=identity.initialInputId;
 const state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',cid).data);s.run("UPDATE conversation_state SET resource='IDLE',data=? WHERE conversation=?",JSON.stringify({...state,cleanup:{cleanup:'quarantined-unreturned-scope',settled:true}}),cid);
 const tables=['works','runs','budgets','role_launches','role_outputs','capacity_leases','finding_occurrences','finding_dispositions','sources'];
 return {c,s,cid,input,identity,run,launch,lease,output,work,source,pass(){passed=true;},snapshot(){return Object.fromEntries([...tables,'conversations','conversation_state','conversation_inputs'].map(n=>[n,s.all('SELECT * FROM '+n+' ORDER BY rowid')]));},immutable(){return Object.fromEntries(tables.map(n=>[n,s.all('SELECT * FROM '+n+' ORDER BY rowid')]));},reclaim(generation=1){return c.reclaimConversationResource({conversationId:cid,expectedGeneration:generation});},patch(table,id,change){const row=s.one('SELECT data FROM '+table+' WHERE '+(table==='conversation_state'?'conversation':'id')+'=?',id);s.run('UPDATE '+table+' SET data=? WHERE '+(table==='conversation_state'?'conversation':'id')+'=?',JSON.stringify({...JSON.parse(row.data),...change}),id);}};
}
test('public reclaim retires exact interrupted undispatched role input and enables public model edit without changing original evidence',async t=>{
 const f=await fixture(t),old=f.immutable(),models=new ApplicationModels(f.c);
 assert.equal(f.c.inspectApplicationMutationBlocker()?.next,'role-reclaim');
 await assert.rejects(models.setRole('planner',null),/queued or retained/);
 await f.reclaim();assert.deepEqual(f.immutable(),old);
 assert.equal(f.c.inspectConversation(f.cid).state,'IDLE');
 const row=f.s.one('SELECT * FROM conversation_inputs WHERE id=?',f.input),receipt=JSON.parse(row.data).terminalRoleInput;
 assert.equal(row.state,'CONFLICTED');assert.equal(receipt.kind,'terminal-role-before-dispatch');assert.equal(receipt.outputId,f.output);
 assert.equal(JSON.parse(f.s.one('SELECT data FROM conversation_state WHERE conversation=?',f.cid).data).cleanup.cleanup,'quarantined-unreturned-scope');
 await models.setRole('planner',null);const after=f.snapshot();await f.reclaim();assert.deepEqual(f.snapshot(),after);f.pass();
});
test('normal settled role cleanup retires no-dispatch reservation after capacity release',async t=>{
 const f=await fixture(t),before=f.immutable();f.c.interactions.cleanup(f.identity,{cleanup:'removed',settled:true});
 assert.equal(f.c.inspectConversation(f.cid).state,'IDLE');assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',f.input).state,'CONFLICTED');assert.deepEqual(f.immutable(),before);f.pass();
});
for(const defect of ['conversation-history','state-native-evidence','dispatch','malformed-dispatch','intent','history','native-id','recovery','unsettled','unremoved','reserved','lease-active','lease-foreign','lease-unadmitted','wrong-launch','wrong-role','wrong-epoch','wrong-generation','wrong-source','raw-output','requests','duplicate-output','extra-input','dialog','stale-owner-generation'])test('terminal role reclaim preserves original hold: '+defect,async t=>{
 const f=await fixture(t);
 if(defect==='conversation-history')f.s.run('UPDATE conversations SET history=? WHERE id=?','/original/retained-history',f.cid);
 if(defect==='state-native-evidence')f.patch('conversation_state',f.cid,{nativeCheckpoint:{original:true}});
 if(defect==='dispatch')f.patch('runs',f.run,{modelDispatchAttempted:true});
 if(defect==='malformed-dispatch')f.patch('runs',f.run,{modelDispatchAttempted:'false'});
 if(defect==='intent')f.patch('role_launches',f.launch,{nativeRoleIntent:{version:1}});
 if(defect==='history')f.patch('runs',f.run,{historyRef:'/original/history'});
 if(defect==='native-id')f.s.run('UPDATE conversation_state SET native_id=? WHERE conversation=?','original-native',f.cid);
 if(defect==='recovery')f.patch('conversation_state',f.cid,{nativeInputRecovery:{}});
 if(defect==='unsettled')f.s.run("UPDATE runs SET phase='UNKNOWN' WHERE id=?",f.run);
 if(defect==='unremoved')f.patch('runs',f.run,{cleanup:'quarantined'});
 if(defect==='reserved')f.s.run("UPDATE runs SET reservation='reserved' WHERE id=?",f.run);
 if(defect==='lease-active')f.s.run("UPDATE capacity_leases SET state='ADMITTED' WHERE id=?",f.lease);
 if(defect==='lease-foreign')f.s.run('UPDATE capacity_leases SET epoch=epoch+1 WHERE id=?',f.lease);
 if(defect==='lease-unadmitted')f.patch('capacity_leases',f.lease,{admitted:false});
 if(defect==='wrong-launch')f.patch('conversation_inputs',f.input,{launchId:'foreign-launch'});
 if(defect==='wrong-role')f.patch('conversation_state',f.cid,{role:'challenger'});
 if(defect==='wrong-epoch')f.s.run('UPDATE role_launches SET epoch=epoch+1 WHERE id=?',f.launch);
 if(defect==='wrong-generation')f.s.run('UPDATE conversation_inputs SET generation=2 WHERE id=?',f.input);
 if(defect==='wrong-source'){const id=randomUUID();f.s.run('INSERT INTO sources VALUES(?,?,?,?)',id,null,'{}','Foreign source');f.s.run('UPDATE conversation_inputs SET source=? WHERE id=?',id,f.input);}
 if(defect==='raw-output')f.s.run("UPDATE role_outputs SET raw='Original received output' WHERE id=?",f.output);
 if(defect==='requests')f.patch('role_outputs',f.output,{providerRequests:1});
 if(defect==='duplicate-output')f.s.run('INSERT INTO role_outputs SELECT ?,launch,raw,status,data FROM role_outputs WHERE id=?',randomUUID(),f.output);
 if(defect==='extra-input')f.s.run('INSERT INTO conversation_inputs SELECT ?,conversation,generation,work,source,\'QUEUED\',mode,text,data FROM conversation_inputs WHERE id=?',randomUUID(),f.input);
 if(defect==='dialog')f.patch('conversation_state',f.cid,{dialogs:[{id:'retained'}]});
 const before=f.snapshot();await assert.rejects(f.reclaim(defect==='stale-owner-generation'?2:1));assert.deepEqual(f.snapshot(),before);f.pass();
});
test('independent lifecycle hold rolls back successful role-input correspondence',async t=>{
 const f=await fixture(t);
 // A separate related run still owns uncertain resources after this role ended.
 f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',randomUUID(),f.work,38,2,'UNKNOWN','/retained/other','consumed',JSON.stringify({kind:'ordinary-conversation',conversation:f.cid,cleanup:'quarantined'}));
 const before=f.snapshot();await assert.rejects(f.reclaim(),/LIFECYCLE_HELD|reconciliation/);assert.deepEqual(f.snapshot(),before);f.pass();
});
test('storage failure during role projection rolls back input retirement',async t=>{
 const f=await fixture(t),before=f.snapshot(),original=f.s.run;
 f.s.run=function(sql,...args){if(sql.startsWith("UPDATE conversations SET state='IDLE'"))throw Error('CONTROLLED_STORAGE_FAILURE');return original.call(this,sql,...args);};
 try{await assert.rejects(f.reclaim(),/CONTROLLED_STORAGE_FAILURE/);}finally{f.s.run=original;}
 assert.deepEqual(f.snapshot(),before);f.pass();
});


test('normal role cleanup before capacity admission retires its undelivered placeholder and preserves failed evidence',async t=>{
 const f=await fixture(t,{unallocated:true}),before=f.immutable();
 f.c.interactions.cleanup(f.identity,{cleanup:'not-allocated',settled:true});
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',f.input).state,'CONFLICTED');
 assert.equal(f.c.inspectConversation(f.cid).state,'IDLE');assert.deepEqual(f.immutable(),before);
 assert.equal(JSON.parse(f.s.one('SELECT data FROM conversation_inputs WHERE id=?',f.input).data).terminalRoleInput.cleanup,'not-allocated');
 const after=f.snapshot();await f.reclaim();assert.deepEqual(f.snapshot(),after);f.pass();
});
test('public reclaim of a terminal preallocation role releases model-selection hold without consuming or refunding work',async t=>{
 const f=await fixture(t,{unallocated:true}),before=f.immutable(),models=new ApplicationModels(f.c);
 await assert.rejects(models.setRole('planner',null),/queued or retained/);
 await f.reclaim();await models.setRole('planner',null);
 assert.equal(f.s.one('SELECT state FROM conversation_inputs WHERE id=?',f.input).state,'CONFLICTED');assert.deepEqual(f.immutable(),before);f.pass();
});
for(const defect of ['capture','manifest','container','foreign-capacity','released-reservation','missing-lease-admitted','missing-lease-never-admitted','cancelled-admitted','cancelled-without-admission-proof','cancelled-with-receipt','cancelled-consumed'])test('preallocation role preserves uncertain resource hold: '+defect,async t=>{
 const f=await fixture(t,{unallocated:true});
 if(defect==='capture')f.patch('runs',f.run,{attainedCapture:true});
 if(defect==='manifest')f.patch('runs',f.run,{manifest:{files:[]}});
 if(defect==='container')f.patch('runs',f.run,{containerId:'original-resource'});
 if(defect==='foreign-capacity')f.patch('runs',f.run,{capacityId:'unproven-capacity'});
 if(defect==='released-reservation')f.s.run("UPDATE runs SET reservation='released' WHERE id=?",f.run);
 if(defect.startsWith('missing-lease-'))f.patch('runs',f.run,{admission:defect==='missing-lease-admitted'?'admitted':'never-admitted'});
 if(defect.startsWith('cancelled-')){
  if(defect!=='cancelled-consumed')f.s.run("UPDATE runs SET reservation='released' WHERE id=?",f.run);
  f.patch('runs',f.run,{capacityId:f.lease,...(defect==='cancelled-without-admission-proof'?{}:{admission:'never-admitted'})});
  f.s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',f.lease,f.work,f.run,35,1,'CANCELLED',JSON.stringify({kind:'role',admitted:defect==='cancelled-admitted',...(defect==='cancelled-with-receipt'?{receipt:{settled:true}}:{})}));
 }
 const before=f.snapshot();await assert.rejects(f.reclaim());assert.deepEqual(f.snapshot(),before);f.pass();
});
