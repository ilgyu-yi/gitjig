import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDispositionEvidence,parseRoleOutput} from '../../dist/workflow/protocol.js';
const core={requirementId:'R',severity:'blocking',repair:'substantive',description:'Original claim',evidence:[]};
const pending={occurrenceId:'O',disposition:'upheld',reason:'Original claim remains unresolved',witnesses:[]};
test('pending judgments without a witness are limited to ordinary subjects',()=>{
 for(const decision of [pending,{...pending,disposition:'equivalent',equivalentTo:'T'}])assert.doesNotThrow(()=>assertDispositionEvidence(decision,core,false));
 for(const [decision,finding,synthetic] of [
  [pending,{...core,severity:'optional'},false],
  [{...pending,disposition:'rejected'},core,false],
  [{...pending,disposition:'unresolved'},core,false],
  [{...pending,resolution:'repaired'},core,false],
  [{...pending,resolution:'diagnosed'},core,true],
  [pending,core,true],
  [{...pending,disposition:'equivalent',equivalentTo:'T'},core,true],
 ])assert.throws(()=>assertDispositionEvidence(decision,finding,synthetic),/retained reason\/witness/);
});
test('an exact typed diagnosis can serve as the witness to an independent reason',()=>{
 const witness={outputId:'original-output',rawSha256:'a'.repeat(64),inputReceiptHash:'b'.repeat(64),materialOccurrenceIds:['A','B']};
 const diagnosed={...pending,resolution:'diagnosed',diagnosis:{...witness,materialOccurrenceIds:['B','A']}};
 assert.doesNotThrow(()=>assertDispositionEvidence(diagnosed,core,true,witness));
 assert.doesNotThrow(()=>assertDispositionEvidence({...diagnosed,witnesses:['retained output']},core,true));
 for(const mismatch of [undefined,{...witness,outputId:'other'},{...witness,rawSha256:'c'.repeat(64)},
  {...witness,inputReceiptHash:'d'.repeat(64)},{...witness,materialOccurrenceIds:[]},{...witness,materialOccurrenceIds:['A','C']}])
  assert.throws(()=>assertDispositionEvidence(diagnosed,core,true,mismatch),/retained reason\/witness/);
 for(const decision of [{...diagnosed,reason:' '},{...diagnosed,resolution:'pending'},{...diagnosed,disposition:'rejected'}])
  assert.throws(()=>assertDispositionEvidence(decision,core,true,witness),/retained reason\/witness/);
 assert.throws(()=>assertDispositionEvidence(diagnosed,core,false,witness),/retained reason\/witness/);
});
test('pending exception requires the original mandatory finding core',()=>{
 for(const key of Object.keys(core)){const finding={...core};delete finding[key];assert.throws(()=>assertDispositionEvidence(pending,finding,false));}
 assert.doesNotThrow(()=>assertDispositionEvidence(pending,{...core,reproduction:'malformed optional claim'},false));
});
test('every disposition needs a reason and terminal accounting needs actual supplied witnesses',()=>{
 assert.throws(()=>assertDispositionEvidence({...pending,reason:'  ',witnesses:['Original source']},core,false),/retained reason/);
 assert.doesNotThrow(()=>assertDispositionEvidence({...pending,witnesses:['Original source']},{...core,severity:'optional'},false));
});
test('historical syntax decoding does not acquire fresh effect admission',()=>{
 const result={version:1,summary:'Original judgment',findings:[],assessedScope:[],decisions:[{...pending,disposition:'rejected'}],planAccepted:false};
 const parsed=parseRoleOutput(JSON.stringify(result),'adjudicator');
 assert.ok(parsed.value,JSON.stringify(parsed.issues));assert.deepEqual(parsed.value.decisions,result.decisions);
 assert.throws(()=>assertDispositionEvidence(parsed.value.decisions[0],core,false),/retained reason/);
});
