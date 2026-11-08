import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {prepareHistoricalPlans, captureHistoricalPlanManifest, historicalPlanManifest} from '../../dist/workflow/historical-plans.js';
import {roleInputEvidenceManifests} from '../../dist/workflow/role-input-evidence.js';
import {structuredOutputContext} from '../../dist/pi/structured-output.js';
import {buildDispositionHistory} from '../../dist/workflow/disposition-history.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {assertModelContextBudget} from '../../dist/pi/context-budget.js';

const sha = text => createHash('sha256').update(text).digest('hex');
const plan = (id='R') => ({intent:'Preserve original intent', requirements:[{id,text:'Exact old requirement 한글',source:'original-owner'}],
 approach:'Original alternative '.repeat(100),simplerAlternative:'Original independent comparison',factualSources:[{sourceId:'base:consumer.cjs',reason:'Original source mapping'}],ambiguities:[],futureField:{original:true},
 verification:{requiredPaths:['consumer.cjs'],reviewRoles:[{key:'independent',role:'reviewer',purpose:'Check actual candidate',requiredPaths:['consumer.cjs']}],
 strategies:[{kind:'base-execution-duty',requirementId:id,subjectPaths:['consumer.cjs'],cases:[{id:'before-author',observed:'original'}]}],checkAmendments:[{correctedCheckId:'C'}],
 checks:[{id:'C',guaranteeIds:[id],assertions:['actual'],timeoutMs:5000,fixturePaths:['fixture'],expectationPaths:[],futureCheck:'retained',command:'node check.cjs',cases:[{id:'case',input:{literalUtf8:'한글🙂\\"\n'.repeat(1000)},expected:{kind:'return',value:'exact'}}]}]}});
