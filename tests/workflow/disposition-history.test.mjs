import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {buildDispositionHistory,captureDispositionHistoryManifest,relevantObligationStates} from '../../dist/workflow/disposition-history.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
const row=(id,occurrence,reason)=>({id,occurrence,launch:'original-producer',status:'upheld',data:{occurrenceId:occurrence,reason,witnesses:['exact source']}});
const snapshot=records=>buildDispositionHistory({id:randomUUID(),workId:'original-work',epoch:7,artifactRoot:'/private/owned-artifacts',records});
function decode(snapshot){
 const lines=snapshot.contents.split('\n'),header=JSON.parse(lines[0]);assert.equal(sha(snapshot.contents),snapshot.manifest.sha256);const index=lines.slice(1,1+header.indexLines).map(JSON.parse);assert.deepEqual(index.map(v=>v.id),index.map(v=>v.id).sort());
 const records=[];for(const entry of index){const chunks=lines.slice(entry.firstLine-1,entry.lastLine).map(JSON.parse);assert.ok(chunks.length>0);assert.equal(chunks.length,chunks[0].chunks);let raw='';for(const [i,chunk]of chunks.entries()){assert.equal(chunk.ordinal,entry.ordinal);assert.equal(chunk.chunk,i+1);assert.equal(chunk.chunks,chunks.length);raw+=chunk.text;}assert.equal(sha(raw),entry.sha256);assert.equal(Buffer.byteLength(raw),entry.bytes);records[entry.ordinal]=JSON.parse(raw);}
 assert.equal(sha(JSON.stringify(records)),header.arraySha256);assert.equal(header.arraySha256,snapshot.manifest.arraySha256);return records;
}
test('exact ordered history and separate canonical latest preserve all original record bodies and identities',()=>{
 const records=[row('z','F','old reason'),row('a','D','same claim, separate member'),row('m','F','current independent judgment')],before=structuredClone(records),value=snapshot(records);
 assert.deepEqual(decode(value),records);assert.deepEqual(records,before);assert.deepEqual(value.latest.map(v=>v.id),['m','a']);assert.equal(value.manifest.records,3);assert.equal(value.manifest.indexLines,3);
 records[2].data.reason='caller mutation';assert.equal(decode(value)[2].data.reason,'current independent judgment');
});
test('32KiB multibyte and escaped reasons remain readable chunks without splitting UTF8 or silently dropping a middle chunk',()=>{
 const value=snapshot([row('R','F','한글🙂\\"\n'.repeat(4096))]);assert.deepEqual(decode(value),[row('R','F','한글🙂\\"\n'.repeat(4096))]);
 assert.ok(value.contents.split('\n').every(line=>Buffer.byteLength(line)<20000));assert.equal(Buffer.from(value.contents).toString('utf8'),value.contents);
 const lines=value.contents.split('\n'),index=JSON.parse(lines[1]);assert.ok(index.lastLine-index.firstLine>3);
 for(const mutate of [lines=>lines.splice(index.firstLine+1,1),lines=>lines[index.firstLine+1]=lines[index.firstLine],lines=>lines[index.firstLine]=lines[index.firstLine].slice(0,-1)]){const copy=structuredClone(lines);mutate(copy);const changed={...value,contents:copy.join('\n')};assert.throws(()=>decode(changed));}
});
test('chronology growth does not repeat old dispositions in the eager latest view; unsupported evidence is not clipped',()=>{
 const one=snapshot([row('first','F','current')]),many=snapshot([...Array.from({length:100},(_,i)=>row('old'+i,'F','old')),row('last','F','current')]);
 assert.equal(one.latest.length,1);assert.equal(many.latest.length,1);assert.ok(many.contents.length>one.contents.length);assert.equal(JSON.stringify(many.latest).length,JSON.stringify(one.latest).length-1);
 assert.throws(()=>snapshot(Array.from({length:100},(_,i)=>row('R'+i,'F','x'.repeat(32000)))),/1MiB/);
 assert.throws(()=>snapshot([row('dup','F','a'),row('dup','D','b')]),/identity/);
 for(const patch of [{version:2},{epoch:0},{bytes:1048577},{indexLines:999},{role:'planner'},{path:'/private/not-the-bound-name'},{extra:true}])assert.throws(()=>captureDispositionHistoryManifest({...one.manifest,...patch}));
});

