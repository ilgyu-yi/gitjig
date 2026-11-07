import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {adjudicationDiagnosisEligibility,captureDiagnosisEligibility} from '../../dist/workflow/role-input.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';

const refs={version:1,occurrenceIds:['material','other-material','diagnostic','historical-diagnostic'],diagnosisOccurrenceIds:['diagnostic','historical-diagnostic']};
const operand={occurrenceId:'diagnostic',outputId:'actual-output',rawSha256:'a'.repeat(64),materialOccurrenceIds:['material','other-material']};
const eligibility={version:1,receiptHash:'b'.repeat(64),eligible:[operand]};
const common={version:1,summary:'Independent current assessment',findings:[],assessedScope:[]};
const decision=()=>({occurrenceId:'diagnostic',disposition:'upheld',reason:'Exact supplied raw independently assessed',witnesses:[],resolution:'diagnosed',diagnosis:{outputId:operand.outputId,rawSha256:operand.rawSha256,inputReceiptHash:eligibility.receiptHash,materialOccurrenceIds:[...operand.materialOccurrenceIds]}});
const reply=d=>({...common,decisions:[...operand.materialOccurrenceIds.map(occurrenceId=>({occurrenceId,disposition:'rejected',reason:'Independent current assessment of this bound sibling',witnesses:[]})),d]});
const context=()=>({stage:'planning-adjudication',decisionReferences:structuredClone(refs),diagnosisEligibility:{version:1},producerDiagnosticReceipt:{receiptHash:eligibility.receiptHash,eligible:structuredClone(eligibility.eligible)}});
function verify(constraints,value,expected,stage='planning-adjudication'){
 const schema=roleOutputSchema('adjudicator',stage,[],constraints);
 assert.equal(new Ajv2020({strict:false}).compile(schema)(value),expected,JSON.stringify(value));
 assert.equal(!!parseRoleOutput(JSON.stringify(value),'adjudicator',[],constraints).value,expected);
 const invoke=()=>validateToolArguments({name:'adjudication',parameters:schema},{type:'toolCall',id:'diagnosis-probe',name:'adjudication',arguments:structuredClone(value)});
 if(expected)assert.doesNotThrow(invoke);else assert.throws(invoke);
}

test('current receipt tuples constrain diagnosis in schema, public SDK arguments and strict decoding',()=>{
 const constraints={decisionReferences:refs,diagnosisEligibility:eligibility};
 for(const stage of ['planning-adjudication','review-adjudication']){
  verify(constraints,reply(decision()),true,stage);
  const reordered=decision();reordered.diagnosis.materialOccurrenceIds.reverse();verify(constraints,reply(reordered),true,stage);
  const mutations=[d=>d.occurrenceId='historical-diagnostic',d=>d.diagnosis.outputId='old-output',d=>d.diagnosis.rawSha256='c'.repeat(64),d=>d.diagnosis.inputReceiptHash='d'.repeat(64),d=>d.diagnosis.materialOccurrenceIds=[],d=>d.diagnosis.materialOccurrenceIds=['material','material'],d=>d.diagnosis.materialOccurrenceIds=['material','foreign'],d=>d.disposition='rejected'];
  for(const mutate of mutations){const d=decision();mutate(d);verify(constraints,reply(d),false,stage);}
 }
});

test('a new diagnosis still requires each bound sibling decision, including an already resolved subject',()=>{
 const constraints={decisionReferences:refs,diagnosisEligibility:eligibility},missing=reply(decision());missing.decisions.shift();
 assert.equal(new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','planning-adjudication',[],constraints))(missing),true,'Cross-decision accounting remains a strict host check, not schema syntax alone');
 const refused=parseRoleOutput(JSON.stringify(missing),'adjudicator',[],constraints);assert.equal(refused.value,null);assert.match(refused.issues.join(),/every bound material sibling decision/);
 verify(constraints,reply(decision()),true);
});

test('empty current eligibility preserves historical references but forbids reissuing their diagnosis',()=>{
 const constraints={decisionReferences:refs,diagnosisEligibility:{...eligibility,eligible:[]}};
 verify(constraints,{...common,decisions:[]},true);
 for(const id of refs.diagnosisOccurrenceIds){const d=decision();d.occurrenceId=id;verify(constraints,reply(d),false);}
 // Historical identity protection remains: a synthetic target cannot absorb material work.
 verify(constraints,{...common,decisions:[{occurrenceId:'material',disposition:'equivalent',equivalentTo:'historical-diagnostic',reason:'Unsupported waiver',witnesses:[]}]},false);
 const c=context();c.producerDiagnosticReceipt.eligible=[];
 const framed=roleFraming('adjudicator',{requirements:[],contracts:'',sources:[],requiredScope:[],context:c});
 assert.match(framed.systemPrompt,/not a mandatory action roster/);assert.match(framed.systemPrompt,/omitting unchanged historical decisions/);
});

test('prospective declaration is explicit, validated and detached from subsequent caller mutation',()=>{
 const c=context(),body={requirements:[],contracts:'',sources:[],requiredScope:[],context:c};
 const framed=roleFraming('adjudicator',body);
 c.producerDiagnosticReceipt.receiptHash='c'.repeat(64);c.producerDiagnosticReceipt.eligible[0].materialOccurrenceIds.length=0;c.producerDiagnosticReceipt.eligible.length=0;c.decisionReferences.diagnosisOccurrenceIds.length=0;
 assert.deepEqual(framed.constraints.diagnosisEligibility,eligibility);assert.ok(Object.isFrozen(framed.constraints.diagnosisEligibility.eligible[0].materialOccurrenceIds));
 verify(framed.constraints,reply(decision()),true);
 const legacy=context();delete legacy.diagnosisEligibility;assert.equal(adjudicationDiagnosisEligibility('adjudicator',legacy),undefined);
 verify({decisionReferences:refs},reply(decision()),true,'review-adjudication');
 for(const declaration of [null,{}, {version:2},{version:1,extra:true}])assert.throws(()=>adjudicationDiagnosisEligibility('adjudicator',{...context(),diagnosisEligibility:declaration}));
 for(const invalid of [{...eligibility,eligible:[{...operand,occurrenceId:'material'}]},{...eligibility,eligible:[{...operand,materialOccurrenceIds:['foreign']}]},{...eligibility,eligible:[operand,operand]},{...eligibility,receiptHash:'bad'},null])assert.throws(()=>captureDiagnosisEligibility(invalid,refs));
 assert.throws(()=>captureDiagnosisEligibility(eligibility));
 for(const [role,stage]of [['reviewer','fresh-review'],['adjudicator','source-fit']])assert.throws(()=>adjudicationDiagnosisEligibility(role,{...context(),stage}));
});
