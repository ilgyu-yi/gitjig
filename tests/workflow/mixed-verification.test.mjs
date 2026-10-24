import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseRoleOutput,parseCheckOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {verificationReviewRequirements,requirementSourceIds} from '../../dist/workflow/role-input.js';
import {verificationCommandContract,buildCaseDescriptor} from '../../dist/workflow/verification-contract.js';
import {coverageIssue,compareCases} from '../../dist/controller/check-cases.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
const parsed=plan=>parseRoleOutput(JSON.stringify({...common,plan}),'planner');
test('closed exhaustive mixed strategies preserve behavior cases and never fall back to legacy on present invalid declarations',()=>{
 const plan=mixedPlan();assert.ok(parsed(plan).value);assert.equal(coverageIssue(plan),null);
 for(const mutate of [p=>p.verification.strategies=null,p=>p.verification.strategies.push(p.verification.strategies[0]),p=>p.verification.strategies[1].kind='qualitative-waiver',p=>delete p.verification.strategies[1].caseIds,p=>p.verification.strategies[2].authorApproved=true]){const p=structuredClone(plan);mutate(p);assert.equal(parsed(p).value,null,JSON.stringify(p.verification.strategies));}
 const undefinedValue=mixedPlan();undefinedValue.verification.strategies=undefined;assert.match(coverageIssue(undefinedValue),/every requirement/);
 const legacy=mixedPlan();delete legacy.verification.strategies;assert.match(coverageIssue(legacy),/baseline lacks healthy/);
 for(const mutate of [p=>p.verification.strategies[0].checkIds=['base-check'],p=>p.verification.checks[0].cases.pop(),p=>p.verification.strategies[1].caseIds=['invented'],p=>p.verification.strategies[1].reviewKey='missing',p=>p.verification.strategies[2].unchangedPaths.push('consumer.cjs')]){const p=mixedPlan();mutate(p);assert.notEqual(coverageIssue(p),null);}
});
test('producer schema and strict parser share required per-kind operands and exact retained source identities',()=>{
 const schema=roleOutputSchema('planner','planning',[],{sourceIds:['actual-owner','owner-request']});assert.deepEqual(schema.properties.plan.properties.requirements.items.properties.source.enum,['actual-owner','owner-request']);
 const branches=schema.properties.plan.properties.verification.properties.strategies.items.anyOf;
 assert.deepEqual(branches.find(x=>x.properties.kind.const==='base-execution-duty').required,['requirementId','kind','checkId','caseIds','reviewKey']);assert.deepEqual(branches.find(x=>x.properties.kind.const==='manifest-scope-duty').required,['requirementId','kind','allowedChangePaths','unchangedPaths','reviewKey']);
 const p=mixedPlan();p.requirements[0].source='owner-request; base:file';assert.equal(parseRoleOutput(JSON.stringify({...common,plan:p}),'planner',[],{sourceIds:['owner-request']}).value,null);
 assert.throws(()=>requirementSourceIds({requirementSourceIds:null}),/unavailable/);assert.deepEqual(requirementSourceIds({requirementSourceIds:['owner-request']}),['owner-request']);
});
test('context-required independent fit decisions bind exact strategy/witnesses without choosing a semantic verdict',()=>{
 const fit=[{requirementId:'scope',strategyDigest:'a'.repeat(64),witnessIds:['actual-scope-record']}];
 const context={stage:'fresh-review',verificationReviewRequirements:fit};assert.deepEqual(verificationReviewRequirements('reviewer',context),fit);assert.throws(()=>verificationReviewRequirements('reviewer',{...context,verificationReviewRequirements:null}),/unavailable/);
 const schema=roleOutputSchema('reviewer','fresh-review',[],{verificationFit:fit});assert.ok(schema.required.includes('verificationDecisions'));assert.equal(schema.properties.verificationDecisions.minItems,1);assert.deepEqual(schema.properties.verificationDecisions.items.anyOf[0].properties.witnessIds.items.enum,['actual-scope-record']);
 const decision={...fit[0],verdict:'satisfied',reason:'Independently checked the actual complete comparison against owner intent'};assert.ok(parseRoleOutput(JSON.stringify({...common,verificationDecisions:[decision]}),'reviewer',[],{verificationFit:fit}).value);
 for(const output of [common,{...common,verificationDecisions:[]},{...common,verificationDecisions:[{...decision,witnessIds:['forged']}]},{...common,verificationDecisions:[{...decision,strategyDigest:'b'.repeat(64)}]}])assert.equal(parseRoleOutput(JSON.stringify(output),'reviewer',[],{verificationFit:fit}).value,null);
 assert.ok(parseRoleOutput(JSON.stringify({...common,verificationDecisions:[{...decision,verdict:'unavailable',witnessIds:[],reason:'Source evidence incomplete'}]}),'reviewer',[],{verificationFit:fit}).value);
});
test('actual shared descriptor reaches an owned Node consumer and strict CheckOutput parser with exact observations',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-mixed-contract-')));let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root)});
 await fs.writeFile(path.join(root,'consumer.cjs'),"module.exports=value=>{if(typeof value!=='number')throw new TypeError('invalid');return value+1};\n");
 const check=mixedPlan().verification.checks[0];const consumerBytes=await fs.readFile(path.join(root,'consumer.cjs')),sourceHash=createHash('sha256').update(consumerBytes).digest('hex');const descriptor=buildCaseDescriptor(check,{hash:createHash('sha256').update(JSON.stringify({files:[{path:'consumer.cjs',sha256:sourceHash,executable:0}],directories:[]})).digest('hex'),data:{manifest:{files:[{path:'consumer.cjs',sha256:sourceHash,effectiveMode:0o600}]}}},{base:'B',candidate:'C',verification:'V'},'actual-run');
 await fs.writeFile(path.join(root,'descriptor.json'),JSON.stringify(descriptor));assert.equal(verificationCommandContract.descriptor.caseFields[0],'declaration');
 const program="const fs=require('fs'),consume=require('./consumer.cjs'),d=JSON.parse(fs.readFileSync('descriptor.json','utf8'));const cases=d.cases.map(c=>{let observed;try{observed={kind:'return',value:String(consume(JSON.parse(c.declaration.input.literalUtf8)))}}catch(e){observed={kind:'rejection',value:e.constructor.name}}return{id:c.id,inputDigest:c.inputDigest,observed}});console.log(JSON.stringify({version:1,assertions:[{id:'actual-consumer',passed:true}],cases}));";
 const {stdout}=await promisify(execFile)(process.execPath,['-e',program],{cwd:root});const output=parseCheckOutput(stdout);assert.ok(output.value,output.issues.join());assert.equal(compareCases(check,descriptor,output.value).complete,true);assert.deepEqual(compareCases(check,descriptor,output.value).mismatches,[]);
 assert.equal(parseCheckOutput(JSON.stringify({...output.value,acceptanceSha256:'not-admitted'})).value,null);const bad=structuredClone(output.value);bad.cases[0].passed=true;assert.equal(parseCheckOutput(JSON.stringify(bad)).value,null);passed=true;
});

