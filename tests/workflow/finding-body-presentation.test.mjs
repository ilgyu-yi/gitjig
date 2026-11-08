import test from 'node:test';
import assert from 'node:assert/strict';
import {presentFindingBodies,restoreFindingBodies,findingBodyFootprint} from '../../dist/workflow/finding-body-presentation.js';
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

test('prospective review body v2 shares exact literals and refuses planning/review reinterpretation',()=>{
 const original={...context(),stage:'review-adjudication',findingBodyInput:{version:2}},wire=presentFindingBodies(original,'adjudicator');assert.equal(wire.findingBodyEncoding.version,2);assert.deepEqual(restoreFindingBodies(wire,'adjudicator'),original);
 for(const mutate of [c=>delete c.findingBodyInput,c=>c.findingBodyInput.version=1,c=>c.findingBodyEncoding.version=1,c=>c.stage='planning-adjudication']){const bad=structuredClone(wire);mutate(bad);assert.throws(()=>restoreFindingBodies(bad,'adjudicator'));}
 const literal={...original};delete literal.findingBodyInput;assert.equal(presentFindingBodies(literal,'adjudicator'),literal);
 assert.throws(()=>presentFindingBodies({...original,findingBodyInput:{version:2,unknown:true}},'adjudicator'));
});

const v3Context = (stage='planning-adjudication') => {
 const shared='정확한 증거🙂\\"\n'.repeat(100),patch={path:'mode.cjs',oldText:shared,newText:shared+' fixed',unknown:{valueRef:73}};
 return {stage,findingBodyInput:{version:3},occurrences:[0,1,2].map(i=>row(String(i),{
  description:'Distinct finding '+i,evidence:[shared,shared,null,{malformed:true}],mechanicalPatch:patch,
  reproduction:{command:shared,assertions:[shared,false],assertion:{valueRef:999}},unknown:{valueRef:999},
 }))};
};
test('v3 shares typed exact values across distinct bodies with opaque nested literals and isolated aliases',()=>{
 for(const stage of ['planning-adjudication','review-adjudication']){
  const original=v3Context(stage),before=JSON.stringify(original),wire=presentFindingBodies(original,'adjudicator');
  assert.equal(wire.findingBodyEncoding.version,3);assert.equal(wire.findingBodyEncoding.bodies.length,3);assert.equal(wire.findingBodyEncoding.values.length,2);
  assert.ok(JSON.stringify(wire).length<before.length);
  const decoded=restoreFindingBodies(JSON.parse(JSON.stringify(wire)),'adjudicator');assert.equal(JSON.stringify(decoded),before);assert.equal(JSON.stringify(original),before);
  decoded.occurrences[0].data.finding.mechanicalPatch.unknown.valueRef=4;
  assert.equal(decoded.occurrences[1].data.finding.mechanicalPatch.unknown.valueRef,73);
  assert.equal(original.occurrences[0].data.finding.mechanicalPatch.unknown.valueRef,73);
 }
});
test('v3 literal fallback for reserved known positions and unprofitable values preserves malformed unknown data',()=>{
 for(const mutate of [b=>b.mechanicalPatch={valueRef:1,extra:true},b=>b.evidence.push({valueRef:2}),b=>b.reproduction.command={valueRef:3},b=>b.reproduction.assertions.push({valueRef:4})]){
  const original=v3Context();mutate(original.occurrences[0].data.finding);assert.equal(presentFindingBodies(original,'adjudicator'),original);
 }
 const tiny={stage:'planning-adjudication',findingBodyInput:{version:3},occurrences:[row('a',{evidence:['a'],mechanicalPatch:null})]};
 assert.equal(presentFindingBodies(tiny,'adjudicator'),tiny);
});
test('v3 invalid references, mixed canonical duplicate bodies and mode changes refuse',()=>{
 const wire=presentFindingBodies(v3Context(),'adjudicator');
 for(const mutate of [
  c=>c.findingBodyEncoding.values.push('unused'),c=>c.findingBodyEncoding.values.push(c.findingBodyEncoding.values[0]),
  c=>c.findingBodyEncoding.bodies[0].evidence[0]={valueRef:-1},c=>c.findingBodyEncoding.bodies[0].evidence[0]={valueRef:0,extra:true},
  c=>c.findingBodyEncoding.bodies[0].evidence[0]={valueRef:999},c=>c.findingBodyEncoding.bodies[0].evidence[0]={valueRef:'0'},
  c=>c.findingBodyEncoding.bodies[0].evidence[0]=c.findingBodyEncoding.bodies[0].mechanicalPatch,
  c=>delete c.findingBodyEncoding.values,c=>c.findingBodyEncoding.extra=true,c=>c.findingBodyInput.version=2,c=>c.stage='planning',c=>c.stage=['planning-adjudication'],c=>c.stage={value:'review-adjudication'},
  c=>{const duplicate=structuredClone(c.findingBodyEncoding.bodies[0]);duplicate.evidence[0]=c.findingBodyEncoding.values[duplicate.evidence[0].valueRef];c.findingBodyEncoding.bodies.push(duplicate);c.occurrences.push({...row('extra'),data:{findingBodyIndex:3}});},
 ]){const bad=structuredClone(wire);mutate(bad);assert.throws(()=>restoreFindingBodies(bad,'adjudicator'),/presentation/);}
 assert.throws(()=>restoreFindingBodies(wire,'planner'),/presentation/);
});
test('v3 exact expansion bound includes repeated values and body multiplicity before JSON.parse',()=>{
 const original=v3Context(),wire=presentFindingBodies(original,'adjudicator');
 // One value appears many times in every body, then every occurrence repeats the same body.
 const evidenceIndex=wire.findingBodyEncoding.bodies[0].evidence[0].valueRef;
 wire.findingBodyEncoding.values[evidenceIndex]='x'.repeat(200000);
 const first=wire.findingBodyEncoding.bodies[0];wire.findingBodyEncoding.bodies=[first];
 wire.occurrences=Array.from({length:6},(_,i)=>({id:String(i),data:{findingBodyIndex:0}}));
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<2*1024*1024);
 const parse=JSON.parse;let calls=0;JSON.parse=(...args)=>{calls++;return parse(...args);};
 try{assert.throws(()=>restoreFindingBodies(wire,'adjudicator'),/presentation/);assert.equal(calls,0);}finally{JSON.parse=parse;}
});
test('v3 accepts exact 2MiB canonical boundary and rejects one byte above before parsing',()=>{
 const original=v3Context(),limit=2*1024*1024;
 original.padding='';original.padding='p'.repeat(limit-Buffer.byteLength(JSON.stringify(original)));
 assert.equal(Buffer.byteLength(JSON.stringify(original)),limit);
 const wire=presentFindingBodies(original,'adjudicator');assert.equal(wire.findingBodyEncoding.version,3);
 assert.equal(JSON.stringify(restoreFindingBodies(wire,'adjudicator')),JSON.stringify(original));
 wire.padding+='p';const parse=JSON.parse;let calls=0;JSON.parse=(...args)=>{calls++;return parse(...args);};
 try{assert.throws(()=>restoreFindingBodies(wire,'adjudicator'),/presentation/);assert.equal(calls,0);}finally{JSON.parse=parse;}
});


