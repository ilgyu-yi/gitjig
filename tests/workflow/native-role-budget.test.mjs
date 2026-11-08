/** Finite capture admission only; source interpretation is tested separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NativeRoleCollector,nativeRoleEntries} from '../../dist/workflow/native-role-output.js';
import {nativeRoleIntentReceipt} from '../../dist/workflow/native-role-output.js';
const MiB=1024*1024, size=value=>Buffer.byteLength(JSON.stringify(value));
const intent={version:2,carrier:'assistant-json/v1',requestId:'budget-request',binding:{launchId:'budget-launch',role:'reviewer',stage:'fresh-review',inputDigest:'0'.repeat(64)},schema:{type:'object',properties:{}},maxNativeTurns:3};
const init={type:'system',subtype:'init',session_id:'original',uuid:'init'};
test('a present invalid evidence policy refuses before intent recording or live intake',()=>{
 for(const policy of ['',undefined,null,1,{},'unsupported-policy']){
  let writes=0;const request={...intent,binding:{...intent.binding,nativeEvidencePolicy:policy}},manager={getSessionId:()=> 'owned-pi',appendCustomEntry(){writes++;return 'unexpected';}};
  assert.throws(()=>nativeRoleIntentReceipt(request),/NATIVE_CAPTURE_POLICY_UNSUPPORTED/);
  assert.throws(()=>new NativeRoleCollector(manager,request),/NATIVE_CAPTURE_POLICY_UNSUPPORTED/);assert.equal(writes,0);
 }
});
const counter=(uuid='c')=>({type:'system',subtype:'thinking_tokens',estimated_tokens:1,estimated_tokens_delta:1,uuid,session_id:'original'});
function fixture(initialized=true){
 let count=0,last,fail=false;const hash=createHash('sha256');const manager={getSessionId:()=> 'owned-pi',appendCustomEntry(kind,data){if(fail)throw Error('CONTROLLED_SOURCE_WRITE_FAILURE');if(kind===nativeRoleEntries.sdk){count++;hash.update(JSON.stringify(data.message)+'\n');}last=data;return 'entry-'+count;}};
 const collector=new NativeRoleCollector(manager,intent);if(initialized)collector.observe(init);
 return {collector,get count(){return count},get last(){return last},fail(){fail=true},receipt(){return {type:'gitjig.native-query-settled/v1',ownerSessionId:'owned-pi',nativeSessionId:'original',queryId:'query',nativeCleanup:'confirmed',messages:count,messageDigest:hash.copy().digest('hex'),format:{request:structuredClone(intent),requestDigest:createHash('sha256').update(JSON.stringify(intent)).digest('hex'),schemaDigest:createHash('sha256').update(JSON.stringify(intent.schema)).digest('hex')}}}};
}
function normal(collector,bytes){
 const base={type:'system',subtype:'opaque-budget-fixture',data:''},overhead=size(base);
 while(bytes){const amount=Math.min(MiB,bytes);assert.ok(amount>=overhead);collector.observe({...base,data:'x'.repeat(amount-overhead)});bytes-=amount;}
}
function counters(collector,bytes){
 const min=size(counter()),max=size(counter('c'.repeat(200)));
 while(bytes>2*max){collector.observe(counter('c'.repeat(200)));bytes-=max;}
 for(let a=0;a<=200;a++)for(let b=0;b<=200;b++){
  const total=(a?min+a-1:0)+(b?min+b-1:0);
  if(total!==bytes)continue;
  if(a)collector.observe(counter('a'.repeat(a)));if(b)collector.observe(counter('b'.repeat(b)));return;
 }
 assert.fail('Exact counter quota fixture cannot be constructed');
}
function quotaFailure(action,expected){
 let failure;assert.throws(action,error=>{failure=error;const text=error.message.split('captureQuota=')[1];assert.ok(text,'Original refusal exposes measured quota facts');assert.deepEqual(JSON.parse(text.split(';')[0]),expected);return true;});return failure;
}
test('normal8MiB and strict counter4MiB quotas retain one crossing event then stop',()=>{
 const f=fixture();counters(f.collector,4*MiB);normal(f.collector,8*MiB-size(init));const accepted=f.count;
 const crossing=counter('crossing'),failure=quotaFailure(()=>f.collector.observe(crossing),{budget:'progress-counter',usedBytes:4*MiB,nextBytes:size(crossing),limitBytes:4*MiB,sdkMessagesBefore:accepted});assert.match(failure.message,/NATIVE_CAPTURE_LIMIT_RETAINED/);assert.equal(f.count,accepted+1);assert.deepEqual(f.last.message,crossing);
 assert.throws(()=>f.collector.observe({type:'system',subtype:'extra'}),/capture already stopped/);assert.equal(f.count,accepted+1);
 assert.throws(()=>f.collector.observe(counter()),/capture already stopped/);
});
test('per-event2MiB cap remains exact independently of total quota',()=>{
 const f=fixture(),packet={type:'system',data:''};packet.data='x'.repeat(2*MiB-size(packet));
 f.collector.observe(packet);assert.equal(size(f.last.message),2*MiB);
 const accepted=f.count,failure=quotaFailure(()=>f.collector.observe({...packet,data:packet.data+'x'}),{budget:'single-event',usedBytes:0,nextBytes:2*MiB+1,limitBytes:2*MiB,sdkMessagesBefore:accepted});
 assert.match(failure.message,/exceeds declared bounds/);assert.doesNotMatch(failure.message,/NATIVE_CAPTURE_LIMIT_RETAINED/);assert.equal(f.count,accepted);assert.deepEqual(f.last.message,packet,'Unsupported oversized event was not captured');
});
test('provider aggregate refusal reports measured costs without echoing original content',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));const accepted=f.count,crossing={type:'system',uuid:'PRIVATE_QUOTA_UUID',data:'PRIVATE_QUOTA_CONTENT'};
 const failure=quotaFailure(()=>f.collector.observe(crossing),{budget:'provider-evidence',usedBytes:8*MiB,nextBytes:size(crossing),limitBytes:8*MiB,sdkMessagesBefore:accepted});
 assert.doesNotMatch(failure.message,/PRIVATE_QUOTA_/);assert.equal(f.count,accepted+1);assert.deepEqual(f.last.message,crossing);
 const receipt=f.receipt();f.collector.observe(receipt);assert.deepEqual(f.last.attestation,receipt,'Original complete cleanup still binds all captured messages');
});
test('a crossing cleanup receipt reports prior SDK count without claiming another SDK packet',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));const accepted=f.count,receipt=f.receipt();
 quotaFailure(()=>f.collector.observe(receipt),{budget:'provider-evidence',usedBytes:8*MiB,nextBytes:size(receipt),limitBytes:8*MiB,sdkMessagesBefore:accepted});
 assert.equal(f.count,accepted);assert.deepEqual(f.last.attestation,receipt);
 assert.throws(()=>f.collector.observe(receipt),/capture already stopped/);assert.deepEqual(f.last.attestation,receipt,'Original crossing control cannot be replaced');
});
test('only initialized same-session scalar counters receive the separate allowance',()=>{
 const variants=[{session_id:'foreign'},{uuid:''},{estimated_tokens:-1},{estimated_tokens:1.5},{estimated_tokens_delta:'1'},{estimated_tokens_delta:Infinity},{user_message_uuid:''},{supersedes:['init']},{retracted_message_uuids:['init']},{parent_tool_use_id:null},{extra:'unknown'},{findings:[]}];
 for(const patch of variants){const f=fixture();normal(f.collector,8*MiB-size(init));f.collector.observe(counter());const crossing={...counter(),...patch};assert.throws(()=>f.collector.observe(crossing),/NATIVE_CAPTURE_LIMIT_RETAINED/,JSON.stringify(patch));assert.deepEqual(f.last.message,crossing);}
 const f=fixture();normal(f.collector,8*MiB-size(init));const message={...counter(),user_message_uuid:'original-user'};f.collector.observe(message);assert.deepEqual(f.last.message,message,'Complete original packet retained, including optional SDK scalar');
 const before=fixture(false);normal(before.collector,8*MiB);assert.throws(()=>before.collector.observe(counter()),/exceeds declared bounds/);
});

test('one original bounded cleanup receipt is retained before validation and cannot be replaced',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));assert.throws(()=>f.collector.observe(counter('x'.repeat(201))),/NATIVE_CAPTURE_LIMIT_RETAINED/);
 const receipt=f.receipt();
 for(const patch of [{nativeSessionId:'foreign'},{ownerSessionId:'foreign'},{queryId:''},{messages:receipt.messages+1},{messageDigest:'0'.repeat(64)},{format:{request:{}}},{nativeCleanup:'unknown'}]){
  const bad=fixture();normal(bad.collector,8*MiB-size(init));assert.throws(()=>bad.collector.observe(counter('x'.repeat(201))),/NATIVE_CAPTURE_LIMIT_RETAINED/);const control={...bad.receipt(),...patch};
  assert.throws(()=>bad.collector.observe(control),/original cleanup receipt is invalid/);assert.deepEqual(bad.last.attestation,control);
  assert.throws(()=>bad.collector.observe(bad.receipt()),/capture already stopped/);assert.deepEqual(bad.last.attestation,control,'A new valid receipt cannot replace the malformed original');
 }
 f.collector.observe(receipt);assert.deepEqual(f.last.attestation,receipt);
 assert.throws(()=>f.collector.observe(receipt),/capture already stopped/);
});
test('write failure at the reserved packet remains failure without a retained-limit claim',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));f.fail();
 assert.throws(()=>f.collector.observe({type:'system',subtype:'crossing'}),/CONTROLLED_SOURCE_WRITE_FAILURE/);
 assert.throws(()=>f.collector.observe(f.receipt()),/capture already stopped/);
});

test('unsupported oversized cleanup consumes its slot without a false source claim',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));assert.throws(()=>f.collector.observe(counter('x'.repeat(201))),/NATIVE_CAPTURE_LIMIT_RETAINED/);
 assert.throws(()=>f.collector.observe({...f.receipt(),padding:'x'.repeat(2*MiB)}),/cleanup receipt exceeds declared bounds/);
 assert.throws(()=>f.collector.observe(f.receipt()),/capture already stopped/);
});

test('unexpected control validation failure cannot erase the original present receipt',()=>{
 const f=fixture();normal(f.collector,8*MiB-size(init));assert.throws(()=>f.collector.observe(counter('x'.repeat(201))),/NATIVE_CAPTURE_LIMIT_RETAINED/);
 const receipt=f.receipt();f.collector.originalCleanupReceipt=()=>{throw Error('CONTROLLED_CONTROL_VALIDATION_FAILURE')};
 assert.throws(()=>f.collector.observe(receipt),/CONTROLLED_CONTROL_VALIDATION_FAILURE/);assert.deepEqual(f.last.attestation,receipt);
 assert.throws(()=>f.collector.observe(receipt),/capture already stopped/);
});
