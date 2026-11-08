import {caseDescriptor,compareCases,bindCheckExpectations} from '../../dist/controller/check-cases.js';
import {parseCheckOutput} from '../../dist/workflow/protocol.js';
import {softwareEvidenceIdentity} from '../../dist/controller/effect-types.js';
/** Original public stage/readonly consumer gates with explicitly controlled retained-plan/history premises.
 * These are admission/refusal tests, not qualification of a baseline engine execution or independent judgment.
 */
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {hash} from '../../dist/controller/change-files.js';
import {mixedPlan,initialVerificationProfile} from '../workflow/mixed-verification-fixture.mjs';
const model={provider:'owned-no-dispatch',modelId:'owned-no-dispatch'};
async function world(t,plan=mixedPlan(),profile=initialVerificationProfile,extraFiles={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-mixed-gates-'))),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=1;\n');await fs.writeFile(path.join(source,'owner.txt'),'owner expectations');
 await fs.writeFile(path.join(source,'checker.cjs'),'// Existing candidate check entry for planning-only fixture.\n');
 for(const [name,bytes] of Object.entries(extraFiles)){
  const file=path.join(source,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
 }
 const c=await openController({installationHome:path.join(root,'home')});await c.registerProject({id:'P',sourceRoot:source});const work=await c.beginChange({projectId:'P',request:'Observe original base before editing; preserve owner file and repair behavior'}),s=c.store,id=work.workId,r=s.one('SELECT * FROM change_state WHERE work=?',id),data=JSON.parse(r.data);
 const put=(kind,payload)=>{const v=randomUUID();s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',v,id,kind,null,null,hash(kind==='plan'?payload.plan:kind==='verification'?payload.verification:payload),JSON.stringify(payload));return v};
 const judge=randomUUID(),judgeRun=randomUUID(),marker={version:1,kind:'finite-mixed',strategyDigest:hash(plan.verification.strategies),decisionLaunch:judge},protocol={version:1,summary:'Controlled retained independent planning premise; no native judgment qualified',findings:[],assessedScope:[],decisions:[],planAccepted:true,acceptedPlan:plan};
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',judgeRun,id,1,1,'SETTLED',source,'consumed',JSON.stringify({kind:'governed-role',role:'adjudicator',launchId:judge,cleanup:'removed'}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',judge,id,judgeRun,'adjudicator',1,'COMPLETE','consumed',JSON.stringify({stage:'planning-adjudication',cleanup:'removed',planningVerificationProfile:profile,inputVersions:{base:r.base,contracts:data.contractsVersion}}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),judge,JSON.stringify(protocol),'usable',JSON.stringify({protocol}));
 const p=put('plan',{plan,verificationProfile:marker,decisionLaunch:judge}),v=put('verification',{verification:plan.verification,verificationProfile:marker}),requirements=put('requirements',{requirements:plan.requirements});s.run('UPDATE change_state SET plan=?,verification=?,phase=?,data=? WHERE work=?',p,v,'PLAN_READY',JSON.stringify({...data,requirementVersion:requirements,verificationProfileMode:{version:1,kind:'finite-mixed',...(plan.verification.strategies.some(strategy=>strategy.kind==='base-execution-duty')?{baselinePlanId:p}:{})},selection:{},authorLaunches:[]}),id);
 let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root)});return{c,s,id,plan,source,base:r.base,pass(){passed=true}};
}
const ledger=f=>({budgets:f.s.all('SELECT * FROM budgets ORDER BY rowid'),runs:f.s.all('SELECT * FROM runs ORDER BY rowid'),launches:f.s.all('SELECT * FROM role_launches ORDER BY rowid')});
test('public implementation requests original base observation before any editing producer or candidate dispatch',async t=>{
 const f=await world(t);let observations=[],authors=0;const before=ledger(f);f.c.changeCore.executeCheck=async(work,check,options,target,purpose)=>{observations.push({work,id:check.id,target,purpose});return{status:'unavailable',data:{},id:'controlled-no-native-receipt'}};f.c.changeCore.role=async()=>{authors++;throw Error('Editing must not be entered')};
 const view=await f.c.implementChange({workId:f.id,model});assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(),/original baseline observation unavailable/);assert.deepEqual(observations,[{work:f.id,id:'base-check',target:f.base,purpose:'baseline'}]);assert.equal(authors,0);assert.deepEqual(ledger(f),before);assert.equal(view.candidateVersion,null);assert.equal(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),'module.exports=1;\n');f.pass();
});
test('direct editing-role admission cannot bypass a missing original baseline witness',async t=>{
 const f=await world(t),before=ledger(f);await assert.rejects(f.c.changeCore.role({workId:f.id,model},'repairer',{},true),/Editing refused before/);assert.deepEqual(ledger(f),before);f.pass();
});
test('an existing unqualified editing history is held rather than backfilled by a later baseline execution',async t=>{
 const f=await world(t),run=f.s.one('SELECT id FROM runs WHERE work=?',f.id).id;f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','controlled-historical-author',f.id,run,'implementer',1,'UNUSABLE','none',JSON.stringify({stage:'implementation',unqualifiedControlledHistory:true}));let observations=0;f.c.changeCore.executeCheck=async()=>{observations++;throw Error('No retrospective observation')};const before=ledger(f),view=await f.c.implementChange({workId:f.id,model});assert.equal(observations,0);assert.match(view.blocked.join(),/historical editing cannot be retroactively/);assert.deepEqual(ledger(f),before);f.pass();
});
test('present malformed strategy profiles cannot take the legacy implementation path',async t=>{
 const f=await world(t);const row=f.s.one('SELECT plan FROM change_state WHERE work=?',f.id),version=f.s.one('SELECT data FROM change_versions WHERE id=?',row.plan);const original=JSON.parse(version.data);for(const strategies of [null,[],{waived:true}]){const value=structuredClone(original);value.plan.verification.strategies=strategies;f.s.run('UPDATE change_versions SET data=? WHERE id=?',JSON.stringify(value),row.plan);let attempted=0;f.c.changeCore.executeCheck=async()=>{attempted++;throw Error('Unexpected baseline')};const before=ledger(f);const view=await f.c.implementChange({workId:f.id,model});assert.equal(view.reviewReady,false);assert.match(view.blocked.join(),/strategies.*every requirement|strategies.*malformed|Typed verification profile/i);assert.equal(attempted,0);assert.deepEqual(ledger(f),before);}f.pass();
});
test('mixed current evidence never succeeds from REVIEW_READY and a generic clear selection without original witnesses',async t=>{
 const f=await world(t);f.s.run("UPDATE change_state SET phase='REVIEW_READY' WHERE work=?",f.id);f.s.run("UPDATE works SET state='DELIVERED' WHERE id=?",f.id);const before=ledger(f);const view=f.c.inspectChange(f.id);assert.equal(view.reviewReady,false);assert.equal(view.phase,'BLOCKED');assert.match(view.blocked.join(),/verification strategy evidence unavailable/);assert.throws(()=>f.c.changeCore.inspectVerificationEvidence(f.id),/witness unavailable/);await assert.rejects(f.c.changeCore.currentEvidence(f.id),/incomplete|unavailable/);assert.deepEqual(ledger(f),before);f.pass();
});