test('v3 framing names the declared format and binds canonical fields without creating review-v2 semantics',()=>{
 const original=v3Context(),inputBundle={requirements:[],contracts:'Original rules',context:original,requiredScope:[],sources:[]};
 const framed=roleFraming('adjudicator',inputBundle,true);
 assert.match(framed.systemPrompt,/findingBodyInput version3/);assert.doesNotMatch(framed.systemPrompt,/findingBodyInput version2/);
 const wire=JSON.parse(framed.prompt.split('\n')[1]);assert.equal(wire.context.findingBodyEncoding.version,3);
 assert.equal(JSON.stringify(restoreFindingBodies(wire.context,'adjudicator')),JSON.stringify(original));
 const before=findingBodyFootprint(original,'adjudicator');assert.equal(typeof before,'string');
 const changed=structuredClone(original);changed.occurrences[0].data.finding.evidence[0]+='changed';assert.notEqual(findingBodyFootprint(changed,'adjudicator'),before);
});

test('v3 whole-body sharing works without a value dictionary and leaves legacy declarations unchanged',()=>{
 const original={...context(),findingBodyInput:{version:3}},wire=presentFindingBodies(original,'adjudicator');
 assert.deepEqual(wire.findingBodyEncoding.values,[]);assert.equal(JSON.stringify(restoreFindingBodies(wire,'adjudicator')),JSON.stringify(original));
 const legacy=presentFindingBodies(context(),'adjudicator');
 assert.deepEqual(Object.keys(legacy.findingBodyEncoding),['version','meaning','bodies']);
 const review=presentFindingBodies({...context(),stage:'review-adjudication',findingBodyInput:{version:2}},'adjudicator');
 assert.deepEqual(Object.keys(review.findingBodyEncoding),['version','meaning','bodies']);
 assert.equal(legacy.findingBodyEncoding.meaning,review.findingBodyEncoding.meaning);
});