test('descriptor captures declarations and tuple bytes before later caller mutation',()=>{
 const check=mixedPlan().verification.checks[0],versions={candidate:'original-C',verification:'original-V'};const descriptor=buildCaseDescriptor(check,{hash:'original-hash',data:{manifest:{files:[{path:'consumer.cjs',sha256:'a'.repeat(64),effectiveMode:0o600}]}}},versions,'original-run');const expected=JSON.stringify(descriptor);check.cases[0].input.literalUtf8='forged';versions.candidate='foreign-C';assert.equal(JSON.stringify(descriptor),expected);assert.equal(Object.isFrozen(verificationCommandContract.descriptor.caseFields),true);
});

test('current supported planning requires accounting on acceptance and preserves a valid unavailable proposal/negative decision',()=>{
 const constraints={planningProfile:initialVerificationProfile},plan=mixedPlan();const planner=roleOutputSchema('planner','planning',[],constraints);assert.ok(planner.properties.plan.properties.verification.required.includes('strategies'));
 const judge=roleOutputSchema('adjudicator','planning-adjudication',[],constraints);assert.ok(judge.anyOf.find(branch=>branch.properties.planAccepted.const===true).required.includes('acceptedPlan'));assert.equal(judge.anyOf.find(branch=>branch.properties.planAccepted.const===false).required.includes('acceptedPlan'),false);
 const missing=structuredClone(plan);delete missing.verification.strategies;assert.equal(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],constraints).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner').value,'Historical three-argument structural parsing does not migrate old plans');
 const incomplete=structuredClone(plan);incomplete.verification.strategies=[];const finding={requirementId:'baseline',severity:'blocking',repair:'unknown',description:'This necessary oracle cannot be represented by the supported finite profile',evidence:['Actual retained owner source and bounded profile']};assert.ok(parseRoleOutput(JSON.stringify({...common,findings:[finding],plan:incomplete}),'planner',[],constraints).value);assert.notEqual(coverageIssue(incomplete),null);assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:true,acceptedPlan:incomplete}),'adjudicator',[],constraints).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,findings:[finding],decisions:[],planAccepted:false}),'adjudicator',[],constraints).value);
 const unavailable={planningProfile:{version:1,supported:false,allowedKinds:[],baseline:{newObservation:false,crossPlanReuse:false,priorDuty:false},reason:'Inherited original editing history unavailable'}};assert.equal(roleOutputSchema('planner','planning',[],unavailable).properties.plan.properties.verification.properties.strategies,undefined);assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],unavailable).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,plan:missing}),'planner',[],unavailable).value);
});

