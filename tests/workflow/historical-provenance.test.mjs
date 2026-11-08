import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,createHash}from'node:crypto';
import{prepareHistoricalProvenance,historicalProvenanceManifest,captureHistoricalProvenanceManifest}from'../../dist/workflow/historical-provenance.js';
import{roleInputEvidenceManifests}from'../../dist/workflow/role-input-evidence.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const producer=id=>({outputId:id,launchId:'L-'+id,nativeEntryId:'entry-'+id,role:'challenger',stage:'planning-challenge',epoch:2,producerStatus:'unusable',launchStatus:'UNUSABLE',inputVersions:{base:'B',candidate:null,contracts:'K'},runId:'R-'+id,nativeSessionId:'N-'+id,outputRawSha256:'a'.repeat(64),checkpoint:{sessionId:'N-'+id,leafId:'leaf-'+id,bytes:1024,sha256:'b'.repeat(64)},materialSource:{version:1,source:{selector:'result-text',sourceEntryId:'original',rawSha256:'c'.repeat(64)},claimLocations:[{index:0}]},initialView:{userEntryId:'user-'+id,textUtf8Bytes:5000,textSha256:'d'.repeat(64),occurrenceIndexes:[0,1],findingBodySuppliedIndexes:[1],findingBodyOmittedIndexes:[0],sourceSetIndex:0,metadataIdentities:{version:1,fieldFootprintSha256:'e'.repeat(64),meaning:'Original IDs shared, not delivered literally'},workflowCriteria:{version:1,profile:'planning-v1',manifestId:'original-norm',sha256:'f'.repeat(64),operatingSha256:'0'.repeat(64),meaning:'Original normative availability',eagerRecordIds:['current:C2'],readBoundRecordIds:['current:D7']},unknown:{exact:'한글🙂'}}});
const canonical=()=>({semantics:'Exact historical source, not standing',producers:Array.from({length:4},(_,i)=>producer('O'+i)),censusEncoding:{occurrenceIds:['F','D'],sourceSets:[[{id:'base:source',sha256:'1'.repeat(64)}]]},plans:[{planHash:'old',unknown:true}],unavailable:[]});
const options=(stage='planning-adjudication')=>({id:randomUUID(),workId:'W',epoch:3,stage,artifactRoot:'/private/owned-artifacts'});
const context=(prepared,input)=>({stage:input.stage,historicalProvenanceInput:{version:1,id:input.id},historicalPlanningOperands:prepared.value});
function records(prepared){const lines=prepared.evidence.contents.split('\n');return prepared.value.producerProvenance.indexLines.map((line,i)=>{const locator=JSON.parse(lines[line-1]);assert.equal(locator.id,prepared.value.producers[i].outputId);const chunks=lines.slice(locator.firstLine-1,locator.lastLine).map(JSON.parse);assert.ok(chunks.every((c,j)=>c.ordinal===locator.ordinal&&c.chunk===j+1&&c.chunks===chunks.length));const raw=chunks.map(c=>c.text).join('');assert.equal(createHash('sha256').update(raw).digest('hex'),locator.sha256);return JSON.parse(raw);});}
test('custody projection preserves all semantic INITIAL facts, modes, source identities and exact full records',()=>{
 for(const stage of ['planning-adjudication','review-adjudication']){const original=canonical(),before=structuredClone(original),input=options(stage),prepared=prepareHistoricalProvenance(original,input);assert.ok(prepared.evidence);assert.deepEqual(records(prepared),before.producers);assert.deepEqual(original,before);assert.deepEqual(prepared.value.censusEncoding,original.censusEncoding);assert.equal(prepared.evidence.manifest.arraySha256,sha(original.producers));assert.equal(prepared.evidence.manifest.censusSha256,sha({present:true,value:original.censusEncoding}));
  for(const [i,p]of prepared.value.producers.entries()){for(const key of ['outputId','launchId','nativeEntryId','materialSource','role','stage','epoch','producerStatus','launchStatus','inputVersions'])assert.deepEqual(p[key],before.producers[i][key]);assert.equal(p.initialView.userEntryId,before.producers[i].initialView.userEntryId);assert.equal(p.initialView.metadataIdentities.version,1);assert.equal(p.initialView.workflowCriteria.manifestId,'original-norm');assert.deepEqual(p.initialView.unknown,{exact:'한글🙂'});assert.equal(Object.hasOwn(p,'checkpoint'),false);assert.equal(Object.hasOwn(p,'runId'),false);}
  assert.deepEqual(roleInputEvidenceManifests(context(prepared,input)),[prepared.evidence.manifest]);
 }
});
test('unknown checkpoint fields and malformed optional proof remain literal instead of disappearing',()=>{
 const original=canonical();original.producers[0].checkpoint.extra={semantic:'unknown exact field'};original.producers[1].checkpoint='Original malformed checkpoint';original.producers[2].initialView.metadataIdentities.fieldFootprintSha256={future:'opaque unknown'};
 const prepared=prepareHistoricalProvenance(original,options());assert.ok(prepared.evidence);assert.deepEqual(prepared.value.producers[0].checkpoint,original.producers[0].checkpoint);assert.equal(prepared.value.producers[1].checkpoint,'Original malformed checkpoint');assert.deepEqual(prepared.value.producers[2].initialView.metadataIdentities.fieldFootprintSha256,{future:'opaque unknown'});assert.deepEqual(records(prepared),original.producers);
});
test('literal fallback covers empty, tiny, unsupported, sparse and oversized optional artifacts',()=>{
 for(const original of [{producers:[]},{producers:[{}]},{producers:Array(1)}]){const prepared=prepareHistoricalProvenance(original,options());assert.equal(prepared.value,original);assert.equal(prepared.evidence,undefined);}
 const tiny={producers:[{...producer('O'),initialView:{userEntryId:'u',textUtf8Bytes:0,textSha256:'a'.repeat(64)}}]};assert.equal(prepareHistoricalProvenance(tiny,options()).evidence,undefined);
 const big=canonical();big.producers[0].unknown='x'.repeat(1048576);const prepared=prepareHistoricalProvenance(big,options());assert.equal(prepared.value,big);assert.equal(prepared.evidence,undefined);
});
test('declared provenance refuses wrong census, missing/foreign receivers, sparse or corrupt index views',()=>{
 const input=options(),prepared=prepareHistoricalProvenance(canonical(),input),original=context(prepared,input);
 for(const mutate of [c=>c.historicalProvenanceInput.version=2,c=>c.stage=['planning-adjudication'],c=>c.historicalPlanningOperands.censusEncoding.occurrenceIds.reverse(),c=>c.historicalPlanningOperands.producerProvenance.indexLines=Array(4),c=>c.historicalPlanningOperands.producerProvenance.indexLines[0]=1,c=>c.historicalPlanningOperands.producerProvenance.indexLines[0]=2.5,c=>c.historicalPlanningOperands.producerProvenance.indexLines[0]=c.historicalPlanningOperands.producerProvenance.indexLines[1],c=>c.historicalPlanningOperands.producerProvenance.manifest.id=randomUUID(),c=>c.historicalPlanningOperands.producerProvenance.extra=true,c=>c.historicalPlanningOperands.producers[0].runId='mixed']){const bad=structuredClone(original);mutate(bad);assert.throws(()=>historicalProvenanceManifest(bad),/provenance/);}
 for(const patch of [{version:3},{version:2,stage:'review-adjudication'},{role:'planner'},{bytes:1048577},{indexLines:999},{extra:true}])assert.throws(()=>captureHistoricalProvenanceManifest({...prepared.evidence.manifest,...patch}));
 const legacy={stage:'planning-adjudication',historicalPlanningOperands:{producerProvenance:{oldUnknown:true}}};assert.equal(historicalProvenanceManifest(legacy),undefined);
});

