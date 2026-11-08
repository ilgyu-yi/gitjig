import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {coverageIssue} from '../../dist/controller/check-cases.js';
import {verificationStrategyLeaves} from '../../dist/workflow/verification-strategy.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
const profile={...initialVerificationProfile,version:2,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
function compound(){
 const plan=mixedPlan();plan.requirements[0].text+='; only consumer.cjs changes and owner.txt remains unchanged';plan.requirements=plan.requirements.filter(r=>r.id!=='scope');
 const {requirementId:unused,...scope}=plan.verification.strategies.pop(),{requirementId,...behavior}=plan.verification.strategies[0];
 plan.verification.strategies[0]={requirementId,kind:'all-of',parts:[behavior,scope]};return plan;
}
const parse=(plan,capability=profile)=>parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],{planningProfile:capability});
test('compound owner intent has one parent strategy and every behavioral/scope obligation remains required',()=>{
 const plan=compound();assert.ok(parse(plan).value);assert.equal(coverageIssue(plan),null);
 const leaves=verificationStrategyLeaves(plan.verification.strategies[0]);assert.deepEqual(leaves.map(x=>x.kind),['consumer-cases','manifest-scope-duty']);assert.ok(leaves.every(x=>x.requirementId==='behavior'));
 for(const mutate of [p=>p.verification.checks[0].cases.pop(),p=>p.verification.strategies[0].parts[1].unchangedPaths.push('consumer.cjs'),p=>p.verification.reviewRoles=[]]){const changed=structuredClone(plan);mutate(changed);assert.notEqual(coverageIssue(changed),null);}
});
test('bounded composite grammar rejects recursion, repeated families, child IDs and unknown fields',()=>{
 for(const mutate of [p=>p.parts.pop(),p=>p.parts.push(p.parts[0]),p=>p.parts[0]={kind:'all-of',parts:structuredClone(p.parts)},p=>p.parts[0].requirementId='behavior',p=>p.parts[0].ignored=true,p=>p.parts[0].checkIds=[]]){
  const plan=compound();mutate(plan.verification.strategies[0]);assert.equal(parse(plan).value,null);
 }
});
test('captured atomic capability and repeated top-level requirement grammar retain their meaning',()=>{
 const plan=compound();assert.equal(parse(plan,initialVerificationProfile).value,null);
 assert.equal(parseRoleOutput(JSON.stringify({...common,plan}),'planner').value,null,'Absence retains original atomic grammar');
 assert.ok(parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],{strategyGrammarVersion:2}).value,'Original captured version2 permits structural decoding without new contextual acceptance');
 const omitted={...common,planAccepted:true,decisions:[]};assert.ok(parseRoleOutput(JSON.stringify(omitted),'adjudicator',[],{strategyGrammarVersion:1}).value,'Historical structural decoder does not invent a missing full acceptedPlan when the authenticated host resolves bound approval separately');
 const old=mixedPlan();old.verification.strategies[1].requirementId='behavior';assert.match(parse(old).issues.join(),/repeats an earlier strategy requirement/);
 const atomic=mixedPlan().verification.strategies[0];assert.equal(verificationStrategyLeaves(atomic)[0],atomic,'Old atomic digest/object interpretation is unchanged');
 const noBase={...profile,allowedKinds:['consumer-cases','manifest-scope-duty','all-of'],baseline:{newObservation:false,crossPlanReuse:false,priorDuty:false}};
 const altered=compound();altered.verification.strategies[0].parts.push({kind:'base-execution-duty',checkId:'base-check',caseIds:['base-defect'],reviewKey:'review'});assert.equal(parse(altered,noBase).value,null,'A supported composite cannot introduce an unavailable atomic duty');
});
test('native schema exposes inherited distinct atomic parts only under explicit current capability',()=>{
 const items=cap=>roleOutputSchema('planner','planning',[],{planningProfile:cap}).properties.plan.properties.verification.properties.strategies.items.anyOf;
 assert.ok(!items(initialVerificationProfile).some(x=>x.properties.kind.const==='all-of'));
 const combined=items(profile).find(x=>x.properties.kind.const==='all-of');assert.equal(combined.properties.parts.minItems,2);assert.equal(combined.properties.parts.maxItems,3);
 assert.ok(combined.properties.parts.items.anyOf.every(x=>!x.properties.requirementId&&!x.properties.parts&&x.additionalProperties===false));
});
