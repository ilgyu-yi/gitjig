import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../../dist/controller/store.js';import {Interactions} from '../../dist/controller/interaction.js';import {lifecycleReasons,resourcePolicy,assertConversationExecutable} from '../../dist/controller/completed-resources.js';
test('private codec: state guards, noticeACK independence and durable tombstone do not fabricate ordinary runtime success',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig153-codec-')),s=new Store(path.join(root,'state.sqlite'));try{
  const i=new Interactions(s,()=>{}),v=i.create();assert.deepEqual(lifecycleReasons(s,v.conversationId),[]);s.run('INSERT INTO conversation_notifications VALUES(?,?,?,?)','N',v.conversationId,'PENDING','{}');assert.deepEqual(lifecycleReasons(s,v.conversationId),[]);
  for(const resource of ['QUEUED','RUNNING','SETTLING','UNKNOWN','WAITING']){s.run('UPDATE conversation_state SET resource=? WHERE conversation=?',resource,v.conversationId);assert.ok(lifecycleReasons(s,v.conversationId).length);}
  s.run('UPDATE conversation_state SET resource=? WHERE conversation=?','IDLE',v.conversationId);const id=i.lifecycleCommit(v.conversationId,v.generation,'delete');assert.equal(id.outcome,'deleted');assert.throws(()=>assertConversationExecutable(s,v.conversationId),/DELETED/);assert.equal(i.inspect(v.conversationId).deleted,true);assert.equal(s.one('SELECT state FROM conversation_notifications WHERE id=?','N').state,'PENDING');assert.throws(()=>i.lifecycleCommit(v.conversationId,v.generation,'restore'),/DELETED/);
  for(const value of [{mode:'finite',idleMs:-1,maxRetained:1},{mode:'bad',idleMs:1,maxRetained:1},{mode:'finite',idleMs:1,maxRetained:17}])assert.throws(()=>resourcePolicy(value),/policy/);
 }finally{s.close();await fs.rm(root,{recursive:true,force:true});}
});
test('private owner codec: fake-clock expiry/LRU closes only eligible objects, close failure remains owned UNKNOWN',async()=>{
 const {CompletedResources}=await import('../../dist/controller/completed-resources.js');const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig153-owner-codec-')),s=new Store(path.join(root,'state.sqlite'));const i=new Interactions(s,()=>{}),a=i.create(),b=i.create();let clock=100,closed=[];const oldNow=Date.now;Date.now=()=>clock;const protectedIds=new Set([b.conversationId]),owner=new CompletedResources(s,{mode:'finite',idleMs:10,maxRetained:2},cid=>protectedIds.has(cid));
 // Synthetic resource-owner records only: no fake ordinary result/standing or native cleanup receipt.
 const entry=(cid,used,fail=false)=>({identity:{conversationId:cid,workId:'private-owner-codec',runId:'private-owner-codec',generation:0},pi:{closeOwned:async()=>{closed.push(cid);if(fail)throw Error('private close fault');}},completed:90,used,state:'retained'});
 try{
  owner.entries.set(a.conversationId,entry(a.conversationId,90));owner.entries.set(b.conversationId,entry(b.conversationId,90));await owner.expire();assert.deepEqual(closed,[a.conversationId]);assert.equal(owner.inspect(b.conversationId).state,'retained');
  protectedIds.clear();owner.touch(b.conversationId);clock=105;await owner.expire();assert.equal(owner.inspect(b.conversationId).state,'retained');clock=111;await owner.expire();assert.equal(owner.inspect(b.conversationId).state,'absent');
  owner.entries.set(a.conversationId,entry(a.conversationId,90,true));await assert.rejects(owner.reclaim(a.conversationId),/private close fault/);assert.equal(owner.inspect(a.conversationId).state,'UNKNOWN');assert.equal(i.inspect(a.conversationId).state,'UNKNOWN');await assert.rejects(owner.beforeFresh(b.conversationId),/UNKNOWN/);await assert.rejects(owner.close(),/UNKNOWN/);
 }finally{Date.now=oldNow;if(owner.timer)clearTimeout(owner.timer);s.close();await fs.rm(root,{recursive:true,force:true});}
});
test('private recency codec: owner acceptance advances, agent/background input does not',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig153-recency-')),s=new Store(path.join(root,'state.sqlite'));const old=Date.now;let clock=100;Date.now=()=>clock;
 try{const i=new Interactions(s,()=>{}),v=i.create();i.enqueue({conversationId:v.conversationId,expectedGeneration:0,text:'owner',mode:'idle'});assert.equal(i.inspect(v.conversationId).humanLastUsed,100);clock=200;i.enqueue({conversationId:v.conversationId,expectedGeneration:0,text:'agent',mode:'idle'},{conversationId:'private-codec-actor',workId:'private-codec-work',runId:'private-codec-run',launchId:null,generation:0,directionRevision:0,initialInputId:'I'});assert.equal(i.inspect(v.conversationId).humanLastUsed,100);clock=300;i.view({selectedId:v.conversationId});assert.equal(i.inspect(v.conversationId).humanLastUsed,300);const second=i.create();clock=400;i.view({selectedId:v.conversationId,secondId:second.conversationId});assert.equal(i.inspect(v.conversationId).humanLastUsed,400);assert.equal(i.inspect(second.conversationId).humanLastUsed,400);clock=500;i.view({selectedId:v.conversationId,secondId:v.conversationId});assert.equal(i.inspect(v.conversationId).humanLastUsed,500);}
 finally{Date.now=old;s.close();await fs.rm(root,{recursive:true,force:true});}
});
test('private lifecycle codec: affirmative cancelled never-admitted and historical cancelled-source no-handoff are not lifetime vetoes; ambiguous transport still holds',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig153-refusal-')),s=new Store(path.join(root,'state.sqlite'));try{const i=new Interactions(s,()=>{}),v=i.create();s.run('INSERT INTO sources VALUES(?,?,?,?)','S',v.conversationId,'{}','private codec');s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','W',null,'S',null,'W','ACTIVE',3,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:v.conversationId}));s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','R','W',3,1,'INTERRUPTED','private-codec-unused','released',JSON.stringify({conversation:v.conversationId,admission:'never-admitted'}));s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','L','W','R',3,1,'CANCELLED',JSON.stringify({admitted:false}));s.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?','W',JSON.stringify({runId:'R'}),v.conversationId);assert.deepEqual(lifecycleReasons(s,v.conversationId),[]);s.run('UPDATE capacity_leases SET data=? WHERE id=?',JSON.stringify({admitted:true}),'L');assert.ok(lifecycleReasons(s,v.conversationId).some(x=>x.startsWith('run:')));s.run('UPDATE capacity_leases SET data=? WHERE id=?',JSON.stringify({admitted:false}),'L');
 s.run('INSERT INTO effect_targets VALUES(?,?,?)','T',null,'{}');s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','G','W','T',1,'{}');const data={kind:'local-git',origin:{identity:{conversationId:v.conversationId}},rootEpoch:1,blocked:['Owned work cancelled'],dispatchRun:'R'};s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','O','W','T','G','REFUSED',JSON.stringify(data));assert.ok(lifecycleReasons(s,v.conversationId).some(x=>x.startsWith('effect:')));s.run('INSERT INTO effect_receipts VALUES(?,?,?,?)','E','O','send',JSON.stringify({handoff:'not-started'}));assert.deepEqual(lifecycleReasons(s,v.conversationId),[]);s.run('UPDATE effect_receipts SET data=? WHERE id=?',JSON.stringify({handoff:'started'}),'E');assert.ok(lifecycleReasons(s,v.conversationId).some(x=>x.startsWith('effect:')));s.run('UPDATE effect_operations SET phase=? WHERE id=?','UNKNOWN','O');assert.ok(lifecycleReasons(s,v.conversationId).some(x=>x.endsWith(':UNKNOWN')));
 }finally{s.close();await fs.rm(root,{recursive:true,force:true});}
});

