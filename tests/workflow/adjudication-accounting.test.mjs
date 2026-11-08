import test from 'node:test';import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createHash} from 'node:crypto';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {common,mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {captureDecisionReferences} from '../../dist/workflow/role-input.js';
import {parseRoleOutput,implementationCarryProposals} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
const refs={version:3,occurrenceIds:['A','E','D','closed','optional'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1,3],retentionChoices:[{dispositionId:'old-D',occurrenceId:'D',sha256:'a'.repeat(64)},{dispositionId:'old-closed',occurrenceId:'closed',sha256:'b'.repeat(64)}]};
const constraints={decisionReferences:refs,decisionCarry:{version:2},diagnosisEligibility:{version:1,receiptHash:'c'.repeat(64),eligible:[]}};
const base={version:1,summary:'Explicit current accounting and historical identity',findings:[],assessedScope:[],planAccepted:true};
const assign={kind:'assign-to-plan',baselineVersion:'original-B',requirementIds:['R']};
const d=(id,disposition,extra={})=>({occurrenceId:id,disposition,reason:'Independent current meaning and owner mapping',witnesses:['original source'],...extra});
const accepted=()=>({...base,retainedDispositions:['old-D'],decisions:[d('A','upheld',{implementation:assign}),d('E','equivalent',{equivalentTo:'A',implementation:assign})]});
function structural(value,expected,c=constraints){const schema=roleOutputSchema('adjudicator','planning-adjudication',[],c),validate=new Ajv2020({strict:false}).compile(schema);assert.equal(!!validate(value),expected,JSON.stringify(validate.errors));if(expected)assert.doesNotThrow(()=>validateToolArguments({name:'judge',parameters:schema},{type:'toolCall',id:'original-call',name:'judge',arguments:structuredClone(value)}));else assert.throws(()=>validateToolArguments({name:'judge',parameters:schema},{type:'toolCall',id:'original-call',name:'judge',arguments:structuredClone(value)}));}
const parse=(v,c=constraints)=>parseRoleOutput(JSON.stringify(v),'adjudicator',[],c);
test('exact historical row acknowledgement is separate from new diagnosis and every member explicitly assigns its remedy',()=>{
 const value=accepted(),before=structuredClone(value);structural(value,true);assert.ok(parse(value).value);
 assert.deepEqual(implementationCarryProposals(value,constraints.decisionCarry),['A','E'].map(occurrenceId=>({occurrenceId,baselineVersion:'original-B',requirementIds:['R'],reason:value.decisions[0].reason})));assert.deepEqual(value,before);
 const oldReplay={...value,decisions:[d('D','upheld',{resolution:'diagnosed'}),...value.decisions]};structural(oldReplay,false);assert.equal(parse(oldReplay).value,null);
 for(const retainedDispositions of [['foreign'],['old-D','old-D']]){const changed={...value,retainedDispositions};structural(changed,false);assert.equal(parse(changed).value,null);}
 const overlap={...value,decisions:[...value.decisions,d('D','rejected')]};structural(overlap,true);assert.equal(parse(overlap).value,null,'A reference cannot also request a fresh judgment for its subject');
});
test('accepted-plan choices retain the unconditional closed grammar and empty ordinary domains remain usable',()=>{
 for(const planAccepted of [true,false])for(const mutation of [v=>v.extra=true,v=>v.decisions[0].extra=true,v=>v.decisions[0].occurrenceId='foreign',v=>v.decisions[0].witnesses=1]){
  const value=accepted();value.planAccepted=planAccepted;mutation(value);structural(value,false);assert.equal(parse(value).value,null);
 }
 const tooMany=accepted();tooMany.decisions.push(...Array(1023).fill(tooMany.decisions[0]));structural(tooMany,false);
 const onlyHistorical={...constraints,decisionReferences:{version:3,occurrenceIds:['D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[],blockingOrdinaryIndexes:[],retentionChoices:[refs.retentionChoices[0]]}};
 const value={...base,retainedDispositions:['old-D'],decisions:[]};structural(value,true,onlyHistorical);assert.ok(parse(value,onlyHistorical).value);
});
test('conditional plan acceptance preserves complete plan grammar, strategy capabilities and criteria requirements',()=>{
 const c={planningProfile:initialVerificationProfile},plan=mixedPlan();
 const check=(value,valid,context=c)=>{structural(value,valid,context);assert.equal(!!parse(value,context).value,valid);};
 for(const planAccepted of [true,false]){
  const value={...common,decisions:[],planAccepted,acceptedPlan:plan};check(value,true);
  for(const mutate of [v=>delete v.acceptedPlan.intent,v=>v.acceptedPlan.extra=true,v=>v.acceptedPlan.verification.extra=true,v=>v.acceptedPlan.verification.checks[0].timeoutMs=0,v=>delete v.acceptedPlan.verification.strategies[0].checkIds]){const changed=structuredClone(value);mutate(changed);check(changed,false);}
  const missing=structuredClone(value);delete missing.acceptedPlan.verification.strategies;check(missing,!planAccepted);
  check({...common,decisions:[],planAccepted},!planAccepted);
 }
 const restricted={planningProfile:{...initialVerificationProfile,allowedKinds:['consumer-cases','manifest-scope-duty'],baseline:{...initialVerificationProfile.baseline,newObservation:false}}};
 check({...common,decisions:[],planAccepted:true,acceptedPlan:plan},false,restricted);check({...common,decisions:[],planAccepted:false,acceptedPlan:plan},true,restricted);
 const criteria={sourceId:'S',fromContractsVersion:'old-K',toContractsVersion:'new-K'},refresh={...c,criteriaRefresh:criteria},value={...common,decisions:[],planAccepted:true,acceptedPlan:plan};
 check(value,false,refresh);check({...value,criteriaDecision:{...criteria,verdict:'adopt',reason:'Independently assessed current rules'}},true,refresh);
 check({...value,ownerDecisionRequired:['Need explicit owner choice']},true,refresh);
});
test('bound approval never turns SDK optional-null normalization into literal correction authority',()=>{
 const plan=mixedPlan(),c={planningProfile:initialVerificationProfile,proposalApproval:{version:1,plannerOutputId:'P',proposalHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),plannerOutputHash:'a'.repeat(64),proposal:plan}},value={...common,decisions:[],planAccepted:true};
 structural(value,true,c);assert.ok(parse(value,c).value);
 const schema=roleOutputSchema('adjudicator','planning-adjudication',[],c),validate=new Ajv2020({strict:false}).compile(schema),literal={...value,acceptedPlan:null},raw=JSON.stringify(literal);
 assert.equal(validate(literal),false);const normalized=validateToolArguments({name:'judge',parameters:schema},{type:'toolCall',id:'original',name:'judge',arguments:literal});
 assert.equal(Object.hasOwn(normalized,'acceptedPlan'),false);assert.equal(JSON.stringify(literal),raw);assert.equal(parse(literal,c).value,null);
 structural({...value,acceptedPlan:{intent:'partial'}},false,c);assert.equal(parse({...value,acceptedPlan:{intent:'partial'}},c).value,null);
});
test('each carry format forbids resolution and diagnosis separately while retaining the root closed grammar',()=>{
 for(const version of [1,2])for(const planAccepted of [true,false]){
  const c={decisionCarry:{version},decisionReferences:version===1?{version:2,occurrenceIds:['A','D'],diagnosisOccurrenceIds:['D']}:{version:3,occurrenceIds:['A','D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]}},key=version===1?'implementationCarry':'implementation';
  const value={...base,planAccepted,decisions:[d('A','upheld',{[key]:{...(version===2?{kind:'assign-to-plan'}:{}),baselineVersion:'B',requirementIds:['R']}})]};structural(value,true,c);assert.ok(parse(value,c).value);
  for(const [field,operand] of [['resolution','repaired'],['diagnosis',{outputId:'O',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:[]}]]){const changed=structuredClone(value);changed.decisions[0][field]=operand;structural(changed,false,c);assert.equal(parse(changed,c).value,null);}
  for(const mutate of [v=>v.decisions[0].extra=true,v=>v.decisions[0].occurrenceId='D',v=>v.decisions[0].disposition='rejected']){const changed=structuredClone(value);mutate(changed);structural(changed,false,c);assert.equal(parse(changed,c).value,null);}
 }
});
test('negative, owner-held, rejected target, real-repair syntax and optional terminal judgments do not invent BASE assignments',()=>{
 for(const value of [{...base,planAccepted:false,decisions:[]},{...base,ownerDecisionRequired:['Owner must choose scope'],decisions:[]}]){structural(value,true);assert.ok(parse(value).value);}
 for(const endpoint of [d('A','rejected'),d('A','upheld',{resolution:'repaired'})]){
  const value={...base,decisions:[endpoint,d('E','equivalent',{equivalentTo:'A',implementation:{kind:'none'}})]};structural(value,true);assert.ok(parse(value).value);assert.deepEqual(implementationCarryProposals(value,constraints.decisionCarry),[],'Actual repair proof remains a later host obligation');
 }
 const optional={...constraints,decisionReferences:{...refs,pendingOrdinaryIndexes:[0,1,4],blockingOrdinaryIndexes:[3]}};
 for(const verdict of ['upheld','deferred']){const value={...base,decisions:[d('A',verdict,verdict==='upheld'?{implementation:{kind:'none'}}:{}),d('E','equivalent',{equivalentTo:'A',implementation:{kind:'none'}}),d('optional','upheld',{implementation:{kind:'none'}})]};structural(value,true,optional);assert.ok(parse(value,optional).value);}
});
test('no omitted member, inherited assignment, reopened historical target or equivalent cycle can establish accepted-plan accounting',()=>{
 const omitted=accepted();omitted.decisions.pop();structural(omitted,false);assert.equal(parse(omitted).value,null);
 const omittedButCountMet=accepted();omittedButCountMet.decisions[1]=d('closed','upheld',{implementation:assign});structural(omittedButCountMet,true);assert.equal(parse(omittedButCountMet).value,null,'Count is not membership proof');
 const missing=accepted();delete missing.decisions[1].implementation;structural(missing,false);assert.equal(parse(missing).value,null);
 const inherited=accepted();inherited.decisions[1].implementation={kind:'none'};structural(inherited,true);assert.equal(parse(inherited).value,null,'Schema-local shape is not effective-chain accounting');
 const freshOverride={...base,decisions:[d('A','rejected'),d('E','equivalent',{equivalentTo:'closed',implementation:{kind:'none'}}),d('closed','upheld',{implementation:{kind:'none'}})]};structural(freshOverride,false);assert.equal(parse(freshOverride).value,null,'Fresh target judgment takes precedence over the captured old closure');
 const cycle={...base,decisions:[d('A','equivalent',{equivalentTo:'E',implementation:{kind:'none'}}),d('E','equivalent',{equivalentTo:'A',implementation:{kind:'none'}})]};structural(cycle,true);assert.equal(parse(cycle).value,null);
 const synthetic=accepted();synthetic.decisions.push(d('D','upheld',{implementation:{kind:'none'}}));structural(synthetic,false);assert.equal(parse(synthetic).value,null);
});
test('original reference/carry versions retain literal grammar and capture does not invent new keys or current state',()=>{
 const original=structuredClone(refs),captured=captureDecisionReferences(original);original.pendingOrdinaryIndexes.length=0;original.retentionChoices[0].sha256='f'.repeat(64);assert.deepEqual(captured,refs);
 for(const patch of [{occurrenceIds:Array(1)},{pendingOrdinaryIndexes:Array(1)},{blockingOrdinaryIndexes:Array(1)},{retentionChoices:Array(1)},{version:4},{pendingOrdinaryIndexes:[2]},{blockingOrdinaryIndexes:[99]},{pendingOrdinaryIndexes:[0,0]},{pendingOrdinaryIndexes:[0.5]},{retentionChoices:[...refs.retentionChoices,{...refs.retentionChoices[0],dispositionId:'other'}]},{retentionChoices:[{...refs.retentionChoices[0],occurrenceId:'A'}]}])assert.throws(()=>captureDecisionReferences({...refs,...patch}));
 for(const version of [1,2]){const old={decisionReferences:{version,occurrenceIds:refs.occurrenceIds,diagnosisOccurrenceIds:refs.diagnosisOccurrenceIds},decisionCarry:{version:1}};
  const value={...base,decisions:[d('A','upheld',{implementationCarry:{baselineVersion:'B',requirementIds:['R']}})]};assert.ok(parse(value,old).value);
  assert.equal(parse({...value,retainedDispositions:[]},old).value,null);assert.equal(parse(accepted(),old).value,null);
 }
});