test('original publication software correspondence refuses typed witness drift with identical versions/check/review IDs',async t=>{
 const f=await world(t);const original={workId:f.id,epoch:1,generation:1,versions:{base:f.base,candidate:'same-candidate',plan:'same-plan',verification:'same-verification',requirements:'same-requirements',contracts:'same-contracts'},candidateDigest:'same-digest',sourceChainDigest:'same-source',selectionDigest:'same-selection',checkIds:['same-check'],reviewLaunchIds:['same-review'],carryDigest:null,dispositionDigest:'unrelated-payload-disposition',fingerprint:'controlled-same-fingerprint'};
 const legacy={workId:original.workId,epoch:original.epoch,generation:original.generation,versions:original.versions,candidateDigest:original.candidateDigest,sourceChainDigest:original.sourceChainDigest,selectionDigest:original.selectionDigest,checkIds:original.checkIds,reviewLaunchIds:original.reviewLaunchIds,carryDigest:null};assert.deepEqual(softwareEvidenceIdentity(original),legacy);
 const baseline={...original,verificationStrategyDigest:'a'.repeat(64)};let current={...baseline};f.c.changeCore.evidenceAt=()=>current;
 f.s.run('INSERT INTO effect_targets VALUES(?,?,?)','controlled-target','P',JSON.stringify({kind:'controlled-no-native'}));f.s.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','controlled-grant',f.id,'controlled-target',1,'{}');f.s.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)','controlled-publication',f.id,'controlled-target','controlled-grant','REFUSED',JSON.stringify({kind:'publication',action:{kind:'create-comment',purpose:'reviewed-summary'},procedureBaseline:baseline}));
 const before=ledger(f);assert.deepEqual(await f.c.changeCore.tentativePublicationEvidence('controlled-publication'),current);current={...baseline,verificationStrategyDigest:'b'.repeat(64)};await assert.rejects(f.c.changeCore.tentativePublicationEvidence('controlled-publication'),/Software\/source tuple changed/);assert.throws(()=>f.c.changeCore.assertCurrentEvidence(baseline),/changed/);
 for(const invalid of [null,'',undefined])assert.throws(()=>softwareEvidenceIdentity({...original,verificationStrategyDigest:invalid}),/invalid/);
 current=original;assert.doesNotThrow(()=>f.c.changeCore.assertCurrentEvidence(original));assert.deepEqual(ledger(f),before);assert.equal(f.s.one('SELECT phase FROM effect_operations WHERE id=?','controlled-publication').phase,'REFUSED');f.pass();
});

