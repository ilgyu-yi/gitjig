import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {createSubjectActionProfile, captureSubjectActionProfile, subjectActionResponseHash, subjectActionSchema, subjectActionView, decodeSubjectActionOutput, prepareSubjectActionInput, adjudicationSubjectActions, subjectActionFootprint} from '../../dist/workflow/subject-actions.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {presentMetadataIdentities,restoreMetadataIdentities,metadataIdentityFootprint} from '../../dist/workflow/metadata-identities.js';
import {readFixtureMetadataContext} from './current-verification-fixture.mjs';
import {roleRecipeGuidance} from './role-recipe-guidance.mjs';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {parseRoleOutput, MAX_FINAL_BYTES} from '../../dist/workflow/protocol.js';
const refs={version:3,occurrenceIds:['F0','F1','D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[{occurrenceId:'D',dispositionId:'OLD-D',sha256:'a'.repeat(64)}]};
const constraints={decisionReferences:refs,decisionCarry:{version:2},diagnosisEligibility:{version:1,receiptHash:'b'.repeat(64),eligible:[]}};
const profile=createSubjectActionProfile('planning-adjudication',refs);
const common={version:1,summary:'Actual independently assessed choices',findings:[],assessedScope:[],planAccepted:true};
const assigned={kind:'assign-to-plan',baselineVersion:'BASE',requirementIds:['R']};
const body=()=>({...common,subjectActionsHash:subjectActionResponseHash(profile,refs),decisionActions:{s0:{disposition:'upheld',reason:'Actual BASE defect',witnesses:[],implementation:assigned},s1:{disposition:'equivalent',equivalentTo:'s0',reason:'Same independently assessed defect',witnesses:[],implementation:assigned},s2:'retain'}});
const decode=(wire,p=profile,r=refs,limit=MAX_FINAL_BYTES)=>decodeSubjectActionOutput(typeof wire==='string'?wire:JSON.stringify(wire),p,r,limit);
const parse=(value,c=constraints)=>parseRoleOutput(JSON.stringify(value),'adjudicator',[],c);
const ajv=new Ajv2020({strict:false});

test('one keyed subject action expands into existing canonical accounting without changing producer bytes or eligibility',()=>{
 const wire=body(),before=JSON.stringify(wire),result=decode(wire);
 assert.equal(JSON.stringify(wire),before);assert.deepEqual(result.decisions.map(x=>x.occurrenceId),['F0','F1']);assert.equal(result.decisions[1].equivalentTo,'F0');assert.deepEqual(result.retainedDispositions,['OLD-D']);assert.equal(result.decisionActions,undefined);
 assert.deepEqual(parse(result).issues,[]);assert.equal(subjectActionView(profile,refs).subjects[2].retainDispositionId,'OLD-D');
 const oldReply={...wire,decisions:[]};assert.equal(parse(oldReply).value,null,'Old literal-only parsing never accepts the new grammar');
 const oldInvalid={...common,decisions:[{occurrenceId:'162',disposition:'upheld',reason:'Original invalid reference string',witnesses:[],implementation:assigned}]};assert.equal(parse(oldInvalid).value,null);
});

test('wire and canonical schemas preserve ordinary, diagnostic, conditional acceptance and unchanged-subject choices',()=>{
 const original=roleOutputSchema('adjudicator','planning-adjudication',[],constraints),before=JSON.stringify(original),wireSchema=subjectActionSchema(original,profile,refs),oldValid=ajv.compile(original),newValid=ajv.compile(wireSchema);
 assert.equal(JSON.stringify(original),before);assert.ok(wireSchema.definitions);assert.equal(wireSchema.properties.decisionActions.properties.s0.$ref,wireSchema.properties.decisionActions.properties.s1.$ref);assert.equal(new Set(Object.values(wireSchema.definitions).map(x=>JSON.stringify(x))).size,Object.keys(wireSchema.definitions).length);
 for(const change of [()=>{},v=>{delete v.decisionActions.s2},v=>{v.planAccepted=false;v.decisionActions={}},v=>{delete v.decisionActions.s0.implementation},v=>{v.decisionActions.s2={disposition:'upheld',reason:'Do not reissue a diagnosis',witnesses:[],implementation:{kind:'none'}}},v=>{v.decisionActions.s2={disposition:'unresolved',reason:'Current unavailable evidence',witnesses:[]}}]){
  const wire=body();change(wire);const canonical=decode(wire);assert.equal(newValid(wire),oldValid(canonical),JSON.stringify({wire,newErrors:newValid.errors,oldErrors:oldValid.errors}));
 }
 const hold={...common,planAccepted:false,subjectActionsHash:subjectActionResponseHash(profile,refs),decisionActions:{}};assert.ok(newValid(hold));assert.deepEqual(parse(decode(hold)).issues,[],'A decline never acquires a new duty to decide every pending subject');
});

test('parallel actions, literal aliases, duplicate raw keys and foreign equivalent identities cannot reach canonical authority',()=>{
 for(const mutate of [v=>v.decisions=[],v=>v.retainedDispositions=['OLD-D'],v=>v.decisionActions.s0='retain',v=>v.decisionActions.s0.occurrenceId='F0',v=>v.decisionActions.s1.equivalentTo='F0',v=>v.decisionActions.s1.equivalentTo='s2',v=>v.decisionActions.s1.equivalentTo='162',v=>v.decisionActions.s0='162',v=>v.decisionActions.s0={ref:0,occurrenceId:'F0'},v=>v.decisionActions['162']=v.decisionActions.s0]){
  const wire=body();mutate(wire);assert.throws(()=>decode(wire));
 }
 assert.throws(()=>decode('{"version":1,"decisionActions":{"s0":"retain","s0":{}}}'),/duplicate/i);
 const freshAndRetain={...common,decisions:[{occurrenceId:'D',disposition:'upheld',reason:'No new decision, handled by retention',witnesses:[]}],retainedDispositions:['OLD-D']};assert.equal(parse(freshAndRetain).value,null,'The old overlap counterexample remains rejected');
 const cycle=body();cycle.decisionActions.s0={...cycle.decisionActions.s1,equivalentTo:'s1'};assert.equal(parse(decode(cycle)).value,null,'A valid short-key lookup never waives graph-cycle validation');
});

test('profile binds original order, pending/retention operands and exact declaration without model-selected fallback',()=>{
 for(const mutate of [r=>r.occurrenceIds.reverse(),r=>r.retentionChoices[0].sha256='c'.repeat(64),r=>r.pendingOrdinaryIndexes=[0],r=>r.occurrenceIds=Array(3)]){
  const changed=structuredClone(refs);mutate(changed);assert.throws(()=>decode(body(),profile,changed));
 }
 for(const value of [{...profile,version:99},{...profile,stage:'raw-assessment'},{...profile,stage:['planning-adjudication']},{...profile,stage:{toString:()=> 'planning-adjudication'}},{...profile,role:'planner'},{...profile,extra:true}])assert.throws(()=>captureSubjectActionProfile(value,refs));
});

test('a previously resolved ordinary subject still admits a supported fresh contrary decision instead of retention',()=>{
 const r={...refs,pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[...refs.retentionChoices,{occurrenceId:'F1',dispositionId:'OLD-F1',sha256:'d'.repeat(64)}]},p=createSubjectActionProfile('planning-adjudication',r),c={...constraints,decisionReferences:r};
 const wire=body();wire.decisionActions.s1={disposition:'rejected',reason:'New contrary source evidence',witnesses:['Actual current source']};wire.subjectActionsHash=subjectActionResponseHash(p,r);const canonical=decode(wire,p,r);assert.deepEqual(parse(canonical,c).issues,[]);assert.equal(canonical.retainedDispositions.includes('OLD-F1'),false);
});

test('canonical amplification is refused before accumulating the entire expanded answer and exact byte boundary stays usable',()=>{
 const r={version:3,occurrenceIds:['u'.repeat(600),'v'.repeat(600)],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[],blockingOrdinaryIndexes:[],retentionChoices:[]},p=createSubjectActionProfile('review-adjudication',r),wire={version:1,subjectActionsHash:subjectActionResponseHash(p,r),summary:'Bounded',findings:[],assessedScope:[],decisionActions:{s0:{disposition:'unresolved',reason:'Held',witnesses:[]},s1:{disposition:'unresolved',reason:'Held',witnesses:[]}}};
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<1024);assert.throws(()=>decode(wire,p,r,1024),/canonical output bound/);const full=decode(wire,p,r),size=Buffer.byteLength(JSON.stringify(full));assert.deepEqual(decode(wire,p,r,size),full);assert.throws(()=>decode(wire,p,r,size-1),/canonical output bound/);
});

test('active diagnosis conditions and required material sibling judgments remain canonical gates',()=>{
 const c={...constraints,diagnosisEligibility:{version:1,receiptHash:'b'.repeat(64),eligible:[{occurrenceId:'D',outputId:'OUT',rawSha256:'c'.repeat(64),materialOccurrenceIds:['F0']}]}};
 const oldSchema=roleOutputSchema('adjudicator','planning-adjudication',[],c),newSchema=subjectActionSchema(oldSchema,profile,refs),oldValid=ajv.compile(oldSchema),newValid=ajv.compile(newSchema);
 const good=body();good.decisionActions.s2={disposition:'upheld',resolution:'diagnosed',reason:'Assessed original raw and every sibling',witnesses:['Original source'],diagnosis:{outputId:'OUT',rawSha256:'c'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:['F0']}};
 for(const mutate of [()=>{},v=>{v.decisionActions.s2.diagnosis.rawSha256='d'.repeat(64)},v=>{v.decisionActions.s0={...v.decisionActions.s2}},v=>{v.decisionActions.s2.implementation={kind:'none'}}]){
  const wire=structuredClone(good);mutate(wire);const canonical=decode(wire);assert.equal(newValid(wire),oldValid(canonical),JSON.stringify({wire,newErrors:newValid.errors,oldErrors:oldValid.errors}));
 }
 assert.deepEqual(parse(decode(good),c).issues,[]);
 const missing=structuredClone(good);delete missing.decisionActions.s0;assert.equal(parse(decode(missing),c).value,null,'Choosing a diagnosis cannot erase its separate material sibling judgment');
});

test('subject views are immutable snapshots and unsupported schema predicates cannot be silently dropped',()=>{
 const view=subjectActionView(profile,refs);assert.ok(Object.isFrozen(view));assert.ok(Object.isFrozen(view.subjects));assert.ok(Object.isFrozen(view.subjects[0]));assert.throws(()=>{view.subjects[0].occurrenceId='other'});
 const schema=roleOutputSchema('adjudicator','planning-adjudication',[],constraints);schema.properties.decisions.items.properties.occurrenceId.pattern='^F';assert.throws(()=>subjectActionSchema(schema,profile,refs),/unsupported subject predicate/);
});

test('schema literal values remain opaque and unsupported bound-else branches refuse rather than weaken constraints',()=>{
 const schema=roleOutputSchema('adjudicator','planning-adjudication',[],constraints),literal={properties:{occurrenceId:{type:'string',enum:['literal']},equivalentTo:{type:'string',enum:['opaque']}}};
 schema.properties.decisions.items.properties.literalAnnotation={type:'object',const:literal};const wire=subjectActionSchema(schema,profile,refs);assert.ok(Object.values(wire.definitions).some(body=>JSON.stringify(body.properties?.literalAnnotation?.const)===JSON.stringify(literal)));
 const conditional=roleOutputSchema('adjudicator','planning-adjudication',[],constraints);conditional.properties.decisions.items.allOf.push({type:'object',if:{type:'object',required:['occurrenceId'],properties:{occurrenceId:{type:'string',const:'F0'}}},then:{type:'object'},else:{type:'object',required:['witnesses']}});assert.throws(()=>subjectActionSchema(conditional,profile,refs),/unsupported subject else predicate/);
});


test('original raw hash prevents remapping even when altered metadata is internally self-consistent',()=>{
 const changed=structuredClone(refs);changed.occurrenceIds[0]='ANOTHER';const p=createSubjectActionProfile('planning-adjudication',changed);assert.throws(()=>decode(body(),p,changed),/raw output does not bind/);
 const noHash=body();delete noHash.subjectActionsHash;assert.throws(()=>decode(noHash),/raw output does not bind/);
});

function inputContext(stage='planning-adjudication') {
 return {stage,subjectActionsInput:{version:1},metadataIdentityInput:{version:3},baseVersion:'BASE',decisionReferences:structuredClone(refs),...(stage==='planning-adjudication'?{decisionCarry:{version:2}}:{}),occurrences:refs.occurrenceIds.map(id=>({id,work:'WORK'.repeat(100),output:'OUTPUT'.repeat(100),data:{finding:{requirementId:'R',description:'Literal '+id,evidence:['WORK']}}}))};
}

test('captured subject input survives lossless metadata transport and original framing without changing findings',()=>{
 for(const stage of ['planning-adjudication','review-adjudication']){
  const original=inputContext(stage),before=structuredClone(original),context=prepareSubjectActionInput('adjudicator',original),wire=presentMetadataIdentities('adjudicator',context);
  assert.deepEqual(original,before);assert.equal(wire.metadataIdentityEncoding.version,3);
  assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),context);
  assert.deepEqual(readFixtureMetadataContext(wire),context,'Independent provider decoder observes the same literal subjects');
  assert.deepEqual(wire.subjectActionsView,context.subjectActionsView,'Subject lookup stays literal beside input refs');
  assert.deepEqual(context.occurrences.map(row=>row.subjectKey),['s0','s1','s2']);
  assert.deepEqual(context.occurrences.map(row=>row.data.finding),before.occurrences.map(row=>row.data.finding));
  const captured=adjudicationSubjectActions('adjudicator',context),framing=roleFraming('adjudicator',{requirements:[],contracts:'Original criteria',sources:[],requiredScope:[],context},true);
  assert.equal(framing.schema.properties.decisions,undefined);assert.equal(framing.schema.properties.subjectActionsHash.const,context.subjectActionsView.responseHash);
  const output=body();if(stage==='review-adjudication'){delete output.planAccepted;for(const action of Object.values(output.decisionActions))if(typeof action==='object')delete action.implementation;}
  output.subjectActionsHash=subjectActionResponseHash(captured,refs);
  assert.equal(ajv.compile(framing.schema)(output),true);
  const parseConstraints={...constraints,subjectActions:captured};if(stage==='review-adjudication')delete parseConstraints.decisionCarry;
  const raw=JSON.stringify(output),parsed=parseRoleOutput(raw,'adjudicator',[],parseConstraints);
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.value.decisions[0].occurrenceId,'F0');assert.equal(raw,JSON.stringify(output));
  assert.equal(parseRoleOutput(raw,'adjudicator',[],constraints).value,null,'Historical literal reader never infers the new recipe');
  assert.equal(parseRoleOutput(JSON.stringify(decode(output,captured)),'adjudicator',[],parseConstraints).value,null,'Canonical derived data cannot impersonate original encoded source');
 }
});

