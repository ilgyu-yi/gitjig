import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recordedResultSummary} from '../../dist/controller/change-result.js';
import {prepareGovernedResult,readGovernedDetail} from '../../dist/controller/governed-result.js';

const reading=()=>({workId:'W',projectId:'P',state:'DELIVERED',recordedPhase:'REVIEW_READY',reviewReady:true,
    request:'Do not duplicate the request in the compact handoff',registeredSourceRoot:'/original',
    candidate:{versionId:'candidate',hash:'a'.repeat(64),path:'/private/recorded-candidate'},
    changes:{availability:'recorded',total:1,omitted:0,entries:[{path:'consumer.cjs',kind:'modified'}]},
    checks:{availability:'recorded',total:1,omitted:0,entries:[{checkId:'behavior',receiptId:'receipt',runId:'check-run',status:'pass',passed:true,cleanup:'removed',durationMs:1}]},
    reviews:{availability:'recorded',total:1,omitted:0,entries:[{key:'review',launchId:'launch',runId:'review-run',state:'selected',outcome:'clear',findingCount:0,outputId:'output'}]},
    blocked:[],blockedOmitted:0,nextAction:'local review-ready only',limitations:[],
    provenance:{baseVersion:'base',candidateVersion:'candidate',planVersion:'plan',verificationVersion:'verification'}});

test('primary recorded facts and inspection route preserve check and review distinctions',()=>{
    const value=reading();value.checks={availability:'recorded',total:6,omitted:2,entries:[
        {checkId:'unsupported-pass',status:'pass',passed:false},
        {checkId:'baseline',status:'baseline-observed',passed:false,target:'base',purpose:'baseline',observed:true},
        {checkId:'failed',status:'fail',passed:false},
        {checkId:'candidate',status:'pass',passed:true}]};
    value.reviews.entries=[{key:'carried',state:'carried',outcome:'clear'},{key:'old',state:'stale',outcome:'unavailable'}];
    value.checks.entries[3].observedCounts={assertions:2,cases:0};
    const before=JSON.stringify(value),result=recordedResultSummary(value);
    assert.deepEqual(result.checks.entries.map(e=>e.status),['unavailable','baseline-observed','fail','pass']);
    assert.equal(result.checks.total,6);assert.equal(result.checks.omitted,2);
    assert.deepEqual(result.checks.entries[3].observedCounts,{assertions:2,cases:0});
    assert.equal(result.checks.entries[0].observedCounts,undefined);
    assert.equal(result.reviews.entries[0].state,'carried');assert.equal(result.reviews.entries[1].state,'stale');
    assert.equal(result.inspection.command,'/work W');assert.equal(result.inspection.readOnly,true);
    assert.equal(result.request,undefined);assert.equal(result.registeredSourceRoot,undefined);assert.equal(result.checks.caseCount,undefined);
    assert.equal(JSON.stringify(value),before,'Projection does not mutate the recorded reading');
});

test('unavailable, no-candidate and not-planned evidence never becomes successful empty evidence',()=>{
    const value=reading();value.candidate=null;value.reviewReady=false;value.changes={availability:'no-candidate',entries:[],total:null,omitted:0};
    value.checks={availability:'unavailable',entries:[],total:null,omitted:0};value.reviews={availability:'not-planned',entries:[],total:null,omitted:0};
    value.blocked=['Inspect original missing evidence'];const result=recordedResultSummary(value);
    assert.equal(result.reviewReady,false);assert.equal(result.candidate,null);assert.equal(result.changes.availability,'no-candidate');
    assert.equal(result.checks.availability,'unavailable');assert.equal(result.checks.total,null);
    assert.equal(result.reviews.availability,'not-planned');assert.equal(result.blocked[0],value.blocked[0]);
    const wire=JSON.stringify(result);assert.ok(wire.indexOf('"blocked"')<wire.indexOf('"candidate"'));
    assert.ok(wire.indexOf('"inspection"')<wire.indexOf('"candidate"'),'C9 inspection and blockers precede saved locations');
});

