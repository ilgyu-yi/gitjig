import test from 'node:test';
import assert from 'node:assert/strict';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {hash} from '../../dist/controller/change-files.js';
import {roleMaterialFindings} from '../../dist/controller/role-material-findings.js';
const finding={requirementId:'R1',severity:'blocking',repair:'unknown',description:'Retain literal received claim',evidence:['original']};
function fixture(keyed=true){
 const raw=JSON.stringify(keyed?{value:{version:1,summary:'Original producer',assessedScope:[],findings:[finding,{...finding,description:'Second original claim'}]}}:{findings:[finding]});
 const read=roleMaterialFindings(raw,'planner'),claims=keyed?read.claims.slice(1):read.claims;
 assert.ok(read.complete&&read.receivedClaimsComplete&&claims.length,'Fixture must contain authenticatable literal claims');
 const source={sourceEntryId:'entry',selector:'formatter-arguments',nativeMessageId:'message',nativeSessionId:'native',parentToolUseId:null,toolUseId:'tool',frames:['start','entry','delta','stop'],complete:true,rawSha256:hash(raw),rawUtf8Bytes:Buffer.byteLength(raw)};
 const locations=claims.map(({finding,...location})=>location),md={protocol:null,nativeSource:null,nativeEntryId:'entry',materialSources:keyed?locations.map(location=>({...source,...location})):[source],harvestedFindings:claims.map(c=>c.finding)};
 if(keyed)md.accountingKey=hash({source,locations});
 const output={id:'output',work:'work',launch:'launch',raw,data:JSON.stringify(md)},launch={id:'launch',role:'planner',data:'{}'};
 const rows=claims.map((claim,ordinal)=>({id:'occurrence'+ordinal,work:'work',output:'output',ordinal,data:JSON.stringify({finding:claim.finding,launchId:'launch',role:'planner'})}));
 const core=new ChangeCore({store:{all:()=>structuredClone(rows)}});
 return {core,output,launch,rows,md,source,claims};
}
const read=f=>{f.output.data=JSON.stringify(f.md);return f.core.historicalArgumentOrigin('work',f.output,f.launch);};
for(const keyed of [false,true])test('historical formatter authenticates '+(keyed?'exact nested keyed subset':'complete legacy root roster'),()=>{
 const f=fixture(keyed),before=structuredClone(f.rows);assert.deepEqual(read(f),{source:f.source,claims:f.claims});assert.deepEqual(f.rows,before);
});
const mutations={
 'changed raw':f=>f.output.raw+=' ',
 'foreign entry':f=>f.md.nativeEntryId='foreign',
 'truncated source':f=>f.md.materialSources[0].complete=false,
 'missing literal location':f=>delete f.md.materialSources[0].memberPath,
 'rebound accounting key':f=>f.md.accountingKey='foreign',
 'different harvested claim':f=>f.md.harvestedFindings[0].description='changed',
 'missing occurrence':f=>f.rows.pop(),
 'duplicate occurrence':f=>f.rows.push(structuredClone(f.rows[0])),
 'foreign work':f=>f.rows[0].work='foreign',
 'sparse ordinal':f=>f.rows[0].ordinal=1,
 'foreign original launch':f=>{const d=JSON.parse(f.rows[0].data);d.launchId='foreign';f.rows[0].data=JSON.stringify(d);},
 'changed original claim':f=>{const d=JSON.parse(f.rows[0].data);d.finding.description='changed';f.rows[0].data=JSON.stringify(d);},
 'present null assessment':f=>f.md.materialAssessment=null,
 'present text projection':f=>f.md.nativeTextProjection=null,
 'invented accepted protocol':f=>f.md.protocol={version:1},
};
for(const [name,mutate]of Object.entries(mutations))test('historical formatter roster refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>read(f),/Historical formatter literal source\/roster unavailable/);});
test('legacy absence cannot hide a nested location subset',()=>{const f=fixture();delete f.md.accountingKey;assert.throws(()=>read(f),/Historical formatter literal source\/roster unavailable/);});

for(const version of [4,5,7,8,9])test('legacy cache'+version+' cannot masquerade as a newer formatter9 receipt',async()=>{
 const {producerEvidence}=await import('../../dist/controller/producer-evidence.js');
 const row={id:'producer',data:JSON.stringify({stage:'original',materialAccounting:{version,claimsDigest:'claims',historyIdentity:'history',nativeSessionId:'session',originalCheckpoint:'checkpoint',producerDigest:'producer'}})};
 assert.equal(producerEvidence(row,'formatter-v9'),row);
});
test('known cache10 preserves exact non-cache evidence when reconstructing a legacy9 receipt',async()=>{
 const {producerEvidence}=await import('../../dist/controller/producer-evidence.js');
 const cache={version:10,claimsDigest:'claims',historyIdentity:'history',nativeSessionId:'session',originalCheckpoint:'checkpoint',producerDigest:'producer'};
 const row={id:'producer',data:JSON.stringify({stage:'original',materialAccounting:cache})},before=structuredClone(row);
 const result=producerEvidence(row,'formatter-v9');assert.deepEqual(JSON.parse(result.data),{stage:'original',materialAccounting:{...cache,version:9}});assert.deepEqual(row,before);
});
