import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {captureDecisionCarry,planningDecisionCarry} from '../../dist/workflow/role-input.js';
import {parseRoleOutput,implementationCarryProposals} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {createSubjectActionProfile,subjectActionResponseHash} from '../../dist/workflow/subject-actions.js';

const refs={version:3,occurrenceIds:['F'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
const format={version:3,baselineVersion:'BASE',baseSourceIds:['base:mode.cjs','base:check.cjs']};
const constraints={decisionCarry:format,decisionReferences:refs};
const final=()=>({version:1,summary:'Independent classification against exact BASE source',findings:[],assessedScope:[],planAccepted:true,
 decisions:[{occurrenceId:'F',disposition:'upheld',reason:'The original claim is a BASE implementation duty; distinguish it from candidate and proposal objections',witnesses:['base:mode.cjs'],
 implementation:{kind:'assign-to-plan',baselineVersion:'BASE',requirementIds:['R'],baseSourceIds:['base:mode.cjs']}}]});
const ajv=new Ajv2020({strict:false});

test('source-qualified wire and parser share exact BASE/source domain, without changing v2',()=>{
 const validate=ajv.compile(roleOutputSchema('adjudicator','planning-adjudication',[],constraints));
 for(const mutate of [()=>{},v=>delete v.decisions[0].implementation.baseSourceIds,v=>v.decisions[0].implementation.baseSourceIds=[],v=>v.decisions[0].implementation.baseSourceIds=['candidate:mode.cjs'],v=>v.decisions[0].implementation.baseSourceIds=['base:mode.cjs','base:mode.cjs'],v=>v.decisions[0].implementation.baselineVersion='old-BASE',v=>v.decisions[0].implementation={kind:'none'},v=>v.decisions[0].implementation.extra=true]){
  const value=final();mutate(value);const decoded=parseRoleOutput(JSON.stringify(value),'adjudicator',[],constraints);
  assert.equal(!!decoded.value,validate(value),JSON.stringify({value,issues:decoded.issues,schema:validate.errors}));
 }
 const parsed=parseRoleOutput(JSON.stringify(final()),'adjudicator',[],constraints);assert.ok(parsed.value,parsed.issues.join());
 assert.deepEqual(implementationCarryProposals(parsed.value,format),[{occurrenceId:'F',baselineVersion:'BASE',requirementIds:['R'],reason:final().decisions[0].reason,baseSourceIds:['base:mode.cjs']}]);
 const old={...constraints,decisionCarry:{version:2}};
 assert.equal(parseRoleOutput(JSON.stringify(final()),'adjudicator',[],old).value,null,'Old captured grammar cannot acquire new source-qualified meaning');
 const legacy=final();delete legacy.decisions[0].implementation.baseSourceIds;
 assert.ok(parseRoleOutput(JSON.stringify(legacy),'adjudicator',[],old).value);
 assert.equal(parseRoleOutput(JSON.stringify(legacy),'adjudicator',[],constraints).value,null,'New classification cannot silently fall back to old assignment');
});

test('subject-action presentation preserves source-qualified typed operands and literal source IDs',()=>{
 const profile=createSubjectActionProfile('planning-adjudication',refs),c={...constraints,subjectActions:profile};
 const value=final(),body={...value.decisions[0]};delete body.occurrenceId;delete value.decisions;
 Object.assign(value,{subjectActionsHash:subjectActionResponseHash(profile,refs),decisionActions:{s0:body}});
 assert.equal(ajv.compile(roleOutputSchema('adjudicator','planning-adjudication',[],c))(value),true);
 const decoded=parseRoleOutput(JSON.stringify(value),'adjudicator',[],c);assert.deepEqual(decoded.issues,[]);
 assert.deepEqual(decoded.value.decisions,final().decisions);
});

test('format capture is detached and malformed or empty source domain cannot invent an assignment',()=>{
 const input=structuredClone(format),captured=captureDecisionCarry(input);input.baseSourceIds.reverse();
 assert.deepEqual(captured,format);assert.equal(Object.isFrozen(captured.baseSourceIds),true);
 for(const value of [{...format,extra:true},{...format,baseSourceIds:['candidate:mode.cjs']},{...format,baseSourceIds:['base:mode.cjs','base:mode.cjs']},{version:3},{...format,baselineVersion:null},{...format,baselineVersion:'\ud800'},{...format,baseSourceIds:['base:\ud800']},{...format,baselineVersion:'b'.repeat(32769)}])assert.throws(()=>captureDecisionCarry(value));
 const empty={...constraints,decisionCarry:{...format,baseSourceIds:[]}},v=final();
 assert.equal(parseRoleOutput(JSON.stringify(v),'adjudicator',[],empty).value,null);
 assert.equal(ajv.compile(roleOutputSchema('adjudicator','planning-adjudication',[],empty))(v),false);
 v.planAccepted=false;v.decisions=[];
 assert.ok(parseRoleOutput(JSON.stringify(v),'adjudicator',[],empty).value,'An unsupported BASE source domain keeps the honest refusal path');
});


test('the prospective declaration cannot lose its source capture or downgrade to a legacy receiver',()=>{
 const context={stage:'planning-adjudication',decisionCarryInput:{version:3},decisionCarry:format,decisionReferences:refs};
 assert.deepEqual(planningDecisionCarry('adjudicator',context),format);
 for(const mutate of [v=>delete v.decisionCarry,v=>delete v.decisionCarryInput,v=>v.decisionCarry={version:2},v=>v.decisionCarryInput={version:2},v=>v.decisionCarryInput={version:3,extra:true}]){
  const value=structuredClone(context);mutate(value);assert.throws(()=>planningDecisionCarry('adjudicator',value));
 }
 assert.deepEqual(planningDecisionCarry('adjudicator',{stage:'planning-adjudication',decisionCarry:{version:2},decisionReferences:refs}),{version:2});
});