// Controlled settled host-record premises exercise selection and presentation only.
// Actual engine/semantic qualification is deliberately not claimed by this fixture.
function controlledBaselineRecord(f) {
 const core=f.c.changeCore,change=f.s.one('SELECT * FROM change_state WHERE work=?',f.id),state=JSON.parse(change.data),base=core.version(f.base),check=f.plan.verification.checks.find(x=>x.id==='base-check'),run=randomUUID(),receipt=randomUUID(),owner=f.s.one('SELECT * FROM works WHERE id=?',f.id);
 const boundVersions={base:f.base,candidate:f.base,plan:change.plan,verification:change.verification,requirements:state.requirementVersion,contracts:state.contractsVersion},premises=core.verificationPremises(f.id,false),target={kind:'base',versionId:f.base,digest:base.hash,candidateAtDispatch:null},runtimeProfile={dockerBinary:'/owned-fixture/no-engine',dockerContext:'owned-fixture',image:'sha256:'+'a'.repeat(64),uid:1,gid:1};
 const dispatchAuthority={workId:f.id,sourceId:owner.source,runId:run,epoch:owner.epoch,generation:owner.generation};
 const descriptor=caseDescriptor(check,base,boundVersions,run),stdout=JSON.stringify({version:1,assertions:check.assertions.map(id=>({id,passed:true})),cases:descriptor.cases.map(c=>({id:c.id,inputDigest:c.inputDigest,observed:c.declaration.expected}))}),parsed=parseCheckOutput(stdout),actual={exitCode:0,stdout,stderr:'',termination:null};
 f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,f.id,owner.epoch,owner.generation,'SETTLED',base.artifact,'consumed',JSON.stringify({kind:'governed-check',cleanup:'removed',runtimeProfile,dispatchAuthority,purpose:'baseline',checkBinding:hash(check),checkTarget:target,verificationPremises:premises,boundVersions}));
 const data={dispatchAuthority,purpose:'baseline',target,verificationPremises:premises,boundVersions,cleanup:'removed',actual,parsed,caseDescriptor:descriptor,caseResults:compareCases(check,descriptor,parsed.value),argv:['/bin/bash','-lc',check.command],cwd:'/work',check,inputHash:hash({candidate:base.hash,verification:change.verification,check,runtime:runtimeProfile})};
 f.s.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)',receipt,f.id,run,f.base,change.verification,check.id,'baseline-observed',JSON.stringify(data));return{run,receipt,check,data};
}
test('observed original baseline stays distinct from candidate pass and visible before any candidate/review exists',async t=>{
 const f=await world(t),record=controlledBaselineRecord(f);assert.equal(f.c.changeCore.baselineReceipt(f.id,record.check).id,record.receipt);const view=f.c.inspectChangeResult(f.id),baseline=view.checks.entries.find(x=>x.checkId==='base-check');assert.equal(baseline.target,'base');assert.equal(baseline.purpose,'baseline');assert.equal(baseline.status,'baseline-observed');assert.equal(baseline.observed,true);assert.equal(baseline.passed,false);assert.equal(view.checks.entries.find(x=>x.checkId==='behavior-check').status,'missing');assert.equal(view.reviewReady,false);assert.equal(view.verificationEvidence.availability,'unavailable');assert.equal(view.verificationEvidence.requirements.find(x=>x.requirementId==='baseline').witnessAvailability,'recorded');f.pass();
});
test('baseline selection refuses raw stdout, argv, target, cleanup, premise and retrospective-edit correspondence drift',async t=>{
 const f=await world(t),record=controlledBaselineRecord(f),original=JSON.stringify(record.data);for(const mutate of [d=>d.actual.stdout='not-json',d=>d.actual.exitCode=2,d=>d.argv=['different-consumer'],d=>d.target.kind='candidate',d=>d.target.candidateAtDispatch='foreign-candidate',d=>d.cleanup='unknown',d=>d.verificationPremises.plan='stale',d=>d.dispatchAuthority.epoch=100,d=>d.boundVersions.base='foreign-base']){const data=JSON.parse(original);mutate(data);f.s.run('UPDATE check_runs SET data=? WHERE id=?',JSON.stringify(data),record.receipt);assert.equal(f.c.changeCore.baselineReceipt(f.id,record.check),undefined);}f.s.run('UPDATE check_runs SET data=? WHERE id=?',original,record.receipt);
 const earlier=f.s.one('SELECT id FROM runs WHERE work=? ORDER BY rowid LIMIT 1',f.id).id;f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','controlled-prior-editor',f.id,earlier,'repairer',1,'UNUSABLE','none','{}');assert.equal(f.c.changeCore.baselineReceipt(f.id,record.check),undefined);f.pass();
});

test('dropping typed fields cannot turn a new all-consumer profile into genuine legacy coverage',async t=>{
 const plan=mixedPlan();plan.requirements=plan.requirements.slice(0,1);plan.verification.checks=plan.verification.checks.slice(0,1);plan.verification.strategies=plan.verification.strategies.slice(0,1);const f=await world(t,plan),row=f.s.one('SELECT * FROM change_state WHERE work=?',f.id),stored=f.s.one('SELECT data FROM change_versions WHERE id=?',row.plan),value=JSON.parse(stored.data);
 delete value.plan.verification.strategies;delete value.verificationProfile;f.s.run('UPDATE change_versions SET data=?,hash=? WHERE id=?',JSON.stringify(value),hash(value.plan),row.plan);
 const verification=f.s.one('SELECT data FROM change_versions WHERE id=?',row.verification),v=JSON.parse(verification.data);delete v.verification.strategies;delete v.verificationProfile;f.s.run('UPDATE change_versions SET data=?,hash=? WHERE id=?',JSON.stringify(v),hash(v.verification),row.verification);
 assert.throws(()=>f.c.changeCore.strategies(f.id),/Typed verification profile/);const view=f.c.inspectChange(f.id);assert.equal(view.reviewReady,false);assert.match(view.blocked.join(),/Typed verification profile/);f.pass();
});

