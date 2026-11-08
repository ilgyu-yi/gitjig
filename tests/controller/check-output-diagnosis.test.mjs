import test from 'node:test';
import assert from 'node:assert/strict';
import {caseDescriptor,compareCases,checkOutputDiagnosis,baselineAssertionsMatch} from '../../dist/controller/check-cases.js';
import {parseCheckOutput} from '../../dist/workflow/protocol.js';
const check={id:'C',guaranteeIds:['R'],command:'node check.cjs',assertions:['behavior'],fixturePaths:['consumer.cjs'],expectationPaths:[],timeoutMs:1000,cases:[{id:'valid',kind:'healthy',guaranteeIds:['R'],derivation:'Valid input returns the actual value',consumerPaths:['consumer.cjs'],input:{literalUtf8:'[]',fixturePaths:[]},expected:{kind:'return',value:'[]'}}]};
const candidate={hash:'a'.repeat(64),data:{manifest:{files:[{path:'consumer.cjs',sha256:'b'.repeat(64),effectiveMode:0o444}]}}};
const descriptor=caseDescriptor(check,candidate,{candidate:'candidate',verification:'verification'},'run');
const output=()=>({version:1,assertions:[{id:'behavior',passed:true}],cases:descriptor.cases.map(c=>({id:c.id,inputDigest:c.inputDigest,observed:c.declaration.expected}))});
test('producer contract validity is separate from actual assertion truth and baseline policy',()=>{
 const result=output();assert.equal(checkOutputDiagnosis(check,descriptor,result).complete,true);
 result.assertions[0].passed=false;
 assert.equal(checkOutputDiagnosis(check,descriptor,result).complete,true,'A genuine false assertion is not a producer roster error');
 assert.equal(baselineAssertionsMatch({...check,baselineExpectedFailures:['behavior']},result.assertions),true);
 assert.equal(baselineAssertionsMatch(check,result.assertions),false);
});
test('true extra or missing assertions cannot stand in for the accepted roster',()=>{
 const extra=output();extra.assertions.push({id:'case:valid',passed:true});
 assert.equal(checkOutputDiagnosis(check,descriptor,extra).complete,false);
 assert.equal(checkOutputDiagnosis(check,descriptor,extra).counts['assertion-unexpected'],1);
 const missing=output();missing.assertions=[];assert.equal(checkOutputDiagnosis(check,descriptor,missing).counts['assertion-missing'],1);
});
test('assertion-only legacy reports still parse and cannot stand for a declared case roster',()=>{
 const stdout=JSON.stringify({version:1,assertions:[{id:'behavior',passed:true}]});
 const parsed=parseCheckOutput(stdout);
 assert.deepEqual(parsed.issues,[]);
 assert.ok(parsed.value);
 assert.deepEqual(checkOutputDiagnosis(check,descriptor,parsed.value).counts,{'case-roster-size':1,'case-missing':1});
 const empty={...check,cases:[]};
 const emptyDescriptor=caseDescriptor(empty,candidate,descriptor.boundVersions,descriptor.runId);
 assert.equal(checkOutputDiagnosis(empty,emptyDescriptor,parsed.value).complete,true);
});
test('current host case tokens are opaque and literal-only hashes remain unbound',()=>{
 const result=output();result.cases[0].inputDigest='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
 const diagnosis=checkOutputDiagnosis(check,descriptor,result);assert.equal(diagnosis.complete,false);assert.equal(diagnosis.counts['case-input-digest'],1);
 const comparison=compareCases(check,descriptor,result);assert.equal(comparison.complete,false);assert.deepEqual(comparison.mismatches,[]);
 assert.deepEqual(Object.keys(comparison).sort(),['checkBinding','complete','descriptorHash','mismatches','version'],'Original v1 comparison shape remains unchanged');
});
test('bound actual value mismatch stays a material comparison rather than a contract diagnosis',()=>{
 const result=output();result.cases[0].observed={kind:'return',value:'wrong'};
 assert.equal(checkOutputDiagnosis(check,descriptor,result).complete,true);assert.equal(compareCases(check,descriptor,result).mismatches.length,1);
});
test('diagnostic previews are bounded and explicitly disclose omissions',()=>{
 const result=output();result.assertions=Array.from({length:80},(_,i)=>({id:String(i)+'x'.repeat(1000),passed:true}));
 const diagnosis=checkOutputDiagnosis(check,descriptor,result);assert.ok(Buffer.byteLength(JSON.stringify(diagnosis))<=4096);assert.ok(diagnosis.omittedProblems>0);assert.ok(diagnosis.problems.some(p=>p.omittedIdCharacters>0));
});
