import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {presentMetadataIdentities,restoreMetadataIdentities,metadataIdentityFootprint} from '../../dist/workflow/metadata-identities.js';
import {presentFindingBodies,restoreFindingBodies} from '../../dist/workflow/finding-body-presentation.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {readFixtureMetadataContext} from './current-verification-fixture.mjs';

function fixture(stage='planning-adjudication') {
    const work=randomUUID(),output=randomUUID(),launch=randomUUID(),baseline=randomUUID(),ids=Array.from({length:48},()=>randomUUID());
    const finding={requirementId:'R',description:'Original literal '+work,evidence:[{ref:0},output],future:{id:launch}};
    const scope={workId:work,launchId:launch,runId:output,outputId:output,inputVersions:{base:baseline,contracts:baseline,requirements:null},occurrenceIds:ids,findingBodyOmittedIds:[],findingBodySuppliedIds:ids,selectedSources:[{version:baseline,path:'consumer.cjs'}]};
    return {stage,metadataIdentityInput:{version:1},occurrences:ids.map(id=>({id,work,output,data:{launchId:launch,finding:structuredClone(finding)},unknown:{id:work,ref:0}})),
        dispositions:ids.map(id=>({id:randomUUID(),occurrence:id,launch,data:{occurrenceId:id,disposition:'rejected',reason:'Literal '+id,witnesses:[work],unknown:{ref:0}}})),
        pendingObligations:ids.map(id=>({id,occurrence:id,kind:'finding',state:'pending'})),obligationStates:ids.map(id=>({id,work,data:{occurrence:id,disposition:'rejected',unknown:work}})),
        plannerInputScope:scope,challengerInputScope:structuredClone(scope),
        historicalPlanningOperands:{links:ids.map(id=>({occurrenceId:id,observationOutputId:output,producerOutputId:output,plannerOutputId:output,unknown:work})),
            producers:[{outputId:output,launchId:launch,runId:output,nativeSessionId:launch,inputVersions:scope.inputVersions,checkpoint:{sessionId:launch},initialView:scope}],
            censusEncoding:{occurrenceIds:ids,sourceSets:[[{version:baseline,path:'consumer.cjs',sha256:'a'.repeat(64)}]]}},
        ownerRequest:work,planProposal:{requirements:[{id:work,text:output}],unknown:{ref:0}},producerDiagnostics:{raw:work,objects:[{ref:0}]},unknown:{id:work,ref:0}};
}
const reject=fn=>assert.throws(fn,/metadata identity presentation unavailable or corrupt/);

for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication']])test('typed identities roundtrip without changing semantic literals: '+role,()=>{
    const original=fixture(stage),before=structuredClone(original),wire=presentMetadataIdentities(role,original);
    assert.ok(wire.metadataIdentityEncoding);assert.ok(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(original)));
    assert.deepEqual(restoreMetadataIdentities(role,wire),original);assert.deepEqual(readFixtureMetadataContext(wire),original);
    assert.deepEqual(original,before);assert.equal(typeof wire.occurrences[0].id,'object');
    assert.deepEqual(wire.occurrences.map(row=>row.data.finding),original.occurrences.map(row=>row.data.finding));
    assert.deepEqual(wire.dispositions.map(row=>row.data.reason),original.dispositions.map(row=>row.data.reason));
    assert.deepEqual(wire.dispositions.map(row=>row.data.witnesses),original.dispositions.map(row=>row.data.witnesses));
    for(const key of ['ownerRequest','planProposal','producerDiagnostics','unknown'])assert.deepEqual(wire[key],original[key]);
    assert.deepEqual(wire.historicalPlanningOperands.censusEncoding.sourceSets[0][0].sha256,'a'.repeat(64));
    assert.equal(metadataIdentityFootprint(role,restoreMetadataIdentities(role,wire)),metadataIdentityFootprint(role,original));
});

