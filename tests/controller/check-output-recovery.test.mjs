/** Real Controller/Pi lifecycle; only physical engine execution and model judgments are controlled. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {scripted} from './effect-fixture.mjs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {changeResultText} from '../../dist/ui/change-result.js';
import {reviewChangeResult} from '../../dist/ui/change-commands.js';
import {uiText} from '../../dist/ui/i18n.js';
import {taskPresentation,managedChangeCompletionNotice} from '../../dist/ui/task-presentation.js';
import {prepareGovernedResult} from '../../dist/controller/governed-result.js';
import {changeCommandResult, changeReplanExitCode} from '../../dist/cli/change-result.js';
const root=await temporaryDirectory('check-output-recovery'),shim=path.join(root,'scope.mjs');
await fs.writeFile(shim,'export async function createScope(options){return globalThis.__checkOutputRecoveryScope(options)}');
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/change-core.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const {openController}=await import('../../dist/controller/index.js');
let active;
const cappedWorkReceipts=[];
globalThis.__checkOutputRecoveryScope=async options=>{
 const safe=p=>{const result=path.resolve(options.workRoot,p);assert.ok(result===options.workRoot||result.startsWith(options.workRoot+path.sep));return result;};
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-'+randomUUID(),validatePath:safe,readFile:p=>fs.readFile(safe(p),'utf8'),access:(p,m)=>fs.access(safe(p),m),writeFile:(p,c)=>fs.writeFile(safe(p),c),mkdir:p=>fs.mkdir(safe(p),{recursive:true}),exec:()=>assert.fail('No host execution of producer code'),closed:false,
  async execute(command){assert.equal(command,'node check.cjs');const descriptor=JSON.parse(await fs.readFile(path.join(options.inputRoot,'verification-cases.json'),'utf8'));const marker=await fs.readFile(path.join(options.workRoot,'check.cjs'),'utf8');const actual=Number((await fs.readFile(path.join(options.workRoot,'consumer.cjs'),'utf8')).match(/exports=(\d+)/)[1]);const fixed=marker.includes('runtime-descriptor');if(!fixed){if(active.mode==='setup-error')throw Error('Controlled engine setup unavailable');if(['malformed','crash','timeout','aborted','output-limit'].includes(active.mode))return {exitCode:active.mode==='crash'?1:0,stdout:'',stderr:active.unavailableStderr??'Controlled unavailable report',...(['timeout','aborted','output-limit'].includes(active.mode)?{termination:active.mode}:{})};}const good=fixed||['roster','roster-renamed','roster-long','material','nonzero-extra','nonzero-incomplete'].includes(active.mode);const cases=descriptor.cases.map(c=>({id:c.id,inputDigest:good?c.inputDigest:createHash('sha256').update(c.declaration.input.literalUtf8).digest('hex'),observed:{kind:actual===Number(c.declaration.input.literalUtf8)?'return':'rejection',value:String(actual)}}));const assertions=[{id:'three',passed:active.mode!=='material'},...(!fixed&&['extra','roster','roster-renamed','roster-long','nonzero-extra'].includes(active.mode)?[{id:active.mode==='roster-long'?'case:'+ 'long'.repeat(32):active.mode==='roster-renamed'?'case:renamed':'case:extra',passed:true}]:[])];return {exitCode:active.mode==='nonzero-extra'||!fixed&&active.mode==='nonzero-incomplete'?17:0,stdout:JSON.stringify({version:1,assertions,...(!fixed&&active.mode==='assertion-only'?{}:{cases:!fixed&&active.mode==='nonzero-incomplete'?cases.slice(1):cases})}),stderr:''};},
  async close(){scope.closed=true;return{state:'removed'}}};
 active.scopes.push(scope);if(!options.readOnlyWork)active.writable=scope.workspaceRoot;return scope;
};
const home=path.join(root,'home'),originalTemp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
const c=await openController({installationHome:home,maxProviderRequests:16,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});let failures=0;
after(async()=>{await c.close();delete globalThis.__checkOutputRecoveryScope;if(originalTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTemp;if(!failures)await fs.rm(root,{recursive:true,force:true});});
async function world(t,mode='literal',unavailableStderr,allowance={executionLimit:24,resolutionLimit:12}){
 const base=path.join(root,randomUUID()),source=path.join(base,'source');await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),'// controlled bad literal digest\n');
 active={mode,scopes:[],correctRepair:true,unavailableStderr};const state=active;
 t.after(()=>{if(t.passed===false)failures++;assert.ok(state.scopes.every(scope=>scope.closed));});
 const inputs=[];const model=scripted(()=>({text:'unused'}),event=>{if(event.role==='repairer'&&event.turn===0){inputs.push(event.body.context);if(state.correctRepair&&event.body.context.checkOutputRecovery)writeFileSync(path.join(state.writable,'check.cjs'),'// controlled runtime-descriptor\n');}});
 const projectId='P-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Consumer exports3',...allowance});const planned=await c.planChange({workId,model});assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));await c.implementChange({workId,model});const failed=await c.checkChange({workId});assert.equal(failed.phase,['material','nonzero-extra'].includes(mode)?'REPAIR_REQUIRED':'BLOCKED',JSON.stringify(failed.blocked));const receipt=c.store.one('SELECT * FROM check_runs WHERE work=? ORDER BY rowid DESC LIMIT 1',workId);assert.equal(receipt.status,['material','nonzero-extra'].includes(mode)?'fail':'unavailable');return {c,model,workId,receipt,inputs,state};
}
test('owner result shows only a bounded safe excerpt of the original rejected check stderr', async t => {
    const diagnostic = "Error: Cannot find module '/work/check.cjs'";
    const {workId, receipt} = await world(t, 'crash',
        '\x1b[31m'+diagnostic+'\x1b[0m\n\u202eforward\x00 text\n'+'detail\n'.repeat(20)+'OMIT THIS LINE\n'+'x'.repeat(900)+'OMIT THIS TAIL');
    const original = c.inspectChangeResult(workId);
    assert.equal(original.checks.entries[0].stderrExcerpt,undefined);
    assert.ok(!JSON.stringify(original).includes(diagnostic));
    const read = locale => reviewChangeResult({
        controller:c, locale:()=>locale, isCurrent:()=>true,
        choose:()=>assert.fail('Result read must not choose a recovery action'),
        show:async (_title,text)=>shown.push(text),
    }, workId, 'owner', ()=>{});
    const shown = [];
    for (const locale of ['en','ko']) {
        await read(locale);
        const text = shown.at(-1);
        assert.ok(text.includes('  '+diagnostic));
        assert.ok(text.includes(uiText(locale,'result.check.stderr')));
        assert.ok(text.includes(uiText(locale,'result.check.stderrShortened')));
        assert.ok(!text.includes('OMIT THIS LINE'));
        assert.ok(!text.includes('OMIT THIS TAIL'));
        assert.doesNotMatch(text,/[\x00\x1b\u202e]/u);
    }
    assert.deepEqual(c.inspectChangeResult(workId),original);
    assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
    const run = c.store.one('SELECT data FROM runs WHERE id=?',receipt.run);
    c.store.run("UPDATE runs SET data=json_set(data,'$.cleanup','unknown') WHERE id=?",receipt.run);
    try {
        await read('en');
        assert.ok(!shown.at(-1).includes(diagnostic));
        assert.ok(!shown.at(-1).includes(uiText('en','result.check.stderr')));
    } finally {
        c.store.run('UPDATE runs SET data=? WHERE id=?',run.data,receipt.run);
    }
});
test('owner check stderr excerpt is also bounded for a single long line', async t => {
    const raw = 'long diagnostic '.repeat(90) + 'TAIL';
    const {workId} = await world(t,'crash',raw);
    const [check] = c.inspectChangeResult(workId,{checkStderr:true}).checks.entries;
    assert.deepEqual(check.stderrExcerpt,{text:raw.slice(0,600),shortened:true});
});
for(const mode of ['literal','extra','roster'])test('released check diagnostic remains an exact repair assignment: '+mode,async t=>{
 const f=await world(t,mode);const {c,model,workId,receipt}=f;
 const run=c.store.one('SELECT * FROM runs WHERE id=?',receipt.run),data=JSON.parse(receipt.data);
 assert.equal(c.inspectChangeResult(workId).checks.entries[0].unavailableReason,'output-contract',JSON.stringify({runPhase:run.phase,reservation:run.reservation,runData:JSON.parse(run.data),bound:data.boundVersions,target:data.target,cleanup:data.cleanup}));
 const result=await c.driveChange({workId,model,maximumSteps:1});assert.equal(result.phase,'CANDIDATE_CAPTURED',JSON.stringify(result.blocked));assert.equal(f.inputs.length,1);
 const context=f.inputs[0];assert.equal(context.purpose,context.checkOutputRecovery.purpose);assert.ok(!context.openObligations.some(o=>o.kind==='diagnostic'),'Scheduling hold is released before the role, as on the normal retry path');
 assert.equal(context.checkOutputRecovery.failures[0].receiptId,receipt.id);if(mode!=='roster')assert.ok(context.checkOutputRecovery.failures[0].diagnosis.counts['case-input-digest']);
 if(mode==='extra'||mode==='roster')assert.equal(context.checkOutputRecovery.failures[0].diagnosis.counts['assertion-unexpected'],1);
 const checked=await c.checkChange({workId});assert.equal(checked.checks.at(-1).status,'pass',JSON.stringify(checked.blocked));assert.equal(checked.checks.at(-1).data.caseResults.complete,true);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt,'Original unavailable receipt is not promoted or rewritten');
});
test('recorded verification report shows exact extra assertion IDs and keeps clipped previews out',async t=>{
 const ordinary=await world(t,'roster');
 const short=ordinary.c.inspectChangeResult(ordinary.workId).checks.entries[0];
 assert.deepEqual(short.outputIssueIds,{'assertion-unexpected':['case:extra']});
 const clipped=await world(t,'roster-long');
 const long=clipped.c.inspectChangeResult(clipped.workId).checks.entries[0];
 assert.deepEqual(long.outputIssues,{'assertion-unexpected':1});
 assert.equal(long.outputIssueIds,undefined);
});
for(const mode of ['literal','crash'])test('unchanged repair and repeated unusable output require owner action: '+mode,async t=>{
 const {c,workId,model,receipt,state,inputs}=await world(t,mode);
 state.correctRepair=false;
 const stopped=await c.driveChange({workId,model});
 assert.equal(stopped.phase,'BLOCKED');
 assert.match(stopped.blocked.join(),/same unusable output after an unchanged repair/);
 const action=c.changeCore.inspectAssignmentOwnerAction(workId);
 assert.equal(action.kind,'repeated-check-report');
 assert.equal(action.checkId,receipt.check_id);
 assert.ok(action.nextAction.includes('/change resume '+workId));
 assert.equal(inputs.length,1);
 assert.equal(stopped.execution.reserved,0);
 assert.deepEqual(c.store.all('SELECT status FROM check_runs WHERE work=? ORDER BY rowid',workId).map(row=>row.status),['unavailable','unavailable']);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
 state.correctRepair=true;
 const recovered=await c.driveChange({workId,model,maximumSteps:1});
 assert.equal(recovered.phase,'CANDIDATE_CAPTURED');
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(workId),null);
 const checked=await c.checkChange({workId});
 assert.equal(checked.checks.at(-1).status,'pass',JSON.stringify(checked.blocked));
});
test('an unchanged repair repeating a complete material check failure requires owner action',async t=>{
 const {c,workId,model,receipt,state}=await world(t,'material');
 state.correctRepair=false;
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(workId),null);
 const stopped=await c.driveChange({workId,model});
 assert.equal(stopped.phase,'BLOCKED');
 assert.match(stopped.blocked.join(),/same material failure/);
 const action=c.changeCore.inspectAssignmentOwnerAction(workId);
 assert.equal(action.kind,'repeated-check-report');
 assert.equal(action.checkId,receipt.check_id);
 assert.match(action.nextAction,/reported the same material failure/);
 assert.ok(action.nextAction.includes('/change resume '+workId));
 assert.deepEqual(c.store.all('SELECT status FROM check_runs WHERE work=? ORDER BY rowid',workId).map(row=>row.status),['fail','fail']);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
 assert.equal((await c.driveChange({workId,model,maximumSteps:1})).phase,'CANDIDATE_CAPTURED','Explicit owner drive still admits an original repair');
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(workId),null);
});
test('changed nonzero diagnostic does not hold same-work recovery',async t=>{
 const {c,workId,model,state}=await world(t,'crash');
 state.correctRepair=false;
 state.unavailableStderr='A different client diagnostic';
 const outcome=await c.driveChange({workId,model});
 assert.equal(outcome.phase,'BLOCKED');
 assert.equal(outcome.checks.at(-1).status,'unavailable');
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(workId),null);
});
test('identical diagnostic counts do not prove the same rejected report',async t=>{
 const {c,workId,model,receipt,state}=await world(t,'roster');
 state.correctRepair=false;
 state.mode='roster-renamed';
 const result=await c.driveChange({workId,model});
 assert.equal(result.phase,'BLOCKED');
 assert.doesNotMatch(result.blocked.join(),/same unusable output/);
 assert.equal(c.changeCore.inspectAssignmentOwnerAction(workId),null);
 assert.deepEqual(result.checks.at(-1).data.outputDiagnosis.counts,JSON.parse(receipt.data).outputDiagnosis.counts);
});
test('a passing check does not override an independent review that names a missing observation',async t=>{
 const {c,workId,model}=await world(t);
 assert.equal((await c.driveChange({workId,model,maximumSteps:1})).phase,'CANDIDATE_CAPTURED');
 const checked=await c.checkChange({workId});
 assert.equal(checked.checks.at(-1).status,'pass');
 const reason='The check serializes values but never tests record references or fresh arrays.';
 let expected, decisions;
 const reviewer=scripted(undefined,({role,body,result})=>{
  assert.equal(role,'reviewer');
  expected=body.context.verificationReviewRequirements;
  decisions=expected.map(item=>({requirementId:item.requirementId,strategyDigest:item.strategyDigest,
   witnessIds:[],verdict:'unavailable',reason:reason+'\u001b'+'x'.repeat(320)}));
  result.verificationDecisions=decisions;
 });
 const result=await c.reviewChange({workId,model:reviewer});
 assert.equal(result.phase,'BLOCKED');
 assert.equal(result.reviewReady,false);
 const view=c.inspectChangeResult(workId);
 const blocked=view.blocked.join('\n');
 assert.match(blocked,/Independent review could not establish verification for "R1"/);
 assert.ok(blocked.includes(reason));
 assert.ok(blocked.includes('…'));
 assert.doesNotMatch(blocked,/\u001b|x{280}/);
 assert.equal(view.checks.entries[0].status,'pass');
 for(const locale of ['en','ko'])assert.ok(changeResultText(view,locale).includes(reason));
 const second={...expected[0],requirementId:'second'};
 const invalid={...decisions[0],requirementId:'second',witnessIds:['foreign-witness']};
 assert.throws(()=>c.changeCore.verificationDecisions(workId,{verificationDecisions:[decisions[0],invalid]},
   [...expected,second]),error=>/witness binding changed/.test(error.message)&&!error.message.includes(reason));
});
for(const behavior of ['changed','dismissed','unchanged','unselected','coverage','coverage-repeat'])test({
 changed:'a bound negative verification review with a blocking finding reaches adjudication and fresh repair',
 dismissed:'dismissing a blocking finding cannot override its unavailable review fit',
 unchanged:'an unchanged repair retains passing checks and the selected negative review without replay',
 unselected:'a finding from an unselected reviewer output cannot stand in for the selected verification finding',
 coverage:'verification replan keeps the exact candidate and closes only after fresh checks and independent review',
 'coverage-repeat':'a second verification replan cannot dismiss the first pending correction',
}[behavior],async t=>{
 const {c,workId,model,state}=await world(t,'literal',undefined,behavior==='coverage-repeat'?{executionLimit:32,resolutionLimit:16}:undefined);
 const captured=await c.driveChange({workId,model,maximumSteps:1});
 assert.equal(captured.phase,'CANDIDATE_CAPTURED');
 assert.equal((await c.checkChange({workId})).checks.at(-1).status,'pass');
 const reviewer=scripted(undefined,({role,body,result})=>{
  assert.equal(role,'reviewer');
  result.outcome='findings';
  result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'A stored success can hide the missing checker observation.',evidence:['candidate:check.cjs']}];
  result.verificationDecisions=body.context.verificationReviewRequirements.map(({requirementId,strategyDigest})=>({requirementId,strategyDigest,witnessIds:[],verdict:'unavailable',reason:'The passing report does not establish the required observation.'}));
 });
 const result=await c.reviewChange({workId,model:reviewer});
 assert.equal(result.phase,'RESOLVING');
 assert.equal(result.reviewReady,false);
 assert.equal(result.candidateVersion,captured.candidateVersion);
 const finding=result.occurrences.find(row=>row.data.finding.description.includes('missing checker observation'));
 assert.ok(finding);
 assert.equal((await c.reviewChange({workId,model:reviewer})).launches.filter(launch=>launch.role==='reviewer').length,1);
 const judge=scripted(undefined,({role,body,result:judgment})=>{
  assert.equal(role,'adjudicator');
  const assessment=body.context.verificationReviewRequirements[0];
  assert.equal(assessment.reviews[0].decision.verdict,'unavailable');
  judgment.verificationDecisions=[{requirementId:assessment.requirementId,strategyDigest:assessment.strategyDigest,witnessIds:assessment.witnessIds,
   verdict:'satisfied',reason:'The runner supplied a passing receipt, but the blocking review finding still requires repair.'}];
  judgment.decisions=[behavior==='dismissed'
   ? {occurrenceId:finding.id,disposition:'rejected',reason:'The asserted defect is unsupported by the selected checker source.',witnesses:['candidate:check.cjs']}
   : {occurrenceId:finding.id,disposition:'upheld',resolution:'pending',reason:'The reviewer identified a material missing observation.',witnesses:[]}];
 });
 const needsRepair=await c.resolveChange({workId,model:judge});
 if(behavior==='dismissed'){
  assert.equal(needsRepair.phase,'BLOCKED');
  assert.equal(needsRepair.reviewReady,false);
  assert.match(needsRepair.blocked.join(),/does not establish the required observation/);
  assert.equal((await c.reviewChange({workId,model:reviewer})).launches.filter(launch=>launch.role==='reviewer').length,1);
  return;
 }
 assert.equal(needsRepair.phase,'REPAIR_REQUIRED',JSON.stringify(needsRepair.blocked));
 assert.equal(needsRepair.reviewReady,false);
 assert.equal(needsRepair.launches.filter(launch=>launch.role==='reviewer').length,1);
 if(behavior==='unselected'){
  const original=c.store.one('SELECT * FROM role_outputs WHERE id=?',finding.output);
  const otherOutput=randomUUID(),otherFinding=randomUUID();
  c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',otherOutput,original.launch,original.raw,'accounted-intermediate',original.data);
  c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',otherFinding,otherOutput,finding.ordinal,workId,JSON.stringify(finding.data));
  c.store.run('INSERT INTO obligations VALUES(?,?,?)',otherFinding,workId,JSON.stringify({kind:'finding',occurrence:otherFinding,state:'pending'}));
  c.store.run("UPDATE obligations SET data=json_set(data,'$.state','resolved') WHERE id=?",finding.id);
  const repaired=await c.driveChange({workId,model:scripted(undefined,({role})=>assert.equal(role,'repairer')),maximumSteps:1});
  assert.equal(repaired.phase,'CANDIDATE_CAPTURED',JSON.stringify(repaired.blocked));
  assert.equal(repaired.reviewReady,false);
  assert.notEqual(repaired.candidateVersion,captured.candidateVersion);
  return;
 }
 if(behavior==='unchanged'||behavior.startsWith('coverage')){
  const read=(table)=>c.store.all(`SELECT * FROM ${table} WHERE work=? ORDER BY rowid`,workId);
  const previousChecks=read('check_runs'),previousFindings=read('obligations'),previousVersions=read('change_versions');
  const selection=()=>JSON.parse(read('change_state')[0].data).selection;
  const selected=selection(), launchCount=read('role_launches').length;
  const held=await c.driveChange({workId,model:scripted(undefined,({role})=>assert.equal(role,'repairer'))});
  assert.equal(held.phase,'BLOCKED');
  assert.equal(held.reviewReady,false);
  assert.equal(held.candidateVersion,captured.candidateVersion);
  assert.match(held.blocked.join(),/Repair left the candidate unchanged.*required observation/);
  assert.match(held.nextAction,/Inspect the retained verification finding/);
  assert.deepEqual(read('check_runs'),previousChecks);
  assert.deepEqual(read('obligations'),previousFindings);
  assert.deepEqual(read('change_versions'),previousVersions);
  assert.deepEqual(selection(),selected);
  assert.equal(read('role_launches').length,launchCount+1);
  const view=c.inspectChangeResult(workId);
  assert.deepEqual(view.verificationGap,{requirementId:'R1',findingId:finding.id,passingChecks:['value'],omittedChecks:0});
  assert.match(changeResultText(view,'en'),/Passed checks: "value". Independent review still needs evidence for "R1"/);
  assert.match(changeResultText(view,'ko'),/"value" 검사는 통과했습니다. 독립 리뷰에서 "R1"의 추가 검증 근거를 요구했습니다/);
  const passing=previousChecks.find(row=>row.status==='pass');
  c.store.run("UPDATE check_runs SET status='unavailable' WHERE id=?",passing.id);
  try {
   assert.equal(c.inspectChangeResult(workId).verificationGap,undefined);
  } finally {
   c.store.run("UPDATE check_runs SET status='pass' WHERE id=?",passing.id);
  }
  const pending=previousFindings.find(row=>row.id===finding.id);
  c.store.run("UPDATE obligations SET data=json_set(data,'$.occurrence','another-finding') WHERE id=?",pending.id);
  try {
   assert.equal(c.inspectChangeResult(workId).verificationGap,undefined);
  } finally {
   c.store.run('UPDATE obligations SET data=? WHERE id=?',pending.data,pending.id);
  }
  const settledRuns=read('runs');
  const reopened=await c.driveChange({workId,model:scripted(undefined,()=>assert.fail('An explicit resume alone cannot recreate missing evidence'))});
  assert.equal(reopened.phase,'BLOCKED');
  assert.equal(reopened.nextAction,held.nextAction);
  assert.deepEqual(read('runs'),settledRuns);
  if(behavior.startsWith('coverage')){
   const originalReview=await c.changeCore.historicalPlanningProducer(workId,finding.output);
   assert.equal(Object.hasOwn(originalReview.context,'occurrences'),false);
   assert.deepEqual(originalReview.witness.initialView.occurrenceIds,[]);
   const route=c.inspectChangeReplan(workId);
   assert.equal(route.kind,'verification');
   assert.equal(route.failures[0].occurrenceId,finding.id);
   assert.equal(c.inspectChangeResult(workId,{retainedChecks:true}).replanKind,'verification');
   await assert.rejects(c.changeCore.plan({workId,model},true,undefined,undefined,'0'.repeat(64)),/verification gap changed/);
   assert.deepEqual(read('runs'),settledRuns);
   const authorCount=()=>read('role_launches').filter(row=>['implementer','repairer'].includes(row.role)).length;
   const originalAuthors=authorCount();
   const replan=(change, subject=finding.id, witness=passing.id)=>scripted(undefined,({role,body,result:proposal})=>{
    assert.ok(['planner','challenger','adjudicator'].includes(role));
    const gap=body.context.verificationReplan;
    assert.equal(gap.occurrenceId,subject);
    assert.equal(gap.requirementId,'R1');
    if(role!=='adjudicator')return;
    const corrected=structuredClone(gap.originalPlan);
    const check=corrected.verification.checks[0];
    const additional=subject===finding.id ? {id:'different-value',literal:'6'} : {id:'further-value',literal:'8'};
    check.cases.push({...structuredClone(check.cases[1]),id:additional.id,input:{literalUtf8:additional.literal,fixturePaths:[]}});
    proposal.acceptedPlan=corrected;
    proposal.decisions=[{occurrenceId:subject,disposition:'upheld',resolution:'pending',
     repair:{kind:'verification-plan',proposalHash:gap.proposalHash},reason:'The retained checker reports actual outcomes for the supplied additional case.',
     witnesses:[witness]}];
    if(change)change(check,proposal);
   });
   if(behavior==='coverage'){
    const rejected=await c.planChange({workId,model:replan(check=>{check.command='node other.cjs';})});
    assert.equal(rejected.phase,'BLOCKED');
    assert.match(rejected.blocked.join(),/only append cases/);
    assert.equal(rejected.verificationVersion,held.verificationVersion);
    assert.equal(JSON.parse(read('obligations').find(row=>row.id===finding.id).data).state,'pending');
   }
   const adopted=await c.planChange({workId,model:replan()});
   assert.equal(adopted.phase,'CANDIDATE_CAPTURED',JSON.stringify(adopted.blocked));
   assert.equal(adopted.verificationReplanAccepted,true);
   assert.equal(changeReplanExitCode(adopted),0);
   assert.equal(changeCommandResult('change replan',adopted,false,home).verificationReplanAccepted,true);
   assert.equal(adopted.candidateVersion,held.candidateVersion);
   assert.notEqual(adopted.verificationVersion,held.verificationVersion);
   const adoptedResult=c.inspectChangeResult(workId);
   assert.equal(adoptedResult.verificationReplanAccepted,true);
   assert.match(changeResultText(adoptedResult,'en'),/Resume to run the new checks and independent review on the retained candidate/);
   assert.deepEqual(read('check_runs'),previousChecks);
   assert.equal(JSON.parse(read('obligations').find(row=>row.id===finding.id).data).state,'pending');
   const beforeChecks=read('runs');
   await assert.rejects(c.planChange({workId,model}),/Resume the accepted verification correction/);
   c.store.run("UPDATE check_runs SET status='unavailable' WHERE id=?",passing.id);
   try {
    const stale=await c.checkChange({workId});
    assert.equal(stale.phase,'BLOCKED');
    assert.match(stale.blocked.join(),/correction source changed/);
    assert.deepEqual(read('runs'),beforeChecks);
   } finally {
    c.store.run("UPDATE check_runs SET status='pass' WHERE id=?",passing.id);
   }
   const originalOccurrence=read('finding_occurrences').find(row=>row.id===finding.id);
   c.store.run("UPDATE finding_occurrences SET data=json_set(data,'$.launchId','different-reviewer') WHERE id=?",finding.id);
   try {
    const stale=await c.checkChange({workId});
    assert.equal(stale.phase,'BLOCKED');
    assert.match(stale.blocked.join(),/original reviewer judgment changed/);
    assert.deepEqual(read('runs'),beforeChecks);
   } finally {
    c.store.run('UPDATE finding_occurrences SET data=? WHERE id=?',originalOccurrence.data,originalOccurrence.id);
   }
   const checked=await c.checkChange({workId});
   assert.equal(checked.phase,'CHECKED',JSON.stringify(checked.blocked));
   const pass=checked.checks.at(-1);
   assert.equal(pass.status,'pass');
   assert.equal(pass.data.caseDescriptor.cases.at(-1).id,'different-value');
   if(behavior==='coverage-repeat'){
    const reviewed=await c.reviewChange({workId,model:reviewer});
    const second=reviewed.occurrences.at(-1).id;
    assert.notEqual(second,finding.id);
    const unresolved=await c.resolveChange({workId,model:scripted(undefined,({result:judgment})=>{
     judgment.decisions=[finding.id,second].map(occurrenceId=>({occurrenceId,disposition:'upheld',resolution:'pending',
      reason:'Required observations still need sufficient independent evidence.',witnesses:[]}));
    })});
    assert.equal(unresolved.phase,'REPAIR_REQUIRED',JSON.stringify(unresolved.blocked));
    assert.equal((await c.driveChange({workId,model:scripted(undefined,({role})=>assert.equal(role,'repairer'))})).phase,'BLOCKED');
    const bad=await c.planChange({workId,model:replan((_check,proposal)=>proposal.decisions.push({occurrenceId:finding.id,
     disposition:'rejected',reason:'Attempt to dismiss the previous finding during a further correction.',witnesses:[pass.id]}),second,pass.id)});
    assert.equal(bad.phase,'BLOCKED',JSON.stringify(bad.blocked));
    assert.equal(bad.verificationVersion,adopted.verificationVersion);
    assert.match(bad.blocked.join(),/preserve the previous finding/);
    assert.equal(JSON.parse(read('obligations').find(row=>row.id===finding.id).data).state,'pending');
    const carried=await c.planChange({workId,model:replan((_check,proposal)=>proposal.decisions.push({occurrenceId:finding.id,
     disposition:'equivalent',equivalentTo:second,implementation:{kind:'none'},
     reason:'Both independently recorded observations identify the same still-unproved behavior.',witnesses:[pass.id]}),second,pass.id)});
    assert.equal(carried.phase,'CANDIDATE_CAPTURED',JSON.stringify(carried.blocked));
    const findingStates=()=>[finding.id,second].map(id=>JSON.parse(read('obligations').find(row=>row.id===id).data).state);
    assert.deepEqual(findingStates(),['pending','pending']);
    const corrected=await c.checkChange({workId});
    assert.equal(corrected.phase,'CHECKED',JSON.stringify(corrected.blocked));
    const receipt=corrected.checks.at(-1);
    assert.equal(receipt.data.caseDescriptor.cases.at(-1).id,'further-value');
    assert.equal((await c.reviewChange({workId,model})).phase,'RESOLVING');
    const ready=await c.resolveChange({workId,model:scripted(undefined,({result:judgment})=>{
     judgment.decisions=[{occurrenceId:second,disposition:'upheld',resolution:'repaired',
      reason:'Independent review now establishes coverage for the missing behavior.',witnesses:[receipt.id]}];
    })});
    assert.equal(ready.phase,'REVIEW_READY',JSON.stringify(ready.blocked));
    assert.equal(ready.candidateVersion,held.candidateVersion);
    assert.deepEqual(findingStates(),['resolved','resolved']);
    return;
   }
   assert.equal((await c.reviewChange({workId,model})).phase,'RESOLVING');
   const dismissal=await c.resolveChange({workId,model:scripted(undefined,({result:judgment})=>{
    judgment.decisions=[{occurrenceId:finding.id,disposition:'rejected',
     reason:'This attempted shortcut must leave the adopted verification duty pending.',witnesses:[pass.id]}];
   })});
   assert.equal(dismissal.phase,'BLOCKED');
   assert.match(dismissal.blocked.join(),/adopted verification finding/);
   assert.equal(JSON.parse(read('obligations').find(row=>row.id===finding.id).data).state,'pending');
   const ready=await c.resolveChange({workId,model:scripted(undefined,({body,result:judgment})=>{
    assert.equal(body.context.verificationReviewRequirements[0].reviews[0].decision.verdict,'satisfied');
    judgment.decisions=[{occurrenceId:finding.id,disposition:'upheld',resolution:'repaired',
     reason:'Fresh required execution and independent review establish the missing coverage.',witnesses:[pass.id]}];
   })});
   assert.equal(ready.phase,'REVIEW_READY',JSON.stringify(ready.blocked));
   assert.equal(ready.candidateVersion,held.candidateVersion);
   assert.equal(ready.dispositions.at(-1).data.repairWitness.kind,'verification-plan');
   assert.equal(JSON.parse(read('obligations').find(row=>row.id===finding.id).data).state,'resolved');
   assert.equal(authorCount(),originalAuthors);
  }
  return;
 }
 const repairer=scripted(undefined,({role,turn})=>{
  assert.equal(role,'repairer');
  if(turn===0)writeFileSync(path.join(state.writable,'check.cjs'),'// controlled runtime-descriptor with corrected observation\n');
 });
 const repaired=await c.driveChange({workId,model:repairer,maximumSteps:1});
 assert.equal(repaired.phase,'CANDIDATE_CAPTURED',JSON.stringify(repaired.blocked));
 assert.notEqual(repaired.candidateVersion,captured.candidateVersion);
 const checked=await c.checkChange({workId});
 assert.equal(checked.checks.at(-1).status,'pass');
 assert.equal((await c.reviewChange({workId,model})).phase,'RESOLVING');
 const finalJudge=scripted(undefined,({role,body,result:judgment})=>{
  assert.equal(role,'adjudicator');
  assert.equal(body.context.verificationReviewRequirements[0].reviews[0].decision.verdict,'satisfied');
  judgment.decisions=[{occurrenceId:finding.id,disposition:'upheld',resolution:'repaired',reason:'Current candidate and fresh verification establish the repair.',witnesses:[checked.checks.at(-1).id]}];
 });
 const ready=await c.resolveChange({workId,model:finalJudge});
 assert.equal(ready.phase,'REVIEW_READY',JSON.stringify(ready.blocked));
 assert.equal(ready.reviewReady,true);
});
for(const mode of ['malformed','crash','nonzero-incomplete','assertion-only'])test('source-qualified rejected report diagnoses before another check: '+mode,async t=>{
 const f=await world(t,mode),{c,workId,receipt,model}=f;
 const data=JSON.parse(receipt.data),originalState=c.store.one('SELECT * FROM change_state WHERE work=?',workId);
 assert.equal(originalState.phase,'BLOCKED');assert.equal(JSON.parse(originalState.data).resumeStage,'repair');
 const check=c.inspectChangeResult(workId).checks.entries[0];
 assert.equal(check.unavailableReason,'output-contract');
 const parsed=['nonzero-incomplete','assertion-only'].includes(mode);
 const recovery=c.changeCore.checkOutputRecovery(workId).view;
 assert.deepEqual(check.outputIssues,parsed?{'case-missing':mode==='assertion-only'?data.caseDescriptor.cases.length:1}:undefined);
 const observedIds=new Set(data.parsed?.value?.cases?.map(row=>row.id));
 assert.deepEqual(check.outputIssueIds,parsed?{'case-missing':data.caseDescriptor.cases.filter(row=>!observedIds.has(row.id)).slice(0,2).map(row=>row.id)}:undefined);
 assert.equal(recovery.failures[0].receiptId,receipt.id);
 assert.equal(recovery.failures[0].production.exitCode,data.actual.exitCode);
 assert.equal(recovery.failures[0].production.report,parsed?'accepted':'rejected');
 // A retained old scheduling hint is historical, not today's diagnosis policy.
 c.store.run("UPDATE change_state SET data=json_set(data,'$.resumeStage','checks','$.nextAction','Explicit resume retries current check') WHERE work=?",workId);
 const retained=c.store.one('SELECT * FROM change_state WHERE work=?',workId);
 const view=c.inspectChange(workId);
 assert.match(view.nextAction,/charged repair role/);assert.match(view.nextAction,/does not simply rerun/);
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'repair',roles:['repairer']});
 assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),retained,'Inspection does not rewrite an old checkpoint');
 const before=c.store.one('SELECT COUNT(*) AS n FROM check_runs WHERE work=?',workId).n;
 const result=await c.driveChange({workId,model,maximumSteps:1});
 assert.equal(result.phase,'CANDIDATE_CAPTURED',JSON.stringify(result.blocked));assert.equal(f.inputs.length,1);
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM check_runs WHERE work=?',workId).n,before,'No unchanged check is repeated before diagnosis');
 assert.match(f.inputs[0].purpose,/does not establish target-command start, infrastructure cause or a subject defect/);
 const checked=await c.checkChange({workId});assert.equal(checked.checks.at(-1).status,'pass',JSON.stringify(checked.blocked));
 assert.equal(checked.checks.at(-1).data.caseResults.complete,true);
 assert.equal(checked.reviewReady,false,'Fresh checks alone do not supply independent review');
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt,'Old unavailable attempt is never promoted or erased');
});
for(const mode of ['timeout','aborted','output-limit','setup-error'])test('unavailable attempt does not infer rejected-report authoring: '+mode,async t=>{
 const {c,workId,receipt,inputs}=await world(t,mode);
 assert.equal(c.changeCore.checkOutputRecovery(workId).view,undefined);
 assert.equal(c.inspectChangeResult(workId).checks.entries[0].unavailableReason,undefined);
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'checks',roles:[]});
 assert.doesNotMatch(c.inspectChange(workId).nextAction,/charged repair role/);
 assert.equal(inputs.length,0);assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
});
test('a selected roleless required check reports execution exhaustion before reserving another run',async t=>{
 const {c,workId,state,receipt,model}=await world(t,'timeout');
 const lineage=c.inspectWork(workId).lineageRoot;
 c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",lineage);
 const count=(table)=>c.store.one('SELECT COUNT(*) AS n FROM '+table+' WHERE work=?',workId).n;
 const before=[count('runs'),count('check_runs'),state.scopes.length];
 const retained=c.store.one('SELECT * FROM change_state WHERE work=?',workId);
 assert.deepEqual(c.inspectChangeContinuationPrerequisites(workId),{stage:'checks',roles:[],allowanceHold:'execution'});
 assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),retained);
 // The empty selection control keeps the original valid verification envelope.
 const core=c.changeCore,required=core.requiredCandidateChecks;
 core.requiredCandidateChecks=()=>[];
 try{assert.deepEqual(c.inspectChangeContinuationPrerequisites(workId),{stage:'checks',roles:[],allowanceHold:undefined});}
 finally{core.requiredCandidateChecks=required;}
 const refused=await c.driveChange({workId,model,maximumSteps:1});
 assert.match(refused.blocked.join(' '),/Execution allowance exhausted/);
 assert.deepEqual([count('runs'),count('check_runs'),state.scopes.length],before);
 c.extendExecutionAllowance({workId,additional:1,reason:'Authorize one explicit original check retry'});
 const checked=await c.driveChange({workId,model,maximumSteps:1});
 assert.equal(checked.checks.at(-1).status,'unavailable',JSON.stringify(checked.blocked));
 const retry=c.store.one('SELECT * FROM check_runs WHERE work=? ORDER BY rowid DESC LIMIT 1',workId);
 assert.equal(retry.check_id,receipt.check_id);assert.notEqual(retry.run,receipt.run);
 assert.deepEqual([count('runs'),count('check_runs'),state.scopes.length],before.map(n=>n+1));
});
test('newer selected pass or timeout does not resurrect an older unavailable repair target',async t=>{
 const {c,workId,receipt}=await world(t);const insert=(status,edit)=>{const data=JSON.parse(receipt.data);edit?.(data);c.store.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)',randomUUID(),workId,receipt.run,receipt.candidate,receipt.verification,receipt.check_id,status,JSON.stringify(data));};
 insert('pass');assert.equal(c.changeCore.checkOutputRecovery(workId).view,undefined);
 insert('unavailable',data=>{data.actual.termination={kind:'timeout'};});assert.equal(c.changeCore.checkOutputRecovery(workId).view,undefined);
});
test('selected receipt drift during verification preparation refuses before a charged repairer launch',async t=>{
 const {c,workId,model,receipt}=await world(t);const core=c.changeCore,method=core.beforeAuthorVerification,original=method.bind(core);t.after(()=>{core.beforeAuthorVerification=method;});let changed=false;
 core.beforeAuthorVerification=async(...args)=>{const proof=await original(...args);if(!changed){changed=true;c.store.run('UPDATE check_runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(receipt.data),durationMs:98765}),receipt.id);}return proof;};
 const before=c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='repairer'",workId).n;
 const result=await c.driveChange({workId,model,maximumSteps:1});assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Selected check-output recovery source changed/);
 assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='repairer'",workId).n,before);assert.equal(result.execution.reserved,0);
});

for(const mode of ['material','nonzero-extra'])test('material false assertion and existing nonzero policy remain separate: '+mode,async t=>{
 const {c,workId,receipt}=await world(t,mode);const data=JSON.parse(receipt.data);
 assert.equal(receipt.status,'fail');assert.equal(data.caseResults.complete,true);assert.equal(c.changeCore.checkOutputRecovery(workId).view,undefined);
 if(mode==='material')assert.equal(data.outputDiagnosis.complete,true);else assert.equal(data.actual.exitCode,17);
});

for(const mode of ['receipt','captured-assignment'])test('capacity wait rechecks original recovery source before model dispatch: '+mode,async t=>{
 const {c,workId,model,receipt,inputs}=await world(t);const host=c.changeCore.h,original=host.acquireCapacity;let changed=false;
 t.after(()=>{host.acquireCapacity=original;});
 host.acquireCapacity=async function(request){const lease=await original.call(this,request);if(!changed&&request.workId===workId&&request.kind==='role'){
  changed=true;
  if(mode==='receipt')c.store.run('UPDATE check_runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(receipt.data),durationMs:123456}),receipt.id);
  else{const launch=c.store.one('SELECT * FROM role_launches WHERE run=?',request.runId),data=JSON.parse(launch.data);data.checkOutputRecovery.instruction='Changed after original capture';c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);}
 }return lease;};
 const result=await c.driveChange({workId,model,maximumSteps:1});assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),mode==='receipt'?/Selected check-output recovery source changed/:/Original check-output recovery assignment changed/);
 assert.equal(inputs.length,0,'No controlled model dispatch after drift');assert.equal(result.execution.reserved,0);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);
});

test('retained unamended check duty remains a recovery target outside the current declaration roster',async t=>{
 const {c,workId,receipt}=await world(t);const core=c.changeCore,check={...JSON.parse(receipt.data).check,id:'retained-old-check'};
 const pending=core.pending,amendments=core.currentAmendments,obligationId=randomUUID();let amended=false;
 t.after(()=>{core.pending=pending;core.currentAmendments=amendments;});
 // Seed only the historical duty. The current accepted plan and both execution receipts stay original.
 const candidate=core.row(workId).candidate;core.resumeDiagnostics(workId);
 const result=await core.operation({workId},'checks',()=>core.executeCheck(workId,check,{workId},candidate));
 assert.equal(result.status,'unavailable');
 core.pending=function(work){return [...pending.call(this,work),{id:obligationId,kind:'check',check,checkBinding:result.data.caseResults.checkBinding}];};
 core.currentAmendments=function(work){return [...amendments.call(this,work),...(amended?[{obligationId}]:[])];};
 assert.ok(core.requiredCandidateChecks(workId).some(item=>item.id===check.id));
 const recovery=core.checkOutputRecovery(workId);assert.ok(recovery.view.failures.some(item=>item.receiptId===result.id));
 amended=true;assert.ok(!core.requiredCandidateChecks(workId).some(item=>item.id===check.id));
 assert.ok(!core.checkOutputRecovery(workId).view.failures.some(item=>item.receiptId===result.id));
 assert.throws(recovery.assertCurrent,/Selected check-output recovery source changed/);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
});

test('mixed eligible and unknown selected attempts cannot advertise diagnostic authoring',async t=>{
 const {c,workId,receipt,inputs}=await world(t,'crash'),core=c.changeCore;
 const check={...JSON.parse(receipt.data).check,id:'retained-unknown-check'};
 core.resumeDiagnostics(workId);
 const second=await core.operation({workId},'checks',()=>core.executeCheck(workId,check,{workId},core.row(workId).candidate));
 assert.equal(second.status,'unavailable');
 const original=c.store.one('SELECT * FROM check_runs WHERE id=?',second.id),data=JSON.parse(original.data);
 data.argv=['unproved invocation'];c.store.run('UPDATE check_runs SET data=? WHERE id=?',JSON.stringify(data),second.id);
 const pending=core.pending;t.after(()=>{core.pending=pending;});
 core.pending=function(work){return [...pending.call(this,work),{id:'retained-unknown-duty',kind:'check',check,checkBinding:second.data.caseResults.checkBinding}];};
 c.store.run("UPDATE change_state SET phase='BLOCKED',data=json_set(data,'$.resumeStage','checks') WHERE work=?",workId);
 const before=c.store.one('SELECT * FROM change_state WHERE work=?',workId),recovery=core.checkOutputRecovery(workId);
 assert.equal(recovery.view,undefined);assert.match(recovery.hold,/cannot substantiate repair/);
 assert.throws(recovery.assertAvailable,/cannot substantiate repair/);
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'checks',roles:[]});
 assert.match(c.inspectChange(workId).nextAction,/No diagnostic authoring is admitted/);
 assert.doesNotMatch(c.inspectChange(workId).nextAction,/charged repair role/);
 assert.equal(c.inspectChangeResult(workId).checks.entries[0].unavailableReason,undefined);
 assert.deepEqual(c.store.one('SELECT * FROM change_state WHERE work=?',workId),before);
 assert.equal(inputs.length,0);assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),receipt);
 c.store.run("UPDATE change_state SET data=json_set(data,'$.resumeStage','repair') WHERE work=?",workId);
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'held',roles:[]});
});

for(const defect of ['missing-descriptor','wrong-binding','missing-run','inconsistent-status','argv','cwd','parsed','comparison','error','exit'])test('unproved current unavailable source refuses before a charged generic repair: '+defect,async t=>{
 const {c,workId,model,receipt,inputs}=await world(t,defect==='inconsistent-status'?'material':'literal');
 const data=JSON.parse(receipt.data);
 if(defect==='missing-descriptor')delete data.caseDescriptor;
 if(defect==='wrong-binding')data.target.digest='0'.repeat(64);
 if(defect==='argv')data.argv=['/bin/bash','-lc','different check'];
 if(defect==='cwd')data.cwd='/different';
 if(defect==='parsed')data.parsed.issues=['Changed original parser outcome'];
 if(defect==='comparison')data.caseResults.complete=true;
 if(defect==='error')data.error='Unresolved attempt error';
 if(defect==='exit')data.actual.exitCode='0';
 c.store.run('UPDATE check_runs SET status=?,data=? WHERE id=?','unavailable',JSON.stringify(data),receipt.id);
 if(defect==='missing-run'){const one=c.store.one;t.after(()=>{c.store.one=one;});c.store.one=function(query,...args){if(query==='SELECT * FROM runs WHERE id=? AND work=?'&&args[0]===receipt.run&&args[1]===workId)return undefined;return one.call(this,query,...args);};}
 const original=c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id);
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'held',roles:[]});
 assert.match(c.inspectChange(workId).nextAction,/No diagnostic authoring is admitted/);
 const before=c.inspectChange(workId).execution.consumed;
 const result=await c.driveChange({workId,model,maximumSteps:1});assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/Selected unavailable check source cannot substantiate repair/);
 assert.equal(inputs.length,0);assert.equal(result.execution.consumed,before);assert.equal(result.execution.reserved,0);
 assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='repairer'",workId).n,0);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',receipt.id),original,'Unavailable source remains exact for inspection');
});

function literalReviewModel(f,seen){
 return scripted(()=>({text:'unused'}),event=>{
  if(event.role==='repairer'&&event.turn===0&&event.body.context.checkOutputRecovery)writeFileSync(path.join(f.state.writable,'check.cjs'),'// controlled runtime-descriptor\n');
  if(event.role==='reviewer'){event.result.outcome='findings';event.result.findings=[{requirementId:'R1',severity:'blocking',repair:'substantive',description:'Controlled contrary allegation: consumer still exports2',evidence:['candidate:consumer.cjs']}];}
  if(event.role==='adjudicator'&&event.body.context.stage==='review-adjudication'&&event.turn===0){
   const context=event.body.context;seen.push(context);assert.equal(context.occurrences.length,1);
   const row=context.occurrences[0];assert.equal(typeof row.id,'string');assert.equal(row.subjectKey,'s0');assert.equal(row.data.finding.description,'Controlled contrary allegation: consumer still exports2');
   event.result.decisions=[{occurrenceId:row.id,disposition:'rejected',reason:'Current consumer exports3 and the bound actual controlled check observes3',witnesses:[context.checks[0].id]}];
  }
 });
}
for(const drift of ['body','identity-footprint','encoding'])test('literal review source drift during capacity refuses model dispatch: '+drift,async t=>{
 const f=await world(t),seen=[],host=c.changeCore.h,original=host.acquireCapacity;let changed=false;
 t.after(()=>{host.acquireCapacity=original;});
 host.acquireCapacity=async function(request){const lease=await original.call(this,request);
  if(request.workId===f.workId&&request.kind==='role'){
   const launch=c.store.one('SELECT * FROM role_launches WHERE run=?',request.runId),data=JSON.parse(launch.data);
   if(!changed&&data.stage==='review-adjudication'){
    changed=true;if(drift==='body')data.occurrences[0].data.finding.description+=' changed after original capture';
    if(drift==='identity-footprint')data.metadataIdentityHash='0'.repeat(64);
    if(drift==='encoding')data.metadataIdentityEncoding={version:3};
    c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);
   }
  }return lease;};
 const result=await c.driveChange({workId:f.workId,model:literalReviewModel(f,seen),maximumSteps:24});
 assert.equal(changed,true);assert.equal(result.phase,'BLOCKED');assert.match(result.blocked.join(),/subject action|metadata identity|literal subject|Subject action/);
 assert.equal(seen.length,0);assert.equal(result.execution.reserved,0);assert.equal(result.resolution.reserved,0);
 assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);
});

async function plannedCheckerWorld(t,createOn='implementer'){
 const source=path.join(root,randomUUID(),'source');await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');
 active={mode:'literal',scopes:[]};const state=active,inputs=[];
 t.after(()=>{if(t.passed===false)failures++;assert.ok(state.scopes.every(scope=>scope.closed));});
 const model=scripted(()=>({text:'unused'}),event=>{
  if(['implementer','repairer'].includes(event.role)&&event.turn===0){
   inputs.push({role:event.role,body:event.body});
   if(event.role===createOn)writeFileSync(path.join(state.writable,'check.cjs'),'// controlled runtime-descriptor\n');
  }
 });
 const projectId='P-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});
 const {workId}=await c.beginChange({projectId,request:'Consumer exports3; create the planned verification checker.',executionLimit:24,resolutionLimit:12});
 const planned=await c.planChange({workId,model});assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
 return{c,workId,source,model,inputs,state};
}
test('accepted new checker is authored before its check/review consumers require it',async t=>{
 const f=await plannedCheckerWorld(t),{c,workId,model}=f;
 const result=await c.driveChange({workId,model,maximumSteps:24});
 assert.equal(result.phase,'REVIEW_READY',JSON.stringify(result.blocked));assert.equal(f.inputs[0].role,'implementer');
 const input=f.inputs[0].body;assert.ok(input.context.acceptedPlan.verification.requiredPaths.includes('check.cjs'));
 assert.ok(!input.sources.some(s=>s.path==='check.cjs'));assert.ok(!input.requiredScope.some(s=>s.sourceId.endsWith(':check.cjs')));
 assert.equal(input.sourceDiscovery.count,1);
 assert.equal(await fs.readFile(path.join(f.source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
 await assert.rejects(fs.access(path.join(f.source,'check.cjs')),{code:'ENOENT'});
 const check=c.store.one('SELECT * FROM check_runs WHERE work=?',workId);assert.equal(check.status,'pass');assert.equal(JSON.parse(check.data).caseResults.complete,true);
 assert.equal(c.store.one("SELECT COUNT(*) AS n FROM role_launches WHERE work=? AND role='reviewer' AND status='COMPLETE'",workId).n,1);
});
test('missing new oracle retains frozen-target refusal and ordinary repair can create it',async t=>{
 const f=await plannedCheckerWorld(t,'repairer'),{c,workId,model}=f;
 assert.equal((await c.implementChange({workId,model})).phase,'CANDIDATE_CAPTURED');
 const scope=c.inspectChange(workId).execution;
 c.store.run("UPDATE budgets SET lim=consumed WHERE lineage=? AND kind='execution'",workId);
 try{assert.deepEqual(c.inspectChangeContinuationPrerequisites(workId),{stage:'checks',roles:[],allowanceHold:undefined});}
 finally{c.store.run("UPDATE budgets SET lim=? WHERE lineage=? AND kind='execution'",scope.limit,workId);}
 const before=c.inspectChange(workId).execution.consumed,checked=await c.checkChange({workId});
 assert.equal(checked.phase,'REPAIR_REQUIRED');assert.match(checked.blocked.join(),/expectation inputs are missing/);
 assert.equal(checked.execution.consumed,before,'Missing oracle allocates no physical check');
 assert.equal(c.store.one('SELECT COUNT(*) AS n FROM check_runs WHERE work=?',workId).n,0);
 const result=await c.driveChange({workId,model,maximumSteps:24});assert.equal(result.phase,'REVIEW_READY',JSON.stringify(result.blocked));
 assert.deepEqual(f.inputs.map(i=>i.role),['implementer','repairer']);
 assert.ok(f.inputs.every(i=>!i.body.sources.some(s=>s.path==='check.cjs')),'Missing future file never acquires invented source text');
 await assert.rejects(fs.access(path.join(f.source,'check.cjs')),{code:'ENOENT'});
});
test('actual consumer purposes and explicit role paths stay strict at an authoring checkpoint',async t=>{
 const {c,workId}=await plannedCheckerWorld(t);
 c.store.run("UPDATE change_state SET phase='REPAIR_REQUIRED' WHERE work=?",workId);
 for(const [role,stage]of[['reviewer','fresh-review'],['confirmer','exact-nit-confirmation'],['adjudicator','review-adjudication'],['implementer','fresh-review'],[undefined,'implementation']]){
  await assert.rejects(c.changeCore.bundle(workId,{stage},role),/Required text source unavailable: check.cjs/);
 }
 await assert.rejects(c.changeCore.bundle(workId,{stage:'implementation',requiredPaths:['check.cjs']},'implementer'),/Required text source unavailable: check.cjs/);
});
for(const defect of ['missing','binary','changed','oversized'])test('declared captured source cannot become a future output: '+defect,async t=>{
 const {c,workId}=await plannedCheckerWorld(t),base=c.changeCore.version(c.changeCore.row(workId).base);
 const file=path.join(base.artifact,'consumer.cjs');
 if(defect==='missing')await fs.unlink(file);
 else await fs.writeFile(file,defect==='binary'?Buffer.from([0]):defect==='changed'?'changed immutable content':'x'.repeat(1024*1024+1));
 await assert.rejects(c.changeCore.bundle(workId,{stage:'implementation'},'implementer'),defect==='missing'?/ENOENT/:defect==='binary'?/binary review source/:defect==='changed'?/version artifact changed/:/source text exceeds1MiB/);
});
// An explicit new drive must reach an existing repair duty; the prior drive
// still stops when its repair repeats the exact same failed manifest.
for(const drift of ['preparation','capacity'])test('explicit same-work scope recovery reaches repair after held owner explanation: '+drift,async t=>{
 const source=path.join(root,randomUUID());await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),'// controlled runtime-descriptor\n');
 const state=active={mode:'scope-repeat',scopes:[]},requests=[];let correct=false;
 t.after(()=>{if(t.passed===false)failures++;assert.ok(state.scopes.every(scope=>scope.closed));});
 const model=scripted(()=>assert.fail('No ordinary model request'),event=>{
  const {role,body,result,turn}=event;if(turn===0)requests.push(body.context.stage);
  if(role==='planner'){
   result.plan.requirements.push({id:'scope',text:'Only consumer.cjs may change; preserve the original checker',source:body.context.ownerSource});
   result.plan.verification.strategies=[{requirementId:'R1',kind:'consumer-cases',checkIds:['value']},{requirementId:'scope',kind:'manifest-scope-duty',allowedChangePaths:['consumer.cjs'],unchangedPaths:['check.cjs'],reviewKey:'general'}];
  }
  if(body.context.stage==='source-fit')for(const decision of result.inputDecisions)decision.requirementIds=['R1','scope'];
  if(role==='implementer'&&turn===0)writeFileSync(path.join(state.writable,'outside.cjs'),'// outside the independently accepted scope\n');
  if(role==='repairer'&&turn===0&&correct)unlinkSync(path.join(state.writable,'outside.cjs'));
 });
 // Explicit larger controlled context for retained P/C/J + two author histories; no live model qualification.
 model.definition.models[0].contextWindow=200000;
 const projectId='scope-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Consumer exports3; only consumer.cjs changes and the original checker stays unchanged',executionLimit:24,resolutionLimit:12});
 const stopped=await c.driveChange({workId,model});assert.equal(stopped.phase,'BLOCKED',JSON.stringify(stopped.blocked));assert.match(stopped.blocked.join(),/Unchanged candidate repeats/);assert.equal(requests.filter(s=>s==='substantive-repair').length,1,'One ineffective automatic repair stops the original drive');
 const oldCandidate=stopped.candidateVersion,oldScope=c.store.all("SELECT * FROM change_versions WHERE work=? AND kind='scope-evidence' ORDER BY rowid",workId),before=c.inspectChange(workId),births=requests.length;
 const original=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='repairer' ORDER BY rowid DESC LIMIT 1",workId),conversation=c.listConversations().find(view=>view.workId===workId&&JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',view.conversationId).data).runId===original.run);assert.ok(conversation);
 const queued=await c.queueConversationInputWithContext({conversationId:conversation.conversationId,expectedGeneration:conversation.generation,text:'Keep the accepted scope. Correct the retained outside-file violation before checking again.',mode:'idle'}),input=c.inspectConversationInputs(conversation.conversationId).find(row=>row.inputId===queued.inputId);assert.equal(input.withdrawEligible,true);c.recoverConversationInput({conversationId:conversation.conversationId,inputId:input.inputId,expectedContext:input.fingerprint,action:'withdraw'});
 assert.deepEqual(c.inspectChangeModelPrerequisites(workId),{stage:'source-fit',roles:['adjudicator']});correct=true;
 // A selected scope duty changing across pre-author preparation cannot spend a repair launch.
 const core=c.changeCore,prepare=core.beforeAuthorVerification,obligation=c.store.one("SELECT * FROM obligations WHERE work=? AND json_extract(data,'$.kind')='verification-scope' AND json_extract(data,'$.state')='pending'",workId);assert.ok(obligation);
 if(drift==='capacity'){
  const host=core.h,acquire=host.acquireCapacity;let changed=false;
  host.acquireCapacity=async function(request){const lease=await acquire.call(this,request),launch=c.store.one('SELECT role FROM role_launches WHERE run=?',request.runId);if(!changed&&request.workId===workId&&launch?.role==='repairer'){changed=true;c.store.run("UPDATE obligations SET data=json_set(data,'$.state','resolved') WHERE id=?",obligation.id);}return lease;};
  try{const refused=await c.driveChange({workId,model,maximumSteps:1});assert.equal(refused.phase,'BLOCKED');assert.match(refused.blocked.join(),/Original failed scope changed before repair admission/);assert.equal(changed,true);assert.deepEqual(requests.slice(births),['source-fit'],'No repair model dispatch after capacity wait drift');assert.equal(refused.execution.reserved,0);assert.equal(c.store.one("SELECT count(*) n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n,0);}finally{host.acquireCapacity=acquire;c.store.run('UPDATE obligations SET data=? WHERE id=?',obligation.data,obligation.id);}
  return;
 }
 core.beforeAuthorVerification=async function(...args){const assertOriginal=await prepare.apply(this,args);c.store.run("UPDATE obligations SET data=json_set(data,'$.state','resolved') WHERE id=?",obligation.id);return assertOriginal;};
 const launchCount=c.store.one('SELECT count(*) n FROM role_launches WHERE work=?',workId).n;
 try{const refused=await c.driveChange({workId,model,maximumSteps:1});assert.equal(refused.phase,'BLOCKED');assert.match(refused.blocked.join(),/Original failed scope changed before repair admission/);assert.deepEqual(requests.slice(births),['source-fit']);assert.equal(c.store.one('SELECT count(*) n FROM role_launches WHERE work=?',workId).n,launchCount+1,'Only source-fit was admitted; no stale repairer launch');}finally{core.beforeAuthorVerification=prepare;c.store.run('UPDATE obligations SET data=? WHERE id=?',obligation.data,obligation.id);}
 const recovered=await c.driveChange({workId,model,maximumSteps:1});assert.equal(recovered.phase,'CANDIDATE_CAPTURED',JSON.stringify(recovered.blocked));assert.deepEqual(requests.slice(births),['source-fit','substantive-repair']);assert.notEqual(recovered.candidateVersion,oldCandidate);
 for(const row of oldScope)assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',row.id),row,'Original failed scope evidence stays immutable');assert.equal(recovered.execution.limit,before.execution.limit);assert.equal(recovered.execution.consumed,before.execution.consumed+2);assert.equal(recovered.resolution.limit,before.resolution.limit);assert.equal(recovered.resolution.consumed,before.resolution.consumed+1);assert.equal(c.inspectChange(workId).reviewReady,false);
 const checked=await c.checkChange({workId});assert.equal(checked.phase,'CHECKED',JSON.stringify(checked.blocked));assert.equal(checked.checks.at(-1).status,'pass');assert.equal(checked.reviewReady,false,'A repaired scope and controlled check do not replace independent review');assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.deepEqual(await fs.readdir(source),['check.cjs','consumer.cjs']);
});

for(const capped of ['implementer','source-fit'])test('owned role request limit reaches canonical coordinator and EN/KO owner consumers: '+capped,async t=>{
 const source=path.join(root,randomUUID());await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');await fs.writeFile(path.join(source,'check.cjs'),'// controlled runtime-descriptor\n');
 const state=active={mode:'local-cap',scopes:[]};let calls=0;const model=scripted(()=>assert.fail('No ordinary dispatch')),original=model.definition.streamSimple;
 model.definition.streamSimple=(selected,context,options)=>{
  const first=context.messages.find(m=>m.role==='user'),text=first.content.filter(p=>p.type==='text').map(p=>p.text).join('');
  const role=text.match(/^Perform the assigned (\w+) task/)?.[1],stage=role?JSON.parse(text.split('\n')[1]).context.stage:undefined;
  if(capped==='implementer'?role!=='implementer':stage!=='source-fit')return original(selected,context,options);
  calls++;const message={role:'assistant',content:[{type:'toolCall',id:'cap-write-'+calls,name:capped==='implementer'?'write':'read',arguments:capped==='implementer'?{path:'consumer.cjs',content:'module.exports=3;\n'}:{path:'consumer.cjs'}}],api:selected.api,provider:selected.provider,model:selected.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:Date.now()},stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message);});return stream;
 };
 t.after(()=>{if(t.passed===false)failures++;assert.ok(state.scopes.every(scope=>scope.closed));});
 const projectId='cap-'+randomUUID();await c.registerProject({id:projectId,sourceRoot:source});const {workId}=await c.beginChange({projectId,request:'Consumer exports3',executionLimit:24,resolutionLimit:12});assert.equal((await c.planChange({workId,model})).phase,'PLAN_READY');
 model.definition.models[0].contextWindow=200000;
 if(capped==='source-fit'){
  const planning=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",workId),target=c.listConversations().find(v=>v.workId===workId&&JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',v.conversationId).data).runId===planning.run);assert.ok(target);
  const queued=await c.queueConversationInputWithContext({conversationId:target.conversationId,expectedGeneration:target.generation,text:'Keep the accepted consumer exports3 requirement.',mode:'idle'}),input=c.inspectConversationInputs(target.conversationId).find(x=>x.inputId===queued.inputId);assert.equal(input.withdrawEligible,true);c.recoverConversationInput({conversationId:target.conversationId,inputId:input.inputId,expectedContext:input.fingerprint,action:'withdraw'});
 }
 const failed=capped==='implementer'?await c.implementChange({workId,model}):await c.driveChange({workId,model,maximumSteps:1});assert.equal(failed.phase,'BLOCKED');assert.equal(calls,16,'Exactly16 original requests; next provider request is never born');
 const launch=c.store.one("SELECT * FROM role_launches WHERE work=? ORDER BY rowid DESC LIMIT 1",workId),output=c.store.one("SELECT * FROM role_outputs WHERE launch=? AND status='unusable' ORDER BY rowid DESC LIMIT 1",launch.id),fact={version:1,kind:'role-request-limit',used:16,limit:16},expected={role:capped==='implementer'?'implementer':'adjudicator',launchId:launch.id,requestLimit:fact};assert.deepEqual(JSON.parse(output.data).requestLimit,fact);assert.equal(JSON.parse(output.data).providerRequests,16);assert.equal(failed.candidateVersion,null);assert.deepEqual(failed.roleRequestLimit,expected);assert.equal(failed.providerFailure,undefined);assert.equal(failed.modelContextFailure,undefined);assert.match(failed.nextAction,/gitjig's local model-request limit/);
 const result=c.inspectChangeResult(workId),activity=c.inspectChangeActivity(workId);assert.deepEqual(result.roleRequestLimit,expected);assert.deepEqual(activity.recordedRoleRequestLimit,expected);
 const compact=await prepareGovernedResult(home,{...failed,recordedResult:result},()=>{});assert.deepEqual(compact.recordedResult.roleRequestLimit,expected);assert.ok(Buffer.byteLength(JSON.stringify(compact))<=8192);assert.equal(compact.reviewReady,false);
 const view=c.listConversations().find(v=>v.workId===workId&&JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',v.conversationId).data).runId===launch.run);assert.ok(view);const ledger=()=>JSON.stringify({runs:c.store.all('SELECT * FROM runs WHERE work=?',workId),outputs:c.store.all('SELECT * FROM role_outputs WHERE launch=?',launch.id),budgets:c.store.all('SELECT * FROM budgets'),obligations:c.store.all('SELECT * FROM obligations WHERE work=?',workId)}),before=ledger();
 for(const locale of ['en','ko']){
  const text=changeResultText(result,locale),summary=taskPresentation({view,roster:[view],changeActivity:activity,locale});assert.match(text,locale==='en'?/gitjig admitted 16 of 16/:/이 역할에 허용한 모델 요청 16회 중 16회/);assert.match(summary.idleStatus,/16\/16/);assert.equal(managedChangeCompletionNotice(failed,c.inspectChange(workId),activity,view,locale),summary.idleStatus);
  assert.doesNotMatch(taskPresentation({view:{...view,state:'UNKNOWN'},roster:[],changeActivity:activity,locale}).navigatorSummary,/16\/16/);assert.doesNotMatch(taskPresentation({view,roster:[],changeActivity:{...activity,state:'CANCELLED'},locale}).navigatorSummary,/16\/16/);
 }
 assert.equal(ledger(),before);assert.equal(calls,16);assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
 const variants=[md=>{delete md.requestLimit;},md=>{md.requestLimit={limit:16};},md=>{md.requestLimit={...fact,used:15};},md=>{md.requestLimit={...fact,extra:true};},md=>{md.providerRequests=15;},md=>{md.terminal='aborted';}];
 for(const mutate of variants){const md=JSON.parse(output.data);mutate(md);c.store.run('UPDATE role_outputs SET data=? WHERE id=?',JSON.stringify(md),output.id);try{assert.equal(c.inspectChangeResult(workId).roleRequestLimit,undefined);assert.equal(c.inspectChangeActivity(workId).recordedRoleRequestLimit,undefined);}finally{c.store.run('UPDATE role_outputs SET data=? WHERE id=?',output.data,output.id);}}
 const ld=JSON.parse(launch.data);ld.bounds.maxProviderRequests=15;c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(ld),launch.id);try{assert.equal(c.inspectChangeResult(workId).roleRequestLimit,undefined);}finally{c.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);}
 assert.equal(ledger(),before);assert.equal(calls,16);cappedWorkReceipts.push({workId,expected});
});

for (const authorFinding of [false,true]) test(authorFinding ? 'an unchanged repair with new findings retains its own produced candidate' :
 'optional upheld observations can close after an unchanged repair preserves exact verification', async t => {
 const {c,workId,model}=await world(t);
 const captured=await c.driveChange({workId,model,maximumSteps:1});
 assert.equal(captured.phase,'CANDIDATE_CAPTURED');
 const checked=await c.checkChange({workId});
 const currentCheck=checked.checks.at(-1).id;
 const reviewer=scripted(undefined,({result})=>{
  result.outcome='findings';
  result.findings=[{requirementId:'R1',severity:'optional',repair:'unknown',description:'The previous failure described an earlier checker.',evidence:['candidate:check.cjs']}];
 });
 const reviewed=await c.reviewChange({workId,model:reviewer});
 const finding=reviewed.occurrences.find(row=>row.data.finding.description.includes('earlier checker'));
 assert.ok(finding);
 const judge=pending=>scripted(undefined,({body,result})=>{
  assert.equal(body.context.reviewResolutionInput.version,4);
  result.decisions=[{occurrenceId:finding.id,disposition:'upheld',reason:'The observation about the earlier checker is accurate.',
   witnesses:[currentCheck],...(pending?{resolution:'pending'}:{})}];
 });
 const pending=await c.resolveChange({workId,model:judge(true)});
 assert.equal(pending.phase,'REPAIR_REQUIRED',JSON.stringify(pending.blocked));
 const repairer=authorFinding?scripted(undefined,({role,result})=>{
  assert.equal(role,'repairer');
  result.findings=[{requirementId:'R1',severity:'optional',repair:'unknown',description:'A new author observation must remain accountable.',evidence:['candidate:check.cjs']}];
 }):model;
 const noChange=await c.driveChange({workId,model:repairer,maximumSteps:1});
 if(authorFinding){
  assert.equal(noChange.phase,'CANDIDATE_CAPTURED',JSON.stringify(noChange.blocked));
  assert.notEqual(noChange.candidateVersion,captured.candidateVersion);
  assert.ok(noChange.occurrences.some(row=>row.data.finding.description.includes('remain accountable')));
  assert.equal(noChange.reviewReady,false);
  return;
 }
 assert.equal(noChange.phase,'BLOCKED');
 assert.match(noChange.blocked.join(),/candidate unchanged/);
 assert.equal(noChange.candidateVersion,captured.candidateVersion);
 assert.equal(noChange.checks.length,checked.checks.length);
 assert.equal(noChange.launches.filter(launch=>launch.role==='reviewer').length,1);
 const ready=await c.resolveChange({workId,model:judge(false)});
 assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));
 assert.equal(ready.candidateVersion,captured.candidateVersion);
 const disposition=ready.dispositions.filter(row=>row.occurrence===finding.id).at(-1);
 assert.equal(disposition.data.resolution,undefined);
 assert.equal(c.inspectChange(workId).reviewReady,true);
});

test('crashed report recovery delivers literal keyed review and completes current adjudication',async t=>{
 const f=await world(t,'crash'),seen=[],scriptedModel=literalReviewModel(f,seen);
 const result=await c.driveChange({workId:f.workId,model:scriptedModel,maximumSteps:24});
 assert.equal(result.phase,'REVIEW_READY',JSON.stringify(result.blocked));assert.equal(seen.length,1);
 assert.equal(seen[0].subjectActionsInput.version,2);assert.equal(seen[0].subjectActionsProfile.version,2);
 assert.equal(Object.hasOwn(seen[0],'metadataIdentityInput'),false);assert.equal(Object.hasOwn(seen[0],'metadataIdentityEncoding'),false);
 assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?',f.receipt.id),f.receipt);
 const launch=c.store.one("SELECT * FROM role_launches WHERE work=? AND role='adjudicator' ORDER BY rowid DESC LIMIT 1",f.workId);
 assert.equal(launch.status,'COMPLETE');const output=c.store.one("SELECT id FROM role_outputs WHERE launch=? AND status='usable'",launch.id).id;
 await c.close();const reopened=await openController({installationHome:home,maxProviderRequests:16,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)}});t.after(()=>reopened.close());
 for(const receipt of cappedWorkReceipts){assert.deepEqual(reopened.inspectChangeResult(receipt.workId).roleRequestLimit,receipt.expected,'Typed own failure survives cold reopening without reclassification from prose');assert.deepEqual(reopened.inspectChangeActivity(receipt.workId).recordedRoleRequestLimit,receipt.expected);}
 const proof=await reopened.changeCore.historicalPlanningProducer(f.workId,output);
 assert.ok(proof,'Fresh Controller reads the original actual controlled SDK source under its literal capture');
 const data=JSON.parse(launch.data);reopened.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify({...data,metadataIdentityHash:'0'.repeat(64)}),launch.id);
 await assert.rejects(reopened.changeCore.historicalPlanningProducer(f.workId,output),/literal subject metadata|HISTORICAL/);
 reopened.store.run('UPDATE role_launches SET data=? WHERE id=?',launch.data,launch.id);
});
