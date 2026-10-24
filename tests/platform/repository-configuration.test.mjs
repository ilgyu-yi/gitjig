import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeConfigurationFixture} from './repository-configuration-fixture.mjs';
import {parseProviderConfigurationProfile,validateProviderConfigurationTarget} from '../../dist/platform/repository-configuration-profile.js';
const mutating=f=>f.requests.filter(r=>r.method!=='GET');
async function preview(client,f){return client.previewConfiguration({operationId:'owner-operation',target:f.target,desired:f.profile});}
test('native provider previews and sealed sparse effects preserve unrelated fields and principal arrays without raw private bodies',async()=>{
 for(const provider of ['gitea','gitlab']){
  const f=await nativeConfigurationFixture(provider);try{const client=await f.client(),plan=await preview(client,f);assert.equal(plan.steps.length,2);assert.equal(mutating(f).length,0);assert.equal(JSON.stringify(plan).includes('fixture-private-native'),false);
   for(const step of plan.steps){const handle=await client.prepareConfigurationStep({plan,stepId:step.id,revisionId:'journal-'+step.id}),bytes=client.inspectPreparedConfigurationPayload(handle);assert.deepEqual(JSON.parse(Buffer.from(bytes.jsonUtf8)),step.payload);const result=await client.invokePreparedConfigurationStep(handle);assert.equal(result.outcome,'confirmed',JSON.stringify(result));assert.equal(result.handoff,'request-created');assert.ok(result.fieldObservations.every(f=>f.state==='matching'));assert.equal(JSON.stringify(result).includes('fixture-private-native'),false);await assert.rejects(client.invokePreparedConfigurationStep(handle),/unused/);}
   assert.equal(mutating(f).length,2);assert.equal(f.state.repository.description,'preserve-unrelated');assert.deepEqual(f.state.protection.unselected_list,['preserve-principal']);if(provider==='gitlab')assert.deepEqual(f.state.protection.push_access_levels,[{id:31,access_level:40}]);
   const noop=await preview(client,f);assert.equal(noop.steps.length,0);assert.equal(mutating(f).length,2);
  }finally{await f.close();}
 }
});
test('native actor, administration, inherited/missing ownership and selected-basis/resource drift refuse before a write',async()=>{
 for(const provider of ['gitea','gitlab'])for(const kind of ['actor','permission','selected','resource']){
  const f=await nativeConfigurationFixture(provider);try{const client=await f.client(),plan=await preview(client,f);if(kind==='actor')f.state.actorId=8;if(kind==='permission')f.state.repository.permissions=provider==='gitea'?{admin:false}:{project_access:{access_level:30},group_access:null};if(kind==='selected')f.state.protection[provider==='gitea'?'required_approvals':'allow_force_push']=provider==='gitea'?3:false;if(kind==='resource'){if(provider==='gitlab')f.state.protection.id=22;else f.state.protection.rule_name='different';}
   await assert.rejects(client.prepareConfigurationStep({plan,stepId:'patch-native-protection',revisionId:'journal'}));assert.equal(mutating(f).length,0);
  }finally{await f.close();}
 }
 for(const inherited of [true,undefined]){const f=await nativeConfigurationFixture('gitlab');try{f.state.protection.inherited=inherited;await assert.rejects(preview(await f.client(),f),/project-owned/);assert.equal(mutating(f).length,0);}finally{await f.close();}}
});
test('partial silent native write and lost response retain original unknown outcomes; read-only reconciliation never replays',async()=>{
 for(const mode of ['silent','lost','denied']){
  const f=await nativeConfigurationFixture('gitea',{intercept:({req,res,relative,body,state,send})=>{if(req.method!=='PATCH'||!relative.endsWith('/main'))return false;if(mode==='denied'){send({},403);return true;}state.protection.required_approvals=body.required_approvals;if(mode==='lost'){res.destroy();return true;}send(state.protection);return true;}});
  try{const client=await f.client(),plan=await preview(client,f),handle=await client.prepareConfigurationStep({plan,stepId:'patch-native-protection',revisionId:'journal'}),result=await client.invokePreparedConfigurationStep(handle);assert.equal(result.outcome,'unknown');assert.equal(result.handoff,'request-created');const writes=mutating(f).length;const observed=await client.reconcileConfigurationStep({plan,stepId:'patch-native-protection'});assert.equal(observed.outcome,'unknown');assert.equal(mutating(f).length,writes);if(mode!=='denied')assert.ok(observed.fieldObservations.some(o=>o.path==='protection.required_approvals'&&o.state==='matching'));}
  finally{await f.close();}
 }
});
test('native profile and target discriminants, exact sparse fields and original immutable payload are strict',async()=>{
 for(const p of [{provider:'gitlab',version:'v',repository:{merge_method:['merge']}},{provider:'gitlab',version:'v',repository:{squash_option:['always']}},{provider:'gitea',version:'v',repository:{allow_rebase:'false'}},{provider:'gitlab',version:'v',protection:{name:'main',fields:{allowed_to_push:[]}}},{provider:'gitlab',version:'v',repository:{merge_method:'custom'}},{provider:'gitea',version:'v',protection:{name:'main',fields:{required_approvals:null}}}])assert.throws(()=>parseProviderConfigurationProfile(p));
 assert.throws(()=>parseProviderConfigurationProfile('{"provider":"gitea","version":"v","repository":{"allow_rebase":true,"allow_rebase":false}}'),/duplicate/i);
 const f=await nativeConfigurationFixture('gitlab');try{assert.throws(()=>validateProviderConfigurationTarget({...f.target,repositoryNodeId:'fake'}));const client=await f.client(),plan=await preview(client,f);const forged=structuredClone(plan);forged.steps[0].payload={only_allow_merge_if_pipeline_succeeds:false};await assert.rejects(client.prepareConfigurationStep({plan:forged,stepId:forged.steps[0].id,revisionId:'journal'}),/payload|fields/);await assert.rejects(client.previewConfiguration({operationId:'op',target:{...f.target,apiBase:'https://other.example/api/v4'},desired:f.profile}),/differs/);assert.equal(mutating(f).length,0);}finally{await f.close();}
});
test('known selected repository drift in the final account read refuses preview and preparation before writes',async()=>{
 for(const provider of ['gitea','gitlab']){
  let enabled=false,reads=0;const key=provider==='gitea'?'allow_merge_commits':'only_allow_merge_if_pipeline_succeeds';
  const f=await nativeConfigurationFixture(provider,{intercept:({req,relative,state})=>{if(enabled&&req.method==='GET'&&relative===(provider==='gitea'?'/repos/owner/repo':'/projects/9')&&++reads===2)state.repository[key]=!state.repository[key];return false;}});
  try{const client=await f.client(),plan=await preview(client,f);enabled=true;await assert.rejects(client.prepareConfigurationStep({plan,stepId:plan.steps[0].id,revisionId:'journal'}),/changed during preflight/);reads=0;await assert.rejects(preview(client,f),/changed during preflight/);assert.equal(mutating(f).length,0);}finally{await f.close();}
 }
});