function retainedEditingHistory(f){const run=f.s.one('SELECT id FROM runs WHERE work=? ORDER BY rowid LIMIT 1',f.id).id;f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',randomUUID(),f.id,run,'implementer',1,'UNUSABLE','none',JSON.stringify({controlledRetainedEditingHistory:true}));}
test('persistent typed mode preserves consumer and scope replanning after editing without creating a baseline event',async t=>{
 const plan=mixedPlan();plan.requirements=plan.requirements.filter(r=>r.id!=='baseline');plan.verification.strategies=plan.verification.strategies.filter(r=>r.kind!=='base-execution-duty');plan.verification.checks=plan.verification.checks.filter(r=>r.id!=='base-check');const f=await world(t,plan);retainedEditingHistory(f);const core=f.c.changeCore,capability=core.verificationSupport(f.id).capability;
 assert.equal(capability.supported,true);assert.deepEqual(capability.allowedKinds,['consumer-cases','manifest-scope-duty','all-of']);assert.equal(capability.baseline.newObservation,false);assert.equal(capability.baseline.priorDuty,false);assert.doesNotThrow(()=>core.planningValid(plan,f.id,capability));
 const legacy=structuredClone(plan);delete legacy.verification.strategies;assert.throws(()=>core.planningValid(legacy,f.id,capability),/cannot downgrade/);assert.throws(()=>core.planningValid(mixedPlan(),f.id,capability),/kind unavailable/);
 f.s.run('UPDATE change_state SET plan=NULL,verification=NULL WHERE work=?',f.id);assert.throws(()=>core.strategies(f.id),/Current accepted typed verification plan unavailable/);assert.equal(core.verificationSupport(f.id).capability.supported,true);f.pass();
});
test('persistent baseline duty cannot be removed or re-created after author history during a fresh replan',async t=>{
 const f=await world(t);retainedEditingHistory(f);const capability=f.c.changeCore.verificationSupport(f.id).capability;assert.equal(capability.baseline.priorDuty,true);const plan=mixedPlan();plan.requirements=plan.requirements.filter(r=>r.id!=='baseline');plan.verification.strategies=plan.verification.strategies.filter(r=>r.kind!=='base-execution-duty');plan.verification.checks=plan.verification.checks.filter(r=>r.id!=='base-check');assert.throws(()=>f.c.changeCore.planningValid(plan,f.id,capability),/mapping across a new plan is unsupported/);
 let calls=0;f.c.changeCore.role=async()=>{calls++;throw Error('No new planning model for unsupported historical mapping')};const before=ledger(f),view=await f.c.planChange({workId:f.id,model});assert.equal(calls,0);assert.match(view.blocked.join(),/no supported cross-plan mapping/);assert.deepEqual(ledger(f),before);f.pass();
});
test('unknown persistent verification mode fails closed instead of falling back to historical legacy grammar',async t=>{
 const f=await world(t),row=f.s.one('SELECT data FROM change_state WHERE work=?',f.id),original=JSON.parse(row.data);for(const mode of [null,{version:2,kind:'finite-mixed'},{version:1,kind:'legacy'},{version:1,kind:'finite-mixed',extra:true}]){f.s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...original,verificationProfileMode:mode}),f.id);assert.throws(()=>f.c.changeCore.verificationSupport(f.id),/profile mode unavailable or unsupported/);}f.pass();
});

test('public cancel and exact retained drive recovery preserve an original before-first-edit receipt without relabelling dispatch authority',async t=>{
 const f=await world(t),core=f.c.changeCore,record=controlledBaselineRecord(f),before=f.s.one('SELECT * FROM runs WHERE id=?',record.run),premises=core.verificationPremises(f.id,false);await f.c.cancelWork({workId:f.id});assert.equal(f.c.inspectWork(f.id).state,'CANCELLED');let authors=0;core.role=async()=>{authors++;throw Error('Controlled stop after original baseline admission')};await f.c.driveChange({workId:f.id,model,maximumSteps:1});assert.equal(authors,1);assert.equal(core.baselineReceipt(f.id,record.check).id,record.receipt);assert.deepEqual(core.verificationPremises(f.id,false),premises);assert.deepEqual(f.s.one('SELECT * FROM runs WHERE id=?',record.run),before);assert.equal(f.s.one('SELECT epoch FROM works WHERE id=?',f.id).epoch,3);
 const state=f.s.one('SELECT data FROM change_state WHERE work=?',f.id),data=JSON.parse(state.data);f.s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...data,contractsVersion:'changed-semantic-contracts'}),f.id);assert.equal(core.baselineReceipt(f.id,record.check),undefined);f.pass();
});

