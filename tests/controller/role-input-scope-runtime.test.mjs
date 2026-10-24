// ROOT-ONLY engine fixture; author prepares but does not execute this native public consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const runtimeProfile={dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
const finding=n=>({requirementId:'R1',severity:'blocking',repair:'substantive',description:'Fixture baseline defect '+n,evidence:['base:consumer.cjs exports2 rather than3']});
function assertScope(actual,body,c,role){
 assert.equal(actual.role,role);assert.equal(actual.stage,body.context.stage);assert.equal(actual.workId,c.inspectChange(actual.workId).workId);
 assert.deepEqual(actual.occurrenceIds,body.context.occurrences.map(o=>o.id));assert.deepEqual(actual.findingBodyOmittedIds,body.context.occurrences.filter(o=>o.findingBodyOmitted===true).map(o=>o.id));assert.deepEqual(actual.findingBodySuppliedIds,body.context.occurrences.filter(o=>Object.hasOwn(o.data,'finding')).map(o=>o.id));
 assert.deepEqual(actual.selectedSources,body.sources.map(({id,version,side,path,sha256})=>({id,version,side,path,sha256})));assert.deepEqual(actual.promptIncludedSourceIds,body.sources.filter(s=>s.exposeInPrompt).map(s=>s.id));
 const launch=c.store.one('SELECT * FROM role_launches WHERE id=?',actual.launchId),output=c.store.one('SELECT * FROM role_outputs WHERE id=?',actual.outputId),stored=JSON.parse(launch.data).inputScope;
 assert.equal(launch.work,actual.workId);assert.equal(launch.run,actual.runId);assert.equal(launch.status,'COMPLETE');assert.equal(output.launch,actual.launchId);assert.equal(output.status,'usable');assert.equal('outputId'in stored,false);const{outputId,...snapshot}=actual;assert.deepEqual(stored,snapshot);
}
test('public native planning preserves P14 omitted8 → C15 full → J17 full input scopes without forcing acceptance',{timeout:60000},async()=>{
 assert.ok(runtimeProfile.dockerContext&&runtimeProfile.image,'Explicit owned engine runtime required; unavailable is not a pass');
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/role-input-scope-'))),home=path.join(root,'home'),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n"));process.env.TMPDIR=path.join(home,'artifacts');let c,mode='seed8',pBody,cBody,pScope,cScope,jBody,passed=false;const calls=[];
 try{
  c=await openController({installationHome:home,runtimeProfile});await c.registerProject({id:'P',sourceRoot:source});const begun=await c.beginChange({projectId:'P',request:'Consumer exports3; input census is host metadata, not model acceptance',executionLimit:32,resolutionLimit:12}),workId=begun.workId;
  const model=scripted(undefined,({role,body,result})=>{
   calls.push({mode,role});
   if(mode==='seed8'&&role==='planner'){result.findings=Array.from({length:8},(_,i)=>finding('unusable-'+i));result.unexpectedField='Fixture deliberately unusable; preserve eight raw findings';}
   else if(mode==='seed6'&&role==='planner')result.findings=Array.from({length:6},(_,i)=>finding('usable-'+i));
   else if(mode==='seed6'&&role==='challenger')result.unexpectedField='Fixture stops prefix after six usable producer findings';
   else if(mode==='observe'&&role==='planner'){
    pBody=structuredClone(body);assert.equal(body.context.occurrences.length,14);assert.equal(body.context.occurrences.filter(o=>o.findingBodyOmitted).length,8);assert.equal(body.context.plannerInputScope,undefined);result.findings=[finding('current-P')];result.summary='Worker claims zero prior occurrences; host receipt must not copy this claim';
   }else if(mode==='observe'&&role==='challenger'){
    cBody=structuredClone(body);assert.equal(body.context.occurrences.length,15);assert.equal(body.context.occurrences.filter(o=>o.findingBodyOmitted).length,0);pScope=structuredClone(body.context.plannerInputScope);assertScope(pScope,pBody,c,'planner');result.findings=[finding('current-C1'),finding('current-C2')];
   }else if(mode==='observe'&&role==='adjudicator'){
    jBody=structuredClone(body);assert.equal(body.context.occurrences.length,17);assert.equal(body.context.occurrences.filter(o=>o.findingBodyOmitted).length,0);assert.deepEqual(body.context.plannerInputScope,pScope);cScope=structuredClone(body.context.challengerInputScope);assertScope(cScope,cBody,c,'challenger');assertScope(body.context.plannerInputScope,pBody,c,'planner');result.planAccepted=false;delete result.acceptedPlan;result.decisions=[];result.summary='Independent negative fixture; metadata does not force acceptance';
   }
  });
  const seed8=await c.planChange({workId,model});assert.equal(seed8.occurrences.length,8);assert.equal(seed8.planVersion,null);
  mode='seed6';const seed14=await c.driveChange({workId,model,maximumSteps:1});assert.equal(seed14.occurrences.length,14);assert.equal(seed14.planVersion,null);const oldOccurrences=c.store.all('SELECT * FROM finding_occurrences WHERE work=? ORDER BY id',workId),oldOutputs=c.store.all('SELECT o.* FROM role_outputs o JOIN role_launches l ON l.id=o.launch WHERE l.work=? ORDER BY o.id',workId);
  mode='observe';const after=await c.driveChange({workId,model,maximumSteps:1});assert.equal(after.phase,'BLOCKED');assert.equal(after.occurrences.length,17);assert.equal(after.planVersion,null);assert.equal(after.candidateVersion,null);assert.match(after.blocked.join(),/Planning decision unresolved/);assert.ok(pBody&&cBody&&jBody&&pScope&&cScope);
  for(const old of oldOccurrences)assert.deepEqual(c.store.one('SELECT * FROM finding_occurrences WHERE id=?',old.id),old);for(const old of oldOutputs)assert.deepEqual(c.store.one('SELECT * FROM role_outputs WHERE id=?',old.id),old);
  assert.deepEqual(calls.filter(x=>x.mode==='observe').map(x=>x.role),['planner','challenger','adjudicator']);assert.equal(after.execution.reserved,0);assert.equal(after.resolution.reserved,0);
  const file=path.join(root,'input-scope-evidence.json');await fs.writeFile(file,JSON.stringify({complete:true,scope:'DUMMY no-network native public engine fixture, no learned judgment',root,home,workId,publicNegativeJudgmentPreserved:true,after:{phase:after.phase,planVersion:after.planVersion,candidateVersion:after.candidateVersion,execution:after.execution,resolution:after.resolution},oldOccurrences:oldOccurrences.map(o=>({id:o.id,dataSha256:sha(o.data)})),oldOutputs:oldOutputs.map(o=>({id:o.id,status:o.status,rawSha256:sha(o.raw??'')})),plannerScope:pScope,challengerScope:cScope,actualInputCensuses:[{stage:'P',count:pBody.context.occurrences.length,omitted:pScope.findingBodyOmittedIds.length},{stage:'C',count:cBody.context.occurrences.length,omitted:cScope.findingBodyOmittedIds.length},{stage:'J',count:jBody.context.occurrences.length,omitted:0}],calls},null,2)+'\n',{mode:0o600,flag:'wx'});passed=true;console.log('RETAINED_INPUT_SCOPE_EVIDENCE '+file);
 }finally{await c?.close();console.log('RETAINED_INPUT_SCOPE_WORLD '+root+' complete='+passed);}
});
