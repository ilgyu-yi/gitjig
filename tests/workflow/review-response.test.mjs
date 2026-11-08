import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {wholeJsonFence} from '../../dist/workflow/json.js';
import {parseRoleOutput,MAX_FINAL_BYTES} from '../../dist/workflow/protocol.js';
import {roleFraming} from '../../dist/workflow/role-framing.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
import {prepareSubjectActionInput} from '../../dist/workflow/subject-actions.js';

const ids=Array.from({length:77},(_,i)=>'original-subject-'+i);
const refs={version:3,occurrenceIds:ids,diagnosisOccurrenceIds:ids.slice(75),pendingOrdinaryIndexes:ids.slice(0,74).map((_,i)=>i),blockingOrdinaryIndexes:ids.slice(0,74).map((_,i)=>i),retentionChoices:ids.slice(74).map((occurrenceId,i)=>({occurrenceId,dispositionId:'retained-'+i,sha256:String(i+1).repeat(64)}))};
const context=prepareSubjectActionInput('adjudicator',{stage:'review-adjudication',reviewResolutionInput:{version:2},subjectActionsInput:{version:1},metadataIdentityInput:{version:3},decisionReferences:refs,occurrences:ids.map(id=>({id}))});
const bundle={requirements:[],contracts:'Actual requirements',sources:[],context};
const framing=roleFraming('adjudicator',bundle);
const wire=()=>({version:1,summary:'Current evidence',findings:[],assessedScope:[],subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:Object.fromEntries(ids.map((_,i)=>['s'+i,i>=74?'retain':i===0?{disposition:'upheld',resolution:'pending',reason:'Current root duty remains',witnesses:['actual-check']}:{disposition:'equivalent',equivalentTo:'s0',reason:'Same independently assessed duty',witnesses:['actual-check']}]))});
const fence=body=>'```json\n'+body+'\n```';
const parse=(raw,constraints=framing.constraints)=>parseRoleOutput(raw,'adjudicator',[],constraints);

test('declared version1 review framing keeps the pinned compatible recipe',()=>{
 const refs={version:3,occurrenceIds:['F','E','D'],diagnosisOccurrenceIds:['D'],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[{occurrenceId:'D',dispositionId:'OLD-D',sha256:'a'.repeat(64)}]};
 const f=roleFraming('adjudicator',{requirements:[],contracts:'Actual requirements',sources:[],context:{stage:'review-adjudication',reviewResolutionInput:{version:1},decisionReferences:refs}});
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 assert.equal(hash(f.systemPrompt),'4b3e166eea938bf37b770175f071a46b4d4ee885f15d707df356a43eadab9510');
 assert.equal(hash(f.prompt),'cdf52cfdb5d8f31531cc7264776c8aad196e2f21fc1d3ce06185e29556cf990b');
 assert.equal(hash(f.schema),'5cc21fe672ff6fa7f3c73f533f21247c68649781c631f8264eb570f56da2fa91');
});

test('whole-answer locator retains exact UTF8 source coordinates with ASCII whitespace and CRLF',()=>{
 const body='{"summary":"현재 ☃"}\r\n',raw=' \t\r\n  ```json\t\r\n'+body+'```\t\r\n \n';
 const region=wholeJsonFence(raw);assert.ok(region);assert.equal(region.body,body);
 const bytes=Buffer.from(raw);assert.equal(bytes.subarray(region.bodyStartByte,region.bodyEndByte).toString(),body);
 assert.equal(bytes.subarray(region.openingStartByte,region.bodyStartByte).toString(),'```json\t\r\n');
 assert.equal(bytes.subarray(region.bodyEndByte,region.closingEndByte).toString(),'```\t\r\n');
});

test('fresh77-subject frame accepts plain or whole fenced keyed actions without changing canonical duties',()=>{
 const output=wire(),plain=JSON.stringify(output),raw=fence(plain);
 const validate=new Ajv2020({strict:false}).compile(roleOutputSchema('adjudicator','review-adjudication',[],framing.constraints));
 assert.equal(validate(output),true,JSON.stringify(validate.errors));
 const direct=parse(plain),wrapped=parse(raw);assert.deepEqual(wrapped.issues,[]);assert.deepEqual(wrapped.value,direct.value);
 assert.equal(wrapped.value.decisions.length,74);assert.equal(wrapped.value.decisions[0].resolution,undefined);
 assert.deepEqual(wrapped.value.retainedDispositions,['retained-0','retained-1','retained-2']);
 assert.equal(JSON.stringify(output),plain);assert.equal(raw,fence(plain));
 assert.equal(parse(raw,{...framing.constraints,reviewResolution:{version:1,stage:'review-adjudication'}}).value,null);
 const {reviewResolution,...absent}=framing.constraints;assert.equal(parse(raw,absent).value,null);
});

for(const [name,wrap]of Object.entries({prose:x=>'Result:\n'+fence(x),suffix:x=>fence(x)+'\nDone',multiple:x=>fence(x)+'\n'+fence(x),missing:x=>'```json\n'+x,wrongLanguage:x=>'```javascript\n'+x+'\n```',bare:x=>'```\n'+x+'\n```',bom:x=>'\ufeff'+fence(x),extraFence:x=>'```json\n'+x+'\n```\n```\n```'}))test('review grammar2 rejects '+name+' instead of finding a snippet',()=>{
 const raw=wrap(JSON.stringify(wire()));assert.equal(wholeJsonFence(raw),undefined);assert.equal(parse(raw).value,null);
});

test('fenced decoding preserves duplicate-key and outer byte limits',()=>{
 const plain=JSON.stringify(wire()),duplicate=plain.replace('"s0":','"s0":"retain","s0":');
 assert.match(parse(fence(duplicate)).issues.join(),/duplicate/i);
 const raw=fence(' '.repeat(MAX_FINAL_BYTES-plain.length-4)+plain);assert.ok(Buffer.byteLength(raw)>MAX_FINAL_BYTES);
 assert.match(parse(raw).issues.join(),/128KiB/);
});

test('fence support cannot normalize invalid equivalent completion or duplicate retention choices',()=>{
 const output=wire();output.decisionActions.s1.resolution='repaired';
 assert.equal(parse(fence(JSON.stringify(output))).value,null);
 const validate=new Ajv2020({strict:false}).compile(framing.schema);assert.equal(validate(output),false);
 const extra={...wire(),retainedDispositions:['retained-0']};assert.equal(parse(fence(JSON.stringify(extra))).value,null);
});
