import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {adjudicationDecisionReferences,captureDecisionReferences} from '../../dist/workflow/role-input.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
const common={version:1,summary:'Independent retained observation assessment',findings:[],assessedScope:[]};
const references={version:1,occurrenceIds:['material','resolved-material','model-labelled-integrity','diagnostic','resolved-diagnostic'],diagnosisOccurrenceIds:['diagnostic','resolved-diagnostic']};
const disposition=(id='material',target='resolved-material')=>({occurrenceId:id,disposition:'equivalent',equivalentTo:target,reason:'Same independently assessed actual observation',witnesses:[]});
const raw=decisions=>JSON.stringify({...common,decisions});
const tool=(schema,value)=>validateToolArguments({name:'adjudication',parameters:schema},{type:'toolCall',id:'actual-ref-probe',name:'adjudication',arguments:structuredClone(value)});

test('fresh identity domains reject invented and synthetic equivalence without selecting independent verdicts',()=>{
 const constraints={decisionReferences:references};
 for(const stage of ['planning-adjudication','review-adjudication']){
  const schema=roleOutputSchema('adjudicator',stage,[],constraints),validate=new Ajv2020({strict:false}).compile(schema);
  assert.equal(schema.type,'object');assert.equal(schema.anyOf,undefined);
  const noTarget=disposition();delete noTarget.equivalentTo;
  const cases=[[[noTarget],false],[[disposition()],true],[[disposition('model-labelled-integrity')],true],[[disposition('diagnostic')],false],[[disposition('material','resolved-diagnostic')],false],[[disposition('material','owner-request finding upheld here')],false],[[disposition('invented')],false]];
  for(const value of ['upheld','rejected','deferred','unresolved'])cases.push([[{occurrenceId:'diagnostic',disposition:value,reason:'Independent judgment remains necessary',witnesses:[]}],true]);
  cases.push([[{occurrenceId:'diagnostic',disposition:'upheld',resolution:'diagnosed',reason:'Original raw independently assessed',witnesses:[],diagnosis:{outputId:'O',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:[]}}],true]);
  for(const [decisions,expected] of cases){const value={...common,decisions};assert.equal(validate(value),expected,JSON.stringify({decisions,errors:validate.errors}));assert.equal(!!parseRoleOutput(JSON.stringify(value),'adjudicator',[],constraints).value,expected);if(expected)assert.doesNotThrow(()=>tool(schema,value));else assert.throws(()=>tool(schema,value));}
 }
 const carry={occurrenceId:'material',baselineVersion:'original-base',requirementIds:['R'],reason:'Actual original BASE implementation remains pending'};
 for(const id of ['material','diagnostic','invented']){
  const value={...common,decisions:[],implementationCarries:[{...carry,occurrenceId:id}]},expected=id==='material';
  assert.equal(new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','planning-adjudication',[],constraints))(value),expected);
  assert.equal(!!parseRoleOutput(JSON.stringify(value),'adjudicator',[],constraints).value,expected);
 }
 // Membership is not proof of a valid historical chain: final host cycle/meaning checks remain necessary.
 assert.ok(parseRoleOutput(raw([disposition('material','material')]),'adjudicator',[],constraints).value);
});

test('known empty domains and all-diagnostic domains never create empty enum schemas or invented reference permission',()=>{
 for(const refs of [{version:1,occurrenceIds:[],diagnosisOccurrenceIds:[]},{version:1,occurrenceIds:['diagnostic'],diagnosisOccurrenceIds:['diagnostic']}]){
  const constraints={decisionReferences:refs},schema=roleOutputSchema('adjudicator','planning-adjudication',[],constraints),validate=new Ajv2020({strict:false}).compile(schema);
  assert.equal(validate({...common,decisions:[]}),true);assert.ok(parseRoleOutput(raw([]),'adjudicator',[],constraints).value);
  assert.equal(validate({...common,decisions:[disposition('diagnostic','diagnostic')]}),false);assert.equal(parseRoleOutput(raw([disposition('diagnostic','diagnostic')]),'adjudicator',[],constraints).value,null);
  assert.equal(validate({...common,decisions:[{occurrenceId:'diagnostic',disposition:'unresolved',reason:'Raw still unavailable',witnesses:[]}]}),refs.occurrenceIds.length>0);
 }
 const historical=disposition('unknown historical ID','historical prose alias');assert.ok(parseRoleOutput(raw([historical]),'adjudicator').value);
 assert.ok(new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','planning-adjudication'))({...common,decisions:[historical]}));
 assert.equal(adjudicationDecisionReferences('adjudicator',{stage:'planning-adjudication',occurrences:[]}),undefined,'Legacy occurrence context does not silently acquire new semantics');
});

test('versioned capture validates provenance domains and detaches callers before framing',()=>{
 const input=structuredClone(references),captured=adjudicationDecisionReferences('adjudicator',{stage:'planning-adjudication',decisionReferences:input});
 input.occurrenceIds.push('late');input.diagnosisOccurrenceIds.length=0;assert.deepEqual(captured,references);assert.ok(Object.isFrozen(captured.occurrenceIds));
 const schema=roleOutputSchema('adjudicator','planning-adjudication',[],{decisionReferences:references});schema.properties.decisions.items.properties.occurrenceId.enum.push('changed-copy');assert.equal(references.occurrenceIds.includes('changed-copy'),false);
 for(const value of [null,{}, {...references,version:3},{...references,extra:true},{...references,occurrenceIds:['material','material']},{...references,diagnosisOccurrenceIds:['foreign']},{...references,occurrenceIds:[null]},{...references,diagnosisOccurrenceIds:undefined}]){
  assert.throws(()=>captureDecisionReferences(value));assert.throws(()=>adjudicationDecisionReferences('adjudicator',{stage:'planning-adjudication',decisionReferences:value}));assert.equal(parseRoleOutput(raw([]),'adjudicator',[],{decisionReferences:value}).value,null);
 }
 for(const [role,stage]of [['reviewer','fresh-review'],['adjudicator','source-fit']])assert.throws(()=>adjudicationDecisionReferences(role,{stage,decisionReferences:references}));
});

test('v2 excludes synthetic code repair while v1 stays literal and ordinary labelled subjects remain ordinary',()=>{
 for(const version of [1,2])for(const stage of ['planning-adjudication','review-adjudication'])for(const id of ['material','model-labelled-integrity','diagnostic','resolved-diagnostic']){
  const refs={...references,version},constraints={decisionReferences:refs,diagnosisEligibility:{version:1,receiptHash:'a'.repeat(64),eligible:[]}};
  const value={...common,decisions:[{occurrenceId:id,disposition:'upheld',resolution:'repaired',reason:'A new explicit code repair request',witnesses:['actual-check']} ]};
  const expected=version===1||!refs.diagnosisOccurrenceIds.includes(id),schema=roleOutputSchema('adjudicator',stage,[],constraints),validate=new Ajv2020({strict:false}).compile(schema);
  assert.equal(validate(value),expected,JSON.stringify(validate.errors));assert.equal(!!parseRoleOutput(JSON.stringify(value),'adjudicator',[],constraints).value,expected);
  if(expected)assert.doesNotThrow(()=>tool(schema,value));else assert.throws(()=>tool(schema,value));
  assert.equal(captureDecisionReferences(refs).version,version);
 }
 const all={version:2,occurrenceIds:['D'],diagnosisOccurrenceIds:['D']},schema=roleOutputSchema('adjudicator','planning-adjudication',[],{decisionReferences:all});
 assert.ok(new Ajv2020({strict:false}).compile(schema)({...common,decisions:[{occurrenceId:'D',disposition:'unresolved',reason:'Exact raw needs assessment',witnesses:[]}]}));
 const missing={...common,decisions:[{occurrenceId:'D',disposition:'upheld',resolution:'repaired',reason:'Legacy remains literally decodable',witnesses:[]}]};
 assert.ok(parseRoleOutput(JSON.stringify(missing),'adjudicator').value);
});
