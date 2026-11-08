import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {capturePlanningRepair,planningRepairProfile} from '../../dist/workflow/planning-repair.js';
import {dispositionAccountingState,implementationCarryProposals,parseRoleOutput} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {initialVerificationProfile,mixedPlan} from './mixed-verification-fixture.mjs';
const proposalHash='a'.repeat(64);
const profile={version:1,subjects:[{occurrenceId:'O',proposalHash,producerOutputId:'C-output'}]};
const refs={version:3,occurrenceIds:['O','D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
const constraints={planningRepair:profile,decisionReferences:refs,decisionCarry:{version:2}};
const decision={occurrenceId:'O',disposition:'upheld',resolution:'repaired',repair:{kind:'plan',proposalHash},reason:'The original proposal omitted a required review path; the complete amendment includes it',witnesses:['Original proposal and corrected accepted plan']};
// A declined plan can retain a requested action, but the Controller cannot
// effect it without a complete valid changed plan and successful adoption.
const result={version:1,summary:'Independent judgment',findings:[],assessedScope:[],decisions:[decision],planAccepted:false};
const validate=new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','planning-adjudication',[],constraints));
function check(value,expected,options=constraints){const parsed=parseRoleOutput(JSON.stringify(value),'adjudicator',[],options);assert.equal(!!parsed.value,expected,parsed.issues.join('; '));if(options===constraints)assert.equal(validate(value),expected,JSON.stringify(validate.errors));}
test('prospective plan repair admits only the exact captured ordinary proposal subject',()=>{
 check(result,true);
 for(const mutate of [v=>v.decisions[0].repair.proposalHash='b'.repeat(64),v=>v.decisions[0].occurrenceId='D',v=>v.decisions[0].occurrenceId='unknown',v=>v.decisions[0].repair.kind='code',v=>v.decisions[0].repair.extra=true,v=>v.decisions[0].implementation={kind:'none'},v=>delete v.decisions[0].resolution,v=>v.decisions[0].witnesses=[],v=>v.decisions[0].disposition='rejected']){const changed=structuredClone(result);mutate(changed);check(changed,false);}
});
test('historical absence never reinterprets a plan repair action as code repair',()=>{
 check(result,false,{decisionReferences:refs,decisionCarry:{version:2}});
 const historical=structuredClone(result);delete historical.decisions[0].repair;check(historical,true,{decisionReferences:refs,decisionCarry:{version:2}});
});
test('planning repair capture is detached and refuses invalid source domains and receivers',()=>{
 const input=structuredClone(profile),captured=capturePlanningRepair(input);input.subjects[0].proposalHash='b'.repeat(64);assert.equal(captured.subjects[0].proposalHash,proposalHash);assert.ok(Object.isFrozen(captured.subjects[0]));
 for(const invalid of [{...profile,version:2},{...profile,extra:true},{version:1,subjects:[...profile.subjects,...profile.subjects]},{version:1,subjects:[{...profile.subjects[0],proposalHash:'not-a-hash'}]}])assert.throws(()=>capturePlanningRepair(invalid));
 assert.equal(planningRepairProfile('adjudicator',{stage:'planning-adjudication'}),undefined);
 assert.throws(()=>planningRepairProfile('reviewer',{stage:'planning-adjudication',planningRepair:profile}));
 assert.throws(()=>planningRepairProfile('adjudicator',{stage:'review-adjudication',planningRepair:profile}));
});

const verification = {occurrenceId: 'V', proposalHash: 'c'.repeat(64), producerOutputId: 'R-output'};
const coverageProfile = {...profile, version: 2, verification};
const coverageConstraints = {
    ...constraints,
    planningRepair: coverageProfile,
    planningProfile: initialVerificationProfile,
    decisionReferences: {...refs, occurrenceIds: ['O','V','E','D'], pendingOrdinaryIndexes: [0,1,2], blockingOrdinaryIndexes: [0,1,2]},
};
const coverageResult = () => ({
    ...result,
    planAccepted: true,
    acceptedPlan: mixedPlan(),
    decisions: [
        structuredClone(decision),
        {occurrenceId: 'V', disposition: 'upheld', resolution: 'pending',
            repair: {kind: 'verification-plan', proposalHash: verification.proposalHash},
            reason: 'The selected check omitted a required input. The proposed coverage still needs new execution and review.',
            witnesses: ['original selected review and passing check']},
        {occurrenceId: 'E', disposition: 'equivalent', equivalentTo: 'V', implementation: {kind: 'none'},
            reason: 'The historical observation identifies the same missing input.', witnesses: ['original independent observations']},
    ],
});

test('accepted planning can account for a pending verification correction and its pending equivalent', () => {
    const value = coverageResult();
    const schema = roleOutputSchema('adjudicator', 'planning-adjudication', [], coverageConstraints);
    const validateCoverage = new Ajv2020({strict: false}).compile(schema);
    assert.equal(validateCoverage(value), true, JSON.stringify(validateCoverage.errors));
    assert.doesNotThrow(() => validateToolArguments({name: 'judge', parameters: schema},
        {type: 'toolCall', id: 'coverage-judgment', name: 'judge', arguments: structuredClone(value)}));
    const parsed = parseRoleOutput(JSON.stringify(value), 'adjudicator', [], coverageConstraints);
    assert.ok(parsed.value, parsed.issues.join('; '));
    assert.deepEqual(parsed.value.decisions, value.decisions);
    assert.deepEqual(implementationCarryProposals(parsed.value, coverageConstraints.decisionCarry), []);
    assert.equal(dispositionAccountingState(parsed.value.decisions[1], {severity: 'blocking'}, {repair: true}), 'pending');
});

test('verification correction syntax requires its exact captured pending subject', () => {
    const schema = roleOutputSchema('adjudicator', 'planning-adjudication', [], coverageConstraints);
    const validateCoverage = new Ajv2020({strict: false}).compile(schema);
    const mutations = [
        finding => { finding.occurrenceId = 'O'; },
        finding => { finding.repair.proposalHash = proposalHash; },
        finding => { finding.disposition = 'rejected'; },
        finding => { finding.resolution = 'repaired'; },
        finding => { delete finding.repair; },
        finding => { delete finding.resolution; },
        finding => { finding.implementation = {kind: 'none'}; },
        finding => { finding.diagnosis = {outputId: 'original', rawSha256: proposalHash, inputReceiptHash: proposalHash, materialOccurrenceIds: []}; },
    ];
    for (const mutate of mutations) {
        const value = coverageResult();
        mutate(value.decisions[1]);
        assert.equal(validateCoverage(value), false, JSON.stringify(value.decisions[1]));
        assert.equal(parseRoleOutput(JSON.stringify(value), 'adjudicator', [], coverageConstraints).value, null);
    }
    for (const planningRepair of [undefined, profile]) {
        const historical = {...coverageConstraints, planningRepair};
        const value = coverageResult();
        assert.equal(new Ajv2020({strict: false}).compile(roleOutputSchema('adjudicator', 'planning-adjudication', [], historical))(value), false);
        assert.equal(parseRoleOutput(JSON.stringify(value), 'adjudicator', [], historical).value, null);
    }
});

test('equivalence to a pending verification correction cannot create a BASE assignment', () => {
    const value = coverageResult();
    value.decisions[2].implementation = {kind: 'assign-to-plan', baselineVersion: 'original-base', requirementIds: ['R1']};
    assert.equal(parseRoleOutput(JSON.stringify(value), 'adjudicator', [], coverageConstraints).value, null);
    delete value.decisions[2].implementation;
    assert.equal(parseRoleOutput(JSON.stringify(value), 'adjudicator', [], coverageConstraints).value, null);
});