test('identity sharing composes with literal finding bodies and retains existing numeric indexes',()=>{
    const original=fixture(),shared=presentFindingBodies(original,'adjudicator'),wire=presentMetadataIdentities('adjudicator',shared);
    assert.ok(shared.findingBodyEncoding);assert.equal(wire.occurrences[0].data.findingBodyIndex,0);
    assert.deepEqual(wire.findingBodyEncoding,shared.findingBodyEncoding);
    assert.deepEqual(restoreFindingBodies(restoreMetadataIdentities('adjudicator',wire),'adjudicator'),original);
    assert.equal(metadataIdentityFootprint('adjudicator',shared),metadataIdentityFootprint('adjudicator',original));
});

test('shared host object aliases cannot rewrite unselected semantic arrays or schema identity domains',()=>{
    const original=fixture(),ids=original.plannerInputScope.occurrenceIds;
    original.decisionReferences={version:1,occurrenceIds:ids,diagnosisOccurrenceIds:[]};
    original.planProposal.literalIds=ids;original.unknown.literalScope=original.plannerInputScope;
    const before=JSON.parse(JSON.stringify(original)),wire=presentMetadataIdentities('adjudicator',original);
    assert.deepEqual(wire.decisionReferences,before.decisionReferences);
    assert.deepEqual(wire.planProposal,before.planProposal);assert.deepEqual(wire.unknown,before.unknown);
    assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),before);
    assert.deepEqual(original,before);
});

test('long semantic status values and unknown obligation metadata are never identity fields',()=>{
    const original=fixture(),status='future-long-semantic-disposition-status',work=original.occurrences[0].work;
    for(const row of original.pendingObligations){row.disposition=status;row.work=work;}
    for(const row of original.obligationStates){row.data.disposition=status;row.data.id=work;row.data.work=work;}
    const wire=presentMetadataIdentities('adjudicator',original);
    assert.ok(!wire.metadataIdentityEncoding.ids.includes(status));
    for(const row of wire.pendingObligations){assert.equal(row.disposition,status);assert.equal(row.work,work);}
    for(const row of wire.obligationStates){assert.equal(row.data.disposition,status);assert.equal(row.data.id,work);assert.equal(row.data.work,work);}
    assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),original);
});

test('legacy absence and original reference-like metadata keep literal interpretation',()=>{
    const original=fixture();delete original.metadataIdentityInput;original.metadataIdentityEncoding={unknown:'Legacy literal'};
    assert.equal(presentMetadataIdentities('adjudicator',original),original);assert.equal(restoreMetadataIdentities('adjudicator',original),original);
    const colliding=fixture();colliding.occurrences[0].id={ref:0};assert.equal(presentMetadataIdentities('adjudicator',colliding),colliding);
    const small={stage:'planning',metadataIdentityInput:{version:1},occurrences:[{id:'short'}]};assert.equal(presentMetadataIdentities('planner',small),small);
});

test('declared malformed and mixed identity references never become a successful literal fallback',()=>{
    const original=fixture(),valid=presentMetadataIdentities('adjudicator',original);
    for(const mutate of [
        wire=>wire.metadataIdentityEncoding.version=2,
        wire=>wire.metadataIdentityEncoding.meaning='A summary',
        wire=>wire.metadataIdentityEncoding.ids.push(wire.metadataIdentityEncoding.ids[0]),
        wire=>wire.metadataIdentityEncoding.ids.push(randomUUID()),
        wire=>wire.metadataIdentityEncoding.ids[0]=null,
        wire=>wire.occurrences[0].id={ref:-1},wire=>wire.occurrences[0].id={ref:999999},
        wire=>wire.occurrences[0].id={ref:0.5},wire=>wire.occurrences[0].id={ref:'0'},
        wire=>wire.occurrences[0].id={ref:0,extra:true},
        wire=>wire.occurrences[0].id=wire.metadataIdentityEncoding.ids[wire.occurrences[0].id.ref],
        wire=>wire.metadataIdentityInput={version:2},wire=>wire.stage='fresh-review',
    ]){const wire=structuredClone(valid);mutate(wire);reject(()=>restoreMetadataIdentities('adjudicator',wire));}
    reject(()=>presentMetadataIdentities('adjudicator',valid));
});

