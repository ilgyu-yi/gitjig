/** Controlled judgments over actual current notes; original SDK, checks and host bindings remain real. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import {runtimeFixtureProfile,runtimeFixtureConfig} from '../runtime/profile.mjs';
import {amendmentModel,correct} from './check-amendment-fixture.mjs';
export function typedNitModel(){
 const base=amendmentModel(),original=base.definition.streamSimple;
 return {...base,definition:{...base.definition,streamSimple(model,context){
  const first=context.messages.find(message=>message.role==='user'),text=typeof first.content==='string'?first.content:first.content.filter(item=>item.type==='text').map(item=>item.text).join(''),body=JSON.parse(text.split('\n')[1]),role=text.match(/assigned (\w+) task/)[1];
  const notes=[...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/g)].map(match=>({metadata:JSON.parse(match[1]),text:match[2]})).find(source=>source.metadata.side==='candidate'&&source.metadata.path==='notes.md')?.text;
  const fixed=typeof notes==='string'&&notes.startsWith('hello $& $$\n');
  const stream=createAssistantMessageEventStream();
  (async()=>{
   const message=await original(model,context).result();
   if(role==='repairer'&&message.content[0]?.type==='toolCall'){
    assert.equal(typeof notes,'string','Actual supplied current notes required before repair');const offset=notes.indexOf('helo');assert.ok(offset>=0);assert.equal(notes.lastIndexOf('helo'),offset);
    message.content[0].arguments={path:'notes.md',content:notes.slice(0,offset)+'hello $& $$'+notes.slice(offset+4)};
   }
   if(message.content[0]?.type==='text'){
    const result=JSON.parse(message.content[0].text);
    if(role==='planner'){
     const check=result.plan.verification.checks[0];check.fixturePaths.push('notes.md');check.cases.forEach(declaration=>declaration.consumerPaths.push('notes.md'));result.plan.verification.requiredPaths.push('notes.md');result.plan.verification.reviewRoles[0].requiredPaths.push('notes.md');
    }
    if(role==='reviewer'){
     assert.equal(typeof notes,'string','Actual supplied current notes required for review');result.outcome=fixed?'clear':'findings';result.findings=fixed?[]:[{requirementId:'R1',severity:'blocking',repair:'mechanical',description:'Correct exact note typo preserving executable fenced code',evidence:['candidate:notes.md'],mechanicalPatch:{path:'notes.md',oldText:'helo',newText:'hello $& $$'}}];
    }
    if(role==='adjudicator'&&body.context.stage==='review-adjudication')result.decisions=body.context.occurrences.map(occurrence=>({occurrenceId:occurrence.id,disposition:'upheld',...(fixed?{resolution:'repaired'}:{}),reason:fixed?'Actual current notes contain the exact literal repair; current paired extractor cases and a distinct fresh review establish closure':'Actual current notes still contain the exact typo; retain its raw finding pending ordinary repair',witnesses:fixed?body.context.checks.filter(check=>check.status==='pass'&&check.candidate===body.context.candidateVersion).map(check=>check.id):['candidate:notes.md']}));
    message.content[0].text=JSON.stringify(result);
   }
   stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
  })().catch(error=>{stream.push({type:'error',reason:'error',error});stream.end();});return stream;
 }}};
}
export async function prepareTypedNitFixture(prefix){
 const runtimeProfile={...runtimeFixtureProfile(),dockerConfigDirectory:runtimeFixtureConfig()};await validateRuntimeProfile(runtimeProfile);
 const parent=process.env.GITJIG_RUNTIME_FIXTURE_ROOT??path.resolve('.runtime-fixtures');assert.ok(path.isAbsolute(parent));await fs.mkdir(parent,{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.join(parent,prefix))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'notes.md'),'helo\n```js\nreturn 3;\n```\n');await fs.writeFile(path.join(source,'check.cjs'),"const note=require('fs').readFileSync('notes.md','utf8');const fence=note.match(/```js\\n([\\s\\S]*?)```/)[1];"+correct.replace("passed:require('./consumer.cjs')===3","passed:require('./consumer.cjs')===3&&fence==='return 3;\\n'"));process.env.TMPDIR=path.join(home,'artifacts');return{root,home,source,runtimeProfile};
}
export async function assertTypedNitEvidence(c,view){
 assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));assert.equal(view.resolution.consumed,6);assert.equal(view.resolution.reserved,0);assert.equal(view.execution.reserved,0);assert.equal(view.launches.filter(launch=>launch.role==='confirmer').length,0);assert.equal(view.launches.filter(launch=>launch.role==='repairer').length,1);
 const reviews=view.launches.filter(launch=>launch.role==='reviewer');assert.equal(reviews.length,2);assert.notEqual(reviews[0].data.inputVersions.candidate,reviews[1].data.inputVersions.candidate);
 const passed=view.checks.filter(check=>check.status==='pass');assert.equal(passed.length,2);assert.notEqual(passed[0].candidate,passed[1].candidate);assert.notEqual(passed[0].data.caseDescriptor.cases[0].inputDigest,passed[1].data.caseDescriptor.cases[0].inputDigest);assert.ok(passed.every(check=>check.data.caseResults.complete));
 const current=view.versions.find(version=>version.id===view.candidateVersion);assert.match(await fs.readFile(path.join(current.artifact,'notes.md'),'utf8'),/^hello \$& \$\$/);
 const evidence=await c.changeCore.currentEvidence(view.workId);assert.equal(evidence.versions.candidate,view.candidateVersion);assert.ok(evidence.checkIds.includes(passed[1].id));assert.equal(evidence.checkIds.includes(passed[0].id),false);assert.equal(c.store.one("SELECT COUNT(*) n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);
}
