import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {prepareHistoricalPlans, captureHistoricalPlanManifest, historicalPlanManifest} from '../../dist/workflow/historical-plans.js';
import {roleInputEvidenceManifests} from '../../dist/workflow/role-input-evidence.js';
import {structuredOutputContext} from '../../dist/pi/structured-output.js';
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
function decode(snapshot, record) {
 const lines=snapshot.contents.split('\n'),chunks=lines.slice(record.firstLine-1,record.lastLine).map(JSON.parse);
 assert.equal(chunks.length,chunks[0].chunks);
 for(const [i,chunk]of chunks.entries()){assert.equal(chunk.ordinal,record.ordinal);assert.equal(chunk.chunk,i+1);assert.equal(chunk.chunks,chunks.length);}
 const raw=chunks.map(c=>c.text).join('');assert.equal(sha(raw),record.sha256);assert.equal(Buffer.byteLength(raw),record.bytes);return JSON.parse(raw);
}
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

test('a selected old check can fit the unchanged request policy while reading every historical body still holds without clipping',()=>{
 const original=canonical(Array.from({length:8},(_,i)=>plan('R'+i))),{value,evidence}=prepare(original);
 const framing=roleFraming('adjudicator',{requirements:[{id:'current',text:'Actual current task',source:'owner'}],contracts:'Current criteria',
  context:{stage:'planning-adjudication',historicalPlansInput:{version:1,id:evidence.manifest.id},historicalPlanningOperands:value},sources:[],requiredScope:[]},true);
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