test('capture refuses malformed declaration, missing display, mixed metadata and changed replay operands',()=>{
 const base=inputContext(),prepared=prepareSubjectActionInput('adjudicator',base),footprint=subjectActionFootprint('adjudicator',prepared);
 for(const mutate of [c=>delete c.subjectActionsProfile,c=>delete c.subjectActionsView,c=>c.subjectActionsView.subjects.reverse(),c=>c.baseVersion='OTHER',c=>c.occurrences[0].subjectKey='s1',c=>c.occurrences.pop(),c=>c.decisionReferences.retentionChoices[0].sha256='e'.repeat(64)]){
  const changed=structuredClone(prepared);mutate(changed);assert.throws(()=>adjudicationSubjectActions('adjudicator',changed));
 }
 for(const mutate of [c=>c.subjectActionsInput.version=2,c=>c.subjectActionsInput.extra=true,c=>c.metadataIdentityInput.version=1,c=>c.metadataIdentityInput.extra=true,c=>c.stage='raw-assessment',c=>delete c.occurrences,c=>c.occurrences[1]=c.occurrences[0],c=>c.occurrences[0].subjectKey='s0']){
  const changed=structuredClone(base);mutate(changed);assert.throws(()=>prepareSubjectActionInput('adjudicator',changed));
 }
 assert.throws(()=>prepareSubjectActionInput('planner',base));
 assert.throws(()=>prepareSubjectActionInput('adjudicator',prepared),'No rebinding a captured view');
 const metadata={...prepared,inputVersions:{base:'BASE'}};delete metadata.baseVersion;delete metadata.occurrences;
 assert.equal(subjectActionFootprint('adjudicator',metadata),footprint,'Stored original metadata uses the same base and domain');
 const legacy={stage:'planning-adjudication',decisionReferences:refs};assert.equal(prepareSubjectActionInput('adjudicator',legacy),legacy);assert.equal(adjudicationSubjectActions('adjudicator',legacy),undefined);
});

