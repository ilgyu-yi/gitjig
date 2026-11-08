import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {mergeFixture} from './merge-fixture.mjs';

// Native protocol standing only: no application work/procedure/grant is seeded
// or claimed here. Controller and installed integration remain separate gates.
test('ordinary merge uses actual HTTP/CI/Git and verifies native result, tree and parents', {timeout:30000}, async t=>{
 const f=await mergeFixture(t),session=f.session();t.after(()=>session.close());let guards=0,intents=0;
 const prepared=await session.prepare(f.subject,()=>{guards++;});assert.equal(f.puts(),0);
 await assert.rejects(session.send(structuredClone(prepared),()=>{},()=>{}),/Original unconsumed/);assert.equal(f.puts(),0);
 const accepted=await session.send(prepared,()=>{guards++;},()=>{intents++;});
 assert.equal(accepted.handoff,'request-created');assert.equal(accepted.responseStatus,200);assert.equal(accepted.result.kind,'merged');assert.equal(accepted.result.causality,'native-success-response');assert.equal(intents,1);assert.ok(guards>=4);
 const confirmed=await session.inspectMergedCandidate(f.subject,accepted.result.commit);assert.equal(confirmed.tree,f.subject.expectedTree);assert.deepEqual(confirmed.parents,[f.subject.expectedBase,f.subject.expectedHead]);assert.equal(await f.head(),confirmed.mergedCommit);
 assert.equal(f.puts(),1);assert.ok(f.ci.length>=2&&f.ci.every(run=>run.exitCode===0));
 const request=f.requests.find(request=>request.method==='PUT');assert.deepEqual(JSON.parse(request.bytes),{sha:f.subject.expectedHead,merge_method:'merge',commit_title:'gitjig: merge PR #12',commit_message:''});
 await assert.rejects(session.send(prepared,()=>{},()=>{}),/Original unconsumed/);assert.equal(f.puts(),1);f.pass();
});

test('cancellation in the durable intent callback is definitely before native handoff', {timeout:30000}, async t=>{
 const f=await mergeFixture(t),session=f.session(),abort=new AbortController();t.after(()=>session.close());
 const prepared=await session.prepare(f.subject,()=>{});
 const attempt=await session.send(prepared,()=>{},()=>abort.abort(),abort.signal);
 assert.equal(attempt.handoff,'not-started');assert.equal(attempt.result,null);assert.equal(f.puts(),0);assert.equal(await f.head(),f.subject.expectedBase);f.pass();
});

