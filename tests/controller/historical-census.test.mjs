import test from 'node:test';
import assert from 'node:assert/strict';
import {projectHistoricalCensus} from '../../dist/controller/historical-census.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';

import {readHistoricalProducers as readProducers} from '../helpers/historical-census.mjs';

function sample(count=6,size=40){
 const ids=Array.from({length:size},(_,i)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
 return {semantics:'Original historical observations, not current receipts.',links:[{occurrenceId:ids[0]}],plans:[{planHash:'unchanged',plan:{intent:'Original plan'}}],unavailable:[],
  producers:Array.from({length:count},(_,i)=>({outputId:'original-'+i,checkpoint:{sha256:'preserve-'+i},initialView:{textSha256:'original-text-'+i,sources:[{id:'base:mode.cjs',version:'11111111-1111-4111-8111-111111111111',path:'mode.cjs',sha256:'a'.repeat(64),exposeInPrompt:true}],occurrenceIds:i%2?[...ids].reverse():[...ids],findingBodySuppliedIds:ids.filter((_,j)=>j%2===0),findingBodyOmittedIds:ids.filter((_,j)=>j%2===1)}}))};
}
test('explicit historical indexes preserve exact ordered censuses and every other fact without mutating canonical witnesses',()=>{
 const canonical=sample(),before=structuredClone(canonical),projected=projectHistoricalCensus(canonical);
 assert.ok(projected.censusEncoding);assert.ok(Buffer.byteLength(JSON.stringify(projected))<Buffer.byteLength(JSON.stringify(canonical)));
 assert.equal(projected.censusEncoding.sourceSets.length,1);
 assert.deepEqual(readProducers(projected),canonical.producers);assert.deepEqual(canonical,before);
 for(const key of ['links','plans','unavailable'])assert.deepEqual(projected[key],canonical[key]);
 assert.ok(projected.semantics.startsWith(canonical.semantics));assert.match(projected.semantics,/zero-based/);
 // Explicit repeated positions remain repeated; they never imply a range or a shared claim.
 canonical.producers[0].initialView.occurrenceIds.push(canonical.producers[0].initialView.occurrenceIds[0]);
 assert.deepEqual(readProducers(projectHistoricalCensus(canonical)),canonical.producers);
 canonical.producers[1].initialView.sources.push({...canonical.producers[1].initialView.sources[0]});
 assert.deepEqual(readProducers(projectHistoricalCensus(canonical)),canonical.producers,'Repeated source entries remain repeated within their own ordered set');
 const unique=sample();unique.producers.forEach((p,i)=>{p.initialView.sources[0].id='unique-'+i;});const idOnly=projectHistoricalCensus(unique);
 assert.equal(idOnly.censusEncoding.sourceSets,undefined,'A source dictionary cannot spend the ID-only representation gain');assert.deepEqual(readProducers(idOnly),unique.producers);
});
test('small legacy views retain their literal representation and the canonical byte bound cannot be bypassed by indexing',()=>{
 const small=sample(1,1);assert.equal(projectHistoricalCensus(small),small);assert.deepEqual(readProducers(small),small.producers);
 assert.throws(()=>projectHistoricalCensus(sample(2,16000)),/exceeds existing2MiB/);
 for(const change of [v=>{v.censusEncoding={version:1}},v=>{v.producers[0].initialView.occurrenceIndexes=[]},v=>{v.producers[0].initialView.occurrenceIds=[null]}]){const value=sample();change(value);assert.throws(()=>projectHistoricalCensus(value),/requires canonical/);}
});
test('the independent historical consumer rejects ambiguous or corrupt dictionaries and vectors',()=>{
 const valid=projectHistoricalCensus(sample());
 for(const change of [v=>{v.censusEncoding.version=2},v=>{v.censusEncoding.indexBase=1},v=>{v.censusEncoding.occurrenceIdDictionary.push(v.censusEncoding.occurrenceIdDictionary[0])},
  v=>{v.producers[0].initialView.occurrenceIds=[]},v=>{v.producers[0].initialView.occurrenceIndexes=[-1]},v=>{v.producers[0].initialView.occurrenceIndexes=[0.5]},
  v=>{v.producers[0].initialView.occurrenceIndexes=[Number.MAX_SAFE_INTEGER]},v=>{v.producers[0].initialView.findingBodySuppliedIndexes='all'},
  v=>{v.producers[0].initialView.sources=[]},v=>{delete v.producers[0].initialView.sourceSetIndex},v=>{v.producers[0].initialView.sourceSetIndex=-1},
  v=>{v.producers[0].initialView.sourceSetIndex=0.5},v=>{v.producers[0].initialView.sourceSetIndex=999},v=>{v.censusEncoding.sourceSets[0]='not an array'}]){const value=structuredClone(valid);change(value);assert.throws(()=>readProducers(value));}
 const altered=structuredClone(valid);altered.censusEncoding.sourceSets[0][0].sha256='changed';assert.notDeepEqual(readProducers(altered),readProducers(valid),'Valid syntax cannot certify original source identity');
});
test('a smaller historical request never discounts original served usage or the full output reserve',()=>{
 const body=JSON.stringify(projectHistoricalCensus(sample())),user={role:'user',content:[{type:'text',text:body}],timestamp:0};
 const model={contextWindow:200000,maxTokens:32000};assert.equal(assertModelContextBudget(model,{messages:[user]}).outputReserve,32000);
 const usage={input:2,output:1,cacheRead:0,cacheWrite:178265,totalTokens:178268,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const assistant={role:'assistant',api:'anthropic-messages',provider:'claude-bridge',model:'claude-sonnet-4-6',content:[{type:'toolCall',id:'read-1',name:'read',arguments:{path:'/work/check.cjs'}}],usage,stopReason:'toolUse',timestamp:1};
 const tool={role:'toolResult',toolCallId:'read-1',toolName:'read',content:[{type:'text',text:'x'.repeat(1822)}],isError:false,timestamp:2};
 assert.throws(()=>assertModelContextBudget(model,{messages:[user,assistant,tool]}),error=>error.code==='MODEL_CONTEXT_LIMIT'&&error.budget.estimatedInput>=178268&&error.budget.outputReserve===32000&&error.budget.margin===4096);
});