function controlledMaterialBaselineFailure(f){
 const record=controlledBaselineRecord(f),data=structuredClone(record.data),output=structuredClone(data.parsed.value);output.cases[0].observed={kind:'return',value:'unexpected-subject-value'};output.assertions[0].passed=false;data.actual.stdout=JSON.stringify(output);data.parsed=parseCheckOutput(data.actual.stdout);data.caseResults=compareCases(record.check,data.caseDescriptor,data.parsed.value);f.s.run("UPDATE check_runs SET status='fail',data=? WHERE id=?",JSON.stringify(data),record.receipt);return{...record,data};
}
test('a material original baseline failure cannot disappear through changed expectations, renamed checks or dropped owner requirements',async t=>{
 const f=await world(t),failure=controlledMaterialBaselineFailure(f),core=f.c.changeCore,capability=core.verificationSupport(f.id).capability;assert.equal(core.materialBaselineFailures(f.id).length,1);assert.doesNotThrow(()=>core.planningValid(f.plan,f.id,capability));
 for(const mutate of [p=>p.verification.checks.find(c=>c.id==='base-check').cases[0].expected.value='unexpected-subject-value',p=>{p.verification.checks.find(c=>c.id==='base-check').id='renamed-check';p.verification.strategies.find(s=>s.kind==='base-execution-duty').checkId='renamed-check'},p=>p.requirements.find(r=>r.id==='baseline').text='A different easier duty',p=>{p.requirements=p.requirements.filter(r=>r.id!=='baseline');p.verification.strategies=p.verification.strategies.filter(s=>s.kind!=='base-execution-duty');p.verification.checks=p.verification.checks.filter(c=>c.id!=='base-check')}]){const plan=structuredClone(f.plan);mutate(plan);assert.throws(()=>core.planningValid(plan,f.id,capability),/Material failed baseline premise amendment is unsupported/);}
 assert.equal(f.s.one('SELECT status FROM check_runs WHERE id=?',failure.receipt).status,'fail');f.pass();
});
test('unavailable baseline producer output can be corrected by independent pre-author planning without inventing a material subject failure',async t=>{
 const f=await world(t),record=controlledBaselineRecord(f),data=structuredClone(record.data);data.actual.stdout='malformed producer output';data.parsed=parseCheckOutput(data.actual.stdout);data.caseResults=compareCases(record.check,data.caseDescriptor,null);f.s.run("UPDATE check_runs SET status='unavailable',data=? WHERE id=?",JSON.stringify(data),record.receipt);const corrected=structuredClone(f.plan);corrected.verification.checks.find(c=>c.id==='base-check').command='node corrected-baseline-checker.cjs';const before=ledger(f);assert.deepEqual(f.c.changeCore.materialBaselineFailures(f.id),[]);assert.doesNotThrow(()=>f.c.changeCore.planningValid(corrected,f.id,f.c.changeCore.verificationSupport(f.id).capability));assert.deepEqual(ledger(f),before);assert.equal(f.s.one('SELECT status FROM check_runs WHERE id=?',record.receipt).status,'unavailable');f.pass();
});

test('losing the owned mode while clearing selected pointers cannot erase accepted typed-plan history',async t=>{
 const f=await world(t),row=f.s.one('SELECT data FROM change_state WHERE work=?',f.id),data=JSON.parse(row.data);delete data.verificationProfileMode;f.s.run('UPDATE change_state SET plan=NULL,verification=NULL,data=? WHERE work=?',JSON.stringify(data),f.id);const before=ledger(f);assert.throws(()=>f.c.changeCore.verificationMode(f.id),/retained accepted typed plans cannot become legacy/);assert.throws(()=>f.c.changeCore.verificationSupport(f.id),/cannot become legacy/);assert.throws(()=>f.c.changeCore.strategies(f.id),/cannot become legacy/);assert.deepEqual(ledger(f),before);f.pass();
});
test('a rejected typed role proposal and genuine legacy accepted-plan history do not create an owned typed mode',async t=>{
 const f=await world(t),legacy=await f.c.beginChange({projectId:'P',request:'Genuine retained legacy and rejected proposal control'}),id=legacy.workId,run=randomUUID(),launch=randomUUID(),protocol={version:1,summary:'Controlled rejected proposal, not an adopted typed plan',findings:[],assessedScope:[],decisions:[],planAccepted:false,acceptedPlan:mixedPlan()};f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,id,1,1,'SETTLED',f.source,'consumed',JSON.stringify({kind:'governed-role',role:'adjudicator',launchId:launch,cleanup:'removed'}));f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,id,run,'adjudicator',1,'COMPLETE','consumed',JSON.stringify({stage:'planning-adjudication',planningVerificationProfile:initialVerificationProfile,cleanup:'removed'}));f.s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',randomUUID(),launch,JSON.stringify(protocol),'usable',JSON.stringify({protocol}));assert.equal(f.c.changeCore.verificationMode(id),undefined);
 const plan=mixedPlan();delete plan.verification.strategies;const version=randomUUID();f.s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',version,id,'plan',null,null,hash(plan),JSON.stringify({plan,decisionLaunch:launch,controlledHistoricalLegacy:true}));assert.equal(f.c.changeCore.verificationMode(id),undefined);f.pass();
});

