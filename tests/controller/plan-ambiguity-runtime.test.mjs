// ROOT ONLY: existing original public Controller/DUMMY fixture. No learned model or provider network.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {getCurrentSystemPrompt} from '@earendil-works/pi-ai';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
test('public original native healthy plan keeps selected conventions and future verification notes outside ambiguity hold',{timeout:60000},async()=>{
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned engine context/image required; unavailable is not PASS');
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/plan-ambiguity-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n"));process.env.TMPDIR=path.join(home,'artifacts');let c;const seen=[];
 try{c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});const begun=await c.beginChange({projectId:'P',request:'Consumer exports3 using meaningful actual checks and independent review',executionLimit:8,resolutionLimit:3});
  const model=scripted(undefined,({role,result,body,context})=>{seen.push({role,stage:body.context.stage});
   if(role==='planner'){result.plan.approach+=' Selected literal export convention is a reversible implementation choice, not a new owner requirement.';result.plan.factualSources.push('Current check execution and changed candidate do not yet exist; later verification is mandatory.');result.plan.ambiguities=[];}
   if(role==='planner'||role==='adjudicator'){const prompt=getCurrentSystemPrompt(context.messages);assert.match(prompt,/unresolved consequential questions about owner intent/);}
   if(role==='adjudicator'){assert.equal(result.planAccepted,true);assert.deepEqual(result.acceptedPlan.ambiguities,[]);assert.ok(result.acceptedPlan.approach.includes('reversible'));assert.ok(result.acceptedPlan.factualSources.some(s=>s.includes('later verification is mandatory')));}
  });
  const after=await c.planChange({workId:begun.workId,model});assert.equal(after.phase,'PLAN_READY',JSON.stringify(after.blocked));assert.ok(after.planVersion);assert.equal(after.candidateVersion,null);assert.equal(after.reviewReady,false);assert.equal(begun.execution.consumed,1,'Initial BASE capture is a retained execution charge');assert.equal(after.execution.consumed-begun.execution.consumed,3,'Exactly P/C/J consume three additional execution admissions');assert.equal(after.resolution.consumed,2);assert.deepEqual(seen.map(s=>s.role),['planner','challenger','adjudicator']);
  const selected=c.changeCore.version(after.planVersion);assert.deepEqual(selected.data.plan.ambiguities,[]);assert.ok(selected.data.plan.approach.includes('reversible'));assert.ok(selected.data.plan.factualSources.some(s=>s.includes('later verification is mandatory')));
  const receipt=path.join(root,'healthy-plan-receipt.json');await fs.writeFile(receipt,JSON.stringify({scope:'ROOT actual original public Controller/Pi AgentSession DUMMY planning only; not learned semantics/check/task/effect success',root,home,workId:begun.workId,after,seen,selectedPlan:selected,launches:c.store.all('SELECT * FROM role_launches WHERE work=? ORDER BY rowid',begun.workId)},null,2)+'\n',{flag:'wx',mode:0o600});console.log('RETAINED_PLAN_AMBIGUITY_EVIDENCE '+receipt);
 }finally{await c?.close();}
});