function literalInput(stage='review-adjudication') {
 const context=inputContext(stage);context.subjectActionsInput={version:2};delete context.metadataIdentityInput;
 context.pendingObligations=[{id:'F0',occurrence:'F0'}];
 context.occurrences[0].data.finding.literalAnnotation={ref:5};
 return context;
}
for(const stage of ['planning-adjudication','review-adjudication'])test('literal keyed composition preserves direct subject/body identity and canonical actions: '+stage,()=>{
 const original=literalInput(stage),before=structuredClone(original),context=prepareSubjectActionInput('adjudicator',original);
 assert.deepEqual(original,before);assert.equal(context.subjectActionsProfile.version,2);assert.equal(context.subjectActionsView.version,2);
 assert.equal(presentMetadataIdentities('adjudicator',context),context);assert.equal(Object.hasOwn(context,'metadataIdentityEncoding'),false);
 assert.deepEqual(context.occurrences.map(row=>[row.id,row.subjectKey]),[['F0','s0'],['F1','s1'],['D','s2']]);
 assert.deepEqual(context.occurrences.map(row=>row.data.finding),before.occurrences.map(row=>row.data.finding));
 const p=adjudicationSubjectActions('adjudicator',context),wire=body();wire.subjectActionsHash=subjectActionResponseHash(p,refs);
 if(stage==='review-adjudication'){delete wire.planAccepted;for(const action of Object.values(wire.decisionActions))if(typeof action==='object')delete action.implementation;}
 const framing=roleFraming('adjudicator',{requirements:[],contracts:'Original criteria',sources:[],requiredScope:[],context},true);
 assert.equal(ajv.compile(framing.schema)(wire),true);assert.match(framing.systemPrompt,/No metadata identity dictionary expansion/);
 assert.deepEqual(parseRoleOutput(JSON.stringify(wire),'adjudicator',[],{...constraints,...(stage==='review-adjudication'?{decisionCarry:undefined}:{}),subjectActions:p}).issues,[]);
 const canonical=decode(wire,p);assert.deepEqual(canonical.decisions.map(row=>row.occurrenceId),['F0','F1']);assert.deepEqual(canonical.retainedDispositions,['OLD-D']);
 assert.throws(()=>decode(wire,createSubjectActionProfile(stage,refs)),/original subject map/);
 const footprint=subjectActionFootprint('adjudicator',context);const changed=structuredClone(context);changed.occurrences[0].data.finding.description+=' changed';
 assert.notEqual(subjectActionFootprint('adjudicator',changed),footprint,'Complete original bodies are bound even without a finding-body profile');
 assert.equal(metadataIdentityFootprint('adjudicator',context).length,64);
});

