import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {presentPlanningDomains,restorePlanningDomains,planningDomainFootprint} from '../../dist/workflow/planning-domains.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {historicalRoleInputBody} from '../../dist/workflow/role-input.js';
import {parseUniqueJson} from '../../dist/workflow/json.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {coverageIssue} from '../../dist/controller/check-cases.js';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {writeFixtureVerificationDomain} from './current-verification-fixture.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profile={...initialVerificationProfile,version:7,allowedKinds:[...initialVerificationProfile.allowedKinds,'all-of']};
function context(role,planVersion=null){
 const plan=mixedPlan();return {stage:role==='planner'?'planning':role==='challenger'?'planning-challenge':'planning-adjudication',planVersion,planningVerificationProfile:profile,
  ownerRequest:'Repair behavior, run the actual candidate command and independent review; do not publish.',
  ...(role==='challenger'?{planProposal:plan,plannerOutput:{...common,plan}}:role==='adjudicator'?{planProposal:plan}:{}),
  historical:{requirements:[{id:'literal-old'}],plan:mixedPlan()},acceptedPlan:{requirements:['unrelated in a planning input']}};
}
test('fresh challenge sends one current plan and restores the exact original two operands',()=>{
 const literal=context('challenger');literal.planningVerificationProfile={...profile,version:8};
 const original=structuredClone(literal);original.plannerPlanReference=1;
 const before=JSON.stringify(original),full=presentPlanningDomains('challenger',literal,null);
 const wire=presentPlanningDomains('challenger',original,null);
 assert.deepEqual(wire.planProposal,full.planProposal);
 assert.deepEqual(wire.plannerOutput.plan,{$ref:'context.planProposal'});
 assert.deepEqual({...wire.plannerOutput,plan:full.planProposal},full.plannerOutput);
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(full)));
 assert.equal(JSON.stringify(restorePlanningDomains('challenger',wire,8,null,1)),before);
 assert.equal(JSON.stringify(original),before);
 assert.throws(()=>restorePlanningDomains('challenger',wire,8,null));
 assert.throws(()=>restorePlanningDomains('challenger',full,8,null,1));
 assert.doesNotThrow(()=>restorePlanningDomains('challenger',full,8,null));
 assert.throws(()=>restorePlanningDomains('challenger',{...wire,plannerOutput:full.plannerOutput},8,null,1));
 const changed=structuredClone(original);changed.plannerOutput.plan={...changed.planProposal,approach:changed.planProposal.approach+' different'};
 assert.throws(()=>presentPlanningDomains('challenger',changed,null));
 assert.notEqual(planningDomainFootprint('challenger',original,hash([]),null),planningDomainFootprint('challenger',literal,hash([]),null));
});
for(const role of ['planner','challenger','adjudicator'])test('profile8 '+role+' retains the profile7 view with its own exact captured identity',()=>{
 const original=context(role);original.planningVerificationProfile={...profile,version:8};
 const before=JSON.stringify(original),wire=presentPlanningDomains(role,original,null);
 assert.equal(wire.planningVerificationProfile.version,8);assert.deepEqual(wire.requirementsView,{kind:'task-request-and-constraints',planVersion:null});
 assert.equal(JSON.stringify(restorePlanningDomains(role,wire,8,null)),before);assert.equal(JSON.stringify(original),before);
 assert.throws(()=>restorePlanningDomains(role,wire,7,null));
 const old=context(role),oldWire=presentPlanningDomains(role,old,null);assert.throws(()=>restorePlanningDomains(role,oldWire,8,null));
 const fingerprint=planningDomainFootprint(role,original,hash([]),null);
 assert.equal(typeof fingerprint,'string');assert.notEqual(fingerprint,planningDomainFootprint(role,old,hash([]),null));
 if(role!=='planner')assert.ok(wire.planProposal.verificationRequirements);
 const frame=roleFraming(role,{requirements:[],contracts:'Preserve original obligations.',sources:[],requiredScope:[],context:original},true);
 assert.match(frame.schema.properties.findings.items.properties.requirementId.description,/not an enum/);
});
for(const role of ['planner','challenger','adjudicator'])test('profile7 '+role+' exposes exact current verification domain and allowed facts, with ordered canonical restoration',()=>{
 const original=context(role),before=JSON.stringify(original),wire=presentPlanningDomains(role,original,null);
 assert.deepEqual(wire.planningVerificationProfile.baseline,{newObservationAllowed:true,crossPlanReuseAllowed:false,retainedDutyPresent:false});
 assert.deepEqual(wire.requirementsView,{kind:'task-request-and-constraints',planVersion:null});
 if(role!=='planner'){assert.ok(wire.planProposal.verificationRequirements);assert.equal(wire.planProposal.requirements,undefined);}
 if(role==='challenger')assert.ok(wire.plannerOutput.plan.verificationRequirements);
 assert.deepEqual(wire.historical,original.historical);assert.deepEqual(wire.acceptedPlan,original.acceptedPlan);
 assert.equal(JSON.stringify(restorePlanningDomains(role,wire,7,null)),before,'Canonical key order is part of existing approval/input hashes');
 assert.equal(JSON.stringify(original),before,'Presentation does not change canonical storage');
 assert.throws(()=>restorePlanningDomains(role,wire,6,null));assert.throws(()=>restorePlanningDomains(role,wire,undefined,null));
 assert.throws(()=>restorePlanningDomains(role,wire,7,'different-plan'));
 const bad=structuredClone(wire);bad.planningVerificationProfile.baseline.newObservation=true;assert.throws(()=>restorePlanningDomains(role,bad,7,null));
 const collision=structuredClone(original);collision.planningVerificationProfile.baseline.newObservationAllowed=true;assert.throws(()=>presentPlanningDomains(role,collision,null));
 if(role!=='planner'){const badPlan=structuredClone(wire);badPlan.planProposal.requirements=[];assert.throws(()=>restorePlanningDomains(role,badPlan,7,null));}
});
test('literal1–6 current and historical input fields retain their original receiver',()=>{
 for(let version=1;version<=6;version++){
  const original=context('challenger');original.planningVerificationProfile={...profile,version,allowedKinds:version===1?initialVerificationProfile.allowedKinds:profile.allowedKinds};
  original.requirementsView='old unrelated literal';
  original.plannerPlanReference='old unrelated literal';
  assert.equal(presentPlanningDomains('challenger',original,undefined),original);
  assert.equal(restorePlanningDomains('challenger',original,version,undefined,original.plannerPlanReference),original);
  assert.equal(planningDomainFootprint('challenger',original,undefined,undefined),undefined);
 }
});
test('profile7 keeps unknown reference-like fields literal',()=>{
 const original=context('challenger');original.plannerPlanReference='old unrelated literal';
 const wire=presentPlanningDomains('challenger',original,null);
 assert.equal(wire.plannerPlanReference,original.plannerPlanReference);
 assert.deepEqual(restorePlanningDomains('challenger',wire,7,null,original.plannerPlanReference),original);
});
for (const {role, version, reference} of [
    {role:'challenger', version:7},
    {role:'challenger', version:10, reference:1},
    {role:'adjudicator', version:10},
]) test(`planning framing restores undeclared JSON keys literally · ${role} · profile ${version}`, () => {
    const literal = parseUniqueJson('{"constructor":"original constructor","__proto__":{"original":"한국어"},"[object Object]":"separate key","toString":"original text"}');
    const original = context(role);
    original.planningVerificationProfile = {
        ...profile, version, baseline:{...profile.baseline,...literal},
    };
    original.planProposal = {...original.planProposal,...literal};
    if (role === 'challenger') original.plannerOutput.plan = original.planProposal;
    if (reference) original.plannerPlanReference = reference;
    const requirements = [{id:'owner-request', text:original.ownerRequest, source:'owner'}];
    const before = JSON.stringify(original);
    const fingerprint = planningDomainFootprint(role,original,hash(requirements),null);
    const frame = roleFraming(role,{
        requirements, contracts:'Keep the exact original request and evidence.', sources:[], requiredScope:[], context:original,
    },true);
    const retainedBody = historicalRoleInputBody(frame.prompt,role);
    assert.ok(retainedBody);
    const wire = parseUniqueJson(retainedBody);
    assert.deepEqual(wire.requirements,requirements);
    assert.ok(Object.hasOwn(wire.context.planProposal,'verificationRequirements'));
    assert.ok(Object.hasOwn(wire.context.planningVerificationProfile.baseline,'newObservationAllowed'));
    for (const [key,value] of Object.entries(literal)) {
        for (const record of [wire.context.planProposal,wire.context.planningVerificationProfile.baseline]) {
            assert.ok(Object.hasOwn(record,key), `Missing literal key ${key}`);
            assert.deepEqual(record[key],value);
        }
    }
    if (reference) assert.deepEqual(wire.context.plannerOutput.plan,{$ref:'context.planProposal'});
    const restored = restorePlanningDomains(role,wire.context,version,null,reference);
    assert.equal(JSON.stringify(restored),before);
    assert.equal(planningDomainFootprint(role,restored,hash(requirements),null),fingerprint);
    assert.equal(JSON.stringify(original),before);
});
test('profile7 footprint binds root rows, actual selected-plan meaning, capability and only actual current-plan slots',()=>{
 const original=context('challenger'),root=[{id:'owner-request',text:original.ownerRequest,source:'actual-source'}],fingerprint=planningDomainFootprint('challenger',original,hash(root),null);
 for(const mutate of [c=>c.planningVerificationProfile.baseline.priorDuty=true,c=>c.planProposal.requirements[0].text+=' changed',c=>c.plannerOutput.plan.verification.checks[0].timeoutMs++]){
  const changed=structuredClone(original);mutate(changed);assert.notEqual(planningDomainFootprint('challenger',changed,hash(root),null),fingerprint);
 }
 assert.notEqual(planningDomainFootprint('challenger',original,hash([...root,{id:'invented'}]),null),fingerprint);
 assert.notEqual(planningDomainFootprint('challenger',original,hash(root),'selected-plan'),fingerprint);
 assert.throws(()=>planningDomainFootprint('challenger',original,undefined,null));
 const literal=structuredClone(original);literal.historical.plan.requirements[0].text+=' original unrelated history';
 assert.equal(planningDomainFootprint('challenger',literal,hash(root),null),fingerprint,'Historical/literal data keeps its separate source custody');
});
for(const selected of [null,'accepted-plan'])test('production7 framing honestly labels preserved root requirements: '+selected,()=>{
 const c=context('challenger',selected),requirements=selected?mixedPlan().requirements:[{id:'owner-request',text:c.ownerRequest,source:'owner'}],bundle={requirements,contracts:'Preserve full task and bound obligations.',sources:[],requiredScope:[],context:c};
 const frame=roleFraming('challenger',bundle,true),wire=JSON.parse(frame.prompt.split('\n')[1]);
 assert.deepEqual(wire.requirements,requirements);assert.deepEqual(wire.context.requirementsView,{kind:selected?'selected-plan-verification-requirements':'task-request-and-constraints',planVersion:selected});
 assert.equal(wire.context.ownerRequest,c.ownerRequest);assert.ok(wire.context.planProposal.verificationRequirements);
 assert.match(frame.systemPrompt,/capabilities, not commands or new duties/);assert.match(frame.schema.properties.findings.items.properties.requirementId.description,/not an enum/);
});
test('an actual operating/historical finding is not a current verification requirement; real case references remain closed',()=>{
 const plan=mixedPlan(),finding={requirementId:'no-publishing-original-task',severity:'blocking',repair:'unknown',description:'Assess an actual original operating restriction, not verification coverage.',evidence:['owner-request']};
 const output=writeFixtureVerificationDomain({...common,findings:[finding],plan},{planningVerificationProfile:profile});
 assert.ok(parseRoleOutput(JSON.stringify(output),'planner',[],{planningProfile:profile}).value);
 plan.verification.checks[0].cases[0].guaranteeIds=['no-publishing-original-task'];
 assert.match(coverageIssue(plan),/not a declared verification requirement/,'The free finding identity grants no check/case coverage');
});

