import test from 'node:test';import assert from 'node:assert/strict';
import {parseRoleOutput,parseCheckOutput} from '../../dist/workflow/protocol.js';
import {caseDescriptor,compareCases,coverageIssue,changedCaseIds} from '../../dist/controller/check-cases.js';
const pair=[{id:'good',kind:'healthy',guaranteeIds:['R'],derivation:'Valid request succeeds',consumerPaths:['consumer'],input:{literalUtf8:'  한글\n',fixturePaths:[]},expected:{kind:'return',value:'\n'}},{id:'bad',kind:'adverse',guaranteeIds:['R'],derivation:'Invalid request is rejected',consumerPaths:['consumer'],input:{literalUtf8:'invalid',fixturePaths:[]},expected:{kind:'rejection',value:''}}];
const check={id:'C',guaranteeIds:['R'],command:'node suite.cjs',assertions:['contract'],fixturePaths:['consumer'],expectationPaths:[],timeoutMs:1000,cases:pair};
const plan={intent:'Actual cases',requirements:[{id:'R',text:'Reject invalid',source:'owner-request'}],approach:'Paired consumer',simplerAlternative:'Existing suite',factualSources:[],ambiguities:[],verification:{checks:[check],requiredPaths:['consumer'],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Case reachability',requiredPaths:['consumer']}]}};
const common={version:1,summary:'Cases',findings:[],assessedScope:[]};
test('finite case schema preserves exact UTF8 bytes, rejects malformed/duplicate/authority fields and supports case-only amendments',()=>{
 const parsed=parseRoleOutput(JSON.stringify({...common,plan}),'planner');assert.ok(parsed.value,JSON.stringify(parsed.issues));assert.equal(parsed.value.plan.verification.checks[0].cases[0].input.literalUtf8,'  한글\n');
 for(const edit of [c=>c.push(c[0]),c=>c[0].input.literalUtf8='\ud800',c=>c[0].input.verified=true,c=>c[0].consumerPaths=['../foreign']]){const p=structuredClone(plan);edit(p.verification.checks[0].cases);assert.equal(parseRoleOutput(JSON.stringify({...common,plan:p}),'planner').value,null);}
 const p=structuredClone(plan);p.verification.checkAmendments=[{obligationId:'O',failedCheckRunId:'F',basis:'fixture-defect',correctedCheckId:'C',fixturePaths:[],negativeAssertions:[],caseIds:['good'],negativeCaseIds:['good'],reason:'Exact wrong expected value'}];assert.ok(parseRoleOutput(JSON.stringify({...common,plan:p}),'planner').value);
});
test('collector matches complete current ordered operands and exact rejection bytes; foreign/missing/duplicate/stale results cannot stand',()=>{
 const candidate={hash:'candidate',data:{manifest:{files:[{path:'consumer',sha256:'file',effectiveMode:0o444}]}}};const d=caseDescriptor(check,candidate,{candidate:'C',verification:'V'},'run1');const result={version:1,assertions:[{id:'contract',passed:true}],cases:d.cases.map(c=>({id:c.id,inputDigest:c.inputDigest,observed:c.declaration.expected}))};
 assert.ok(parseCheckOutput(JSON.stringify(result)).value);assert.deepEqual(compareCases(check,d,result).mismatches,[]);assert.equal(compareCases(check,d,result).complete,true);
 const wrong=structuredClone(result);wrong.cases[0].observed.value='';assert.equal(compareCases(check,d,wrong).mismatches.length,1);assert.equal(compareCases(check,d,{...result,cases:result.cases.slice(1)}).complete,false);assert.equal(compareCases(check,caseDescriptor(check,candidate,{candidate:'C',verification:'V'},'run2'),result).complete,false);
 assert.equal(parseCheckOutput(JSON.stringify({...result,cases:[...result.cases,result.cases[0]]})).value,null);assert.equal(coverageIssue(plan),null);const no=structuredClone(plan);delete no.verification.checks[0].cases;assert.match(coverageIssue(no),/verification-cases-required/);
 const next=structuredClone(check);next.cases[0].expected.value='correct';assert.deepEqual(changedCaseIds(check,next),['good']);next.cases.reverse();assert.throws(()=>changedCaseIds(check,next),/ordered/);
});
