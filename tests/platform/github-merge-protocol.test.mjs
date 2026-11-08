import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryMergeOptions,parseNativeMergeResult} from '../../dist/platform/github-merge-protocol.js';
const head='1'.repeat(40),commit='2'.repeat(40);
test('one-PR synchronous request pins reviewed head and merge method without async/queue/bypass defaults',()=>{
 const options=ordinaryMergeOptions(head);assert.ok(Object.isFrozen(options));assert.deepEqual(options,{sha:head,merge_method:'merge'});
 for(const bad of ['main','A'.repeat(40),null])assert.throws(()=>ordinaryMergeOptions(bad));
});
test('only documented synchronous success establishes native success response',()=>{
 const response={merged:true,sha:commit,message:'Pull Request successfully merged'};
 assert.deepEqual(parseNativeMergeResult(response,200),{kind:'merged',commit,causality:'native-success-response'});
 for(const value of [null,{}, {...response,merged:'true'}, {...response,merged:false}, {...response,sha:head.toUpperCase().replace(/1/g,'A')}, {...response,extra:true}, {status:'pending',details:{uuid:'some-job'}}])assert.throws(()=>parseNativeMergeResult(value,200));
 for(const status of [201,202,204,500])assert.throws(()=>parseNativeMergeResult(response,status));
});
test('documented native refusal stays distinct from timeout and malformed success',()=>{
 for(const status of [403,404,405,409,422])assert.deepEqual(parseNativeMergeResult({message:'Refused'},status),{kind:'rejected'});
 assert.throws(()=>parseNativeMergeResult({message:'Unknown'},504));assert.throws(()=>parseNativeMergeResult({},200));
});