test('literal composition refuses hidden reference metadata, absent bodies and contradictory captures',()=>{
 const original=literalInput(),prepared=prepareSubjectActionInput('adjudicator',original);
 for(const edit of [c=>c.metadataIdentityInput={version:3},c=>c.metadataIdentityInput=undefined,c=>c.metadataIdentityEncoding={version:3,ids:['F0']},c=>c.metadataIdentityEncoding=undefined,c=>c.pendingObligations[0].id={ref:0},c=>c.occurrences[0].id={ref:0},c=>delete c.occurrences[0].data.finding,c=>c.occurrences[0].data.finding=undefined,c=>delete c.occurrences,c=>c.subjectActionsInput.extra=true,c=>c.stage='raw-assessment']){
  const changed=structuredClone(original);edit(changed);assert.throws(()=>prepareSubjectActionInput('adjudicator',changed));
 }
 assert.throws(()=>prepareSubjectActionInput('reviewer',original));
 const changed=structuredClone(prepared);changed.subjectActionsProfile.version=1;assert.throws(()=>adjudicationSubjectActions('adjudicator',changed));
 const noBodies=structuredClone(prepared);delete noBodies.occurrences;assert.throws(()=>subjectActionFootprint('adjudicator',noBodies));
 const moved=structuredClone(prepared);moved.pendingObligations[0].id='F1';assert.notEqual(metadataIdentityFootprint('adjudicator',moved),metadataIdentityFootprint('adjudicator',prepared));
 assert.deepEqual(prepared.occurrences[0].data.finding.literalAnnotation,{ref:5},'Reference-shaped literal evidence is opaque');
});

