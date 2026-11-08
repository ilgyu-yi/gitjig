import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mixedPlan,initialVerificationProfile} from './mixed-verification-fixture.mjs';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {captureSourceFitReferences,sourceFitReferencesInput,sourceFitRequirements} from '../../dist/workflow/role-input.js';
import {presentMetadataIdentities,restoreMetadataIdentities} from '../../dist/workflow/metadata-identities.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required=[{inputId:'held-input',directionRevision:2}];
const references=(stage='planning-adjudication',requirementIds=['retained-R'])=>({version:1,stage,inputs:structuredClone(required),requirementIds});
const plan=id=>({intent:'Preserve owner behavior',requirements:[{id,text:'Actual task requirement',source:'owner-request'}],approach:'Use the existing consumer',simplerAlternative:'Keep the current implementation',factualSources:[],ambiguities:[],verification:{checks:[{id:'check',guaranteeIds:[id],command:'node check.cjs',assertions:['observed'],timeoutMs:1000,fixturePaths:['consumer.cjs']}],requiredPaths:['consumer.cjs'],reviewRoles:[{key:'independent',kind:'reviewer',purpose:'Inspect actual behavior',requiredPaths:['consumer.cjs']}]}});
const output=(ids=['new-R'],extra={})=>({version:1,summary:'Independent source interpretation',findings:[],assessedScope:[],decisions:[],planAccepted:true,acceptedPlan:plan('new-R'),inputDecisions:[{inputId:'held-input',directionRevision:2,impact:'explanation',reason:'The actual source preserves the requested behavior',requirementIds:ids}],...extra});
const decode=(value,refs=references(),extra={})=>parseRoleOutput(JSON.stringify(value),'adjudicator',required,{sourceFitReferences:refs,...extra});
const context=stage=>({stage,sourceFitReferences:references(stage),sourceInputChain:[{input_id:'held-input',revision:2,text:'Preserve the same original task',data:{effectHold:true}}]});
const bundle=stage=>({requirements:[{id:'owner-request',text:'Normalized original owner intent',source:'owner-request'}],contracts:'Keep independent source fit.',sources:[],requiredScope:[],context:context(stage)});