const canonical = plans => ({semantics:'Exact historical evidence; no current acceptance',links:plans.map(p=>({occurrenceId:randomUUID(),planHash:sha(JSON.stringify(p))})),producers:[{outputId:'original',initialView:{sources:[]}}],unavailable:[{occurrenceId:'missing',code:'HISTORICAL_PLAN_SOURCE_UNAVAILABLE'}],plans:plans.map(plan=>({planHash:sha(JSON.stringify(plan)),plan}))});
const prepare = value => prepareHistoricalPlans(value,{id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts'});
const preparePreAdoption = value => prepareHistoricalPlans(value,{id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts',neverAdoptedWork:{version:1,censusSha256:'a'.repeat(64)}});
function decode(snapshot, record) {
 const lines=snapshot.contents.split('\n'),chunks=lines.slice(record.firstLine-1,record.lastLine).map(JSON.parse);
 assert.equal(chunks.length,chunks[0].chunks);
 for(const [i,chunk]of chunks.entries()){assert.equal(chunk.ordinal,record.ordinal);assert.equal(chunk.chunk,i+1);assert.equal(chunk.chunks,chunks.length);}
 const raw=chunks.map(c=>c.text).join('');assert.equal(sha(raw),record.sha256);assert.equal(Buffer.byteLength(raw),record.bytes);return JSON.parse(raw);
}
test('pre-adoption v2 preserves literal intent and exact full old records without supplying historical definitions eagerly',()=>{
 const old=plan();old.verification.checkIndex={unknownOriginal:true};old.intent={literal:'Original unknown intent representation'};
 const original=canonical([old]),before=structuredClone(original),{value,evidence}=preparePreAdoption(original);
 assert.ok(evidence);assert.deepEqual(original,before);assert.equal(value.planBodyEncoding.version,2);assert.equal(evidence.manifest.version,1);
 assert.deepEqual(value.plans[0].recordedIntent,old.intent);assert.equal(value.plans[0].inlinePlan,undefined);
 assert.deepEqual(decode(evidence,value.plans[0].record),original.plans[0]);
 for(const key of ['links','producers','unavailable'])assert.deepEqual(value[key],original[key]);
 const context={stage:'planning-adjudication',historicalPlansInput:{version:2,id:evidence.manifest.id},historicalPlanningOperands:value};
 assert.deepEqual(roleInputEvidenceManifests(context),[evidence.manifest]);
 const framing=roleFraming('adjudicator',{requirements:[{id:'current',text:'Actual owner duty',source:'owner'}],contracts:'Complete current workflow criteria',context:{...context,planProposal:{intent:'Full current proposal',requirements:[{id:'current',text:'Current definition'}]}},sources:[],requiredScope:[]},true);
 assert.match(framing.systemPrompt,/read its exact full record or hold/);assert.match(framing.prompt,/Full current proposal/);assert.match(framing.prompt,/Actual owner duty/);
 for(const mutate of [
  c=>{c.historicalPlansInput.version=1},
  c=>{c.historicalPlanningOperands.planBodyEncoding.readBoundPlanHashes.push(value.plans[0].planHash)},
  c=>{c.historicalPlanningOperands.planBodyEncoding.readBoundPlanHashes[0]='b'.repeat(64)},
  c=>{c.historicalPlanningOperands.planBodyEncoding.neverAdoptedWork.censusSha256='invalid'},
  c=>{c.historicalPlanningOperands.plans[0].inlinePlan=old},
  c=>{c.historicalPlanningOperands.plans[0].record.id='b'.repeat(64)},
 ]){const invalid=structuredClone(context);mutate(invalid);assert.throws(()=>historicalPlanManifest(invalid),/encoding/);}
 const legacy=prepare(canonical([plan()]));
 assert.deepEqual(historicalPlanManifest({...context,historicalPlanningOperands:legacy.value,historicalPlansInput:{version:2,id:legacy.evidence.manifest.id}}),legacy.evidence.manifest,'A fresh v2-capable receiver can retain v1 fallback');
});
test('exact historical plan bodies stay reconstructable while definitions, mappings and before-author duties remain inline',()=>{
 const original=canonical([plan('R1'),plan('R2')]),before=structuredClone(original),prepared=prepare(original),{value,evidence}=prepared;
 assert.ok(evidence);assert.deepEqual(original,before);assert.deepEqual(value.links,original.links);assert.deepEqual(value.producers,original.producers);assert.deepEqual(value.unavailable,original.unavailable);
 assert.ok(JSON.stringify(value).length<JSON.stringify(original).length);
 for(const [i,entry]of value.plans.entries()){
  assert.equal(entry.plan,undefined,'An explicitly partial inlinePlan cannot look like a complete hash-matched plan');
  const old=original.plans[i].plan,inline=entry.inlinePlan;
  for(const key of ['intent','requirements','factualSources','ambiguities','futureField'])assert.deepEqual(inline[key],old[key]);
  for(const key of ['requiredPaths','reviewRoles','strategies','checkAmendments'])assert.deepEqual(inline.verification[key],old.verification[key]);
  assert.deepEqual(inline.verification.checkIndex,[{id:'C',guaranteeIds:[i?'R2':'R1'],assertions:['actual'],timeoutMs:5000,fixturePaths:['fixture'],expectationPaths:[],futureCheck:'retained'}]);
  assert.equal(inline.verification.checks,undefined);assert.equal(inline.approach,undefined);
  assert.deepEqual(decode(evidence,entry.record),original.plans[i]);
 }
 const header=JSON.parse(evidence.contents.split('\n')[0]);assert.equal(header.kind,'historical-plans');assert.equal(header.arraySha256,sha(JSON.stringify(original.plans)));
 assert.equal(evidence.manifest.sha256,sha(evidence.contents));assert.ok(evidence.contents.split('\n').every(line=>Buffer.byteLength(line)<20000));
 original.plans[0].plan.requirements[0].text='late caller mutation';assert.deepEqual(decode(evidence,value.plans[0].record),before.plans[0]);
});
test('plain historical absence stays literal; malformed identities and unreadable artifacts never acquire a manifest',()=>{
 const small=canonical([{intent:'small'}]);assert.equal(prepare(small).evidence,undefined);assert.equal(prepare(small).value,small);
 assert.equal(historicalPlanManifest({stage:'planning-adjudication',historicalPlanningOperands:small}),undefined);assert.deepEqual(roleInputEvidenceManifests({}),[]);
 const invalid=canonical([plan()]);invalid.plans[0].plan.intent='changed';assert.throws(()=>prepare(invalid),/identity/);
 const duplicate=canonical([plan(),plan()]);assert.throws(()=>prepare(duplicate),/identity/);
 const collision=plan();collision.verification.checkIndex={unknownOriginal:'Preserve literally'};
 const retained=canonical([collision]);assert.equal(prepare(retained).value,retained);assert.equal(prepare(retained).evidence,undefined);
 const large=canonical([plan()]);large.plans[0].plan.approach='x'.repeat(1100000);large.plans[0].planHash=sha(JSON.stringify(large.plans[0].plan));assert.throws(()=>prepare(large),/manifest/);
 const {value,evidence}=prepare(canonical([plan()]));
 const context={stage:'planning-adjudication',historicalPlansInput:{version:1,id:evidence.manifest.id},historicalPlanningOperands:value};
 assert.deepEqual(historicalPlanManifest(context),evidence.manifest);assert.deepEqual(roleInputEvidenceManifests(context),[evidence.manifest]);
 for(const patch of [{kind:'disposition-history'},{epoch:0},{bytes:1048577},{records:0},{indexLines:9},{path:'/private/role-dispositions-'+evidence.manifest.id+'.jsonl'},{extra:true}])assert.throws(()=>captureHistoricalPlanManifest({...evidence.manifest,...patch}));
 for(const patch of [{stage:'fresh-review'},{historicalPlansInput:{version:1,id:randomUUID()}},{historicalPlansInput:undefined}])assert.throws(()=>historicalPlanManifest({...context,...patch}));
 assert.throws(()=>prepareHistoricalPlans(value,{id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts'}),/canonical/);
});

for(const deliveryVersion of [1,2])test('historical delivery v'+deliveryVersion+' preserves the real context guard after selected and all-record reads',()=>{
 const original=canonical(Array.from({length:8},(_,i)=>plan('R'+i))),{value,evidence}=(deliveryVersion===2?preparePreAdoption:prepare)(original);
 const framing=roleFraming('adjudicator',{requirements:[{id:'current',text:'Actual current task',source:'owner'}],contracts:'Current criteria',
  context:{stage:'planning-adjudication',historicalPlansInput:{version:deliveryVersion,id:evidence.manifest.id},historicalPlanningOperands:value},sources:[],requiredScope:[]},true);
 const initial=structuredOutputContext({messages:[{role:'system',content:framing.systemPrompt,timestamp:0},{role:'user',content:framing.prompt,timestamp:1}]},{version:1,requestId:'original-role',binding:{launchId:'original-role'},schema:framing.schema,maxNativeTurns:16});
 const delivered=records=>({...initial,messages:[...initial.messages,...records.flatMap((record,i)=>[
  {role:'user',content:'Read registered historical record '+record.id,timestamp:2+i*2},
  {role:'toolResult',toolCallId:'read-'+i,toolName:'read',content:[{type:'text',text:evidence.contents.split('\n').slice(record.firstLine-1,record.lastLine).join('\n')}],isError:false,timestamp:3+i*2}])]});
 const one=delivered([value.plans[0].record]),all=delivered(value.plans.map(p=>p.record));
 const probe={contextWindow:1000000,maxTokens:4000};
 const oneBudget=assertModelContextBudget(probe,one),model={contextWindow:oneBudget.estimatedInput+4000+4096+1024,maxTokens:4000};
 assert.doesNotThrow(()=>assertModelContextBudget(model,initial));assert.doesNotThrow(()=>assertModelContextBudget(model,one));
 const before=structuredClone(all);assert.throws(()=>assertModelContextBudget(model,all),{code:'MODEL_CONTEXT_LIMIT'});assert.deepEqual(all,before);
 assert.deepEqual(value.plans.map(entry=>decode(evidence,entry.record)),original.plans);
});

test('review v3 preserves adopted definitions and strategies with separately scoped partial records',()=>{
 const original=canonical([plan()]),prepared=prepareHistoricalPlans(original,{id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts',stage:'review-adjudication'}),{value,evidence}=prepared;
 assert.ok(evidence);assert.equal(value.planBodyEncoding.version,3);assert.equal(evidence.manifest.version,2);assert.equal(evidence.manifest.stage,'review-adjudication');assert.deepEqual(decode(evidence,value.plans[0].record),original.plans[0]);
 assert.deepEqual(value.plans[0].inlinePlan.requirements,original.plans[0].plan.requirements);assert.deepEqual(value.plans[0].inlinePlan.verification.strategies,original.plans[0].plan.verification.strategies);assert.deepEqual(value.plans[0].inlinePlan.futureField,original.plans[0].plan.futureField);
 const context={stage:'review-adjudication',historicalPlansInput:{version:3,id:evidence.manifest.id},historicalPlanningOperands:value};assert.deepEqual(roleInputEvidenceManifests(context),[evidence.manifest]);
 const chronology=buildDispositionHistory({id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts',stage:'review-adjudication',records:[]});
 const framing=roleFraming('adjudicator',{requirements:[],contracts:'Complete current workflow criteria',sources:[],requiredScope:[],context:{...context,findingBodyInput:{version:3},occurrences:[],dispositionHistoryInput:{version:2,id:chronology.manifest.id},dispositionHistory:chronology.manifest,dispositions:[]}},true);
 assert.match(framing.systemPrompt,/findingBodyInput version3/);assert.match(framing.systemPrompt,/version2 dispositionHistory/);assert.match(framing.systemPrompt,/version3 review-stage historicalPlanningOperands/);assert.doesNotMatch(framing.systemPrompt,/version1 dispositionHistory|findingBodyInput version2|version2 historical plan view/);
 for(const mutate of [c=>c.historicalPlansInput.version=1,c=>c.stage='planning-adjudication',c=>c.historicalPlanningOperands.planBodyEncoding.version=1,c=>c.historicalPlanningOperands.planBodyEncoding.manifest.version=1]){const bad=structuredClone(context);mutate(bad);assert.throws(()=>historicalPlanManifest(bad));}
 assert.throws(()=>prepareHistoricalPlans(original,{id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts',stage:'review-adjudication',neverAdoptedWork:{version:1,censusSha256:'a'.repeat(64)}}));
});

const requirementCodec=await import('../../dist/workflow/historical-plans.js');
const requirementContext=(stage='planning-adjudication')=>({stage,historicalRequirementsInput:{version:1},ownerRequirements:['Original owner request'],planProposal:{intent:'Full current plan',requirements:[{id:'CURRENT',text:'Current unchanged'}]},historicalPlanningOperands:{semantics:'Exact old definitions',plans:[0,1,2].map(i=>({planHash:'hash-'+i,inlinePlan:{intent:'Separate old plan '+i,requirements:[{id:'R1',text:'Exact 한글🙂\\"\n'.repeat(100),source:'Original-owner',unknown:{requirementsRef:555}}],unknown:{requirementsRef:777}}})),unavailable:[]}});
test('historical requirement sharing preserves exact arrays, source mappings, old identities and current operands',()=>{
 for(const stage of ['planning-adjudication','review-adjudication']){
  const original=requirementContext(stage),before=JSON.stringify(original),wire=requirementCodec.presentHistoricalRequirements(original,'adjudicator');
  assert.equal(wire.historicalPlanningOperands.requirementsEncoding.version,1);assert.equal(wire.historicalPlanningOperands.requirementsEncoding.values.length,1);assert.equal(JSON.stringify(original),before);
  const restored=requirementCodec.restoreHistoricalRequirements(JSON.parse(JSON.stringify(wire)),'adjudicator');assert.equal(JSON.stringify(restored),before);assert.deepEqual(restored.planProposal,original.planProposal);assert.deepEqual(restored.ownerRequirements,original.ownerRequirements);
  restored.historicalPlanningOperands.plans[0].inlinePlan.requirements[0].unknown.requirementsRef=1;assert.equal(restored.historicalPlanningOperands.plans[1].inlinePlan.requirements[0].unknown.requirementsRef,555);assert.equal(original.historicalPlanningOperands.plans[0].inlinePlan.requirements[0].unknown.requirementsRef,555);
 }
});
test('historical requirements retain no-history, small, malformed literal and reserved-position fallback',()=>{
 const absent={stage:'planning-adjudication',historicalRequirementsInput:{version:1}};assert.equal(requirementCodec.presentHistoricalRequirements(absent,'adjudicator'),absent);assert.equal(requirementCodec.restoreHistoricalRequirements(absent,'adjudicator'),absent);
 for(const value of [[],[{id:'short'}],{requirementsRef:0},'Original malformed literal',null]){
  const context=requirementContext();context.historicalPlanningOperands.plans=[{inlinePlan:{requirements:value}}];assert.equal(requirementCodec.presentHistoricalRequirements(context,'adjudicator'),context);
 }
 const collision=requirementContext();collision.historicalPlanningOperands.plans[0].inlinePlan.requirements={requirementsRef:0,unknown:true};assert.equal(requirementCodec.presentHistoricalRequirements(collision,'adjudicator'),collision);
 const legacy=requirementContext();delete legacy.historicalRequirementsInput;assert.equal(requirementCodec.presentHistoricalRequirements(legacy,'adjudicator'),legacy);assert.equal(requirementCodec.restoreHistoricalRequirements(legacy,'adjudicator'),legacy);
});
test('historical requirement references refuse unknown formats, wrong receivers, mixed and unused dictionary entries',()=>{
 const wire=requirementCodec.presentHistoricalRequirements(requirementContext(),'adjudicator');
 for(const mutate of [c=>delete c.historicalRequirementsInput,c=>c.historicalRequirementsInput.version=2,c=>c.historicalRequirementsInput.extra=true,c=>c.stage=['planning-adjudication'],c=>c.historicalPlanningOperands.requirementsEncoding.version=2,c=>c.historicalPlanningOperands.requirementsEncoding.values.push([{unused:true}]),c=>c.historicalPlanningOperands.requirementsEncoding.values.push(c.historicalPlanningOperands.requirementsEncoding.values[0]),c=>c.historicalPlanningOperands.requirementsEncoding.values=[null],c=>c.historicalPlanningOperands.requirementsEncoding.values=Array(1),c=>c.historicalPlanningOperands.plans[0].inlinePlan.requirements={requirementsRef:-1},c=>c.historicalPlanningOperands.plans[0].inlinePlan.requirements={requirementsRef:'0'},c=>c.historicalPlanningOperands.plans[0].inlinePlan.requirements={requirementsRef:0,extra:true},c=>c.historicalPlanningOperands.plans[0].inlinePlan.requirements={requirementsRef:999}]){
  const bad=structuredClone(wire);mutate(bad);assert.throws(()=>requirementCodec.restoreHistoricalRequirements(bad,'adjudicator'),/Historical requirement/);
 }
 assert.throws(()=>requirementCodec.restoreHistoricalRequirements(wire,'planner'));assert.throws(()=>requirementCodec.presentHistoricalRequirements(wire,'adjudicator'));
});
test('historical requirement amplification refuses before JSON.parse and exact2MiB boundary remains valid',()=>{
 const limit=2*1024*1024,original=requirementContext();original.padding='';original.padding='p'.repeat(limit-Buffer.byteLength(JSON.stringify(original)));const boundary=requirementCodec.presentHistoricalRequirements(original,'adjudicator');assert.equal(Buffer.byteLength(JSON.stringify(requirementCodec.restoreHistoricalRequirements(boundary,'adjudicator'))),limit);
 boundary.padding+='p';const parse=JSON.parse;let calls=0;JSON.parse=(...args)=>{calls++;return parse(...args);};try{assert.throws(()=>requirementCodec.restoreHistoricalRequirements(boundary,'adjudicator'));assert.equal(calls,0);}finally{JSON.parse=parse;}
 const wire=requirementCodec.presentHistoricalRequirements(requirementContext(),'adjudicator');wire.historicalPlanningOperands.requirementsEncoding.values=[[{text:'x'.repeat(800000)}]];assert.ok(Buffer.byteLength(JSON.stringify(wire))<limit);calls=0;JSON.parse=(...args)=>{calls++;return parse(...args);};try{assert.throws(()=>requirementCodec.restoreHistoricalRequirements(wire,'adjudicator'));assert.equal(calls,0);}finally{JSON.parse=parse;}
});


test('historical requirement expansion detaches even shared in-memory inline plan positions',()=>{
 const wire=requirementCodec.presentHistoricalRequirements(requirementContext(),'adjudicator');wire.historicalPlanningOperands.plans[1].inlinePlan=wire.historicalPlanningOperands.plans[0].inlinePlan;
 const restored=requirementCodec.restoreHistoricalRequirements(wire,'adjudicator'),plans=restored.historicalPlanningOperands.plans;
 assert.notEqual(plans[0].inlinePlan,plans[1].inlinePlan);assert.notEqual(plans[0].inlinePlan.requirements,plans[1].inlinePlan.requirements);plans[0].inlinePlan.requirements[0].text='later change';assert.notEqual(plans[1].inlinePlan.requirements[0].text,'later change');
});

test('planning version4 retains adopted duties and distinguishes exact deferred fields from empty or absent values',()=>{
 const old=plan(),empty=plan('empty');empty.factualSources=[];empty.intent='';empty.verification.reviewRoles[0].purpose='';
 const original=canonical([old,empty]),input={id:randomUUID(),workId:'W',epoch:3,artifactRoot:'/private/role-artifacts',deliveryVersion:4};
 const prepared=prepareHistoricalPlans(original,input),ctx={stage:'planning-adjudication',historicalPlansInput:{version:4,id:input.id},historicalPlanningOperands:prepared.value};
 assert.ok(prepared.evidence);assert.deepEqual(historicalPlanManifest(ctx),prepared.evidence.manifest);
 const [row,literal]=prepared.value.plans;
 assert.ok(row.readBoundFields.includes('/intent'));assert.ok(!row.readBoundFields.includes('/factualSources'));assert.deepEqual(row.inlinePlan.factualSources,old.factualSources);assert.ok(row.readBoundFields.includes('/verification/reviewRoles/0/purpose'));
 assert.equal(Object.hasOwn(row.inlinePlan,'intent'),false);assert.deepEqual(row.inlinePlan.requirements,old.requirements);assert.deepEqual(row.inlinePlan.verification.strategies,old.verification.strategies);
 assert.deepEqual(row.inlinePlan.verification.checkIndex[0].assertions,old.verification.checks[0].assertions);assert.deepEqual(row.inlinePlan.futureField,old.futureField);
 assert.deepEqual(literal.inlinePlan.factualSources,[]);assert.equal(literal.inlinePlan.intent,'');assert.equal(literal.inlinePlan.verification.reviewRoles[0].purpose,'');
 assert.ok(!literal.readBoundFields.includes('/intent'));assert.ok(!literal.readBoundFields.includes('/factualSources'));
 for(const [i,entry]of prepared.value.plans.entries())assert.deepEqual(decode(prepared.evidence,entry.record),original.plans[i]);
 for(const mutate of [c=>{c.historicalPlansInput.version=2},c=>{c.historicalPlanningOperands.planBodyEncoding.version=1},c=>{c.historicalPlanningOperands.plans[0].readBoundFields=Array(1)},c=>{c.stage='review-adjudication'},c=>{c.historicalPlanningOperands.plans[0].readBoundFields.push('/requirements')},c=>{c.historicalPlanningOperands.plans[0].readBoundFields.push('/verification/reviewRoles/999/purpose')},c=>{c.historicalPlanningOperands.plans[0].inlinePlan.intent=old.intent},c=>{c.historicalPlanningOperands.plans.pop()},c=>{c.historicalPlanningOperands.plans=Array(1);c.historicalPlanningOperands.planBodyEncoding.manifest.records=1;c.historicalPlanningOperands.planBodyEncoding.manifest.indexLines=1}]){
  const changed=structuredClone(ctx);mutate(changed);assert.throws(()=>historicalPlanManifest(changed),/Historical plan/);
 }
 assert.throws(()=>prepareHistoricalPlans(original,{...input,stage:'review-adjudication'}),/version/);
});