test('resolved diagnostic chronology cannot inflate the eager current set or erase referenced, pending or unknown evidence',()=>{
 const retained=[{id:'finding',data:{kind:'finding',state:'resolved',proof:'original'}},{id:'referenced',data:{kind:'diagnostic',state:'resolved'}},{id:'pending',data:{kind:'diagnostic',state:'pending'}},{id:'unknown-kind',data:{kind:'future-kind',state:'resolved'}},{id:'unknown-state',data:{kind:'diagnostic'}},{id:'check',data:{kind:'check',state:'resolved',proof:'passing evidence'}},{id:'opaque-kind',data:{kind:{toString:null},state:'resolved'}}],past=Array.from({length:100},(_,i)=>({id:'past'+i,data:{kind:i%2?'diagnostic':'raw-findings-incomplete',state:'resolved',issues:['original old diagnostic '+i]}})),all=[...retained,...past],before=structuredClone(all),current=relevantObligationStates(all,new Set(['finding','referenced']),new Set(['pending','unknown-state']));
 assert.deepEqual(current.map(r=>r.id),retained.map(r=>r.id));assert.deepEqual(current.filter(r=>r.currentPending).map(r=>r.id),['pending','unknown-state']);assert.deepEqual(all,before);
 assert.deepEqual(relevantObligationStates(all.slice(0,retained.length),new Set(['finding','referenced']),new Set(['pending','unknown-state'])),current);
});

