import test from 'node:test';
import assert from 'node:assert/strict';
import {presentFindingBodies,restoreFindingBodies} from '../../dist/workflow/finding-body-presentation.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
const body={description:'한글🙂\\"\n'.repeat(200),evidence:['base:mode.cjs'],optionalMalformed:{reproduction:['literal',null],unknown:true}};
const row=(id,finding=body)=>({id,work:'W',output:'O-'+id,ordinal:0,data:{finding,launchId:'L-'+id,role:'planner',other:{original:id}}});
const context=()=>({stage:'planning-adjudication',occurrences:[row('A'),row('B'),row('C',{...body,description:body.description+' distinct'})],pendingObligations:[{id:'A'},{id:'B'},{id:'C'}]});
test('inline literal bodies share bytes without merging identities, metadata, malformed fields or order',()=>{
 const original=context(),before=structuredClone(original),wire=presentFindingBodies(original,'adjudicator');
 assert.equal(wire.findingBodyEncoding.version,1);assert.equal(wire.findingBodyEncoding.bodies.length,2);
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(original)));
 const decoded=restoreFindingBodies(JSON.parse(JSON.stringify(wire)),'adjudicator');
 assert.deepEqual(decoded,original);assert.equal(JSON.stringify(decoded),JSON.stringify(original));assert.deepEqual(original,before);
 decoded.occurrences[0].data.finding.description='later mutation';
 assert.equal(decoded.occurrences[1].data.finding.description,body.description);assert.deepEqual(original,before);
});
test('legacy absence preserves literal and unknown historical metadata; unprofitable or foreign roles stay literal',()=>{
 const legacy={stage:'planning-adjudication',occurrences:[{id:'old',data:{findingBodyIndex:33,unknown:'historical'}}]};
 assert.equal(restoreFindingBodies(legacy,'adjudicator'),legacy);assert.equal(presentFindingBodies(legacy,'adjudicator'),legacy);
 const short={stage:'planning-adjudication',occurrences:[row('A',{x:1})]};assert.equal(presentFindingBodies(short,'adjudicator'),short);
 for(const [role,stage]of[['planner','planning'],['challenger','planning-challenge'],['adjudicator','review-adjudication']]){
  const other={...context(),stage};assert.equal(presentFindingBodies(other,role),other);
 }
});
test('declared malformed, mixed, dangling and unused references refuse rather than fall back',()=>{
 const wire=presentFindingBodies(context(),'adjudicator');
 for(const mutate of[
  c=>c.findingBodyEncoding.version=2,c=>c.findingBodyEncoding.extra=true,c=>delete c.findingBodyEncoding.meaning,
  c=>c.findingBodyEncoding.bodies.push({unused:true}),c=>c.findingBodyEncoding.bodies.push(c.findingBodyEncoding.bodies[0]),
  c=>c.occurrences[0].data.finding=body,c=>c.occurrences[0].data.findingBodyIndex=-1,
  c=>c.occurrences[0].data.findingBodyIndex=0.5,c=>c.occurrences[0].data.findingBodyIndex='0',
  c=>c.occurrences[0].data.findingBodyIndex=999,c=>c.occurrences[0].data=null,c=>c.stage='planning',
 ]){const changed=structuredClone(wire);mutate(changed);assert.throws(()=>restoreFindingBodies(changed,'adjudicator'),/presentation/);}
 assert.throws(()=>restoreFindingBodies(wire,'planner'),/presentation/);
 assert.throws(()=>presentFindingBodies(wire,'adjudicator'),/presentation/);
});
test('reference amplification is rejected before repeated literal materialization',()=>{
 const wire=presentFindingBodies(context(),'adjudicator');wire.findingBodyEncoding.bodies=[{text:'x'.repeat(512*1024)}];
 wire.occurrences=Array.from({length:8},(_,i)=>({id:String(i),data:{findingBodyIndex:0}}));
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<2*1024*1024);
 const originalParse=JSON.parse;let parses=0;JSON.parse=(...args)=>{parses++;return originalParse(...args);};
 try{assert.throws(()=>restoreFindingBodies(wire,'adjudicator'),/presentation/);assert.equal(parses,0);}finally{JSON.parse=originalParse;}
});

test('sharing cannot admit a canonical complete prompt above the original source-inclusive bound',()=>{
 const current={stage:'planning-adjudication',occurrences:Array.from({length:3},(_,i)=>row(String(i),{description:'x'.repeat(600000)}))};
 assert.ok(Buffer.byteLength(JSON.stringify(current))<2*1024*1024);
 const inputBundle={requirements:[],contracts:'Original rules',context:current,requiredScope:[],sources:[{id:'base:source.txt',version:'B',side:'base',path:'source.txt',sha256:'a'.repeat(64),exposeInPrompt:true,content:'s'.repeat(400000)}]};
 assert.ok(Buffer.byteLength(JSON.stringify(presentFindingBodies(current,'adjudicator')))+400000<2*1024*1024);
 assert.throws(()=>roleFraming('adjudicator',inputBundle,true),/Role prompt exceeds2MiB/);
 inputBundle.sources[0].content='s'.repeat(100000);
 const framed=roleFraming('adjudicator',inputBundle,true),wire=JSON.parse(framed.prompt.split('\n')[1]);
 assert.equal(wire.context.findingBodyEncoding.version,1);
 assert.deepEqual(restoreFindingBodies(wire.context,'adjudicator'),current);
});