test('persistent typed replanning advertises only current consumer/scope kinds and cannot manufacture a later baseline event',()=>{
 const profile={version:1,supported:true,allowedKinds:['consumer-cases','manifest-scope-duty'],baseline:{newObservation:false,crossPlanReuse:false,priorDuty:false}},constraints={planningProfile:profile};
 const schema=roleOutputSchema('planner','planning',[],constraints),kinds=schema.properties.plan.properties.verification.properties.strategies.items.anyOf.map(branch=>branch.properties.kind.const);assert.deepEqual(kinds,profile.allowedKinds);
 const plan=mixedPlan();assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],constraints).value,null);plan.requirements=plan.requirements.filter(r=>r.id!=='baseline');plan.verification.strategies=plan.verification.strategies.filter(r=>r.kind!=='base-execution-duty');plan.verification.checks=plan.verification.checks.filter(r=>r.id!=='base-check');assert.ok(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],constraints).value);
 const historicalDuty={planningProfile:{...profile,baseline:{...profile.baseline,priorDuty:true}}};const judge=roleOutputSchema('adjudicator','planning-adjudication',[],historicalDuty);assert.equal(judge.properties.planAccepted.const,false);assert.equal(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:true,acceptedPlan:plan}),'adjudicator',[],historicalDuty).value,null);assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:false}),'adjudicator',[],historicalDuty).value);
});


test('the actual second-cycle controlled producer retains matching strategy references when renaming a check',async()=>{
 const {cycleModel}=await import('../controller/repeated-merge-fixture.mjs'),model=cycleModel(4),body={requiredScope:[],context:{stage:'planning',ownerSource:'owner-request',planningVerificationProfile:initialVerificationProfile}},context={messages:[{role:'user',content:[{type:'text',text:'Perform the assigned planner task\n'+JSON.stringify(body)}]}]};
 const message=await model.definition.streamSimple({api:'owned-fixture',provider:'owned-fixture',id:'owned-fixture'},context).result(),output=parseRoleOutput(message.content.find(part=>part.type==='text').text,'planner',[],{planningProfile:initialVerificationProfile});assert.ok(output.value,output.issues.join());const plan=output.value.plan;assert.deepEqual(plan.verification.checks.map(check=>check.id),['value4']);assert.deepEqual(plan.verification.strategies,[{requirementId:'R1',kind:'consumer-cases',checkIds:['value4']}]);assert.equal(coverageIssue(plan),null);
});