test('expanded identity bytes are bounded before cloning repeated large strings',()=>{
    const valid=presentMetadataIdentities('adjudicator',fixture()),wire={stage:'planning-adjudication',metadataIdentityInput:{version:1},metadataIdentityEncoding:{...valid.metadataIdentityEncoding,ids:['x'.repeat(1024*1024)]},pendingObligations:Array.from({length:30},()=>({id:{ref:0}}))};
    const parse=JSON.parse;JSON.parse=()=>assert.fail('Expansion must refuse before materialization');
    try{reject(()=>restoreMetadataIdentities('adjudicator',wire));}finally{JSON.parse=parse;}
});

test('source footprint binds exact field positions, independently of dictionary membership',()=>{
    const original=fixture(),altered=structuredClone(original),before=metadataIdentityFootprint('adjudicator',original);
    [altered.occurrences[0].id,altered.occurrences[1].id]=[altered.occurrences[1].id,altered.occurrences[0].id];
    assert.notEqual(metadataIdentityFootprint('adjudicator',altered),before);
    altered.occurrences=original.occurrences;delete altered.plannerInputScope.outputId;
    assert.notEqual(metadataIdentityFootprint('adjudicator',altered),before);
});

test('actual framing keeps unchanged full-ID schema and original literal source envelope',()=>{
    const context=fixture(),source={id:'base:consumer.cjs',version:randomUUID(),side:'base',path:'consumer.cjs',sha256:'a'.repeat(64),content:'original source\n',exposeInPrompt:true},bundle={requirements:[],contracts:'Original literal product rules.',sources:[source],requiredScope:[],context};
    const framed=roleFraming('adjudicator',bundle,true),legacy=structuredClone(bundle);delete legacy.context.metadataIdentityInput;
    assert.deepEqual(framed.schema,roleFraming('adjudicator',legacy,true).schema);
    const body=JSON.parse(framed.prompt.split('\n')[1]);assert.ok(body.context.metadataIdentityEncoding);
    const {content,...metadata}=source;
    assert.equal(body.contracts,bundle.contracts);assert.deepEqual(body.sources[0],{...metadata,lineCount:2});
    assert.ok(framed.prompt.includes(content));
});

test('review v2 shares only declared receipt identities and digests, preserving all semantic and output domains',()=>{
    const c={...fixture(),stage:'review-adjudication',metadataIdentityInput:{version:2}},id=c.occurrences[0].work,digest='a'.repeat(64),planHash='b'.repeat(64);
    c.ownerSource=id;c.baseVersion=id;c.decisionReferences={version:3,occurrenceIds:c.occurrences.map(x=>x.id),diagnosisOccurrenceIds:[],retentionChoices:[]};
    c.historicalPlanningOperands.links.forEach(x=>x.planHash=planHash);c.historicalPlanningOperands.plans=[{planHash,inlinePlan:{requirements:[{id,text:digest}],verification:{strategies:[{requirementId:id,text:digest}]},unknown:digest},record:{id:planHash,sha256:digest}}];
    c.historicalPlanningOperands.producers.forEach(p=>{p.outputRawSha256=digest;p.checkpoint.sha256=digest;p.initialView.textSha256=digest;p.materialSource={source:{nativeSessionId:id,rawSha256:digest,selector:id},unknown:{id}};});
    c.historicalPlanningOperands.censusEncoding.occurrenceIdDictionary=c.decisionReferences.occurrenceIds;
    c.checks=[{id,work:id,run:id,candidate:id,verification:id,check_id:id,status:id,data:{inputHash:digest,boundVersions:{base:id,candidate:id},check:{id,command:digest},actual:{stdout:digest},parsed:{value:{assertions:[{id,actual:digest}]}},caseDescriptor:{checkBinding:digest,cases:[{id,inputDigest:digest}],consumerFiles:[{path:id,sha256:digest}]}}}];c.verificationEvidence=JSON.parse(JSON.stringify(c.checks));
    c.selectedReviewEvidence={binding:digest,reviews:[{launchId:id,runId:id,outputId:id,rawSha256:digest,raw:digest,native:{sessionId:id,checkpoint:{sessionId:id,sha256:digest}}}]};
    const before=JSON.parse(JSON.stringify(c)),wire=presentMetadataIdentities('adjudicator',c);assert.equal(wire.metadataIdentityEncoding.version,2);assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),before);assert.deepEqual(readFixtureMetadataContext(wire),before);assert.deepEqual(c,before);
    assert.deepEqual(wire.decisionReferences,before.decisionReferences);assert.deepEqual(wire.historicalPlanningOperands.plans[0].inlinePlan,before.historicalPlanningOperands.plans[0].inlinePlan);
    assert.equal(wire.checks[0].check_id,id);assert.equal(wire.checks[0].status,id);assert.deepEqual(wire.checks[0].data.check,before.checks[0].data.check);assert.deepEqual(wire.checks[0].data.actual,before.checks[0].data.actual);assert.deepEqual(wire.checks[0].data.parsed,before.checks[0].data.parsed);assert.deepEqual(wire.checks[0].data.caseDescriptor.cases,before.checks[0].data.caseDescriptor.cases);assert.equal(wire.selectedReviewEvidence.reviews[0].raw,digest);
    const changed=structuredClone(before);changed.checks[0].data.boundVersions.base='different';assert.notEqual(metadataIdentityFootprint('adjudicator',changed),metadataIdentityFootprint('adjudicator',before));
    for(const mutate of [x=>x.metadataIdentityInput.version=1,x=>x.metadataIdentityEncoding.version=1,x=>x.stage='planning-adjudication',x=>x.metadataIdentityEncoding.meaning+=' changed']){const bad=structuredClone(wire);mutate(bad);reject(()=>restoreMetadataIdentities('adjudicator',bad));}
});