for(const [role,stage]of [['planner','planning'],['challenger','planning-challenge']]){
 const original=()=>({...context(),stage,findingBodyInput:{version:4},dispositions:[{id:'D1',occurrence:'A',data:{reason:'Distinct original judgment'}}]});
 test('explicit planning body version4 shares exact values with distinct duties: '+role,()=>{
  const c=original(),before=JSON.stringify(c),wire=presentFindingBodies(c,role);
  assert.equal(wire.findingBodyEncoding.version,4);assert.match(wire.findingBodyEncoding.meaning,/Version4/);assert.ok(Array.isArray(wire.findingBodyEncoding.values));
  assert.equal(JSON.stringify(restoreFindingBodies(JSON.parse(JSON.stringify(wire)),role)),before);assert.equal(JSON.stringify(c),before);
  assert.deepEqual(wire.occurrences.map(o=>o.id),c.occurrences.map(o=>o.id));assert.deepEqual(wire.dispositions,c.dispositions);assert.deepEqual(wire.pendingObligations,c.pendingObligations);
  assert.equal(findingBodyFootprint(c,role),findingBodyFootprint(restoreFindingBodies(wire,role),role));
  const changed=structuredClone(c);changed.occurrences[0].data.finding.description+='changed';assert.notEqual(findingBodyFootprint(c,role),findingBodyFootprint(changed,role));
 });
 test('planning version4 framing explains literal expansion and output identities: '+role,()=>{
  const c=original(),framing=roleFraming(role,{requirements:[],contracts:'Original criteria',sources:[],requiredScope:[],context:c});
  assert.match(framing.systemPrompt,/findingBodyInput version4/);assert.match(framing.systemPrompt,/Emit original literal evidence and output IDs, never reference wrappers/);
  const wire=JSON.parse(framing.prompt.split('\n').find(line=>line.startsWith('{"requirements":'))).context;assert.equal(wire.findingBodyEncoding.version,4);assert.equal(JSON.stringify(restoreFindingBodies(wire,role)),JSON.stringify(c));
 });
 test('planning version4 receiver and declaration are exact: '+role,()=>{
  const wire=presentFindingBodies(original(),role);
  for(const mutate of [c=>delete c.findingBodyInput,c=>c.findingBodyInput.version=3,c=>c.findingBodyInput.extra=true,c=>c.stage='planning-adjudication',c=>c.findingBodyEncoding.version=3,c=>c.findingBodyEncoding.meaning=c.findingBodyEncoding.meaning.replace('Version4','Version3'),c=>c.occurrences[0].data.findingBodyIndex=999,c=>c.findingBodyEncoding.bodies.push({unused:true}),c=>c.findingBodyEncoding.values.push('unused'),c=>c.occurrences[0].data.finding=body]){
   const changed=structuredClone(wire);mutate(changed);assert.throws(()=>restoreFindingBodies(changed,role),/presentation/);
  }
  for(const foreign of ['adjudicator','reviewer',role==='planner'?'challenger':'planner'])assert.throws(()=>restoreFindingBodies(wire,foreign),/presentation/);
 });
 test('planning version4 remains explicit and may keep an unprofitable context literal: '+role,()=>{
  const legacy=original();delete legacy.findingBodyInput;assert.equal(presentFindingBodies(legacy,role),legacy);assert.equal(restoreFindingBodies(legacy,role),legacy);
  const small={stage,findingBodyInput:{version:4},occurrences:[row('one',{description:'small'})]};assert.equal(presentFindingBodies(small,role),small);assert.equal(restoreFindingBodies(small,role),small);assert.ok(findingBodyFootprint(small,role));
 });
}