test('selected-review caller refuses malformed original producer or changed selected inputs before native history preparation',async t=>{
 const f=await world(t),core=f.c.changeCore,state=f.s.one('SELECT * FROM change_state WHERE work=?',f.id),data=JSON.parse(state.data),candidate=randomUUID(),launch=randomUUID(),run=randomUUID(),base=core.version(f.base),position=f.plan.verification.reviewRoles[0];f.s.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',candidate,f.id,'candidate',null,null,base.hash,JSON.stringify({manifest:base.data.manifest,controlledCandidate:true}));f.s.run('UPDATE change_state SET candidate=?,data=? WHERE work=?',candidate,JSON.stringify({...data,selection:{[position.key]:launch}}),f.id);
 const versions={contracts:data.contractsVersion,requirements:data.requirementVersion,base:f.base,candidate,plan:state.plan,verification:state.verification},metadata={stage:'fresh-review',reviewKey:position.key,purpose:position.purpose,requiredPaths:position.requiredPaths,inputVersions:versions,cleanup:'removed'},execution={kind:'governed-role',role:'reviewer',launchId:launch,cleanup:'removed'};f.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,f.id,1,1,'SETTLED',f.source,'consumed',JSON.stringify(execution));f.s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,f.id,run,'reviewer',1,'COMPLETE','consumed',JSON.stringify(metadata));
 const foreign=await f.c.beginChange({projectId:'P',request:'Owned foreign-work negative control'});let preparations=0;core.bundle=async()=>{preparations++;throw Error('Unexpected native preparation')};core.nativeEntries=async()=>{preparations++;throw Error('Unexpected native history read')};
 for(const mutate of [x=>x.execution.kind='ordinary-conversation',x=>x.execution.role='implementer',x=>x.execution.launchId='foreign-launch',x=>x.runWork=foreign.workId,x=>x.launchWork=foreign.workId,x=>x.epoch=100,x=>x.generation=100,x=>x.metadata.inputVersions.candidate='different-candidate']){const x={execution:structuredClone(execution),metadata:structuredClone(metadata),runWork:f.id,launchWork:f.id,epoch:1,generation:1};mutate(x);f.s.run('UPDATE runs SET work=?,epoch=?,generation=?,data=? WHERE id=?',x.runWork,x.epoch,x.generation,JSON.stringify(x.execution),run);f.s.run('UPDATE role_launches SET work=?,data=? WHERE id=?',x.launchWork,JSON.stringify(x.metadata),launch);await assert.rejects(core.selectedReviewEvidence(f.id,{reviews:{[position.key]:launch}}),/SELECTED_REVIEW_EVIDENCE_UNAVAILABLE/);assert.equal(preparations,0);}
 f.pass();
});

test('each public result read rechecks changed planning producer and owned mode without changing retained ledgers',async t=>{
 const f=await world(t),before=ledger(f),row=f.s.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator'",f.id),state=f.s.one('SELECT * FROM change_state WHERE work=?',f.id);
 const requirements=f.plan.verification.strategies.map(({requirementId,kind})=>({requirementId,kind}));
 const inspect=()=>f.c.inspectChangeResult(f.id),recorded=()=>assert.deepEqual(inspect().verificationEvidence.requirements.map(({requirementId,kind})=>({requirementId,kind})),requirements);
 recorded();f.s.run("UPDATE role_launches SET status='UNUSABLE' WHERE id=?",row.id);
 const held=inspect();assert.equal(held.reviewReady,false);assert.equal(held.verificationEvidence.availability,'unavailable');assert.deepEqual(held.verificationEvidence.requirements,[]);assert.match(held.blocked.join(),/actual independent planning producer/);
 f.s.run('UPDATE role_launches SET status=? WHERE id=?',row.status,row.id);recorded();
 const data=JSON.parse(state.data);f.s.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...data,verificationProfileMode:{version:2,kind:'finite-mixed'}}),f.id);
 const invalid=inspect();assert.equal(invalid.reviewReady,false);assert.deepEqual(invalid.verificationEvidence.requirements,[]);assert.match(invalid.blocked.join(),/verification profile mode unavailable/);
 f.s.run('UPDATE change_state SET data=? WHERE work=?',state.data,f.id);recorded();assert.deepEqual(ledger(f),before);f.pass();
});

test('a checked legacy result cannot mask a later invalid typed read or retain its error after restoration',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-verification-read-'))),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=1;\n');
 const c=await openController({installationHome:path.join(root,'home')});let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root);});
 await c.registerProject({id:'P',sourceRoot:source});const work=await c.beginChange({projectId:'P',request:'Keep original source'}),state=c.store.one('SELECT * FROM change_state WHERE work=?',work.workId),before=c.store.all('SELECT * FROM budgets ORDER BY rowid');
 assert.equal(c.changeCore.inspectVerificationEvidence(work.workId),undefined);
 c.store.run('UPDATE change_state SET data=? WHERE work=?',JSON.stringify({...JSON.parse(state.data),verificationProfileMode:{version:1,kind:'finite-mixed'}}),work.workId);
 assert.throws(()=>c.changeCore.inspectVerificationEvidence(work.workId),/Current accepted typed verification plan unavailable/);assert.equal(c.inspectChangeResult(work.workId).verificationEvidence.availability,'unavailable');
 c.store.run('UPDATE change_state SET data=? WHERE work=?',state.data,work.workId);assert.equal(c.changeCore.inspectVerificationEvidence(work.workId),undefined);assert.equal(c.inspectChangeResult(work.workId).verificationEvidence,undefined);assert.deepEqual(c.store.all('SELECT * FROM budgets ORDER BY rowid'),before);passed=true;
});

test('a falsey verification failure remains unavailable rather than becoming legacy permission',async t=>{
 const f=await world(t),core=f.c.changeCore,original=core.strategies,before=ledger(f);core.strategies=()=>{throw undefined;};
 try{
  let refused=false;try{core.inspectVerificationEvidence(f.id);}catch(error){refused=true;assert.equal(error,undefined);}assert.equal(refused,true);
  const view=f.c.inspectChange(f.id);assert.equal(view.phase,'BLOCKED');assert.equal(view.reviewReady,false);assert.equal(view.verificationEvidence.availability,'unavailable');assert.equal(view.verificationEvidence.reason,'undefined');assert.deepEqual(view.verificationEvidence.requirements,[]);
 }finally{core.strategies=original;}
 assert.deepEqual(ledger(f),before);f.pass();
});


