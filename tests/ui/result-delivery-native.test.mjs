import test from 'node:test';
import assert from 'node:assert/strict';
import {repositoryCommands} from '../../dist/ui/repository-commands.js';
import {HostCommands} from '../../dist/ui/host-commands.js';

// Native receiver/projection/allocation are original; procedure and drive outcomes
// are controlled premises. This does not qualify engineering judgment or landing.
for(const preallocationDrift of [false,true])test(`result pin transfers only at original allocation, own derived result changes are allowed; preallocation drift=${preallocationDrift}`,{timeout:15000},async t=>{
 const {firstWorld,remoteContext}=await import('./integration-start-fixture.mjs');
 const f=await firstWorld(t);await remoteContext(f);
 let drift=false,drives=0,allocations=0;const inspect=f.c.inspectChangeResult.bind(f.c);
 f.c.inspectChangeResult=id=>({...inspect(id),reviewReady:true,reviews:{availability:'recorded',entries:[{key:drift?'changed-clear-review':'original-clear-review',state:'selected',outcome:'clear',findingCount:0}],total:1,omitted:0}});
 const prepare=f.c.prepareFirstIntegration.bind(f.c);
 f.c.prepareFirstIntegration=(options,validate,onAllocated)=>prepare(options,validate,id=>{
  allocations++;assert.equal(f.c.store.one('SELECT work FROM effect_operations WHERE id=?',id).work,f.workId);onAllocated?.(id);
 });
 if(preallocationDrift){const trust=f.c.effects.trustedProfile.bind(f.c.effects);f.c.effects.trustedProfile=async(...args)=>{const result=await trust(...args);drift=true;return result;};}
 f.c.changeCore.drive=async()=>{
  drives++;assert.equal(allocations,1,'Original allocation precedes derived work');
  const candidate=f.c.changeCore.version(f.c.inspectChange(f.workId).candidateVersion);assert.notEqual(candidate.id,f.evidence.versions.candidate);
  f.evidence.versions.candidate=candidate.id;f.evidence.candidateDigest=candidate.hash;return{reviewReady:true};
 };
 const ui=repositoryCommands({controller:f.c,model:f.model,isCurrent:()=>true,show:async()=>{},input:async()=>assert.fail('Existing original Git profile needs no new input'),notice(){},choose:async(title,rows)=>{
  if(title==='Choose the next branch-delivery step')return 'Review receivers for this original result';
  if(title.startsWith('Branch delivery'))return rows.find(row=>row.includes(f.target));
  if(title==='Original integration target · actions')return 'Prepare first integration for owner work';
  if(title==='Confirm first integration preparation')return 'Prepare first integration for this work';
  assert.fail('Unexpected delivery chooser '+title);
 }});t.after(()=>ui.close());
 const action=new HostCommands(ui.commands).execute('/repo deliver '+f.workId,f.conversation);
 if(preallocationDrift){await assert.rejects(action,/Original result changed/);assert.equal(allocations,0);assert.equal(drives,0);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM effect_operations').n,0);}
 else{assert.equal(await action,'completed');assert.equal(allocations,1);assert.equal(drives,1);const op=f.c.store.one('SELECT id FROM effect_operations');assert.equal(f.c.inspectEffect(op.id).phase,'RESERVED');}
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);assert.equal(f.c.store.one("SELECT COUNT(*) n FROM runs WHERE reservation='reserved'").n,0);f.pass();
});

for(const epochDrift of [false,true])test(`explicit retained-original handoff keeps one operation and permits only its own derived change; epoch drift=${epochDrift}`,{timeout:15000},async t=>{
 const {candidateWorld}=await import('./integration-prepare-fixture.mjs');const f=await candidateWorld(t,{derived:true});
 const inspect=f.c.inspectChangeResult.bind(f.c);f.c.inspectChangeResult=id=>({...inspect(id),reviewReady:true});
 let drives=0;f.c.changeCore.drive=async()=>{
  drives++;const candidate=f.c.changeCore.version(f.c.inspectChange(f.op.workId).candidateVersion);assert.notEqual(candidate.id,f.evidence.versions.candidate);
  if(epochDrift)f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.op.workId);
  f.evidence.versions.candidate=candidate.id;f.evidence.candidateDigest=candidate.hash;return{reviewReady:true};
 };
 const ui=repositoryCommands({controller:f.c,model:f.model,isCurrent:()=>true,show:async()=>{},input:async()=>assert.fail('Original client already configured'),notice(){},choose:async(title,rows)=>{
  if(title==='Choose the next branch-delivery step')return 'Review receivers for this original result';
  if(title.startsWith('Branch delivery'))return rows.find(row=>row.includes(f.target));
  if(title==='Original integration target · actions')return 'Prepare first integration for owner work';
  if(title==='Existing original integration · no new allocation')return rows.find(row=>row.includes(f.op.operationId));
  if(title.startsWith('Original integration · '))return drives?'Back without action':'Review original integration preparation';
  if(title==='Confirm original integration preparation')return 'Prepare this original integration';
  assert.fail('Unexpected original chooser '+title);
 }});t.after(()=>ui.close());
 const action=new HostCommands(ui.commands).execute('/repo deliver '+f.op.workId,f.conversation);
 if(epochDrift)await assert.rejects(action,/work or source changed|epoch|source changed/i);else assert.equal(await action,'completed');
 assert.equal(drives,1);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM effect_operations').n,1);assert.equal(f.c.inspectEffect(f.op.operationId).phase,epochDrift?'REFUSED':'RESERVED');
 assert.equal(f.c.store.one("SELECT COUNT(*) n FROM effect_receipts WHERE kind='send'").n,0);assert.equal(f.c.store.one("SELECT COUNT(*) n FROM runs WHERE reservation='reserved'").n,0);f.pass();
});
