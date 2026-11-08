import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {baselineAssertionsMatch,coverageIssue} from '../../dist/controller/check-cases.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
const profile={...initialVerificationProfile,version:3,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
const parse=(plan,version=3)=>parseRoleOutput(JSON.stringify({...common,plan}),'planner',[],{strategyGrammarVersion:version});
function expectedBase(){const plan=mixedPlan();plan.verification.checks[1].baselineExpectedFailures=['concrete-subject-defect'];return plan;}
test('captured grammar3 admits explicit original BASE observations while old grammars retain their exact default',()=>{
 const plan=expectedBase();assert.ok(parse(plan).value);assert.equal(coverageIssue(plan),null);
 for(const version of [1,2]){assert.equal(parse(plan,version).value,null);assert.ok(parse(mixedPlan(),version).value);}
 const ajv=new Ajv2020({strict:false});const v3=ajv.compile(roleOutputSchema('planner','planning',[],{planningProfile:profile}));assert.equal(v3({...common,plan}),true,JSON.stringify(v3.errors));
 for(const version of [1,2]){const old={...profile,version,...(version===1?{allowedKinds:initialVerificationProfile.allowedKinds}:{})};const validate=ajv.compile(roleOutputSchema('planner','planning',[],{planningProfile:old}));assert.equal(validate({...common,plan}),false);}
 // The same old builder after3 cannot inherit a mutated check schema.
 assert.equal(ajv.compile(roleOutputSchema('planner','planning',[],{planningProfile:{...profile,version:2}}))({...common,plan}),false);
});
test('all-of under3 retains the BASE-only expectation without weakening its consumer child',()=>{
 const plan=expectedBase(),parts=plan.verification.strategies.map(({requirementId,...part})=>part);plan.requirements=[plan.requirements[0]];plan.verification.strategies=[{requirementId:'behavior',kind:'all-of',parts}];for(const check of plan.verification.checks){check.guaranteeIds=['behavior'];for(const item of check.cases)item.guaranteeIds=['behavior'];}
 assert.ok(parse(plan).value);assert.equal(coverageIssue(plan),null);
 plan.verification.strategies[0].parts[0].checkIds.push('base-check');assert.equal(parse(plan).value,null);assert.match(coverageIssue(plan),/distinct actual candidate/);
});
test('candidate, unreferenced, duplicate, empty and unknown expected failures are refused',()=>{
 for(const change of [p=>p.verification.checks[0].baselineExpectedFailures=['actual-consumer'],p=>p.verification.checks[1].baselineExpectedFailures=[],p=>p.verification.checks[1].baselineExpectedFailures=['foreign'],p=>p.verification.checks[1].baselineExpectedFailures.push('concrete-subject-defect'),p=>p.verification.strategies.splice(1,1)]){const plan=expectedBase();change(plan);assert.equal(parse(plan).value,null);assert.notEqual(coverageIssue(plan),null);}
 const legacy=expectedBase();delete legacy.verification.strategies;assert.equal(parse(legacy).value,null);assert.match(coverageIssue(legacy),/typed BASE/);
});
test('exact assertion observation preserves false states and refuses unexpected results or incomplete rosters',()=>{
 const check={assertions:['oracle','integrity'],baselineExpectedFailures:['oracle']},actual=[{id:'oracle',passed:false},{id:'integrity',passed:true}],before=structuredClone(actual);
 assert.equal(baselineAssertionsMatch(check,actual),true);assert.deepEqual(actual,before);
 for(const value of [[{id:'oracle',passed:true},{id:'integrity',passed:true}],[{id:'oracle',passed:false},{id:'integrity',passed:false}],actual.slice(0,1),[...actual,{id:'extra',passed:true}],[actual[0],actual[0]]])assert.equal(baselineAssertionsMatch(check,value),false);
 assert.equal(baselineAssertionsMatch({assertions:check.assertions},actual),false,'Historical all-true declarations do not acquire the new expectation');
 assert.equal(baselineAssertionsMatch({assertions:['oracle'],baselineExpectedFailures:[]},[{id:'oracle',passed:true}]),false);
});
