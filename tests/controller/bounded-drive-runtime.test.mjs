// Owned public Controller + original Pi/AgentSession DUMMY provider; no learned/native provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const raw=c=>({outputs:c.store.all('SELECT * FROM role_outputs ORDER BY rowid').map(x=>({...x})),versions:c.store.all('SELECT * FROM change_versions ORDER BY rowid').map(x=>({...x}))});
const budget=x=>({limit:x.limit,consumed:x.consumed,reserved:x.reserved});
async function subject(prefix,open){
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/'+prefix))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n"));process.env.TMPDIR=path.join(home,'artifacts');const c=await open({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});const begun=await c.beginChange({projectId:'P',request:'Consumer exports3 with genuine checks and independent review',executionLimit:10,resolutionLimit:4});return{root,home,c,workId:begun.workId};
}
test('actual old public bounded checkpoint survives close/reopen and resumes through guarded author',{timeout:120000},async()=>{
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned Docker context/image required');await fs.mkdir('.runtime-fixtures',{recursive:true});
 const receipt=JSON.parse(await fs.readFile(process.env.GITJIG_OLD_INSTALL_RECEIPT,'utf8')),oldPayload=await fs.realpath(path.join(receipt.home,'versions',receipt.payloadId));
 const {openController:openOld}=await import(pathToFileURL(path.join(oldPayload,'dist/controller/index.js')).href);
 let legacy,baseline,current,future;const observations={scope:'Owned DUMMY public phase resumption only; no learned inference/currentW/auth/provider network',oldPayload};
 try{
  const roles=[];const model=scripted(undefined,({role})=>roles.push(role));legacy=await subject('bounded-legacy-',openOld);
  const first=await legacy.c.driveChange({workId:legacy.workId,model,maximumSteps:1});assert.equal(first.phase,'BLOCKED');assert.deepEqual(first.blocked,['Bounded drive step limit reached']);assert.equal(first.candidateVersion,null);assert.ok(first.planVersion);assert.deepEqual(roles,['planner','challenger','adjudicator']);const before=raw(legacy.c);observations.legacy={root:legacy.root,home:legacy.home,workId:legacy.workId,first,beforeHash:digest(before)};await legacy.c.close();legacy.c=null;
  // A closed owned byte-copy is used ONLY for the unchanged old-source failure witness.
  const copied=path.join(legacy.root,'old-failure-home');await fs.cp(legacy.home,copied,{recursive:true});process.env.TMPDIR=path.join(copied,'artifacts');baseline=await openOld({installationHome:copied,runtimeProfile});const refused=await baseline.driveChange({workId:legacy.workId,model,maximumSteps:1});assert.equal(refused.phase,'BLOCKED');assert.ok(refused.blocked.some(x=>x.includes('Accepted current plan required before authoring')));assert.equal(refused.candidateVersion,null);assert.deepEqual(roles,['planner','challenger','adjudicator']);assert.deepEqual(raw(baseline),before);observations.oldFailure={home:copied,refused};await baseline.close();baseline=null;
  process.env.TMPDIR=path.join(legacy.home,'artifacts');current=await openController({installationHome:legacy.home,runtimeProfile});const second=await current.driveChange({workId:legacy.workId,model,maximumSteps:1});assert.equal(second.phase,'CANDIDATE_CAPTURED',JSON.stringify(second.blocked));assert.ok(second.candidateVersion);assert.equal(second.planVersion,first.planVersion);assert.equal(second.execution.consumed-first.execution.consumed,1);assert.deepEqual(budget(second.resolution),budget(first.resolution));assert.ok(roles.slice(3).every(r=>r==='implementer'));const now=raw(current);assert.deepEqual(now.outputs.slice(0,before.outputs.length),before.outputs);assert.deepEqual(now.versions.slice(0,before.versions.length),before.versions);assert.equal(await fs.readFile(path.join(current.changeCore.version(second.candidateVersion).artifact,'consumer.cjs'),'utf8'),'module.exports=3;\n');observations.repaired={second,roles,launches:current.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',legacy.workId),history:current.store.all('SELECT id,data FROM runs WHERE work=? ORDER BY rowid',legacy.workId)};await current.close();current=null;

 }finally{await legacy?.c?.close();await baseline?.close();await current?.close();await future?.c?.close();const file=path.join(legacy?.root??path.resolve('.runtime-fixtures'),'bounded-resume-evidence.json');await fs.writeFile(file,JSON.stringify(observations,null,2)+'\n',{flag:'wx',mode:0o600});console.log('RETAINED_BOUNDED_RESUME_EVIDENCE '+file);}
});