test('captured planning-J literal policy keeps bodies beside identities without interpreting reference-shaped data',()=>{
 const original={...context(),findingBodyInput:{version:5}};original.occurrences[0].data.findingBodyIndex=41;
 original.occurrences[0].data.finding={...body,evidence:[{valueRef:0},'quoted historical {ref:95}'],unknown:{ref:4}};
 const before=JSON.stringify(original),wire=presentFindingBodies(original,'adjudicator');
 assert.equal(JSON.stringify(wire),before);assert.equal(Object.hasOwn(wire,'findingBodyEncoding'),false);
 assert.equal(JSON.stringify(restoreFindingBodies(JSON.parse(before),'adjudicator')),before);
 assert.equal(wire.occurrences[0].data.findingBodyIndex,41);assert.deepEqual(wire.occurrences[0].data.finding.evidence[0],{valueRef:0});
 const fingerprint=findingBodyFootprint(original,'adjudicator');assert.match(fingerprint,/^[a-f0-9]{64}$/);
 const changed=structuredClone(original);changed.occurrences[0].data.finding.description+=' changed';assert.notEqual(findingBodyFootprint(changed,'adjudicator'),fingerprint);
 changed.occurrences=original.occurrences;changed.findingBodyInput={version:3};assert.notEqual(findingBodyFootprint(changed,'adjudicator'),fingerprint);
});
for(const defect of ['role','stage','declaration','encoding','bound'])test('literal body policy refuses '+defect,()=>{
 const original={...context(),findingBodyInput:{version:5}};let role='adjudicator';
 if(defect==='role')role='planner';if(defect==='stage')original.stage='review-adjudication';if(defect==='declaration')original.findingBodyInput.extra=true;
 if(defect==='encoding')original.findingBodyEncoding={version:5,meaning:'forged',bodies:[body]};
 if(defect==='bound')original.occurrences[0].data.finding={description:'x'.repeat(2*1024*1024)};
 assert.throws(()=>presentFindingBodies(original,role),/Finding body/);
 if(defect!=='encoding')assert.throws(()=>findingBodyFootprint(original,role),/Finding body/);
 assert.throws(()=>restoreFindingBodies(original,role),/Finding body/);
});

test('review literal version6 exposes distinct current claims beside their subject keys and preserves opaque data',()=>{
 const original={...context(),stage:'review-adjudication',findingBodyInput:{version:6}};
 original.occurrences[0].subjectKey='s0';original.occurrences[1].subjectKey='s1';
 original.occurrences[1].data.finding={description:'Earlier role accounting is a different allegation from a code defect',evidence:['literal {valueRef:0}'],unknown:{ref:4}};
 const before=structuredClone(original),wire=presentFindingBodies(original,'adjudicator');
 assert.equal(wire,original);assert.equal(Object.hasOwn(wire,'findingBodyEncoding'),false);
 assert.deepEqual(restoreFindingBodies(JSON.parse(JSON.stringify(wire)),'adjudicator'),before);
 assert.notEqual(wire.occurrences[0].data.finding.description,wire.occurrences[1].data.finding.description);
 const fingerprint=findingBodyFootprint(original,'adjudicator');assert.match(fingerprint,/^[a-f0-9]{64}$/);
 const changed=structuredClone(original);changed.occurrences[1].data.finding.description+=' changed';assert.notEqual(findingBodyFootprint(changed,'adjudicator'),fingerprint);
 for(const mutate of [c=>c.stage='planning-adjudication',c=>c.findingBodyInput.extra=true,c=>c.findingBodyEncoding={version:6,bodies:[body]},c=>c.occurrences[0].data.finding={description:'x'.repeat(2*1024*1024)}]){
  const invalid=structuredClone(original);mutate(invalid);assert.throws(()=>presentFindingBodies(invalid,'adjudicator'),/Finding body/);assert.throws(()=>restoreFindingBodies(invalid,'adjudicator'),/Finding body/);
 }
 assert.throws(()=>presentFindingBodies(original,'reviewer'),/Finding body/);
});
