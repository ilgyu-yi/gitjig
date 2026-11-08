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
