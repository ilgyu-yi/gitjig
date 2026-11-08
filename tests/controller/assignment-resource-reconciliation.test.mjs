import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectCommands} from '../../dist/ui/project-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {structuredAssignmentWorld as world} from './structured-assignment-fixture.mjs';

const tables=['works','runs','budgets','sources','capacity_leases','role_launches','conversation_results','conversation_assignments','conversation_dependencies','conversation_state','role_outputs','effect_delegations','effect_operations','effect_receipts'];
const snapshot=s=>Object.fromEntries(tables.map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
async function legacy(f,family){
 await f.assign();if(family==='effect')await f.integrate();
 const s=f.c.store,id=family==='effect'?f.effect.assignmentId:f.child.assignmentId;
 const row=s.one('SELECT * FROM conversation_assignments WHERE id=?',id),data=JSON.parse(row.data);delete data.resultId;
 s.run('UPDATE conversation_assignments SET data=? WHERE id=?',JSON.stringify(data),id);
 s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",id);
 const source=path.join(f.root,'other-project');await fs.mkdir(source,{recursive:true});
 if(!f.c.listProjects().some(project=>project.id==='Q'))await f.c.registerProject({id:'Q',sourceRoot:source});
 return{id,assignment:row,run:s.one('SELECT * FROM runs WHERE work=? ORDER BY rowid LIMIT 1',f.child.workId)};
}

for(const family of ['governed','effect'])for(const uncertainty of ['quarantined','unknown','missing-cleanup','malformed-run','reserved','invalid-reservation','active-capacity','unknown-capacity','active-role','unknown-role-cleanup','missing-role-cleanup','target-unknown','native-input-recovery'])test(`${family} legacy result cannot release project scope with ${uncertainty}`,async t=>{
 const f=await world(t),original=await legacy(f,family),s=f.c.store,run=original.run,data=JSON.parse(run.data),roleId=randomUUID(),leaseId=randomUUID();
 const target=s.one('SELECT * FROM conversation_state WHERE conversation=?',f.child.conversationId),leases=s.all('SELECT * FROM capacity_leases WHERE run=?',run.id);
 try{
  if(['quarantined','unknown','missing-cleanup'].includes(uncertainty)){
   if(uncertainty==='missing-cleanup')delete data.cleanup;else data.cleanup=uncertainty==='quarantined'?'quarantined-native-join':'unknown';
   s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify(data),run.id);
  }else if(uncertainty==='malformed-run')s.run('UPDATE runs SET data=? WHERE id=?','{broken',run.id);
  else if(['reserved','invalid-reservation'].includes(uncertainty))s.run('UPDATE runs SET reservation=? WHERE id=?',uncertainty==='reserved'?'reserved':'unproven',run.id);
  else if(['active-capacity','unknown-capacity'].includes(uncertainty)){
   s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',leaseId,f.child.workId,run.id,run.epoch,s.one('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM capacity_leases').next,uncertainty==='active-capacity'?'ADMITTED':'UNKNOWN',JSON.stringify({admitted:true}));
  }else if(['active-role','unknown-role-cleanup','missing-role-cleanup'].includes(uncertainty)){
   const metadata=uncertainty==='missing-role-cleanup'?{}:{cleanup:uncertainty==='active-role'?'removed':'unknown'};
   s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',roleId,f.child.workId,run.id,'implementer',run.epoch,uncertainty==='active-role'?'RUNNING':'UNUSABLE','none',JSON.stringify(metadata));
  }else if(uncertainty==='target-unknown')s.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",f.child.conversationId);
  else if(uncertainty==='native-input-recovery')s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...JSON.parse(target.data),nativeInputRecovery:{format:'gitjig-native-input-recovery-1',runId:run.id,generation:run.generation}}),f.child.conversationId);
  const before=snapshot(s),view=f.c.inspectConversation(f.parent);
  await assert.rejects(f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:view.generation}),uncertainty==='malformed-run'?/LIFECYCLE_HELD|malformed JSON/:/LIFECYCLE_HELD/);
  assert.throws(()=>f.c.setConversationProject({conversationId:f.parent,projectId:'Q',expectedGeneration:view.generation}),/PROJECT_SCOPE_UNAVAILABLE/);
  assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',original.id).state,'PENDING');
  assert.deepEqual(snapshot(s),before,'Uncertainty cannot change the original publication, work, wait, allowance or cursor');
 }finally{
  // Restore only injected test premises before closing the shared fixture. This
  // is test teardown, never a product recovery or successful cleanup claim.
  s.run('UPDATE runs SET data=?,reservation=? WHERE id=?',run.data,run.reservation,run.id);
  s.run('UPDATE conversation_state SET resource=?,data=? WHERE conversation=?',target.resource,target.data,target.conversation);
  for(const lease of leases)s.run('UPDATE capacity_leases SET state=? WHERE id=?',lease.state,lease.id);
  s.run('DELETE FROM role_launches WHERE id=?',roleId);
  s.run('DELETE FROM capacity_leases WHERE id=?',leaseId);
 }
 f.pass();
});