test('captured v1 response, schema, input and role guidance retain their original interpretation',()=>{
 const gold={
 'planning-adjudication':['ff0ab2cfc44f75a3e0c0aca16def55b497c094f5a5ec5ad3679d12c4fbc3b654','157494da047961275dc58e402bb898333b9e9c3dd2cb79d33adaee4f51e19287','17f30af550d03eada3b591908faec4c2f13ccc3673eda652e610618379a6e3c1','5649f6d3ea4d1f979ddeb7336765b03a7fe342172388c0abb20aad080d7d169a'],
 'review-adjudication':['75f758731b002af352b9412521c6f0f3dbd897df6ae89cdaceaa7250300e6468','0bbf4b760e137afcbff79b90347b65d1b795c4bb1104dd00944b6310f3e12fc2','26fb86c5a8f97ec7a0daa33777bd5acf04fdd7ed03c6cfca642ae7bc62a8ffe8','c21f09694532515bd033dd0c7c72549f466e1b0bf6fa7ac16200c3a59ce18ea5']};
 const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
 for(const [stage,expected]of Object.entries(gold)){
  const context=prepareSubjectActionInput('adjudicator',inputContext(stage)),f=roleFraming('adjudicator',{requirements:[],contracts:'Original criteria',sources:[],requiredScope:[],context},true);
  assert.deepEqual([subjectActionResponseHash(context.subjectActionsProfile,refs),hash(f.schema),hash(f.prompt),
   hash(roleRecipeGuidance(f.systemPrompt,stage==='planning-adjudication'))],expected);
 }
});
