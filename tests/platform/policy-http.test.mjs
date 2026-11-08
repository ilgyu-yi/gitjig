import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOwnedPolicyFixture } from '../../dist/platform/github-policy.js';
import {fixture,input,set,override,pr,H} from './policy-fixture.mjs';
const noMutation=f=>assert.ok(f.requests.every(r=>r.method==='GET'||(r.method==='POST'&&r.path==='/graphql')));

test('healthy finite no-extra-approval visible policy and forward/deletion invariants remain useful but visibility/activation unestablished',async()=>{
 for(const sets of [[],[set()]]){const f=await fixture({sets});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.ordinary.visiblePolicyFit,'matched');assert.equal(r.ordinary.state,'unknown');assert.equal(r.classic.visibility,'not-established');assert.equal(r.activation,'disabled');assert.match(r.fingerprint,/^[a-f0-9]{64}$/);assert.equal(r.requests,f.requests.length);noMutation(f);}finally{await f.close();}}
});

test('all-set explicit User/always override is separate from ordinary; identical rules across sets stay separate',async()=>{
 const f=await fixture({sets:[override(1),override(2)],paginate:true});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.override.visiblePolicyFit,'matched');assert.equal(r.ordinary.visiblePolicyFit,'blocked');assert.equal(r.applicableSetKeys.length,2);assert.equal(r.sets.length,2);assert.equal(r.override.state,'unknown');assert.ok(f.requests.some(x=>x.path.includes('page=2')));noMutation(f);}finally{await f.close();}
 for(const patch of [{bypass_actors:[{actor_type:'Team',actor_id:12,bypass_mode:'always'}]},{bypass_actors:undefined},{current_user_can_bypass:'never'},{bypass_actors:[{actor_type:'User',actor_id:7,bypass_mode:'pull_request'}]},{bypass_actors:[{actor_type:'User',actor_id:7,bypass_mode:'exempt'}]}]){const f=await fixture({sets:[override(1),{...override(2),...patch}]});try{const r=await f.reader().observeTargetPolicy(input());assert.notEqual(r.override.visiblePolicyFit,'matched',JSON.stringify(patch));assert.equal(r.activation,'disabled');noMutation(f);}finally{await f.close();}}
});

test('active push rules absent from branch endpoint and native PRcount0/status obligations are never omitted',async()=>{
 const f=await fixture({sets:[set(1,{target:'push',rules:[{type:'file_path_restriction',parameters:{restricted_file_paths:['private/**']}}]})]});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.applicableSetKeys.length,1);assert.notEqual(r.ordinary.visiblePolicyFit,'matched');assert.notEqual(r.override.visiblePolicyFit,'matched');noMutation(f);}finally{await f.close();}
 const prOnly=await fixture({sets:[set(1,{rules:[pr]})]});try{const r=await prOnly.reader().observeTargetPolicy(input());assert.equal(r.ordinary.visiblePolicyFit,'blocked');assert.ok(r.ordinary.conditions.some(x=>x.includes('platform approval')));noMutation(prOnly);}finally{await prOnly.close();}
});

test('later-page/duplicate/omitted/effective-semantic/inventory enum faults cannot yield complete policy prefix',async()=>{
 for(const options of [{sets:[set(1),set(2)],paginate:true,pageError:true},{sets:[set()],duplicateEffective:true},{sets:[set()],omitRule:true},{sets:[set()],effectiveExtra:true},{sets:[set(1,{enforcement:'enabled'})]}]){const f=await fixture(options);try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,false,JSON.stringify(options));assert.equal(r.fingerprint,null);assert.notEqual(r.ordinary.visiblePolicyFit,'matched');noMutation(f);}finally{await f.close();}}
});