test('accepted history can release its wait after same-epoch phase drift without establishing new standing',async t=>{
 const f=await world(t),{id}=await legacy(f,'governed'),s=f.c.store;
 s.run("UPDATE change_state SET phase='IMPLEMENTING' WHERE work=?",f.child.workId);
 const before=snapshot(s),view=f.c.inspectConversation(f.parent);
 await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:view.generation});
 assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state,'RESOLVED');
 for(const table of tables.filter(table=>table!=='conversation_dependencies'))assert.deepEqual(snapshot(s)[table],before[table],table);
 assert.equal(f.c.inspectChangeActivity(f.child.workId).recordedPhase,'IMPLEMENTING');
 f.c.setConversationProject({conversationId:f.parent,projectId:'Q',expectedGeneration:view.generation});
 assert.equal(f.c.inspectConversation(f.parent).projectId,'Q');
 f.pass();
});

test('unrelated later conversation ownership does not invalidate original settled publication',async t=>{
 const f=await world(t),{id}=await legacy(f,'governed'),s=f.c.store,target=s.one('SELECT * FROM conversation_state WHERE conversation=?',f.child.conversationId);
 const successor=randomUUID(),successorRun=randomUUID(),successorSource=randomUUID();
 s.run('INSERT INTO sources VALUES(?,?,?,?)',successorSource,f.child.conversationId,JSON.stringify({kind:'owner-conversation-input',uid:process.getuid?.()}),'Controlled later owner input');
 s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',successor,'P',successorSource,null,successor,'UNKNOWN',1,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:f.child.conversationId}));
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',successorRun,successor,1,1,'UNKNOWN',f.root,'consumed',JSON.stringify({kind:'ordinary-conversation',conversation:f.child.conversationId,cleanup:'unknown'}));
 try{
  // Controlled successor custody, separate from the original child's runs and
  // immutable publication. This is not successful successor execution evidence.
  s.run("UPDATE conversation_state SET work=?,resource='UNKNOWN',data=? WHERE conversation=?",successor,JSON.stringify({runId:successorRun,nativeInputRecovery:{runId:successorRun}}),f.child.conversationId);
  const before=snapshot(s),view=f.c.inspectConversation(f.parent);
  await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:view.generation});
  assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state,'RESOLVED');
  for(const table of tables.filter(table=>table!=='conversation_dependencies'))assert.deepEqual(snapshot(s)[table],before[table],table);
 }finally{s.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?',target.work,target.resource,target.data,target.conversation);}
 f.pass();
});

for(const premise of ['proven-unadmitted','native-history','foreign-lease','missing-admission-proof','malformed-role','launch-history','launch-session','launch-allocated','contradictory-lease'])test(`legacy result uses only original never-admitted settlement proof · ${premise}`,async t=>{
 const f=await world(t),{id}=await legacy(f,'governed'),s=f.c.store,runId=randomUUID(),leaseId=randomUUID(),otherLeaseId=randomUUID(),roleId=randomUUID();
 const work=s.one('SELECT * FROM works WHERE id=?',f.child.workId),data={kind:'governed-role',admission:'never-admitted'};
 if(premise==='native-history')data.historyRef='/unproven-native-history';
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,work.id,work.epoch,work.generation,'INTERRUPTED',f.root,'released',JSON.stringify(data));
 s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',leaseId,premise==='foreign-lease'?f.c.inspectConversation(f.parent).workId:work.id,runId,work.epoch,s.one('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM capacity_leases').next,'CANCELLED',JSON.stringify(premise==='missing-admission-proof'?{}:{admitted:false}));
 if(premise==='contradictory-lease')s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)',otherLeaseId,work.id,runId,work.epoch,s.one('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM capacity_leases').next,'CANCELLED',JSON.stringify({admitted:true}));
 const launch={};
 if(premise==='launch-history')launch.historyRef='/unproven-launch-history';
 if(premise==='launch-session')launch.nativeSessionId='unproven-native-session';
 if(premise==='launch-allocated')launch.allocatedNative=true;
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',roleId,work.id,runId,'implementer',work.epoch,'INTERRUPTED','released',premise==='malformed-role'?'{broken':JSON.stringify(launch));
 try{
  const before=snapshot(s),view=f.c.inspectConversation(f.parent),reclaim=()=>f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:view.generation});
  if(premise==='proven-unadmitted'){
   await reclaim();assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state,'RESOLVED');
   for(const table of tables.filter(table=>table!=='conversation_dependencies'))assert.deepEqual(snapshot(s)[table],before[table],table);
  }else{
   await assert.rejects(reclaim(),/LIFECYCLE_HELD/);
   assert.deepEqual(snapshot(s),before);
  }
 }finally{
  s.run('DELETE FROM role_launches WHERE id=?',roleId);s.run('DELETE FROM capacity_leases WHERE id IN (?,?)',leaseId,otherLeaseId);s.run('DELETE FROM runs WHERE id=?',runId);
 }
 f.pass();
});