test('private collection codec: delayed eviction concurrent admission rechecks max1 before insertion',async()=>{
 const {CompletedResources}=await import('../../dist/controller/completed-resources.js');
let release;const gate=new Promise(r=>release=r);const closed=[];
const store={all:()=>[],one(sql,id){if(sql.includes("FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED'"))return undefined;if(sql.includes('FROM conversations'))return{generation:1};if(sql.includes('FROM conversation_state'))return{resource:'IDLE',work:'W'+id,human_used:1,data:JSON.stringify({runId:'R'+id})};if(sql.includes('FROM runs'))return{work:'W'+id.slice(1),phase:'SETTLED',reservation:'consumed',data:JSON.stringify({cleanup:'unbound',nativeSessionId:'N'+id.slice(1),nativeCheckpoint:{sessionId:'N'+id.slice(1)}})};if(sql.includes('capacity_leases'))return{id:'L'};throw Error(sql);}};
const owner=new CompletedResources(store,{mode:'finite',idleMs:86400000,maxRetained:1},()=>false);
owner.entries.set('E',{identity:{conversationId:'E'},pi:{closeOwned:()=>gate},completed:0,used:0,state:'retained'});
const admit=id=>owner.admit({conversationId:id,runId:'R'+id,workId:'W'+id,generation:1},{sessionManager:{getSessionId:()=> 'N'+id},closeOwned:async()=>{closed.push(id)}});
const a=admit('A');let b;let bStart;const started=new Promise(r=>bStart=r);
gate.then(()=>queueMicrotask(()=>{b=admit('B');bStart();}));release();await a;await started;await b;
const retained=[...owner.entries.keys()];owner.quiesce();
assert.equal(retained.length,1);assert.deepEqual(retained,['A']);assert.deepEqual(closed,['B']);
});

