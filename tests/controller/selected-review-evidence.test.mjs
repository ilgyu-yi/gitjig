/** Pure host-record controls: synthetic rows/entries, no SDK/Controller/provider/native claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectSelectedReview,boundSelectedReviews} from '../../dist/controller/selected-review-evidence.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const content='module.exports=3;\n',scope={sourceId:'candidate:consumer.cjs',startLine:1,endLine:2};
 const protocol={version:1,summary:'DISTINCTIVE COMPLETE REVIEW BODY',findings:[{requirementId:'R1',severity:'blocking',repair:'unknown',description:'DUMMY finding must remain verbatim, never turn into clear',evidence:['candidate:consumer.cjs:1']}],assessedScope:[scope],outcome:'findings'};
 const raw=JSON.stringify(protocol),tuple={contracts:'K',requirements:'R',base:'B',candidate:'C',plan:'P',verification:'V'};
 const exposure={...scope,launchId:'L',version:'C',side:'candidate',path:'consumer.cjs',sourceSha256:hash(content),rangeSha256:hash(content),producer:'prompt'};
 return {workId:'W',epoch:3,generation:1,versions:tuple,reviewKey:'behavior-review',purpose:'behavior',requiredPaths:['consumer.cjs'],
  launch:{id:'L',work:'W',run:'RUN',role:'reviewer',status:'COMPLETE',epoch:3,data:JSON.stringify({stage:'fresh-review',reviewKey:'behavior-review',purpose:'behavior',requiredPaths:['consumer.cjs'],inputVersions:tuple,cleanup:'removed',historyRef:'/synthetic/not-read',nativeSessionId:'S'})},
  run:{id:'RUN',work:'W',epoch:3,generation:1,phase:'SETTLED',reservation:'consumed',data:JSON.stringify({cleanup:'removed',historyRef:'/synthetic/not-read',nativeSessionId:'S',nativeCheckpoint:{sessionId:'S',leafId:'PREFIX',bytes:1,sha256:'a'.repeat(64)}})},
  outputs:[{id:'INTERMEDIATE',launch:'L',status:'accounted-intermediate',raw:'old partial advocacy',data:'{}'},{id:'FINAL',launch:'L',status:'usable',raw,data:JSON.stringify({terminal:'complete',rawFinalTruncated:false,omittedFindingCount:0,issues:[],nativeEntryId:'FINAL-ENTRY',historyRef:'/synthetic/not-read',protocol,exposures:[exposure]})}],
  entries:[{type:'message',id:'FINAL-ENTRY',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:raw}]}}],
  bundle:{requirements:[],contracts:'controlled fixture',sources:[{id:scope.sourceId,version:'C',side:'candidate',path:'consumer.cjs',content,sha256:hash(content),exposeInPrompt:true}],requiredScope:[scope],context:{}}};
}
const change=(x,key,fn)=>{const d=JSON.parse(x[key].data);fn(d);x[key].data=JSON.stringify(d);};
test('selected complete final preserves distinctive raw/nonempty findings/scope beside intermediate',()=>{
 const input=fixture(),out=projectSelectedReview(input);assert.equal(out.outputId,'FINAL');assert.equal(out.epoch,input.launch.epoch);assert.equal(out.generation,input.run.generation);assert.match(boundSelectedReviews('binding',[out]).semantics,/original producer provenance, not current action authority/);assert.equal(out.raw,input.outputs[1].raw);assert.equal(JSON.parse(out.raw).findings.length,1);assert.equal(JSON.parse(out.raw).outcome,'findings');assert.equal(out.rawSha256,hash(out.raw));assert.equal(out.assessedScope[0].sourceId,'candidate:consumer.cjs');assert.ok(!JSON.stringify(out).includes('/synthetic/not-read'));assert.equal(boundSelectedReviews('binding',[out]).reviews.length,1);
});
test('foreign/stale/role/roster/ambiguous/loss/malformed/native/scope guards refuse, never omit',()=>{
 const cases=[x=>x.launch.work='FOREIGN',x=>x.run.epoch++,x=>change(x,'launch',d=>d.inputVersions.candidate='STALE'),x=>x.launch.role='implementer',x=>change(x,'launch',d=>d.reviewKey='wrong'),x=>x.outputs.push({...x.outputs[1],id:'DUP'}),x=>x.outputs.splice(1,1),x=>x.entries=[],x=>x.entries[0].message.content[0].text='OTHER',x=>change(x,'run',d=>d.nativeSessionId='OTHER'),x=>x.launch.data='{malformed',x=>x.outputs[1].raw='x'.repeat(128*1024+1),x=>{const m=JSON.parse(x.outputs[1].data);m.rawFinalTruncated=true;x.outputs[1].data=JSON.stringify(m);},x=>{const m=JSON.parse(x.outputs[1].data);m.omittedFindingCount=1;x.outputs[1].data=JSON.stringify(m);},x=>{const m=JSON.parse(x.outputs[1].data);m.exposures[0].rangeSha256='WRONG';x.outputs[1].data=JSON.stringify(m);}];
 for(const mutate of cases){const input=fixture();mutate(input);assert.throws(()=>projectSelectedReview(input),/SELECTED_REVIEW_EVIDENCE_UNAVAILABLE/);}
});
test('projection refuses serialized/reference limits without partial evidence',()=>{
 const out=projectSelectedReview(fixture());assert.throws(()=>boundSelectedReviews('binding',Array.from({length:65},()=>out)),/references exceed64/);assert.throws(()=>boundSelectedReviews('binding',[{...out,raw:'x'.repeat(128*1024)},{...out,raw:'y'.repeat(128*1024)}]),/exceeds256KiB/);
});

test('byte-small review with more than64 combined scope ranges retains every range',()=>{
 const input=fixture(),source=input.bundle.sources[0],meta=JSON.parse(input.outputs[1].data);
 const sources=Array.from({length:22},(_,i)=>({...source,id:i===0?source.id:'candidate:f'+i+'.cjs',path:i===0?source.path:'f'+i+'.cjs'}));
 const scopes=sources.map(s=>({sourceId:s.id,startLine:1,endLine:2}));
 input.bundle.sources=sources;input.bundle.requiredScope=scopes;
 meta.protocol.assessedScope=scopes;meta.exposures=scopes.map((scope,i)=>({...meta.exposures[0],...scope,path:sources[i].path}));
 input.outputs[1].raw=JSON.stringify(meta.protocol);input.outputs[1].data=JSON.stringify(meta);input.entries[0].message.content[0].text=input.outputs[1].raw;
 const out=projectSelectedReview(input),projection=boundSelectedReviews('binding',[out]);
 assert.equal(out.requiredScope.length+out.assessedScope.length+out.exposures.length,66);assert.equal(projection.reviews.length,1);assert.equal(projection.reviews[0].assessedScope.length,22);assert.ok(Buffer.byteLength(JSON.stringify(projection))<256*1024);
});