test('accepting planning checks its own effective plan, not owner/source or retained IDs',()=>{
 assert.ok(decode(output()).value);
 for(const id of ['owner-request','retained-R','unknown']){
  const rejected=decode(output(['new-R',id]));assert.equal(rejected.value,null);assert.match(rejected.issues.join(),/effective plan requirements, not input\/source locators/);
 }
 assert.ok(decode(output([])).value,'Membership does not invent a coverage verdict');
 assert.ok(decode(output(['owner-request'],{acceptedPlan:plan('owner-request')})).value,'A literal is valid when it actually names a declared requirement; there is no locator blacklist');
});
test('qualified unchanged proposal approval supplies planning reference domain',()=>{
 const proposal=mixedPlan(),approval={version:1,plannerOutputId:'planner-output',proposalHash:sha(proposal),plannerOutputHash:'a'.repeat(64),proposal};
 const value=output(['behavior']);delete value.acceptedPlan;
 assert.ok(decode(value,references(),{proposalApproval:approval,planningProfile:initialVerificationProfile}).value);
 assert.ok(parseRoleOutput(JSON.stringify(value),'adjudicator',[],{sourceFitReferences:references(),proposalApproval:approval,planningProfile:initialVerificationProfile}).value);
 value.inputDecisions[0].requirementIds=['owner-request'];assert.equal(decode(value,references(),{proposalApproval:approval,planningProfile:initialVerificationProfile}).value,null);
});
for(const extra of [{planAccepted:false},{ownerDecisionRequired:['Clarify the actual owner ambiguity']}])test('planning without adoption preserves unused-reference semantics '+JSON.stringify(extra),()=>{
 assert.ok(decode(output(['not-an-accepted-requirement'],extra)).value);
});
for(const stage of ['source-fit','review-adjudication'])test(stage+' uses retained domain despite stray accepted plan',()=>{
 assert.ok(decode(output(['retained-R']),references(stage)).value);
 assert.equal(decode(output(['new-R']),references(stage)).value,null);
 assert.ok(decode(output([]),references(stage,[])).value);
 assert.equal(decode(output(['retained-R']),references(stage,[])).value,null);
});
test('owner decision defers dedicated fit but not review source classification',()=>{
 const value=output(['not-in-domain'],{ownerDecisionRequired:['Need an owner decision']});
 assert.ok(decode(value,references('source-fit')).value);
 assert.equal(decode(value,references('review-adjudication')).value,null);
});
test('historical marker absence retains original parser and review tuple coverage',()=>{
 assert.ok(parseRoleOutput(JSON.stringify(output(['new-R','owner-request'])),'adjudicator',required).value);
 const old=bundle('review-adjudication');delete old.context.sourceFitReferences;
 assert.deepEqual(sourceFitRequirements('adjudicator',old.context),[]);
 const first=roleFraming('adjudicator',old),second=roleFraming('adjudicator',structuredClone(old));
 assert.deepEqual(second,first);assert.equal(first.constraints.sourceFitReferences,undefined);
 assert.equal(first.schema.required.includes('inputDecisions'),false);
});
for(const stage of ['planning-adjudication','source-fit','review-adjudication'])test('one captured '+stage+' contract guides schema and decoder without verdict',()=>{
 const value=bundle(stage),framing=roleFraming('adjudicator',value);
 assert.deepEqual(framing.sourceFit,required);assert.deepEqual(framing.constraints.sourceFitReferences,references(stage));
 assert.ok(framing.schema.required.includes('inputDecisions'));assert.ok(framing.schema.properties.inputDecisions.description.includes(JSON.stringify(references(stage))));
 assert.match(framing.schema.properties.inputDecisions.description,/Requirement IDs are distinct from input\/source locators/);
 assert.match(framing.schema.properties.inputDecisions.description,/Use scope-change when an authorized direction changes one of those obligations or premises/);
 value.context.sourceFitReferences.requirementIds.push('after-capture');value.context.sourceInputChain.push({input_id:'new-input',revision:3,data:{effectHold:true}});
 assert.deepEqual(framing.constraints.sourceFitReferences.requirementIds,['retained-R']);assert.deepEqual(framing.sourceFit,required);
 assert.ok(Object.isFrozen(framing.constraints.sourceFitReferences.requirementIds));
 const missing=output(stage==='planning-adjudication'?['new-R']:['retained-R']);delete missing.inputDecisions;
 assert.equal(parseRoleOutput(JSON.stringify(missing),'adjudicator',framing.sourceFit,framing.constraints).value,null);
});
test('fresh-review reviewers never acquire adjudicator input duties',()=>{
 const value=bundle('fresh-review');delete value.context.sourceFitReferences;
 assert.deepEqual(sourceFitRequirements('reviewer',value.context),[]);
 value.context.sourceFitReferences=references('review-adjudication');assert.throws(()=>roleFraming('reviewer',value),/original adjudicator stage/);
});
for(const bad of [null,{...references('source-fit'),version:2},{...references('source-fit'),stage:'fresh-review'},{...references('source-fit'),requirementIds:['R','R']},{...references('source-fit'),requirementIds:[null]},{...references('source-fit'),extra:true}])test('invalid original domain refuses '+JSON.stringify(bad),()=>assert.throws(()=>captureSourceFitReferences(bad),/references unavailable/));
test('marker cannot be rebound to another stage or reviewer',()=>{
 assert.throws(()=>sourceFitReferencesInput('adjudicator',{stage:'source-fit',sourceFitReferences:references()}),/original adjudicator stage/);
 assert.throws(()=>sourceFitReferencesInput('reviewer',context('planning-adjudication')),/original adjudicator stage/);
});
test('existing metadata recipes retain literal requirement domain and roundtrip it unchanged',()=>{
 const value={...context('review-adjudication'),metadataIdentityInput:{version:2},ownerSource:'source-opaque'};
 const presented=presentMetadataIdentities('adjudicator',value);
 assert.deepEqual(presented.sourceFitReferences,value.sourceFitReferences);
 assert.deepEqual(restoreMetadataIdentities('adjudicator',presented),value);
});


test('self-contained cold constraints preserve tuple coverage and reference membership with no separate roster',()=>{
 const constraints={sourceFitReferences:references()};
 assert.ok(parseRoleOutput(JSON.stringify(output()),'adjudicator',[],constraints).value);
 assert.equal(parseRoleOutput(JSON.stringify(output(['owner-request'])),'adjudicator',[],constraints).value,null);
 const missing=output();delete missing.inputDecisions;assert.equal(parseRoleOutput(JSON.stringify(missing),'adjudicator',[],constraints).value,null);
 const revision=output();revision.inputDecisions[0].directionRevision++;assert.equal(parseRoleOutput(JSON.stringify(revision),'adjudicator',[],constraints).value,null);
 assert.equal(parseRoleOutput(JSON.stringify(output()),'adjudicator',[{inputId:'different',directionRevision:2}],constraints).value,null);
 assert.throws(()=>roleFraming('adjudicator',{...bundle('planning-adjudication'),context:{...context('planning-adjudication'),sourceInputChain:[]}}),/held-input tuples changed/);
});
for(const inputs of [[{inputId:'held-input',directionRevision:0}],[{inputId:'held-input',directionRevision:2},{inputId:'held-input',directionRevision:3}],[{inputId:'held-input',directionRevision:2,extra:true}]])test('malformed captured tuple domain refuses '+JSON.stringify(inputs),()=>assert.throws(()=>captureSourceFitReferences({...references(),inputs}),/references unavailable/));


test('captured requirement identities retain the role text domain for multibyte IDs',()=>{
 const id='한'.repeat(12000);assert.ok(Buffer.byteLength(id)>32768);
 assert.deepEqual(captureSourceFitReferences(references('source-fit',[id])).requirementIds,[id]);
 assert.ok(decode(output([id],{acceptedPlan:plan(id)})).value);
});