test('prospective review chronology uses its own stage-bound version without widening old manifests',()=>{
 const records=[row('older','F','previous'),row('current','F','current')],value=buildDispositionHistory({id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/owned-artifacts',stage:'review-adjudication',records});
 assert.equal(value.manifest.version,2);assert.equal(JSON.parse(value.contents.split('\n')[0]).stage,'review-adjudication');assert.deepEqual(decode(value),records);assert.deepEqual(value.latest,[records[1]]);
 for(const patch of [{version:1},{stage:'planning-adjudication'},{stage:'review'}])assert.throws(()=>captureDispositionHistoryManifest({...value.manifest,...patch}));
 const old=snapshot(records);assert.throws(()=>captureDispositionHistoryManifest({...old.manifest,stage:'review-adjudication'}));
});

const latestContext = history => ({stage:history.manifest.stage,latestDispositionInput:{version:1},dispositionHistoryInput:{version:history.manifest.version,id:history.manifest.id},dispositionHistory:history.manifest,dispositions:history.latest,pendingObligations:[{id:'F',state:'pending'}]});
const latestModule=await import('../../dist/workflow/disposition-history.js');
test('latest partial view binds exact ordered full records while preserving every other state and unknown field',()=>{
 const records=[row('z','F','Old reason'),row('b','D','한글🙂\\"\n'.repeat(200)),{...row('a','F','Current evidence '.repeat(200)),data:{...row('a','F','Current evidence '.repeat(200)).data,resolution:'diagnosed',equivalentTo:'D',implementation:{kind:'none'},proof:{literal:{reason:'nested retained',witnesses:['retained']}},unknown:['exact',false]}}];
 const history=snapshot(records),context=latestContext(history),before=structuredClone(context),projected=latestModule.prepareLatestDispositions(context,'adjudicator',history);
 assert.ok(projected.latestDispositionView);assert.equal(projected.dispositions.length,2);assert.deepEqual(context,before);assert.equal(projected.pendingObligations,context.pendingObligations);
 const lines=history.contents.split('\n');for(const [i,partial]of projected.dispositions.entries()){
  const locator=JSON.parse(lines[projected.latestDispositionView.indexLines[i]-1]);assert.equal(locator.id,partial.id);assert.equal(locator.occurrence,partial.occurrence);
  const exact=JSON.parse(lines.slice(locator.firstLine-1,locator.lastLine).map(line=>JSON.parse(line).text).join(''));
  assert.deepEqual(exact,before.dispositions[i]);const {reason,witnesses,...rest}=exact.data;assert.deepEqual(partial,{...exact,data:rest});assert.equal(Object.hasOwn(partial.data,'reason'),false);assert.equal(Object.hasOwn(partial.data,'witnesses'),false);
 }
 assert.equal(typeof latestModule.latestDispositionFootprint(projected,'adjudicator'),'string');assert.notEqual(latestModule.latestDispositionFootprint(context,'adjudicator'),latestModule.latestDispositionFootprint(projected,'adjudicator'));
});
test('latest delivery literal fallback covers empty, tiny, missing fields and arbitrary legacy values',()=>{
 for(const records of [[],[row('a','F','x')],[{...row('a','F','x'),data:{unknown:true}}],[{...row('a','F','x'),data:null}]]){
  const history=snapshot(records),context=latestContext(history);assert.equal(latestModule.prepareLatestDispositions(context,'adjudicator',history),context);assert.equal(typeof latestModule.latestDispositionFootprint(context,'adjudicator'),'string');
 }
 const history=snapshot([row('a','F','x'.repeat(1000))]),context={...latestContext(history),latestDispositionView:{oldUnknown:true}};delete context.latestDispositionInput;
 assert.equal(latestModule.prepareLatestDispositions(context,'adjudicator',history),context);assert.equal(latestModule.latestDispositionFootprint(context,'adjudicator'),undefined);
});
test('latest view rejects corrupt profiles, mixed explanations, foreign receivers and locator corruption',()=>{
 const history=snapshot([row('a','F','x'.repeat(2000)),row('b','D','y'.repeat(2000))]),view=latestModule.prepareLatestDispositions(latestContext(history),'adjudicator',history);
 for(const mutate of [c=>c.latestDispositionInput.version=2,c=>c.latestDispositionInput.extra=true,c=>c.stage=['planning-adjudication'],c=>c.dispositionHistoryInput.id=randomUUID(),c=>c.latestDispositionView.extra=true,c=>c.latestDispositionView.indexLines[0]=1,c=>c.latestDispositionView.indexLines[0]=history.manifest.records+2,c=>c.latestDispositionView.indexLines[0]='2',c=>c.latestDispositionView.indexLines.pop(),c=>c.latestDispositionView.indexLines=Array(2),c=>c.dispositions=Array(2),c=>c.latestDispositionView.indexLines[0]=c.latestDispositionView.indexLines[1],c=>c.dispositions[0].data.reason='mixed']){
  const bad=structuredClone(view);mutate(bad);assert.throws(()=>latestModule.latestDispositionFootprint(bad,'adjudicator'),/latest disposition|history manifest/);
 }
 assert.throws(()=>latestModule.latestDispositionFootprint(view,'planner'));
 const collision={...latestContext(history),latestDispositionView:{unknown:true}};assert.throws(()=>latestModule.prepareLatestDispositions(collision,'adjudicator',history));
 const corrupt=structuredClone(history);corrupt.latest[0].data.reason+=' forged';assert.throws(()=>latestModule.prepareLatestDispositions(latestContext(corrupt),'adjudicator',corrupt));
});
test('review latest view retains physical history2 with its independently captured partial meaning',()=>{
 const history=buildDispositionHistory({id:randomUUID(),workId:'W',epoch:2,artifactRoot:'/private/owned-artifacts',stage:'review-adjudication',records:[row('a','F','Exact review reason '.repeat(200))]}),view=latestModule.prepareLatestDispositions(latestContext(history),'adjudicator',history);
 assert.equal(view.dispositionHistory.version,2);assert.equal(view.latestDispositionView.version,1);assert.equal(typeof latestModule.latestDispositionFootprint(view,'adjudicator'),'string');
 assert.deepEqual(decode(history),[row('a','F','Exact review reason '.repeat(200))]);
});
