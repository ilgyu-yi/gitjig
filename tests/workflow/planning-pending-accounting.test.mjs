import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCurrentPendingSubjects,assertCurrentPendingAccounting,assertImplementationAccounting} from '../../dist/workflow/adjudication-accounting.js';
const refs={version:3,occurrenceIds:['ordinary','pending-diagnosis','resolved-diagnosis'],diagnosisOccurrenceIds:['pending-diagnosis','resolved-diagnosis'],pendingOrdinaryIndexes:[0],blockingOrdinaryIndexes:[0],retentionChoices:[]};
const accepted={version:1,summary:'Independent current plan',findings:[],assessedScope:[],planAccepted:true,decisions:[]};
test('current original pending union includes unavailable diagnosis but excludes resolved historical membership',()=>{
 const projection={occurrences:[{occurrenceId:'pending-diagnosis'}],outputs:[]},captured=captureCurrentPendingSubjects(refs,projection);
 assert.deepEqual(captured,['ordinary','pending-diagnosis']);projection.occurrences.length=0;assert.deepEqual(captured,['ordinary','pending-diagnosis']);assert.equal(Object.isFrozen(captured),true);
 assert.throws(()=>assertCurrentPendingAccounting({...accepted,decisions:[{occurrenceId:'ordinary'}]},captured),/pending-diagnosis/);
 assert.doesNotThrow(()=>assertCurrentPendingAccounting({...accepted,decisions:[{occurrenceId:'ordinary'},{occurrenceId:'pending-diagnosis',disposition:'deferred'}]},captured));
});
test('declined and owner-hold outputs preserve partial independent judgments',()=>{
 const pending=captureCurrentPendingSubjects(refs,{occurrences:[{occurrenceId:'pending-diagnosis'}]});
 assert.doesNotThrow(()=>assertCurrentPendingAccounting({...accepted,planAccepted:false},pending));
 assert.doesNotThrow(()=>assertCurrentPendingAccounting({...accepted,ownerDecisionRequired:['Original scope unresolved']},pending));
});
test('long Unicode identities keep feedback bounded without changing original operands',()=>{
 const pending=Array.from({length:16},(_,i)=>'🙂'.repeat(8000)+i);
 assert.throws(()=>assertCurrentPendingAccounting(accepted,pending),error=>{
  assert.ok(Buffer.byteLength(error.message)<8192);assert.match(error.message,/"omittedSubjects":8/);assert.match(error.message,/"omittedCodePoints":7937/);assert.match(error.message,/not exact operands/);return true;
 });assert.equal(Array.from(pending[0]).length,8001);
});
test('missing and historical current-domain declarations supply no new absence premise or decoder recipe',()=>{
 assert.equal(captureCurrentPendingSubjects(refs,undefined),undefined);assert.equal(captureCurrentPendingSubjects(undefined,{occurrences:[]}),undefined);
 assert.equal(captureCurrentPendingSubjects({version:2,occurrenceIds:['pending-diagnosis'],diagnosisOccurrenceIds:['pending-diagnosis']},{occurrences:[]}),undefined);
 assert.doesNotThrow(()=>assertCurrentPendingAccounting(accepted,undefined));
 assert.doesNotThrow(()=>assertImplementationAccounting(accepted,{...refs,pendingOrdinaryIndexes:[]}));
});
for(const occurrences of [[{occurrenceId:'foreign'}],[{occurrenceId:'ordinary'}],[{occurrenceId:'pending-diagnosis'},{occurrenceId:'pending-diagnosis'}],[null]])test('malformed current diagnosis identity domain refuses: '+JSON.stringify(occurrences),()=>{
 assert.throws(()=>captureCurrentPendingSubjects(refs,{occurrences}),/current pending diagnosis subject unavailable/);
});