test('concurrent sends consume a genuine preparation only once before durable intent', {timeout:30000}, async t=>{
 const f=await mergeFixture(t),session=f.session();t.after(()=>session.close());let intents=0;
 const prepared=await session.prepare(f.subject,()=>{});
 const results=await Promise.allSettled([session.send(prepared,()=>{},()=>{intents++;}),session.send(prepared,()=>{},()=>{intents++;})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const refused=results.find(result=>result.status==='rejected');assert.match(refused.reason.message,/Original unconsumed/);
 assert.equal(intents,1);assert.equal(f.puts(),1);f.pass();
});

for(const fault of ['non-strict','empty-checks','exempt-actor','extra-approval','same-account-approval','failed-ci','missing-fence','fence-bypass','fence-extra-exclusion','fence-fetch-merge','stack'])test('native ordinary preparation refuses '+fault+' without merge intent', {timeout:30000}, async t=>{
 const f=await mergeFixture(t),session=f.session();t.after(()=>session.close());
 const rules=f.options.sets[0].rules,checks=rules.find(rule=>rule.type==='required_status_checks'),reviews=rules.find(rule=>rule.type==='pull_request');
 if(fault==='non-strict')checks.parameters.strict_required_status_checks_policy=false;
 if(fault==='empty-checks')checks.parameters.required_status_checks=[];
 if(fault==='exempt-actor')f.options.sets[0].current_user_can_bypass='exempt';
 if(fault==='extra-approval')reviews.parameters.require_extra_approval_for_unattributed_changes=true;
 if(fault==='same-account-approval')f.options.approver=7;
 if(fault==='failed-ci')f.options.badCI=true;
 if(fault==='missing-fence')f.options.sets.pop();
 if(fault==='fence-bypass')f.options.sets[1].current_user_can_bypass='always';
 if(fault==='fence-extra-exclusion')f.options.sets[1].conditions.ref_name.exclude.push('refs/heads/other');
 if(fault==='fence-fetch-merge')f.options.sets[1].rules[1].parameters.update_allows_fetch_and_merge=true;
 if(fault==='stack')f.options.stack={number:1,size:2,position:2};
 await assert.rejects(session.prepare(f.subject,()=>{}));assert.equal(f.puts(),0);assert.equal(await f.head(),f.subject.expectedBase);
 if(fault==='failed-ci')assert.ok(f.ci.some(run=>run.exitCode!==0));f.pass();
});

for(const drift of ['actor','policy','source'])test('native merge rechecks '+drift+' before durable intent and PUT', {timeout:30000}, async t=>{
 let changed=false;
 const f=await mergeFixture(t,{intercept:({req,send,options})=>{if(changed&&req.url==='/repos/owner/repo/pulls/12'){send({id:120,node_id:'PR120',number:12,state:'open',merged:false,draft:false,mergeable:true,mergeable_state:'clean',title:'Changed intent',body:'Different source',user:{id:7},base:{ref:'main',sha:options.base,repo:{id:9,node_id:'R9',full_name:'owner/repo'}},head:{ref:'feature/path',sha:options.head,repo:{id:9,node_id:'R9',full_name:'owner/repo'}}});return true;}return false;}}),session=f.session();t.after(()=>session.close());
 const prepared=await session.prepare(f.subject,()=>{});let intents=0;
 if(drift==='actor')f.options.wrongUser=true;
 if(drift==='policy')f.options.sets[0].current_user_can_bypass='exempt';
 if(drift==='source')changed=true;
 await assert.rejects(session.send(prepared,()=>{},()=>{intents++;}));assert.equal(intents,0);assert.equal(f.puts(),0);assert.equal(await f.head(),f.subject.expectedBase);f.pass();
});

test('native strict enforcement refuses a real base advance after the final observation', {timeout:30000}, async t=>{
 const f=await mergeFixture(t,{beforeAccept:async({options,native,bare,checkout})=>{
  await native('-C',checkout,'checkout','main');await fs.writeFile(path.join(checkout,'concurrent.txt'),'A real concurrent base change\n');await native('-C',checkout,'add','concurrent.txt');await native('-C',checkout,'-c','commit.gpgsign=false','commit','-m','Concurrent native base');
  options.base=await native('-C',checkout,'rev-parse','HEAD');await native('-C',checkout,'push',bare,'HEAD:refs/heads/main');
 }}),session=f.session();t.after(()=>session.close());
 const prepared=await session.prepare(f.subject,()=>{}),attempt=await session.send(prepared,()=>{},()=>{});assert.equal(attempt.result.kind,'rejected');assert.equal(attempt.responseStatus,405);assert.equal(f.puts(),1);assert.equal(await f.head(),f.options.base);assert.notEqual(f.options.base,f.subject.expectedBase);assert.equal(f.options.merged,undefined);f.pass();
});

test('lost acceptance retains possible handoff and actual native outcome without resubmitting', {timeout:30000}, async t=>{
 const f=await mergeFixture(t,{dropAcceptance:true}),session=f.session();t.after(()=>session.close());
 const prepared=await session.prepare(f.subject,()=>{}),attempt=await session.send(prepared,()=>{},()=>{});
 assert.equal(attempt.handoff,'request-created');assert.equal(attempt.result,null);assert.match(attempt.unavailable,/without replay/);assert.equal(f.puts(),1);
 const present=await session.inspectMergedCandidate(f.subject,await f.head());assert.equal(present.kind,'merged-candidate-correspondence');assert.equal(present.sendCausality,'not-established-by-resource-observation');
 await assert.rejects(session.send(prepared,()=>{},()=>{}),/Original unconsumed/);assert.equal(f.puts(),1);f.pass();
});

// No controller eligibility is claimed: this regression must hold the actual
// unauthorized native destination, rather than merely reject a late receipt.
for(const destination of ['existing','new'])test('late PR retarget cannot update '+destination+' branch outside the original destination', {timeout:30000}, async t=>{
 const f=await mergeFixture(t,{beforeAccept:async({options,native,bare})=>{
  if(destination==='new')await native('--git-dir='+bare,'update-ref','refs/heads/other',options.base);options.baseRef='other';
 }}),session=f.session();t.after(()=>session.close());
 if(destination==='existing')await f.native('--git-dir='+f.bare,'update-ref','refs/heads/other',f.subject.expectedBase);
 const prepared=await session.prepare(f.subject,()=>{}),result=await session.send(prepared,()=>{},()=>{});assert.equal(result.result.kind,'rejected');assert.equal(result.responseStatus,405);
 assert.equal(await f.native('--git-dir='+f.bare,'rev-parse','refs/heads/other'),f.subject.expectedBase,'No unauthorized native ref update');
 assert.equal(await f.head(),f.subject.expectedBase);f.pass();
});

test('late stack membership is rejected by the synchronous native endpoint', {timeout:30000}, async t=>{
 const f=await mergeFixture(t,{beforeAccept:({options})=>{options.stack={number:1,size:2,position:2};}}),session=f.session();t.after(()=>session.close());
 const prepared=await session.prepare(f.subject,()=>{}),result=await session.send(prepared,()=>{},()=>{});assert.equal(result.result.kind,'rejected');assert.equal(f.puts(),1);assert.equal(await f.head(),f.subject.expectedBase);f.pass();
});