test('review-only new fields keep collision fallback and old planning v1 positions literal',()=>{
 const review={...fixture(),stage:'review-adjudication',metadataIdentityInput:{version:2},checks:[{data:{inputHash:{ref:0,original:true}}}]};assert.equal(presentMetadataIdentities('adjudicator',review),review);
 const old=fixture(),hash='a'.repeat(64);old.checks=[{id:old.occurrences[0].work,data:{inputHash:hash}},{id:old.occurrences[0].work,data:{inputHash:hash}}];const wire=presentMetadataIdentities('adjudicator',old);assert.deepEqual(wire.checks,old.checks);assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),old);
});

test('literal planning metadata4 preserves canonical rows and opaque reference-shaped values',()=>{
 const original={...fixture(),metadataIdentityInput:{version:4}},before=JSON.parse(JSON.stringify(original));
 original.occurrences[0].id={ref:0,opaque:true};before.occurrences[0].id={ref:0,opaque:true};
 const wire=presentMetadataIdentities('adjudicator',original);assert.equal(JSON.stringify(wire),JSON.stringify(before));assert.equal(Object.hasOwn(wire,'metadataIdentityEncoding'),false);
 assert.deepEqual(restoreMetadataIdentities('adjudicator',wire),before);assert.deepEqual(original,before);
 const fingerprint=metadataIdentityFootprint('adjudicator',original),legacy={...original,metadataIdentityInput:{version:1}};
 assert.notEqual(fingerprint,metadataIdentityFootprint('adjudicator',legacy),'The literal selector is part of source capture');
 const changed=structuredClone(original);changed.plannerInputScope.outputId=randomUUID();assert.notEqual(metadataIdentityFootprint('adjudicator',changed),fingerprint);
 const semantic=structuredClone(original);semantic.unknown.ref=999;semantic.occurrences[0].data.finding.future.id='literal user edit';assert.equal(metadataIdentityFootprint('adjudicator',semantic),fingerprint,'Only declared metadata positions belong to this footprint');
});
test('literal metadata4 refuses mixed encoding, unsupported receiver and oversized declarations',()=>{
 const literal={...fixture(),metadataIdentityInput:{version:4}};
 for(const mutate of [x=>x.stage='review-adjudication',x=>x.subjectActionsInput={version:1},x=>x.metadataIdentityInput.extra=true,x=>x.metadataIdentityEncoding=null,x=>x.metadataIdentityEncoding={version:4,ids:[]},x=>x.ownerRequest='x'.repeat(2*1024*1024)]){
  const changed=structuredClone(literal);mutate(changed);
  reject(()=>presentMetadataIdentities('adjudicator',changed));reject(()=>restoreMetadataIdentities('adjudicator',changed));reject(()=>metadataIdentityFootprint('adjudicator',changed));
 }
 for(const role of ['planner','challenger','reviewer']){reject(()=>presentMetadataIdentities(role,literal));reject(()=>restoreMetadataIdentities(role,literal));}
});
test('literal metadata4 framing keeps full-ID output schema and accurate current guidance',()=>{
 const context={...fixture(),metadataIdentityInput:{version:4},findingBodyInput:{version:5}},bundle={requirements:[],contracts:'Original definitions',sources:[],requiredScope:[],context};
 const current=roleFraming('adjudicator',bundle,true),legacy=roleFraming('adjudicator',{...bundle,context:{...context,metadataIdentityInput:{version:1}}},true);
 assert.deepEqual(current.schema,legacy.schema);assert.deepEqual(JSON.parse(current.prompt.split('\n')[1]).context,context);
 assert.match(current.systemPrompt,/Current metadata identities are literal original strings/);assert.match(current.systemPrompt,/Quoted historical reference strings remain literal evidence text/);
 assert.ok(!current.systemPrompt.includes('Declared metadataIdentityEncoding is lossless identity sharing'));
});

