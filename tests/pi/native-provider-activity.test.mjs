import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeProviderActivity,captureNativeProviderActivity,createNativeProviderActivityReporter} from '../../dist/pi/native-provider-activity.js';
const retry={type:'system',subtype:'api_retry',attempt:2,max_retries:5,retry_delay_ms:1000,error_status:503};
test('Native wait notices retain bounded scalar facts and omit private error/prompt content',()=>{
 assert.deepEqual(nativeProviderActivity({...retry,error:{message:'private detail'},prompt:'private input'}),{kind:'retry',attempt:2,maxAttempts:5,delayMs:1000,status:503});
 for(const mutation of [{attempt:-1},{attempt:NaN},{attempt:1.5},{max_retries:1},{retry_delay_ms:Infinity},{retry_delay_ms:604800001}])assert.equal(nativeProviderActivity({...retry,...mutation}),undefined);
 assert.equal(nativeProviderActivity({...retry,retry_delay_ms:1250.5}).delayMs,1250.5,'Native jittered delays may be fractional');
 assert.equal(nativeProviderActivity({...retry,parent_tool_use_id:'different-owner'}),undefined);
 assert.equal(nativeProviderActivity({type:'system',subtype:'unrecognized',attempt:2}),undefined);
 assert.deepEqual(captureNativeProviderActivity({kind:'rate-limit',resetsAt:'untrusted date',extra:'not retained'}),{kind:'rate-limit'});
 assert.deepEqual(nativeProviderActivity({type:'rate_limit_event',rate_limit_info:{status:'rejected',resetsAt:2000000000}}),{kind:'rate-limit',resetsAt:2000000000});
 for(const status of ['allowed','allowed_warning'])assert.equal(nativeProviderActivity({type:'rate_limit_event',rate_limit_info:{status}}),null);
 assert.equal(nativeProviderActivity({type:'rate_limit_event',rate_limit_info:{status:'unrecognized'}}),undefined);
});
const init=sid=>({type:'system',subtype:'init',session_id:sid});
const event=(sid,value)=>({...value,session_id:sid});
test('Native query ownership survives unused Pi tool turns and rejects foreign or stale events',()=>{
 const seen=[],reporter=createNativeProviderActivityReporter(value=>seen.push(value));
 const captureFirst=reporter.begin(),first=value=>captureFirst(value)();
 first(init('A'));first(event('A',retry));first(event('A',retry));assert.equal(seen.length,2);
 const captureUnused=reporter.begin();
 first(event('A',{...retry,attempt:3}));assert.equal(seen.at(-1).attempt,3,'Original callback remains live after another Pi dispatch');
 const before=structuredClone(seen);first(event('foreign',{type:'result'}));first(event('foreign',retry));assert.deepEqual(seen,before);
 first(event('A',{type:'assistant'}));first(event('A',retry));assert.equal(seen.at(-1).kind,'retry','Response activity does not seal the original query');
 const captureNext=reporter.begin(),second=value=>captureNext(value)();second(init('B'));second(event('B',{...retry,attempt:4}));
 const next=structuredClone(seen);first(init('A'));first(event('A',{type:'assistant'}));captureUnused(init('unused'))();assert.deepEqual(seen,next);
 second({type:'gitjig.native-query-settled/v1',nativeSessionId:'foreign'});assert.equal(seen.at(-1).attempt,4);
 second(event('B',{type:'result'}));const settled=structuredClone(seen);second(event('B',retry));second(event('B',{type:'assistant'}));second(init('B'));assert.deepEqual(seen,settled);
 reporter.close();reporter.begin()(init('C'))();assert.deepEqual(seen,settled);
});
test('rate window recovery preserves unrelated limits and a current retry',()=>{
 const seen=[],reporter=createNativeProviderActivityReporter(value=>seen.push(value)),capture=reporter.begin(),receive=value=>capture(event('A',value))();
 receive(init('A'));
 const rate=(status,rateLimitType,resetsAt)=>({type:'rate_limit_event',rate_limit_info:{status,rateLimitType,resetsAt}});
 receive(rate('rejected','five_hour',10));receive(rate('allowed',['five_hour']));assert.equal(seen.at(-1).resetsAt,10,'Malformed window cannot clear a valid rejection');receive(rate('allowed','seven_day'));assert.equal(seen.at(-1).resetsAt,10);
 receive(rate('rejected','seven_day',20));receive(rate('allowed','seven_day'));assert.equal(seen.at(-1).resetsAt,10);
 receive(retry);receive(rate('allowed_warning','five_hour'));assert.equal(seen.at(-1).kind,'retry');
 receive({type:'assistant'});assert.equal(seen.at(-1),null);
 receive(rate('rejected','unknown-window',30));receive(rate('allowed','another-unknown-window'));assert.equal(seen.at(-1).resetsAt,30);
 reporter.reset();const reset=structuredClone(seen);receive(retry);assert.deepEqual(seen,reset);
});
test('optional display failure and malformed display facts cannot create a source failure',async()=>{
 let calls=0;const reporter=createNativeProviderActivityReporter(()=>{calls++;if(calls===1)throw Error('display closed');return Promise.reject(Error('late display failure'))});
 const capture=reporter.begin(),receive=value=>capture(event('A',value))();receive(init('A'));assert.doesNotThrow(()=>receive(retry));assert.doesNotThrow(()=>capture({get type(){throw Error('malformed display event')}})());reporter.close();await new Promise(resolve=>setImmediate(resolve));assert.ok(calls>=2);
});