test('withheld versus empty bypass and unimplemented native semantics remain explicit',async()=>{
 for(const patch of [{current_user_can_bypass:undefined},{current_user_can_bypass:'exempt'},{rules:[{type:'future_rule'}]},{rules:[{...pr,parameters:{...pr.parameters,future_requirement:true}}]}]){const f=await fixture({sets:[set(1,patch)]});try{const r=await f.reader().observeTargetPolicy(input());assert.notEqual(r.ordinary.visiblePolicyFit,'matched');assert.equal(r.activation,'disabled');noMutation(f);}finally{await f.close();}}
});

test('classic overlap blocks initial landing routes; classic errors/fork/missingfork cannot prove absence',async()=>{
 const f=await fixture({classicMatch:true});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.ordinary.visiblePolicyFit,'blocked');assert.equal(r.override.visiblePolicyFit,'blocked');assert.deepEqual(r.classic.matchedRuleIds,['CR1']);noMutation(f);}finally{await f.close();}
 for(const options of [{graphqlError:true},{repoPatch:{fork:true}},{repoPatch:{fork:undefined}}]){const f=await fixture(options);try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,false);assert.equal(r.ordinary.state,'unknown');noMutation(f);}finally{await f.close();}}
});

test('observed policy/grant/target identity drift invalidates snapshot without automatic refresh loop',async()=>{
 for(const options of [{sets:[set()],drift:true},{sets:[set()],scopeFlip:true},{wrongBase:true},{wrongUser:true}]){const f=await fixture(options);try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,false);assert.equal(r.fingerprint,null);assert.ok(f.requests.length<30);noMutation(f);}finally{await f.close();}}
});

test('one operation-global request/byte/item budget includes capability, details, classic and final refresh',async()=>{
 for(const limits of [{pages:1},{pages:8},{collectionBytes:1},{collectionItems:1}]){const f=await fixture({sets:[set()]});try{const r=await f.reader(limits).observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,false);assert.equal(r.fingerprint,null);if(limits.pages)assert.ok(f.requests.length<=limits.pages);if(limits.pages===1)assert.deepEqual(f.requests.map(x=>x.path),['/user']);assert.ok(r.conditions.some(x=>x.includes('global')));noMutation(f);}finally{await f.close();}}
});

test('literal slash head/ref identities survive native URL encoding without requiring a PR',async()=>{
 const f=await fixture();try{const i=input();i.referencedHead={branch:'feature/path',expectedCommit:H};const r=await f.reader().observeTargetPolicy(i);assert.equal(r.completeVisibleInputs,true,JSON.stringify(r));assert.equal(r.request.referencedHead.expectedCommit,H);assert.ok(f.requests.some(x=>x.path.includes('feature%2Fpath')));noMutation(f);}finally{await f.close();}
});

test('caller cancellation closes actual stalled native read before fixture teardown and returns incomplete UNKNOWN',async()=>{
 const f=await fixture({stallUser:true});try{const abort=new AbortController(),pending=f.reader().observeTargetPolicy(input(),abort.signal);await f.entered;abort.abort();const r=await pending;assert.equal(r.completeVisibleInputs,false);assert.equal(r.ordinary.state,'unknown');assert.equal(r.requests,1);let timer;try{await Promise.race([f.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('policy socket did not close')),500);})]);}finally{clearTimeout(timer);}noMutation(f);}finally{await f.close();}
});


test('native enum operands must be scalar strings; malformed push cannot disappear from applicability',async()=>{
 for(const patch of [{target:['push']},{source_type:['Repository']},{enforcement:['active']},{current_user_can_bypass:['never']}]){const f=await fixture({sets:[set(1,{target:'push',rules:[pr],...patch})]});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,false,JSON.stringify(patch));assert.equal(r.fingerprint,null);assert.equal(r.ordinary.visiblePolicyFit,'unknown');noMutation(f);}finally{await f.close();}}
 const f=await fixture({sets:[set(1,{target:'push',rules:[pr]})]});try{const r=await f.reader().observeTargetPolicy(input());assert.equal(r.completeVisibleInputs,true);assert.equal(r.applicableSetKeys.length,1);assert.equal(r.ordinary.visiblePolicyFit,'blocked');assert.equal(r.activation,'disabled');}finally{await f.close();}
});