for(const eligibility of ['undeclared','empty','current'])test('literal metadata4 supplies current action membership without an index join: '+eligibility,()=>{
 const context={...fixture(),metadataIdentityInput:{version:4},findingBodyInput:{version:5}},ids=context.occurrences.map(o=>o.id),retained=randomUUID();
 context.decisionReferences={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:[ids[0]],pendingOrdinaryIndexes:[1,2,3],blockingOrdinaryIndexes:[1],retentionChoices:[{occurrenceId:ids[4],dispositionId:retained,sha256:'a'.repeat(64)}]};
 const eligible=eligibility==='current'?[{occurrenceId:ids[0],outputId:randomUUID(),rawSha256:'b'.repeat(64),materialOccurrenceIds:[ids[1],ids[4]]}]:[];
 if(eligibility!=='undeclared'){context.diagnosisEligibility={version:1};context.producerDiagnosticReceipt={receiptHash:'c'.repeat(64),eligible};}
 const bundle={requirements:[],contracts:'Original rules',sources:[],requiredScope:[],context},before=structuredClone(bundle),framing=roleFraming('adjudicator',bundle,true);
 const marker='Current action domains (literal original occurrence IDs; output uses these full IDs): ',text=framing.systemPrompt.split(marker)[1];assert.ok(text);
 const domain=JSON.parse(text.split('. These membership lists')[0]);
 assert.deepEqual(domain.pendingOrdinary,{count:3,occurrenceIds:ids.slice(1,4)});
 assert.deepEqual(domain.producerDiagnostics,{count:1,occurrenceIds:[ids[0]],newDiagnosisOccurrenceIds:eligibility==='undeclared'?null:eligible.map(e=>e.occurrenceId),conditionalMaterialSiblings:eligibility==='undeclared'?null:eligible.map(e=>({diagnosisOccurrenceId:e.occurrenceId,materialOccurrenceIds:e.materialOccurrenceIds})),implementation:'forbidden, including kind:none'});
 assert.equal(domain.retention.count,1);assert.deepEqual(domain.retention.choices,[{occurrenceId:ids[4],dispositionId:retained}]);
 assert.deepEqual(bundle,before);assert.deepEqual(JSON.parse(framing.prompt.split('\n')[1]).context,context);
 const legacy=roleFraming('adjudicator',{...bundle,context:{...context,metadataIdentityInput:{version:1}}},true);assert.deepEqual(framing.schema,legacy.schema);
 assert.ok(!framing.systemPrompt.includes('Current action domains (indexes address'));
 const invalid=structuredClone(bundle);invalid.context.decisionReferences.pendingOrdinaryIndexes=[ids.length];assert.throws(()=>roleFraming('adjudicator',invalid,true),/current-state indexes unavailable/);
});