test('profile7 current host diagnostic pointers name the visible plan and restore exact original facts',()=>{
 const original=context('challenger');original.currentProposalDiagnostics={version:2,kind:'current-proposal-validation',issue:'Original prose /requirements is literal.',referenceDiagnostics:{version:1,pointerDomain:'canonical-plan',problems:[
  {kind:'case-requirement-undeclared',pointer:'/verification/checks/0/cases/0/guaranteeIds/0',expectedPointer:'/requirements',reference:{value:'/requirements',omittedCodeUnits:0}},
  {kind:'literal-path-test',pointer:'/requirementsExtra',expectedPointer:'/other/requirements'},
 ],omittedProblems:7}};
 const before=JSON.stringify(original),wire=presentPlanningDomains('challenger',original,null),reference=wire.currentProposalDiagnostics.referenceDiagnostics;
 assert.equal(reference.pointerDomain,'current-planning-view');assert.equal(reference.problems[0].expectedPointer,'/verificationRequirements');assert.equal(reference.problems[0].reference.value,'/requirements');assert.equal(reference.problems[1].pointer,'/requirementsExtra');assert.equal(reference.problems[1].expectedPointer,'/other/requirements');assert.equal(reference.omittedProblems,7);assert.equal(wire.currentProposalDiagnostics.issue,original.currentProposalDiagnostics.issue);
 assert.equal(JSON.stringify(restorePlanningDomains('challenger',wire,7,null)),before);assert.equal(JSON.stringify(original),before);
 const rootHash=hash([{id:'owner-request'}]),captured=planningDomainFootprint('challenger',original,rootHash,null),changed=structuredClone(original);changed.currentProposalDiagnostics.referenceDiagnostics.omittedProblems++;
 assert.notEqual(planningDomainFootprint('challenger',changed,rootHash,null),captured);
 for(const mutate of [c=>c.currentProposalDiagnostics.referenceDiagnostics.pointerDomain='unknown',c=>c.currentProposalDiagnostics.referenceDiagnostics.problems[0].expectedPointer='/verificationRequirements',c=>delete c.currentProposalDiagnostics.referenceDiagnostics.problems[0].pointer,c=>c.currentProposalDiagnostics.referenceDiagnostics.version=2,c=>c.currentProposalDiagnostics.referenceDiagnostics.problems[0].reference.value='界'.repeat(5000)]){
  const malformed=structuredClone(original);mutate(malformed);assert.throws(()=>presentPlanningDomains('challenger',malformed,null));
 }
 const mixed=structuredClone(wire);mixed.currentProposalDiagnostics.referenceDiagnostics.problems[0].expectedPointer='/requirements';assert.throws(()=>restorePlanningDomains('challenger',mixed,7,null));
});

test('profile 10 can assign a replacement to a reviewer while profile 9 needs its BASE path', () => {
    const plan = mixedPlan(), check = plan.verification.checks[0];
    check.consumerControl = {
        path: check.cases[0].consumerPaths[0],
        failedAssertions: [],
        observations: [{id:check.cases[0].id, observed:{kind:'rejection', value:'control result'}}],
    };
    const parse = version => {
        const planningVerificationProfile = {...profile,version};
        const wire = writeFixtureVerificationDomain({...common,plan},{planningVerificationProfile});
        return parseRoleOutput(JSON.stringify(wire), 'planner', [], {planningProfile:planningVerificationProfile});
    };
    assert.ok(parse(10).value);
    assert.equal(parse(9).value, null);
});

test('replacement text uses its dedicated role grammar and UTF-8 size bound', () => {
    const text = '가'.repeat(8192);
    const parser = (consumerReplacement, constraints) =>
        parseRoleOutput(JSON.stringify({...common,consumerReplacement}), 'reviewer', [], constraints);
    assert.equal(parser(text,{consumerControlProposal:true}).value?.consumerReplacement, text);
    assert.equal(parser(text,{}).value, null);
    assert.equal(parser('가'.repeat(21846),{consumerControlProposal:true}).value, null);
});