test('project command retains an unknown original parent capacity after child completion',async t=>{
 const f=await world(t);await f.assign();const s=f.c.store,view=f.c.inspectConversation(f.parent);
 const root=path.join(f.root,'other-project');await fs.mkdir(root,{recursive:true});
 if(!f.c.listProjects().some(project=>project.id==='Q'))await f.c.registerProject({id:'Q',sourceRoot:root});
 const lease=s.one('SELECT * FROM capacity_leases WHERE work=? ORDER BY sequence DESC LIMIT 1',view.workId);assert.ok(lease);
 s.run("UPDATE capacity_leases SET state='UNKNOWN' WHERE id=?",lease.id);
 try{
  const before=snapshot(s),registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,hostLanguage:'en',
   choose:async()=>assert.fail('Explicit project needs no picker'),input:async()=>assert.fail('No registration requested'),
   notice:()=>assert.fail('Unknown capacity cannot select a project'),refresh:async()=>assert.fail('No project refresh before settlement')}));
  await assert.rejects(registry.execute('/project Q',f.parent),new RegExp('capacity:'+lease.id+':UNKNOWN'));
  assert.deepEqual(snapshot(s),before);
  assert.equal(f.c.inspectConversation(f.parent).generation,view.generation);
  assert.equal(f.c.inspectConversation(f.parent).projectId,view.projectId);
 }finally{s.run('UPDATE capacity_leases SET state=? WHERE id=?',lease.state,lease.id);}
 f.pass();
});

for(const locale of ['en','ko'])for(const cause of ['uncertain-child','parent-input'])test(`project ${locale} completion guidance requires the same recorded dependency hold · ${cause}`,async t=>{
 const f=await world(t),{id,run}=await legacy(f,'governed'),s=f.c.store;
 if(cause==='uncertain-child')s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(run.data),cleanup:'quarantined-native-join'}),run.id);
 else await f.c.queueConversationInput({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,text:'Retained unrelated owner input',mode:'idle'});
 try{
  const before=snapshot(s),registry=new HostCommands(projectCommands({controller:f.c,isCurrent:()=>true,hostLanguage:locale,
   choose:async()=>assert.fail('No picker for explicit project'),input:async()=>assert.fail('No registration'),notice:()=>assert.fail('Project must remain held'),refresh:async()=>assert.fail('No refresh')}));
  await assert.rejects(registry.execute('/project Q',f.parent),error=>{
   assert.equal(error.code,'PROJECT_DEPENDENCY_PENDING');
   const completion=locale==='ko'?'완료 기록의 확인이 필요합니다':'recorded completion needs reconciliation';
   assert.equal(error.message.includes(completion),cause==='uncertain-child');
   assert.ok(error.recovery.includes('LIFECYCLE_HELD:'));
   if(cause==='uncertain-child')assert.ok(error.recovery.includes('dependency:'+s.one('SELECT id FROM conversation_dependencies WHERE assignment=?',id).id));
   else assert.ok(error.recovery.includes('input:'));
   return true;
  });
  assert.deepEqual(snapshot(s),before);assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',id).state,'PENDING');
 }finally{s.run('UPDATE runs SET data=? WHERE id=?',run.data,run.id);}
 f.pass();
});