test('recorded production survives compact publication and exact detail without manufacturing a verdict', async t=>{
    const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-check-production-')));
    t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'artifacts'),{mode:0o700});
    const recordedResult=reading();recordedResult.reviewReady=false;
    const check=recordedResult.checks.entries[0];
    Object.assign(check,{status:'unavailable',passed:false,production:{exitCode:1,termination:null,report:'rejected'}});
    const original=JSON.stringify(recordedResult),summary=recordedResultSummary(recordedResult);
    assert.deepEqual(summary.checks.entries[0],check);assert.equal(summary.reviewReady,false);
    assert.ok(Buffer.byteLength(JSON.stringify(summary))<=4096);
    const value={workId:'W',epoch:1,phase:'BLOCKED',reviewReady:false,recordedResult};
    const compact=await prepareGovernedResult(home,value,()=>{});
    assert.deepEqual(compact.recordedResult.checks.entries[0],check);
    assert.deepEqual(JSON.parse((await readGovernedDetail(home,compact.detailRef)).toString()),value);
    assert.equal(JSON.stringify(recordedResult),original);
    delete recordedResult.checks.entries[0].production;
    assert.equal(Object.hasOwn(recordedResultSummary(recordedResult).checks.entries[0],'production'),false,'Old reading is not enriched');
});

test('bounded handoff omits whole paths and entries, adds omissions and retains blockers and navigation',()=>{
    const value=reading();value.candidate.path='/'+'한'.repeat(2700);value.nextAction='Long detailed action '.repeat(1000);
    value.changes={availability:'recorded',total:15,omitted:3,entries:Array.from({length:12},(_,i)=>({path:'path'+i+'/'+'x'.repeat(8000),kind:'modified'}))};
    value.blocked=['Original known blocker'];const result=recordedResultSummary(value);
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=4096);assert.equal(result.candidate.path,null);assert.equal(result.candidateLocationOmitted,true);
    assert.equal(result.changes.total,15);assert.equal(result.changes.omitted,15-result.changes.entries.length);
    assert.ok(result.changes.entries.every(e=>value.changes.entries.some(original=>original.path===e.path)));
    assert.deepEqual(result.blocked,['Original known blocker']);assert.equal(result.nextAction,null);assert.equal(result.nextActionOmitted,true);
    assert.equal(result.inspection.command,'/work W');
});

test('a blocked result projects only the authenticated provider reset fact within its existing bound', () => {
    const result = reading();
    Object.assign(result, {state:'ACTIVE',recordedPhase:'BLOCKED',reviewReady:false});
    const quota = {version:1,kind:'usage-limit',ownerSessionId:'owner',nativeSessionId:'native',queryId:'query',
        intentEntryId:'intent',eventEntryId:'event-entry',eventId:'event',resetsAt:1794020400};
    result.providerFailure = {role:'adjudicator',launchId:'launch',usageLimit:quota};
    const compact = recordedResultSummary(result);
    assert.equal(compact.providerUsageLimitReset, quota.resetsAt);
    assert.equal(compact.providerFailure, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 4096);
    delete result.providerFailure;
    result.planningFailure = {role:'adjudicator',launchId:'launch',providerFailure:quota};
    assert.equal(recordedResultSummary(result).providerUsageLimitReset, quota.resetsAt);
    delete quota.resetsAt;
    assert.equal(recordedResultSummary(result).providerUsageLimitReset, null);
    assert.equal(recordedResultSummary({...result,state:'UNKNOWN'}).providerUsageLimitReset, undefined);
    quota.ownerSessionId = 'unverifiable';
    quota.resetsAt = '1794020400';
    assert.equal(recordedResultSummary(result).providerUsageLimitReset, undefined);
});

test('existing immutable detail retains full reading while compact stays bounded; old absence stays absent',async t=>{
    const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-recorded-reading-')));
    t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'artifacts'),{mode:0o700});
    const recordedResult=reading();recordedResult.candidate.path='/'+'x'.repeat(8191);recordedResult.pendingFindings=2;
    recordedResult.planningClarification={outputId:'original-judge-output',questions:{entries:['Choose the expected result.'],total:1,omitted:0}};
    const value={workId:'W',epoch:1,phase:'REVIEW_READY',reviewReady:true,recordedResult};const frozen=JSON.stringify(value);
    const pending=prepareGovernedResult(home,value,()=>{});recordedResult.candidate.path='/later-location';delete recordedResult.pendingFindings;delete recordedResult.planningClarification;
    const compact=await pending;assert.ok(Buffer.byteLength(JSON.stringify(compact))<=8192);
    assert.equal(compact.recordedResult.candidate.path,null);assert.equal((await readGovernedDetail(home,compact.detailRef)).toString(),frozen);
    assert.equal(compact.recordedResult.pendingFindings,2);
    assert.deepEqual(compact.recordedResult.planningClarification,{outputId:'original-judge-output',questionCount:1});
    assert.equal(recordedResultSummary(recordedResult).pendingFindings,undefined);
    assert.equal(recordedResultSummary(recordedResult).planningClarification,undefined);
    const legacy=await prepareGovernedResult(home,{workId:'W',epoch:1,phase:'BLOCKED',reviewReady:false},()=>{});
    assert.equal(Object.hasOwn(legacy,'recordedResult'),false);
});