test('new planning requires an explicit oracle list; original missing coverage remains unknown',async t=>{
 const f=await world(t),core=f.c.changeCore,profile=core.verificationSupport(f.id).capability,plan=mixedPlan();
 delete plan.verification.checks[0].expectationPaths;
 assert.throws(()=>core.planningValid(plan,f.id,profile),/explicit expectationPaths/);
 assert.doesNotThrow(()=>core.planningValid(plan,f.id,{...profile,version:3}));
 plan.verification.checks[0].expectationPaths=['new-checker.cjs'];
 plan.verification.strategies.find(strategy=>strategy.kind==='manifest-scope-duty').allowedChangePaths.push('new-checker.cjs');
 assert.doesNotThrow(()=>core.planningValid(plan,f.id,profile),'A plan may legitimately create its checker before execution');
 const state=f.s.one('SELECT plan FROM change_state WHERE work=?',f.id),row=f.s.one('SELECT data FROM change_versions WHERE id=?',state.plan),old=JSON.parse(row.data);
 delete old.plan.verification.checks[1].expectationPaths;f.s.run('UPDATE change_versions SET data=?,hash=? WHERE id=?',JSON.stringify(old),hash(old.plan),state.plan);
 assert.equal(core.verificationSupport(f.id).capability.version,3,'An exact retained BASE declaration is not silently augmented');assert.match(core.verificationSupport(f.id).capability.reason,/unknown expectation-input/);f.pass();
});

for(const version of [4,5,6,7])test('captured'+version+' refuses missing target oracle files before check allocation, preserving the original ledger',async t=>{
 const plan=mixedPlan();plan.verification.checks[0].expectationPaths=['missing-oracle.cjs'];
 const f=await world(t,plan,{...initialVerificationProfile,version}),before=ledger(f);
 await assert.rejects(f.c.changeCore.executeCheck(f.id,plan.verification.checks[0],{workId:f.id},f.base),error=>/expectation inputs are missing/.test(error.message)&&error.repairableProbe===true);
 await assert.rejects(f.c.changeCore.executeCheck(f.id,plan.verification.checks[0],{workId:f.id},f.base,'baseline'),error=>/expectation inputs are missing/.test(error.message)&&error.repairableProbe===false);
 assert.deepEqual(ledger(f),before);
 assert.equal(f.s.one('SELECT COUNT(*) n FROM check_runs WHERE work=?',f.id).n,0);f.pass();
});


test('fresh grammar5 host admission refuses omitted cases without inventing coverage',async t=>{
 const plan=mixedPlan(),f=await world(t,plan),core=f.c.changeCore,profile=core.verificationSupport(f.id).capability,before=ledger(f);
 delete plan.verification.checks[0].cases;
 assert.throws(()=>core.planningValid(plan,f.id,profile),/explicit cases array/);
 plan.verification.checks[0].cases=[];assert.throws(()=>core.planningValid(plan,f.id,profile),/lacks healthy actual consumer case/);
 assert.deepEqual(ledger(f),before);f.pass();
});

test('prospective BASE checks cannot depend on a checker only a future author could create',async t=>{
 const f=await world(t),core=f.c.changeCore,profile=core.verificationSupport(f.id).capability,plan=mixedPlan(),before=ledger(f);
 plan.verification.checks[0].expectationPaths=['future-candidate-checker.cjs'];
 plan.verification.strategies.find(strategy=>strategy.kind==='manifest-scope-duty').allowedChangePaths.push('future-candidate-checker.cjs');
 assert.doesNotThrow(()=>core.planningValid(plan,f.id,profile),'Candidate oracle files may be created by the author');
 const base=plan.verification.checks.find(check=>check.id==='base-check');base.expectationPaths=['future-base-checker.cjs'];
 assert.throws(()=>core.planningValid(plan,f.id,profile),/expectation inputs.*original.*BASE/i);
 assert.doesNotThrow(()=>core.planningValid(plan,f.id,{...profile,version:3}),'Historical oracle-unknown recipes retain their own law');
 base.expectationPaths=[];assert.doesNotThrow(()=>core.planningValid(plan,f.id,profile));
 base.expectationPaths=['owner.txt'];assert.doesNotThrow(()=>core.planningValid(plan,f.id,profile));
 assert.deepEqual(ledger(f),before);f.pass();
});