test('source and delivered headers/census stay bound across preparation awaits, including literal fallback',()=>{
 const original=canonical(),prepared=prepareHistoricalProvenance(original,options());prepared.assertCurrent(prepared.value);prepared.value.producers[0].role='changed';assert.throws(()=>prepared.assertCurrent(prepared.value),/provenance/);prepared.value.producers[0].role=original.producers[0].role;prepared.assertCurrent(prepared.value);original.producers[0].checkpoint.sha256='9'.repeat(64);assert.throws(()=>prepared.assertCurrent(prepared.value),/provenance/);
 const empty={producers:[]},literal=prepareHistoricalProvenance(empty,options());literal.assertCurrent(literal.value);empty.producers.push({unknown:true});assert.throws(()=>literal.assertCurrent(literal.value),/provenance/);
});

test('receiver replacement, removal and artifact drift cannot establish a new capture baseline',()=>{
 for(const replacement of [undefined,null,{}, {producers:[]}]){const prepared=prepareHistoricalProvenance(canonical(),options());assert.throws(()=>prepared.assertCurrent(replacement),/provenance/);prepared.assertCurrent(structuredClone(prepared.value));}
 for(const mutate of [p=>p.evidence.contents+='corrupt',p=>p.evidence.manifest={...p.evidence.manifest,path:'/private/foreign/role-provenance-'+p.evidence.manifest.id+'.jsonl'}]){const prepared=prepareHistoricalProvenance(canonical(),options());mutate(prepared);assert.throws(()=>prepared.assertCurrent(prepared.value),/provenance/);}
});
test('wire omission of undefined census retains the same authenticated identity',()=>{
 const input=options(),original=canonical();original.censusEncoding=undefined;const prepared=prepareHistoricalProvenance(original,input);assert.ok(prepared.evidence);assert.ok(historicalProvenanceManifest(JSON.parse(JSON.stringify(context(prepared,input)))));
});

