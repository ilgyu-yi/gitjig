import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseRoleOutput,assertApprovedProposal} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {coverageIssue,verificationReferenceDiagnostics} from '../../dist/controller/check-cases.js';
import {hasCompleteStrategyAccounting} from '../../dist/workflow/verification-strategy.js';
import Ajv2020 from 'ajv/dist/2020.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
const profile={...initialVerificationProfile,version:6};
const wire=plan=>{const {requirements,...rest}=structuredClone(plan);return {...rest,verificationRequirements:requirements};};
const output=(role,plan)=>role==='planner'?{...common,plan}:{...common,decisions:[],planAccepted:true,acceptedPlan:plan};
test('complete strategy membership is distinct from coverage and preserves historical planner decoding',()=>{
 const plan=mixedPlan();plan.verification.checks[0].cases=[];
 assert.equal(hasCompleteStrategyAccounting(plan),true);assert.match(coverageIssue(plan),/lacks healthy actual consumer case/);
 const raw=JSON.stringify(output('planner',wire(plan)));
 assert.ok(parseRoleOutput(raw,'planner',[],{planningProfile:{...profile,version:8}}).value,'Original captured planner decoding does not apply fresh adapter admission');
 const incomplete=structuredClone(plan);incomplete.verification.strategies.pop();assert.equal(hasCompleteStrategyAccounting(incomplete),false);
 const reversed=structuredClone(plan);reversed.verification.strategies.reverse();assert.equal(hasCompleteStrategyAccounting(reversed),true);
 const foreign=structuredClone(plan);foreign.verification.strategies[0].requirementId='unowned';assert.equal(hasCompleteStrategyAccounting(foreign),false);
});
for(const version of [6,7,8])for(const role of ['planner','adjudicator'])test('grammar'+version+' '+role+' distinguishes missing declarations from forbidden wire aliases',()=>{
 const constraints={planningProfile:{...profile,version}},field=role==='planner'?'plan':'acceptedPlan';
 const healthy=output(role,wire(mixedPlan()));assert.ok(parseRoleOutput(JSON.stringify(healthy),role,[],constraints).value);
 for(const variant of ['missing','canonical-only','both']){
  const candidate=structuredClone(healthy),proposal=candidate[field];
  if(variant!=='missing')proposal.requirements=proposal.verificationRequirements;
  if(variant!=='both')delete proposal.verificationRequirements;
  const raw=JSON.stringify(candidate),result=parseRoleOutput(raw,role,[],constraints);
  assert.equal(result.value,null,'References in strategies cannot supply the omitted requirement declarations');
  const issue=result.issues.join();
  if(variant==='missing'){
   assert.ok(issue.includes('missing '+field+'.verificationRequirements'));
   assert.match(issue,/nonempty list.*id, text, source/);assert.match(issue,/before referencing requirement IDs/);
   assert.doesNotMatch(issue,/alias|forbids/,'A missing list does not mean the producer used an alias');
  }else assert.ok(issue.includes('forbids '+field+'.requirements on the wire'));
  assert.equal(JSON.stringify(candidate),raw,'Diagnostic feedback never fills or rewrites the producer data');
 }
 assert.equal(parseRoleOutput('```json\n'+JSON.stringify(healthy)+'\n```',role,[],constraints).value,null,'Historical fence rules are unchanged');
});
for(const role of ['planner','adjudicator'])for(const supported of [false,true])test('grammar8 '+role+' advertises existing supplied-plan minima, supported='+supported,()=>{
 const current={...profile,version:8,supported,allowedKinds:supported?profile.allowedKinds:[],...(!supported?{reason:'Current capability unavailable'}:{})};
 const constraints={planningProfile:current},stage=role==='planner'?'planning':'planning-adjudication';
 const schema=roleOutputSchema(role,stage,[],constraints),validate=new Ajv2020({strict:false}).compile(schema);
 const proposal=mixedPlan();if(!supported)delete proposal.verification.strategies;
 const healthy=output(role,wire(proposal));if(!supported&&role==='adjudicator')healthy.planAccepted=false;
 assert.ok(validate(healthy),JSON.stringify(validate.errors));
 assert.ok(parseRoleOutput(JSON.stringify(healthy),role,[],constraints).value);
 for(const empty of ['verificationRequirements','reviewRoles']){
  const invalid=structuredClone(healthy),plan=invalid[role==='planner'?'plan':'acceptedPlan'];
  if(empty==='verificationRequirements')plan.verificationRequirements=[];else plan.verification.reviewRoles=[];
  assert.equal(validate(invalid),false,'The advertised schema must reject an empty '+empty);
  assert.equal(parseRoleOutput(JSON.stringify(invalid),role,[],constraints).value,null,'The host still rejects the same invalid plan');
 }
 if(role==='adjudicator'){
  const refusal={...common,decisions:[],planAccepted:false};
  assert.ok(validate(refusal),JSON.stringify(validate.errors));assert.ok(parseRoleOutput(JSON.stringify(refusal),role,[],constraints).value);
 }
 const prior=roleOutputSchema(role,stage,[],{planningProfile:{...current,version:7}}).properties[role==='planner'?'plan':'acceptedPlan'];
 assert.equal(prior.properties.verificationRequirements.minItems,undefined);assert.equal(prior.properties.verification.properties.reviewRoles.minItems,undefined);
});
test('grammar8 preserves incomplete planner evidence and exact canonical unchanged approval',()=>{
 const current={...profile,version:8},proposal=mixedPlan();proposal.verification.strategies.pop();
 const incomplete={...output('planner',wire(proposal)),findings:[{requirementId:'scope',severity:'blocking',repair:'unknown',description:'Scope strategy still needs independent correction',evidence:[]}]};
 assert.ok(new Ajv2020({strict:false}).compile(roleOutputSchema('planner','planning',[],{planningProfile:current}))(incomplete));
 assert.ok(parseRoleOutput(JSON.stringify(incomplete),'planner',[],{planningProfile:current}).value);
 incomplete.findings=[];assert.equal(parseRoleOutput(JSON.stringify(incomplete),'planner',[],{planningProfile:current}).value,null);
 const complete=mixedPlan(),approval={version:1,plannerOutputId:'original',proposalHash:createHash('sha256').update(JSON.stringify(complete)).digest('hex'),plannerOutputHash:'b'.repeat(64),proposal:complete};
 const constraints={planningProfile:current,proposalApproval:approval},answer={...common,decisions:[],planAccepted:true};
 assert.ok(new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','planning-adjudication',[],constraints))(answer));
 assert.ok(parseRoleOutput(JSON.stringify(answer),'adjudicator',[],constraints).value);
});
for(const role of ['planner','adjudicator'])test('grammar6 '+role+' wire identifies verification requirements and preserves canonical owner/source data',()=>{
 const plan=mixedPlan(),encoded=output(role,wire(plan)),raw=JSON.stringify(encoded);
 const schema=roleOutputSchema(role,role==='planner'?'planning':'planning-adjudication',[],{planningProfile:profile});
 const shape=schema.properties[role==='planner'?'plan':'acceptedPlan'];
 assert.equal(JSON.stringify(schema).includes('this plan.requirements'),false,'Every final constrained strategy/conditional uses the captured wire domain');
 assert.ok(shape.required.includes('verificationRequirements'));assert.equal(shape.properties.requirements,undefined);
 assert.match(shape.properties.verificationRequirements.description,/before-first-edit BASE/);assert.match(shape.properties.verificationRequirements.description,/every original owner obligation/);
 const parsed=parseRoleOutput(raw,role,[],{planningProfile:profile});assert.ok(parsed.value,parsed.issues.join());assert.deepEqual(parsed.value[role==='planner'?'plan':'acceptedPlan'],plan);assert.equal(JSON.stringify(encoded),raw,'Literal original wire is not rewritten');
 for(const invalid of [plan,{...wire(plan),requirements:plan.requirements},(()=>{const p=wire(plan);delete p.verificationRequirements;return p;})()])assert.equal(parseRoleOutput(JSON.stringify(output(role,invalid)),role,[],{planningProfile:profile}).value,null);
 assert.equal(parseRoleOutput(raw,role,[],{planningProfile:{...profile,version:5}}).value,null,'A new name cannot reinterpret a historical capture');
 assert.ok(parseRoleOutput(JSON.stringify(output(role,plan)),role,[],{planningProfile:{...profile,version:5}}).value);
 const expectedBase=structuredClone(plan);expectedBase.verification.checks[1].baselineExpectedFailures=['concrete-subject-defect'];assert.ok(parseRoleOutput(JSON.stringify(output(role,wire(expectedBase))),role,[],{planningProfile:profile}).value,'Genuine BASE duties and actual expected assertion states remain representable');
});
test('bound approval still validates the canonical exact proposal under grammar6',()=>{
 const proposal=mixedPlan(),approval={version:1,plannerOutputId:'original',proposalHash:createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),plannerOutputHash:'b'.repeat(64),proposal};
 assert.doesNotThrow(()=>assertApprovedProposal(approval,{planningProfile:profile}));
 assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:true}),'adjudicator',[],{planningProfile:profile,proposalApproval:approval}).value);
 assert.throws(()=>assertApprovedProposal({...approval,proposal:wire(mixedPlan())},{planningProfile:profile}),'Wire-to-canonical decoding is not applied twice');
});
test('finite planning reports malformed role and plan wire shapes together',()=>{
 const proposal=mixedPlan(),approval={version:1,plannerOutputId:'original',proposalHash:createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),plannerOutputHash:'b'.repeat(64),proposal};
 const constraints={planningProfile:profile,proposalApproval:approval};
 const {version,...answer}={...common,decisions:[],planAccepted:true};
 const raw=JSON.stringify({...answer,acceptedPlan:{}});
 const rejected=parseRoleOutput(raw,'adjudicator',[],constraints);
 assert.equal(rejected.value,null);
 assert.equal(rejected.issues.length,2);
 assert.match(rejected.issues[0],/RoleOutput:.*missing \["version"\]/);
 assert.match(rejected.issues[1],/acceptedPlan is empty.*Omit acceptedPlan/);
 assert.ok(parseRoleOutput(JSON.stringify({version,...answer}),'adjudicator',[],constraints).value);
 const foreign=parseRoleOutput(JSON.stringify({...common,alternatives:[],acceptedPlan:{}}),'challenger',[],{planningProfile:profile});
 assert.equal(foreign.issues.length,1);
 assert.match(foreign.issues[0],/unexpected \["acceptedPlan"\]/);
 assert.doesNotMatch(foreign.issues[0],/Omit acceptedPlan|verificationRequirements/);
 const duplicate=parseRoleOutput(raw.slice(0,-1)+',"acceptedPlan":{}}','adjudicator',[],constraints);
 assert.equal(duplicate.issues.length,1);
 assert.match(duplicate.issues[0],/duplicate/i);
 assert.doesNotMatch(duplicate.issues[0],/Omit acceptedPlan/);
});
test('a well-formed incomplete proposal still needs independent correction; syntax does not manufacture coverage',()=>{
 const plan=mixedPlan();plan.verification.checks[0].cases=[];
 assert.ok(parseRoleOutput(JSON.stringify(output('planner',wire(plan))),'planner',[],{planningProfile:profile}).value);
 assert.match(coverageIssue(plan),/lacks healthy/);
 assert.ok(parseRoleOutput(JSON.stringify({...common,decisions:[],planAccepted:false}),'adjudicator',[],{planningProfile:profile}).value);
});
test('exact case/check reference mismatch remains a source-bound observation, not a repaired declaration',()=>{
 const plan=mixedPlan();plan.requirements.push({id:'type-guard',text:'Reject non-string input',source:'owner-request'});
 plan.verification.strategies.push({requirementId:'type-guard',kind:'consumer-cases',checkIds:['behavior-check']});
 plan.verification.checks[0].cases[1].guaranteeIds.push('type-guard');
 const before=structuredClone(plan),detail=verificationReferenceDiagnostics(plan);
 const problem=detail.problems.find(row=>row.kind==='case-requirement-not-in-check');
 assert.equal(problem.pointer,'/verification/checks/0/cases/1/guaranteeIds/1');assert.equal(problem.caseId.value,'invalid');assert.equal(problem.checkId.value,'behavior-check');assert.equal(problem.reference.value,'type-guard');assert.equal(problem.reference.omittedCodeUnits,0);
 assert.ok(detail.problems.some(row=>row.kind==='strategy-check-requirement-missing'));
 assert.match(coverageIssue(plan),/\/verification\/checks\/0\/cases\/1\/guaranteeIds\/1.*type-guard.*behavior-check.*invalid/);
 assert.ok(parseRoleOutput(JSON.stringify(output('planner',wire(plan))),'planner',[],{planningProfile:profile}).value,'No unimplemented in-query semantic validation callback is implied');assert.deepEqual(plan,before);
 plan.verification.checks[0].cases[1].guaranteeIds=['not-declared'];assert.ok(verificationReferenceDiagnostics(plan).problems.some(row=>row.kind==='case-requirement-undeclared'));
});
test('BASE/candidate strategy phase conflicts and required reviewer/case links expose exact locations',()=>{
 const plan=mixedPlan();plan.verification.strategies[1].checkId='behavior-check';plan.verification.strategies[1].caseIds=['missing-case'];plan.verification.strategies[1].reviewKey='missing-review';
 const detail=verificationReferenceDiagnostics(plan);assert.ok(detail.problems.some(row=>row.kind==='base-candidate-check-conflict'&&row.pointer==='/verification/strategies/0/checkIds/0'));assert.ok(detail.problems.some(row=>row.kind==='baseline-case-undeclared'&&row.reference.value==='missing-case'));assert.ok(detail.problems.some(row=>row.kind==='strategy-reviewer-undeclared'&&row.pointer==='/verification/strategies/1/reviewKey'));
});
test('reference detail is bounded with honest omissions and canonical pointers for exact original values',()=>{
 const plan=mixedPlan();for(const item of plan.verification.checks[0].cases)item.guaranteeIds=Array.from({length:30},(_,n)=>'unknown-'+n+'界'.repeat(200));
 const detail=verificationReferenceDiagnostics(plan,1200);assert.ok(Buffer.byteLength(JSON.stringify(detail))<=1200);assert.ok(detail.omittedProblems>0);assert.ok(detail.problems.every(row=>row.reference.omittedCodeUnits>0));assert.equal(detail.pointerDomain,'canonical-plan');assert.equal(detail.problems.length+detail.omittedProblems,62,'Sixty bad references and both missing actual consumer kinds');assert.equal(verificationReferenceDiagnostics(mixedPlan()),undefined);
});
test('one bounded roster names every missing actual consumer duty without imposing cases on BASE or manifest duties',()=>{
 const plan=mixedPlan();plan.verification.checks[0].cases=plan.verification.checks[0].cases.filter(row=>row.kind==='healthy');
 plan.requirements.push({id:'custom-field',text:'Group by the explicitly selected field',source:'owner-request'});
 plan.verification.strategies.push({requirementId:'custom-field',kind:'consumer-cases',checkIds:['behavior-check']});
 plan.verification.checks[0].guaranteeIds.push('custom-field');plan.verification.checks[0].cases[0].guaranteeIds.push('custom-field');
 const consumer=plan.verification.strategies[0];
 plan.verification.strategies[0]={requirementId:consumer.requirementId,kind:'all-of',parts:[{kind:'consumer-cases',checkIds:consumer.checkIds},{kind:'manifest-scope-duty',allowedChangePaths:['consumer.cjs'],unchangedPaths:[],reviewKey:'review'}]};
 const unrelated=structuredClone(plan.verification.checks[0]);unrelated.id='unselected';unrelated.cases=[{...structuredClone(unrelated.cases[0]),id:'unselected-adverse',kind:'adverse'}];plan.verification.checks.push(unrelated);
 const before=structuredClone(plan),detail=verificationReferenceDiagnostics(plan);
 assert.deepEqual(detail.problems.map(row=>[row.kind,row.reference.value,row.pointer]),[
  ['consumer-case-adverse-missing','behavior','/verification/strategies/0/parts/0'],
  ['consumer-case-adverse-missing','custom-field','/verification/strategies/3']]);
 assert.equal(detail.omittedProblems,0);assert.ok(detail.problems.every(row=>!Object.hasOwn(row,'checkId')));
 assert.match(coverageIssue(plan),/behavior lacks adverse actual consumer case/);assert.deepEqual(plan,before);
 const legacy=mixedPlan();delete legacy.verification.strategies;legacy.requirements=legacy.requirements.slice(0,1);legacy.verification.checks=legacy.verification.checks.slice(0,1);legacy.verification.checks[0].cases=[];
 assert.deepEqual(verificationReferenceDiagnostics(legacy).problems.map(row=>[row.kind,row.pointer]),[['consumer-case-healthy-missing','/requirements/0'],['consumer-case-adverse-missing','/requirements/0']]);
});
test('missing-case rosters retain honest omitted duties and Unicode identifier previews within the existing bounds',()=>{
 const plan=mixedPlan();plan.requirements=[];plan.verification.strategies=[];plan.verification.checks=[];
 for(let n=0;n<20;n++){const id=n+'界'.repeat(200);plan.requirements.push({id,text:'Explicit consumer duty',source:'owner-request'});plan.verification.strategies.push({requirementId:id,kind:'consumer-cases',checkIds:['absent-'+n]});}
 const detail=verificationReferenceDiagnostics(plan,1200);
 assert.ok(Buffer.byteLength(JSON.stringify(detail))<=1200);assert.ok(detail.problems.length<=12);assert.equal(detail.problems.length+detail.omittedProblems,60,'Forty missing kinds and twenty absent check references');
 assert.ok(detail.problems.some(row=>row.kind.startsWith('consumer-case-')&&row.reference.omittedCodeUnits>0));
});