test('fresh candidate check inputs must be possible under every accepted manifest scope',async t=>{
 const f=await world(t,mixedPlan(),initialVerificationProfile,{'original-dir/retained.txt':'original'}),core=f.c.changeCore;
 const profile=core.verificationSupport(f.id).capability,plan=mixedPlan(),before=ledger(f);
 const check=plan.verification.checks[0],scope=plan.verification.strategies.find(strategy=>strategy.kind==='manifest-scope-duty');
 const verify=()=>core.planningValid(plan,f.id,profile);
 check.expectationPaths=['owner.txt'];
 assert.doesNotThrow(verify,'An existing immutable checker file needs no permission to change');
 check.expectationPaths=['checks/checker.cjs'];
 assert.throws(verify,/Candidate check.*regular file.*checks\/checker\.cjs.*manifest scope/);
 assert.doesNotThrow(()=>core.planningValid(plan,f.id),'Historical interpretation still uses its original gate');
 scope.allowedChangePaths.push('checks/checker.cjs');
 assert.throws(verify,/Candidate check.*directory "checks".*manifest scope/);
 scope.allowedChangePaths.push('checks');
 assert.doesNotThrow(verify);
 check.cases[0].input.fixturePaths=['owner.txt/data.json'];
 scope.allowedChangePaths.push('owner.txt/data.json');
 assert.throws(verify,/Candidate check.*directory "owner\.txt".*manifest scope/);
 check.cases[0].input.fixturePaths=[];
 check.cases[0].consumerPaths=['missing-consumer.cjs'];
 assert.throws(verify,/Candidate check.*regular file "missing-consumer\.cjs".*manifest scope/);
 check.cases[0].consumerPaths=['consumer.cjs'];
 check.expectationPaths.push('original-dir');
 scope.allowedChangePaths.push('original-dir');
 assert.throws(verify,/forbids removing its BASE descendant "original-dir\/retained\.txt"/);
 scope.allowedChangePaths.push('original-dir/retained.txt');
 assert.doesNotThrow(verify);
 check.cases[0].input.fixturePaths=['original-dir/new.json'];
 assert.throws(verify,/require both a regular file and directory at "original-dir"/);
 check.cases[0].input.fixturePaths=[];
 check.expectationPaths.pop();
 plan.requirements.push({id:'other-scope',text:'Only consumer.cjs may change under the other constraint',source:'owner-request'});
 plan.verification.strategies.push({...scope,requirementId:'other-scope',allowedChangePaths:['consumer.cjs']});
 assert.throws(verify,/Candidate check.*checks\/checker\.cjs.*manifest scope "other-scope"/);
 assert.deepEqual(ledger(f),before);f.pass();
});

test('fresh scope requires declared review inputs but allows an unused optional path',async t=>{
 const f=await world(t), plan=mixedPlan(), core=f.c.changeCore, before=ledger(f);
 const profile=core.verificationSupport(f.id).capability, verification=plan.verification;
 const scope=verification.strategies.find(strategy=>strategy.kind==='manifest-scope-duty');
 const verify=()=>core.planningValid(plan,f.id,profile), script='test/group-records.test.cjs';
 scope.allowedChangePaths.push(script);
 assert.doesNotThrow(verify,'An unused allowance does not make the path required');
 verification.reviewRoles[0].requiredPaths.push(script);
 assert.throws(verify,/Required review source "test\/group-records\.test\.cjs" requires a directory "test".*manifest scope/);
 assert.doesNotThrow(()=>core.planningValid(plan,f.id),'Earlier accepted plans retain their interpretation');
 scope.allowedChangePaths.push('test');
 assert.doesNotThrow(verify);
 scope.unchangedPaths.push('missing-baseline');
 assert.throws(verify,/requires "missing-baseline" to remain unchanged, but it is absent from BASE/);
 scope.unchangedPaths=[];
 const nested='owner.txt/new.cjs';
 verification.checks[0].cases[0].consumerPaths=[nested];
 scope.allowedChangePaths.push('owner.txt',nested);
 assert.ok(verification.reviewRoles[0].requiredPaths.includes('owner.txt'));
 assert.doesNotThrow(verify,'Review can read BASE owner.txt while the candidate uses that name as a directory');
 assert.deepEqual(ledger(f),before);f.pass();
});

test('retained missing immutable BASE oracle requests replanning without dispatch or spend',async t=>{
 const plan=mixedPlan();plan.verification.checks.find(check=>check.id==='base-check').expectationPaths=['future-base-checker.cjs'];
 const f=await world(t,plan,{...initialVerificationProfile,version:4}),before=ledger(f);
 const view=await f.c.implementChange({workId:f.id,model});
 assert.equal(view.phase,'BLOCKED');assert.match(view.nextAction,/Inspect original planning blockers/);
 const retained=JSON.parse(f.s.one('SELECT data FROM change_state WHERE work=?',f.id).data);assert.equal(retained.nextAction,'planChange');assert.equal(retained.resumeStage,'plan');
 assert.match(view.blocked.join(),/original immutable BASE.*independently replan/);
 assert.equal(view.candidateVersion,null);assert.deepEqual(ledger(f),before);
 assert.equal(f.s.one('SELECT COUNT(*) n FROM check_runs WHERE work=?',f.id).n,0);f.pass();
});


test('oracle bindings preserve exact frozen hashes and executable bits without inventing legacy coverage',()=>{
 const manifest={files:[{path:'oracle.cjs',sha256:'a'.repeat(64),effectiveMode:0o100754}]};
 assert.deepEqual(bindCheckExpectations(manifest,{expectationPaths:['oracle.cjs']}),[{path:'oracle.cjs',sha256:'a'.repeat(64),executable:0o110}]);
 assert.equal(bindCheckExpectations(manifest,{expectationPaths:['missing.cjs']}),null);
 assert.equal(bindCheckExpectations(manifest,{}),null);
 assert.deepEqual(bindCheckExpectations(manifest,{expectationPaths:[]}),[]);
});

test('unknown legacy oracle coverage does not require a target lookup',async t=>{
 const f=await world(t);
 assert.equal(f.c.changeCore.expectations('not-an-existing-version',{}),null);
 assert.throws(()=>f.c.changeCore.expectations('not-an-existing-version',{expectationPaths:[]}));f.pass();
});
