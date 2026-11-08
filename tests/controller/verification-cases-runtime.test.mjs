import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';import {amendmentModel,correct} from './check-amendment-fixture.mjs';
test('initial missing paired coverage blocks; same W public resume executes internal pair and reaches actual current evidence',{timeout:15000},async()=>{
 const {GITJIG_RUNTIME_FIXTURE_ROOT:parent,GITJIG_DOCKER_BINARY:dockerBinary,GITJIG_DOCKER_CONTEXT:dockerContext,
  GITJIG_DOCKER_CONFIG_DIRECTORY:dockerConfigDirectory,GITJIG_RUNTIME_IMAGE:image}=process.env;
 assert.ok(parent&&path.isAbsolute(parent)&&dockerBinary&&dockerContext&&dockerConfigDirectory&&image,'Explicit private fixture root and prepared Docker route required');
 const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'cases-runtime-'))),source=path.join(root,'source'),home=path.join(root,'home');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),correct);
 const c=await openController({installationHome:home,runtimeProfile:{dockerBinary,dockerContext,dockerConfigDirectory,image}});let success=false;
 const previousTemporary=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
 try{
 await c.registerProject({id:'P',sourceRoot:source});let v=await c.beginChange({projectId:'P',request:'Consumer exports3 and rejects a contradictory value claim. Retain actual paired verification.',executionLimit:32,resolutionLimit:16});const workId=v.workId;
 v=await c.driveChange({workId,model:amendmentModel({withoutCases:true})});assert.equal(v.reviewReady,false);assert.match(v.blocked.join(),/PROTOCOL:.*missing \["cases"\]/);assert.equal(v.checks.length,0);const consumed=v.resolution.consumed;
 v=await c.driveChange({workId,model:amendmentModel()});assert.equal(v.reviewReady,true,JSON.stringify(v.blocked));assert.ok(v.resolution.consumed>consumed);const check=v.checks.find(r=>r.status==='pass');assert.equal(check.data.caseResults.complete,true);assert.equal(check.data.parsed.value.cases.length,2);assert.equal(check.data.actual.exitCode,0);assert.equal(check.data.parsed.value.cases[1].observed.kind,'rejection');assert.equal((await c.changeCore.currentEvidence(workId)).versions.candidate,v.candidateVersion);success=true;
 }finally{
  try{await c.close();}finally{if(previousTemporary===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemporary;}
  if(success)await fs.rm(root,{recursive:true,force:true});else console.error('Preserved '+root);
 }
});
