import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {amendmentModel} from './model.mjs';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {home,payloadId,workId,phase,baselinePath,outputPath}=config;
const payload=path.join(home,'versions',payloadId),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.execPath,path.join(home,'bootstrap/node'));
assert.equal(JSON.parse(await fs.readFile(path.join(home,'binding.json'),'utf8')).payloadId,payloadId);
const {openController}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')).href);
const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
let c=await openController({installationHome:home,runtimeProfile});
const logical=value=>JSON.parse(JSON.stringify(value));
const immutableTables=['requirements','change_versions','runs','role_launches','role_outputs','finding_occurrences','check_runs','remedy_confirmations'];
const rows=table=>logical(table==='role_outputs'?c.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.rowid',workId):c.store.all('SELECT * FROM '+table+' WHERE work=? ORDER BY rowid',workId));
const snapshot=()=>logical({tables:Object.fromEntries(immutableTables.map(table=>[table,rows(table)])),obligations:rows('obligations'),source:c.inspectWork(workId).source,work:c.inspectWork(workId),state:c.store.one('SELECT * FROM change_state WHERE work=?',workId)});
const histories=async()=>{const references=[...new Set(rows('runs').map(run=>JSON.parse(run.data).historyRef).filter(Boolean))];return Object.fromEntries(await Promise.all(references.map(async ref=>[ref,hash(await fs.readFile(ref))])));};
const sameHistory=async expected=>{for(const[ref,digest]of Object.entries(expected))assert.equal(hash(await fs.readFile(ref)),digest,'Prior actual native entry history changed: '+ref);};
try{
 if(phase==='before'){
  const view=c.inspectChange(workId);assert.equal(view.reviewReady,true);const proof=await c.changeCore.currentEvidence(workId),captured=snapshot(),history=await histories();
  assert.ok(captured.obligations.some(row=>{const o=JSON.parse(row.data);return o.kind==='check'&&o.state==='resolved'&&o.witnesses?.length;}),'Use actual installed recovered failure, not injected readiness');
  assert.ok(captured.tables.role_outputs.length>0);assert.ok(Object.keys(history).length>0);
  const baseline={home,payloadId,workId,view,proof,captured,history,contracts:c.changeCore.version(proof.versions.contracts),module:path.join(payload,'dist/controller/index.js'),sdk:path.join(payload,'node_modules/@earendil-works/pi-coding-agent'),node:process.execPath};
  await fs.writeFile(baselinePath,JSON.stringify(baseline,null,2),{mode:0o600});await fs.writeFile(outputPath,JSON.stringify({phase,workId,ready:true,payloadId}));
 }else{
  const baseline=JSON.parse(await fs.readFile(baselinePath,'utf8'));await sameHistory(baseline.history);assert.deepEqual(c.inspectWork(workId).source,baseline.captured.source);assert.equal(c.inspectWork(workId).lineageRoot,baseline.captured.work.lineageRoot);
  for(const[table,old]of Object.entries(baseline.captured.tables)){const current=rows(table);assert.deepEqual(current.slice(0,old.length),old,'Old actual '+table+' history changed');}
  if(phase==='held'){
   assert.deepEqual(snapshot(),baseline.captured);const view=c.inspectChange(workId);assert.equal(view.reviewReady,false);assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(),/criteria changed/);assert.equal(c.store.one('SELECT phase FROM change_state WHERE work=?',workId).phase,'REVIEW_READY');
   await assert.rejects(c.changeCore.currentEvidence(workId),/criteria/);let providerCalls=0;const model=amendmentModel();model.definition.streamSimple=()=>{providerCalls++;throw Error('Stale owned criteria must refuse before provider');};const driven=await c.driveChange({workId,model});assert.equal(driven.reviewReady,false);assert.equal(providerCalls,0);assert.deepEqual(snapshot(),baseline.captured);
   await fs.writeFile(outputPath,JSON.stringify({phase,workId,payloadId,view,providerCalls,execution:c.inspectWork(workId).allowance},null,2));
  }else if(phase==='after'){
   const initial=c.inspectChange(workId),pending=JSON.parse(c.store.one('SELECT data FROM change_state WHERE work=?',workId).data).criteriaRefresh;assert.ok(pending);assert.equal(initial.epoch,baseline.view.epoch+1);assert.equal(pending.fromContractsVersion,baseline.proof.versions.contracts);assert.notEqual(pending.toContractsVersion,pending.fromContractsVersion);
   const source=c.store.one('SELECT * FROM sources WHERE id=?',pending.sourceId);assert.equal(JSON.parse(source.origin).kind,'owner-criteria-refresh');assert.equal(source.raw,config.reason);assert.deepEqual(logical(c.inspectWork(workId).allowance),baseline.captured.work.allowance);
   const ready=await c.driveChange({workId,model:amendmentModel()});assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));const proof=await c.changeCore.currentEvidence(workId),plan=c.changeCore.version(ready.planVersion),contracts=c.changeCore.version(proof.versions.contracts);
   assert.equal(plan.data.criteriaDecision.sourceId,pending.sourceId);assert.equal(proof.versions.contracts,pending.toContractsVersion);assert.notEqual(contracts.hash,baseline.contracts.hash);assert.notEqual(proof.versions.plan,baseline.proof.versions.plan);assert.notEqual(proof.versions.verification,baseline.proof.versions.verification);assert.equal(proof.versions.base,baseline.proof.versions.base);assert.notEqual(proof.versions.candidate,baseline.proof.versions.candidate);assert.ok(proof.checkIds.every(id=>!baseline.proof.checkIds.includes(id)));assert.ok(proof.reviewLaunchIds.every(id=>!baseline.proof.reviewLaunchIds.includes(id)));
   assert.equal(ready.execution.limit,baseline.view.execution.limit);assert.equal(ready.resolution.limit,baseline.view.resolution.limit);assert.ok(ready.execution.consumed>baseline.view.execution.consumed);assert.ok(ready.resolution.consumed>baseline.view.resolution.consumed);assert.equal(ready.execution.reserved,0);assert.equal(ready.resolution.reserved,0);assert.deepEqual(rows('obligations').slice(0,baseline.captured.obligations.length),baseline.captured.obligations);await sameHistory(baseline.history);
   for(const[table,old]of Object.entries(baseline.captured.tables))assert.deepEqual(rows(table).slice(0,old.length),old);
   const result={phase,home,payloadId,workId,proof,view:ready,refresh:pending,refreshSource:source,oldContracts:baseline.contracts,newContracts:contracts,node:process.execPath,module:path.join(payload,'dist/controller/index.js'),sdk:path.join(payload,'node_modules/@earendil-works/pi-coding-agent'),maxRSS:process.resourceUsage().maxRSS};
   await c.close();c=await openController({installationHome:home,runtimeProfile});assert.equal(c.inspectChange(workId).reviewReady,true);assert.deepEqual(await c.changeCore.currentEvidence(workId),proof);result.reopened=true;await fs.writeFile(outputPath,JSON.stringify(result,null,2),{mode:0o600});
  }else throw Error('Unknown fixed criteria consumer phase');
 }
}finally{await c.close();}