test('planning provenance2 keeps full records and explicit original absence, empty and unread INITIAL membership',()=>{
 const original=canonical();original.censusEncoding={version:1,occurrenceIdDictionary:['F','D'],sourceSets:[[{id:'base:source',sha256:'1'.repeat(64)}]]};
 original.producers[0].initialView.findingBodyOmittedIndexes=[];delete original.producers[1].initialView.findingBodyOmittedIndexes;
 original.producers[2].initialView.workflowCriteria.sharedCurrentRecords=[{id:'old',sharedWith:'current',future:'literal'}];
 const before=structuredClone(original),input={...options(),version:2},prepared=prepareHistoricalProvenance(original,input),ctx={stage:input.stage,historicalProvenanceInput:{version:2,id:input.id},historicalPlanningOperands:prepared.value};
 assert.ok(prepared.evidence);assert.equal(historicalProvenanceManifest(ctx).version,2);assert.deepEqual(records(prepared),before.producers);assert.deepEqual(original,before);
 const view=prepared.value.producerProvenance,paths=p=>p.readBoundFields.map(i=>view.readBoundPaths[i]);
 assert.ok(paths(prepared.value.producers[0]).includes('/initialView/occurrenceIndexes'));
 assert.ok(paths(prepared.value.producers[0]).includes('/initialView/workflowCriteria/eagerRecordIds'));
 assert.deepEqual(prepared.value.producers[0].initialView.findingBodyOmittedIndexes,[]);
 assert.equal(Object.hasOwn(prepared.value.producers[1].initialView,'findingBodyOmittedIndexes'),false);
 assert.ok(!paths(prepared.value.producers[1]).includes('/initialView/findingBodyOmittedIndexes'));
 assert.deepEqual(prepared.value.producers[2].initialView.workflowCriteria.sharedCurrentRecords,before.producers[2].initialView.workflowCriteria.sharedCurrentRecords);
 for(const [i,p]of prepared.value.producers.entries()){
  for(const key of ['materialSource','inputVersions','role','epoch'])assert.deepEqual(p[key],before.producers[i][key]);
  assert.equal(p.initialView.sourceSetIndex,before.producers[i].initialView.sourceSetIndex);assert.deepEqual(p.initialView.unknown,before.producers[i].initialView.unknown);
 }
 for(const mutate of [c=>{c.historicalProvenanceInput.version=1},c=>{c.stage='review-adjudication'},c=>{c.historicalPlanningOperands.producerProvenance.readBoundPaths.reverse()},c=>{c.historicalPlanningOperands.producers[0].readBoundFields.push(999)},c=>{c.historicalPlanningOperands.producers[0].readBoundFields=Array(1)},c=>{c.historicalPlanningOperands.producers[0].initialView.occurrenceIndexes=[0,1]},c=>{c.historicalPlanningOperands.censusEncoding.occurrenceIdDictionary.reverse()}]){
  const changed=structuredClone(ctx);mutate(changed);assert.throws(()=>historicalProvenanceManifest(changed),/provenance/);
 }
 const collision=canonical();collision.producers[0].readBoundFields='Unknown original field';assert.equal(prepareHistoricalProvenance(collision,input).evidence,undefined);
 assert.throws(()=>prepareHistoricalProvenance(original,{...input,stage:'review-adjudication'}),/provenance/);
});


test('planning provenance2 preserves malformed memberships and rejects invalid versions even for empty history',()=>{
 const input={...options(),version:2};
 for(const bad of [Array(1),[''],[null]]){
  const original=canonical();original.censusEncoding={version:1,occurrenceIdDictionary:['F']};
  original.producers[0].initialView.occurrenceIndexes=bad;
  original.producers[0].initialView.workflowCriteria.eagerRecordIds=bad;
  const prepared=prepareHistoricalProvenance(original,input);
  assert.ok(prepared.evidence);
  assert.deepEqual(prepared.value.producers[0].initialView.occurrenceIndexes,bad);
  assert.deepEqual(prepared.value.producers[0].initialView.workflowCriteria.eagerRecordIds,bad);
 }
 assert.throws(()=>prepareHistoricalProvenance({producers:[]},{...input,stage:'review-adjudication'}),/provenance/);
});