test('private owner codec: authority changes during delayed eviction dispose incoming before insertion',async()=>{
 const {CompletedResources}=await import('../../dist/controller/completed-resources.js');
 for(const changed of ['queued','generation','lease','closing']){
  let release;const gate=new Promise(r=>release=r);let flipped=false,closed=0;
  const store={all(sql){return flipped&&changed==='queued'&&sql.includes('FROM conversation_inputs')?[{id:'new-owner-input',state:'QUEUED'}]:[];},one(sql,id){if(sql.includes("FROM conversation_inputs WHERE conversation=? AND state='RECONCILIATION_REQUIRED'"))return undefined;if(sql.includes('FROM conversations'))return{generation:flipped&&changed==='generation'?2:1};if(sql.includes('FROM conversation_state'))return{resource:'IDLE',work:'WA',human_used:1,data:JSON.stringify({runId:'RA'})};if(sql.includes('FROM runs'))return{work:'WA',phase:'SETTLED',reservation:'consumed',data:JSON.stringify({cleanup:'unbound',nativeSessionId:'NA',nativeCheckpoint:{sessionId:'NA'}})};if(sql.includes('capacity_leases'))return flipped&&changed==='lease'?undefined:{id:'L'};throw Error(sql);}};
  const owner=new CompletedResources(store,{mode:'finite',idleMs:86400000,maxRetained:1},()=>false);
  owner.entries.set('E',{identity:{conversationId:'E'},pi:{closeOwned:()=>gate},completed:0,used:0,state:'retained'});
  const incoming={sessionManager:{getSessionId:()=> 'NA'},closeOwned:async()=>{closed++;}};
  const pending=owner.admit({conversationId:'A',runId:'RA',workId:'WA',generation:1},incoming);flipped=true;if(changed==='closing')owner.quiesce();release();await pending;
  assert.equal(owner.inspect('A').state,'absent',changed);assert.equal(closed,1,changed);owner.quiesce();
 }
});
