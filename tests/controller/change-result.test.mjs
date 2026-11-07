// Original controller reads with explicit synthetic check/review records. No model/engine qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {registryWorld, workLedger} from './change-registry-fixture.mjs';
import {seedPlanningFailure,seedPlanningQuota,seedNormalQuota,normalQuotaStages} from './planning-failure-fixture.mjs';
import {freeze, delta, hash} from '../../dist/controller/change-files.js';
import {caseDescriptor, compareCases} from '../../dist/controller/check-cases.js';
import {openController} from '../../dist/controller/index.js';

const parse = value => JSON.parse(value);
const ledger = c => ({...workLedger(c), checks:c.store.all('SELECT * FROM check_runs'),
    launches:c.store.all('SELECT * FROM role_launches'), outputs:c.store.all('SELECT * FROM role_outputs')});
async function cancelAndResume(f) {
    const original = ledger(f.c), work = f.c.store.one('SELECT * FROM works WHERE id=?', f.workId);
    await f.c.cancelWork({workId:f.workId, expectedEpoch:work.epoch});
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, false);
    const resumed = await f.c.driveChange({workId:f.workId, maximumSteps:1,
        model:{provider:'unused-fixture',modelId:'must-not-dispatch'}});
    assert.equal(resumed.reviewReady, true, JSON.stringify(resumed));
    const current = f.c.store.one('SELECT * FROM works WHERE id=?', f.workId), after = ledger(f.c);
    assert.equal(current.epoch, work.epoch+2);
    assert.equal(current.generation, work.generation+1);
    for (const key of ['runs','budgets','checks','launches','outputs','change_versions'])
        assert.deepEqual(after[key], original[key], 'Original recovery preserves '+key);
    return {original, current};
}
async function fixture(t) {
    const f = await registryWorld(t, 'change-result-'), workId = f.works[0].workId;
    const selected = f.c.store.one('SELECT * FROM change_state WHERE work=?', workId);
    const base = f.c.store.one('SELECT * FROM change_versions WHERE id=?', selected.base);
    const working = path.join(f.root, 'candidate-source'), artifact = path.join(f.home, 'inputs', 'result-candidate');
    await fs.cp(base.artifact, working, {recursive:true});
    await fs.writeFile(path.join(working, 'file.txt'), 'Changed candidate\n');
    await fs.writeFile(path.join(working, 'added.txt'), 'New output\n');
    const frozen = await freeze(working, artifact, {}), candidate = 'result-candidate';
    const candidateData = {manifest:frozen.manifest, delta:delta(parse(base.data).manifest, frozen.manifest), producer:'synthetic-fixture-author'};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', candidate, workId, 'candidate', base.id, artifact, frozen.digest, JSON.stringify(candidateData));
    const check = {id:'behavior', command:'synthetic-not-executed', assertions:['value'], timeoutMs:1000,
        guaranteeIds:['R'], fixturePaths:['file.txt'], cases:['healthy','adverse'].map(kind=>({id:kind, kind,
            guaranteeIds:['R'], derivation:'Controlled required case', consumerPaths:['file.txt'],
            input:{literalUtf8:kind, fixturePaths:['file.txt']}, expected:{kind:'return', value:'Expected observation'}}))};
    const verification = {checks:[check], requiredPaths:['file.txt'], reviewRoles:[{key:'behavior-review', kind:'reviewer', purpose:'Behavior review', requiredPaths:['file.txt']}]};
    const plan = {requirements:[{id:'R', text:'Retain correct changed output'}], verification};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-plan', workId, 'plan', null, null, hash(plan), JSON.stringify({plan}));
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-verification', workId, 'verification', null, null, hash(verification), JSON.stringify({verification}));
    const data = {...parse(selected.data), selection:{}, blocked:[], nextAction:'Run the required checks'};
    f.c.store.run('UPDATE change_state SET candidate=?,plan=?,verification=?,phase=?,data=? WHERE work=?', candidate, 'result-plan', 'result-verification', 'CANDIDATE_CAPTURED', JSON.stringify(data), workId);
    const work = f.c.store.one('SELECT * FROM works WHERE id=?', workId);
    const tuple = {base:base.id, candidate, plan:'result-plan', verification:'result-verification', contracts:data.contractsVersion, requirements:data.requirementVersion??null};
    function receipt(id, status, declaration=check, overrides={}) {
        const run = f.c.store.one('SELECT id FROM runs WHERE work=?', workId).id;
        const descriptor = caseDescriptor(declaration, {hash:frozen.digest, data:{manifest:frozen.manifest}}, tuple, run);
        const output = {version:1, assertions:[{id:'value', passed:status==='pass'}], cases:descriptor.cases.map(c=>({id:c.id, inputDigest:c.inputDigest, observed:c.declaration.expected}))};
        const record = {check:declaration, caseDescriptor:descriptor, caseResults:compareCases(declaration, descriptor, output), parsed:{value:output}, cleanup:'removed', durationMs:12, boundVersions:tuple, ...overrides};
        f.c.store.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)', id, workId, run, candidate, tuple.verification, declaration.id, status, JSON.stringify(record));
    }
    function review(id='selected-review', overrides={}) {
        const runId = id+'-run', historyRef = path.join(f.home, 'state', id+'.jsonl');
        f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, workId, work.epoch, work.generation, 'SETTLED', 'retained-not-read', 'consumed', JSON.stringify({cleanup:'removed', historyRef, nativeSessionId:id, nativeCheckpoint:{sessionId:id, leafId:id+'-entry', bytes:1, sha256:'a'.repeat(64)}}));
        const launchData = {inputVersions:tuple, stage:'fresh-review', reviewKey:'behavior-review', purpose:verification.reviewRoles[0].purpose, requiredPaths:verification.reviewRoles[0].requiredPaths, cleanup:'removed', historyRef, nativeSessionId:id, ...overrides};
        f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', id, workId, runId, 'reviewer', work.epoch, 'COMPLETE', 'none', JSON.stringify(launchData));
        const protocol = {version:1, summary:'Retained synthetic reviewer judgment', findings:[], assessedScope:[{sourceId:'candidate:file.txt', startLine:1, endLine:2}], outcome:'clear'};
        const metadata = {protocol, terminal:'complete', rawFinalTruncated:false, omittedFindingCount:0, issues:[], historyRef, nativeEntryId:id+'-entry'};
        f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', id+'-output', id, JSON.stringify(protocol), 'usable', JSON.stringify(metadata));
        f.c.store.run("UPDATE change_state SET data=json_set(data,'$.selection',json(?)) WHERE work=?", JSON.stringify({'behavior-review':id}), workId);
        return {runId, metadata, protocol};
    }
    function markReady() {
        f.c.store.run('UPDATE works SET state=? WHERE id=?', 'DELIVERED', workId);
        f.c.store.run("UPDATE change_state SET phase=?,data=json_set(data,'$.nextAction',?) WHERE work=?", 'REVIEW_READY', 'local review-ready only', workId);
        assert.equal(f.c.inspectChange(workId).reviewReady, true, 'Controlled retained premise must satisfy the existing assessment');
    }
    return {...f, workId, base, candidate, artifact, candidateData, check, verification, plan, tuple, receipt, review, markReady};
}

for (const recordedPhase of ['PLANNING', 'BLOCKED', 'REVIEW_READY']) test(`UNKNOWN change inspection holds recorded ${recordedPhase} without rewriting original work`, async t => {
    const f = await registryWorld(t, 'change-unknown-inspection-'), workId = f.works[0].workId;
    const state = f.c.store.one('SELECT * FROM change_state WHERE work=?', workId);
    const oldBlockers = Array.from({length: 18}, (_, i) => `Retained original blocker ${i}`);
    const data = {...parse(state.data), blocked: oldBlockers, nextAction: 'planChange'};
    f.c.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', workId);
    f.c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?', recordedPhase, JSON.stringify(data), workId);
    const before = ledger(f.c), view = f.c.inspectChange(workId), result = f.c.inspectChangeResult(workId);
    assert.equal(view.state, 'UNKNOWN'); assert.equal(view.recordedPhase, recordedPhase); assert.equal(view.phase, 'BLOCKED');
    assert.equal(view.reviewReady, false); assert.match(view.blocked[0], /cleanup is unconfirmed/);
    assert.deepEqual(view.blocked.slice(1), oldBlockers);
    assert.match(view.nextAction, new RegExp('/work ' + workId));
    assert.doesNotMatch(view.nextAction, /planChange|change resume|Extend shared/);
    assert.equal(result.recordedPhase, recordedPhase); assert.equal(result.state, 'UNKNOWN'); assert.equal(result.reviewReady, false);
    assert.equal(result.blocked[0], view.blocked[0]); assert.equal(result.blockedOmitted, 3); assert.equal(result.nextAction, view.nextAction);
    assert.deepEqual(ledger(f.c), before);
    const held = await f.c.driveChange({workId, maximumSteps: 1, model: {provider: 'unused-fixture', modelId: 'must-not-dispatch'}});
    assert.equal(held.state, 'UNKNOWN'); assert.equal(held.phase, 'BLOCKED'); assert.equal(held.reviewReady, false);
    assert.deepEqual(ledger(f.c), before, 'Inspection and refused drive preserve original finite state');
});

test('UNKNOWN settlement guidance precedes activation and exhausted allowance advice', async t => {
    const f = await registryWorld(t, 'change-unknown-priority-'), workId = f.works[0].workId;
    const work = f.c.store.one('SELECT * FROM works WHERE id=?', workId);
    const metadata = parse(work.data);
    // Controlled incomplete activation premise; inspection must not recommend it
    // as a substitute for the independently retained UNKNOWN resource state.
    metadata.ownerRootActivation = {version: 1, state: 'PENDING', profile: {version: 1, integrations: [], publications: []}, fingerprint: hash({version: 1, integrations: [], publications: []})};
    f.c.store.run('UPDATE works SET state=?,data=? WHERE id=?', 'UNKNOWN', JSON.stringify(metadata), workId);
    f.c.store.run("UPDATE change_state SET phase='BLOCKED',data=json_set(data,'$.nextAction','planChange') WHERE work=?", workId);
    f.c.store.run('UPDATE budgets SET consumed=lim WHERE lineage=?', work.lineage);
    const before = ledger(f.c), view = f.c.inspectChange(workId);
    assert.match(view.blocked[0], /cleanup is unconfirmed/);
    assert.match(view.nextAction, /Inspect original execution ownership/);
    assert.doesNotMatch(view.nextAction, /change activate|change resume|Extend shared/);
    assert.deepEqual(ledger(f.c), before);
});

test('UNKNOWN result retains settlement guidance when rich assessment is unavailable', async t => {
    const f = await registryWorld(t, 'change-unknown-unavailable-'), workId = f.works[0].workId;
    f.c.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', workId);
    f.c.store.run("UPDATE change_state SET phase='PLANNING',data=json_set(data,'$.nextAction','planChange') WHERE work=?", workId);
    // A missing selected historical plan makes the actual rich assessment
    // unavailable; the known work state must still guide retained result reads.
    f.c.store.run('UPDATE change_state SET plan=? WHERE work=?', 'unavailable-original-plan', workId);
    assert.throws(() => f.c.inspectChange(workId), /Required immutable version absent/);
    const before = ledger(f.c), result = f.c.inspectChangeResult(workId);
    assert.equal(result.state, 'UNKNOWN'); assert.equal(result.recordedPhase, 'PLANNING'); assert.equal(result.reviewReady, false);
    assert.match(result.blocked[0], /cleanup is unconfirmed/); assert.match(result.blocked.join(' '), /assessment unavailable/);
    assert.match(result.nextAction, /Inspect original execution ownership/); assert.doesNotMatch(result.nextAction, /planChange/);
    assert.deepEqual(ledger(f.c), before);
});

test('UNKNOWN settlement stays primary when retained criteria no longer match', async t => {
    const f = await registryWorld(t, 'change-unknown-criteria-'), workId = f.works[0].workId;
    const data = parse(f.c.store.one('SELECT data FROM change_state WHERE work=?', workId).data);
    f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?', 'different-original-criteria', data.contractsVersion);
    f.c.store.run('UPDATE works SET state=? WHERE id=?', 'UNKNOWN', workId);
    const before = ledger(f.c), view = f.c.inspectChange(workId);
    assert.match(view.blocked[0], /cleanup is unconfirmed/); assert.match(view.blocked.join(' '), /workflow criteria changed/);
    assert.doesNotMatch(view.nextAction, /refresh-criteria|change resume/); assert.deepEqual(ledger(f.c), before);
});

test('healthy active inspection keeps ordinary stage and next action', async t => {
    const f = await registryWorld(t, 'change-active-inspection-'), workId = f.works[0].workId;
    const before = ledger(f.c), view = f.c.inspectChange(workId);
    assert.equal(view.state, 'ACTIVE'); assert.equal(view.phase, view.recordedPhase); assert.equal(view.phase, 'BASE_CAPTURED');
    assert.doesNotMatch(view.blocked.join(' '), /cleanup is unconfirmed/);
    assert.deepEqual(ledger(f.c), before);
});

async function failedPlanning(t,role='planner') {
    const f=await registryWorld(t,'planning-producer-guidance-'),workId=f.works[0].workId;
    return {...f,...seedPlanningFailure(f.c,workId,role)};
}

test('same original planning producer failure guides diagnostics without blaming cases or owner intent',async t=>{
    const f=await failedPlanning(t),before=ledger(f.c),view=f.c.inspectChange(f.workId),result=f.c.inspectChangeResult(f.workId);
    assert.match(view.nextAction,/original planning role failed-planner/);assert.match(view.nextAction,/remaining original allowance/);
    assert.doesNotMatch(view.nextAction,/corrected verification cases|owner clarification/);
    assert.match(view.blocked[0],/Role deadline exceeded/);assert.equal(result.nextAction,view.nextAction);
    assert.deepEqual(view.planningFailure,{role:'planner',launchId:f.launch});assert.deepEqual(result.planningFailure,view.planningFailure);
    assert.equal(view.reviewReady,false);assert.deepEqual(ledger(f.c),before);
});

for(const [label,change]of[
    ['other blocked cause',f=>f.c.store.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['Independent planning requires an owner decision']),f.workId)],
    ['resolved historical diagnostic',f=>f.c.store.run("UPDATE obligations SET data=json_set(data,'$.state','resolved') WHERE id=?",'diagnostic-'+f.launch)],
    ['changed epoch',f=>f.c.store.run('UPDATE works SET epoch=epoch+1 WHERE id=?',f.workId)],
    ['different retained input',f=>f.c.store.run("UPDATE role_launches SET data=json_set(data,'$.inputVersions.base','foreign') WHERE id=?",f.launch)],
    ['foreign diagnostic output',f=>f.c.store.run("UPDATE obligations SET data=json_set(data,'$.output','foreign-output') WHERE id=?",'diagnostic-'+f.launch)],
    ['foreign diagnostic launch',f=>f.c.store.run("UPDATE obligations SET data=json_set(data,'$.launchId','foreign-launch') WHERE id=?",'diagnostic-'+f.launch)],
    ['contradictory diagnostic issues',f=>f.c.store.run("UPDATE obligations SET data=json_set(data,'$.issues',json(?)) WHERE id=?",JSON.stringify(['Different retained cause']),'diagnostic-'+f.launch)],
    ['unavailable producer metadata',f=>f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?','malformed',f.output)],
    ['later complete producer',f=>{f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','later-role',f.workId,f.run,'adjudicator',1,'COMPLETE','none',JSON.stringify({stage:'planning-adjudication'}));}],
])test('planning inspection does not borrow '+label,async t=>{
    const f=await failedPlanning(t);change(f);const before=ledger(f.c),view=f.c.inspectChange(f.workId);
    assert.match(view.nextAction,/Inspect original planning blockers/);assert.doesNotMatch(view.nextAction,/original planning role failed-planner|corrected verification cases|owner clarification/);
    assert.equal(view.planningFailure,undefined);assert.equal(f.c.inspectChangeActivity(f.workId).recordedPlanningFailure,undefined);
    assert.deepEqual(ledger(f.c),before);
});

test('settlement and current criteria advice retain priority over historical producer guidance',async t=>{
    const f=await failedPlanning(t),s=f.c.store;
    s.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',f.workId);
    assert.match(f.c.inspectChange(f.workId).nextAction,/original execution ownership/);
    assert.equal(f.c.inspectChange(f.workId).planningFailure,undefined);assert.equal(f.c.inspectChangeActivity(f.workId).recordedPlanningFailure,undefined);
    s.run('UPDATE works SET state=? WHERE id=?','ACTIVE',f.workId);
    const data=parse(s.one('SELECT data FROM change_state WHERE work=?',f.workId).data);
    s.run('UPDATE change_versions SET hash=? WHERE id=?','changed',data.contractsVersion);
    const before=ledger(f.c),view=f.c.inspectChange(f.workId);
    assert.match(view.nextAction,/refresh-criteria/);assert.ok(view.blocked.some(value=>value.includes('original planning role failed-planner')));
    assert.equal(view.planningFailure,undefined);assert.equal(f.c.inspectChangeResult(f.workId).planningFailure,undefined);
    assert.deepEqual(ledger(f.c),before);
});

for(const role of ['planner','challenger','adjudicator'])test('recorded '+role+' failure needs no protocol/native-history or current-criteria read',async t=>{
    const f=await failedPlanning(t,role),s=f.c.store,marker='UNUSED_LARGE_NATIVE_METADATA_'.repeat(4000);
    s.run("UPDATE role_launches SET data=json_set(data,'$.nativeRoleIntent',?) WHERE id=?",marker,f.launch);
    s.run("UPDATE role_outputs SET data=json_set(data,'$.protocol',?) WHERE id=?",marker,f.output);
    const before=ledger(f.c),read=s.one.bind(s),criteria=f.c.changes.criteriaHoldReason;
    s.one=(...args)=>{const row=read(...args);assert.ok(!JSON.stringify(row)?.includes('UNUSED_LARGE_NATIVE_METADATA_'),'Activity transferred an unrelated large metadata body');return row;};
    f.c.changes.criteriaHoldReason=()=>{throw Error('Activity cannot assess current criteria');};
    try{assert.deepEqual(f.c.inspectChangeActivity(f.workId).recordedPlanningFailure,{role,launchId:f.launch});}
    finally{s.one=read;f.c.changes.criteriaHoldReason=criteria;}
    assert.deepEqual(ledger(f.c),before);
});

test('original selected result exposes retained candidate changes without reading or applying its files', async t => {
    const f = await fixture(t), before = ledger(f.c), result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.request, 'Owner request 0 한국어');
    assert.equal(result.registeredSourceRoot, path.join(f.root, 'A'));
    assert.equal(result.candidate.path, f.artifact);
    assert.equal(result.candidate.versionId, f.candidate);
    assert.deepEqual(result.changes.entries, [{path:'added.txt',kind:'added'}, {path:'file.txt',kind:'modified'}]);
    assert.equal(result.changes.total, 2);
    assert.equal(result.reviewReady, false, 'Synthetic records cannot turn the still-captured task into completed delivery');
    assert.match(result.limitations.join(' '), /existence and current content are not verified/);
    assert.match(result.limitations.join(' '), /original project folder has not been compared/);
    assert.deepEqual(ledger(f.c), before);
    await fs.rm(f.artifact, {recursive:true});
    await fs.writeFile(path.join(f.root, 'A', 'file.txt'), 'Later owner edit');
    const later = f.c.inspectChangeResult(f.workId);
    assert.deepEqual(later.candidate, result.candidate);
    assert.deepEqual(later.changes, result.changes);
    assert.equal(await fs.readFile(path.join(f.root, 'A', 'file.txt'), 'utf8'), 'Later owner edit');
    await f.c.close();
    const reopened = await openController({installationHome:f.home});
    try { assert.deepEqual(reopened.inspectChangeResult(f.workId).changes, result.changes); }
    finally { await reopened.close(); }
});

test('selected check summaries reuse latest exact declarations instead of all historical passes', async t => {
    const f = await fixture(t);
    f.receipt('old-failure', 'fail');
    f.receipt('current-pass', 'pass');
    f.receipt('later-unrelated-pass', 'pass', {...f.check, command:'Different declaration'});
    const before = ledger(f.c), view = f.c.inspectChangeResult(f.workId);
    assert.equal(view.checks.entries.length, 1);
    assert.deepEqual(view.checks.entries[0], {checkId:'behavior', receiptId:'current-pass', runId:f.c.store.one('SELECT id FROM runs WHERE work=?',f.workId).id, status:'pass', passed:true, cleanup:'removed', durationMs:12});
    assert.deepEqual(ledger(f.c), before);
    f.receipt('newer-failure', 'fail');
    assert.equal(f.c.inspectChangeResult(f.workId).checks.entries[0].receiptId, 'newer-failure');
    assert.equal(f.c.inspectChangeResult(f.workId).checks.entries[0].passed, false);
    f.receipt('missing-case-proof', 'pass', f.check, {caseResults:null});
    assert.equal(f.c.inspectChangeResult(f.workId).checks.entries[0].passed, false);
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'new-verification', f.workId, 'verification', null, null, hash(f.verification), JSON.stringify({verification:f.verification}));
    f.c.store.run('UPDATE change_state SET verification=? WHERE work=?', 'new-verification', f.workId);
    const stale = f.c.inspectChangeResult(f.workId).checks.entries[0];
    assert.equal(stale.status, 'missing');
    assert.equal(stale.receiptId, null, 'Old-version passes cannot satisfy a newly selected verification');
    f.c.store.run('UPDATE change_state SET verification=? WHERE work=?', null, f.workId);
    assert.equal(f.c.inspectChangeResult(f.workId).checks.availability, 'not-planned');
});

test('selected review outcome requires its exact retained protocol and settled producer, not COMPLETE alone', async t => {
    const f = await fixture(t), reviewed = f.review();
    f.review('unselected-review');
    f.c.store.run("UPDATE change_state SET data=json_set(data,'$.selection',json(?)) WHERE work=?", JSON.stringify({'behavior-review':'selected-review'}), f.workId);
    const before = ledger(f.c), view = f.c.inspectChangeResult(f.workId);
    assert.equal(view.reviews.entries.length, 1);
    assert.equal(view.reviews.entries[0].launchId, 'selected-review');
    assert.equal(view.reviews.entries[0].state, 'selected');
    assert.equal(view.reviews.entries[0].outcome, 'clear');
    assert.equal(view.reviewReady, false);
    assert.deepEqual(ledger(f.c), before);
    f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?', JSON.stringify({...reviewed.metadata, rawFinalTruncated:true}), 'selected-review-output');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'unavailable');
    f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?', JSON.stringify(reviewed.metadata), 'selected-review-output');
    f.c.store.run('UPDATE runs SET phase=? WHERE id=?', 'UNKNOWN', reviewed.runId);
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].outcome, 'unavailable');
});

test('cancel and resume retain an unchanged selected review from its original epoch and generation', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    f.review();
    f.markReady();
    const originalResult = f.c.inspectChangeResult(f.workId);
    await cancelAndResume(f);
    const before = ledger(f.c), result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.reviewReady, true);
    assert.deepEqual(result.reviews, originalResult.reviews);
    assert.deepEqual(result.checks, originalResult.checks);
    assert.deepEqual(result.candidate, originalResult.candidate);
    assert.deepEqual(ledger(f.c), before, 'Result inspection neither rewrites historical producers nor reruns them');
    await f.c.close();
    const reopened = await openController({installationHome:f.home});
    try { assert.deepEqual(reopened.inspectChangeResult(f.workId), result); }
    finally { await reopened.close(); }
});

for (const mutation of [
    {name:'launch epoch disagrees with original run', launchEpoch:2},
    {name:'run epoch disagrees with original launch', runEpoch:2},
    {name:'producer epoch is later than current work', launchEpoch:4,runEpoch:4},
    {name:'producer epoch is invalid', launchEpoch:0,runEpoch:0},
    {name:'producer generation is later than current work', generation:3},
    {name:'producer generation is invalid', generation:0},
    {name:'producer generation is fractional', generation:1.5},
]) test('resumed result refuses historical metadata when '+mutation.name, async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    const review = f.review();
    f.markReady();
    await cancelAndResume(f);
    if (mutation.launchEpoch !== undefined) f.c.store.run('UPDATE role_launches SET epoch=? WHERE id=?', mutation.launchEpoch, 'selected-review');
    if (mutation.runEpoch !== undefined) f.c.store.run('UPDATE runs SET epoch=? WHERE id=?', mutation.runEpoch, review.runId);
    if (mutation.generation !== undefined) f.c.store.run('UPDATE runs SET generation=? WHERE id=?', mutation.generation, review.runId);
    const before = ledger(f.c), result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.reviews.entries[0].state, 'unavailable');
    assert.equal(result.reviews.entries[0].outcome, 'unavailable');
    assert.equal(result.reviewReady, false);
    assert.deepEqual(ledger(f.c), before);
});

test('stale review and nonempty findings never inherit another selected clear review', async t => {
    const f = await fixture(t), review = f.review();
    const findings = [{requirementId:'R', severity:'blocking', repair:'substantive', description:'Observed missing requirement', evidence:['candidate:file.txt:1']}];
    const protocol = {...review.protocol, findings, outcome:'findings'};
    f.c.store.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?', JSON.stringify(protocol), JSON.stringify({...review.metadata,protocol}), 'selected-review-output');
    const view = f.c.inspectChangeResult(f.workId);
    assert.equal(view.reviews.entries[0].outcome, 'findings');
    assert.equal(view.reviews.entries[0].findingCount, 1);
    const launch = parse(f.c.store.one('SELECT data FROM role_launches WHERE id=?','selected-review').data);
    f.c.store.run('UPDATE role_launches SET data=? WHERE id=?', JSON.stringify({...launch,inputVersions:{...f.tuple,verification:'old-verification'}}),'selected-review');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'stale');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].outcome, 'unavailable');
});

test('missing or inconsistent selected candidate metadata is unavailable rather than an empty diff', async t => {
    const f = await fixture(t);
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?', JSON.stringify({...f.candidateData,delta:{files:[],directories:{before:[],after:[]}}}), f.candidate);
    const result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.changes.availability, 'unavailable');
    assert.equal(result.changes.total, null);
    assert.match(result.changes.reason, /delta differs/);
    f.c.store.run('UPDATE change_state SET candidate=? WHERE work=?', 'missing-candidate', f.workId);
    const missing = f.c.inspectChangeResult(f.workId);
    assert.equal(missing.candidate, null);
    assert.equal(missing.changes.availability, 'unavailable');
    assert.equal(missing.checks.availability, 'unavailable');
    f.c.store.run('UPDATE change_state SET candidate=? WHERE work=?', null, f.workId);
    assert.equal(f.c.inspectChangeResult(f.workId).changes.availability, 'no-candidate');
});

test('result entries disclose bounded omissions without shortening literal identities', async t => {
    const f = await fixture(t), working = path.join(f.root, 'many-output'), artifact = path.join(f.home, 'inputs', 'many-candidate');
    await fs.cp(f.base.artifact, working, {recursive:true});
    for (let index=0;index<105;index++) await fs.writeFile(path.join(working,'new-'+String(index).padStart(3,'0')+'.txt'),'new');
    const frozen = await freeze(working, artifact, {}), manifest = parse(f.base.data).manifest;
    f.c.store.run('UPDATE change_versions SET artifact=?,hash=?,data=? WHERE id=?', artifact, frozen.digest, JSON.stringify({manifest:frozen.manifest,delta:delta(manifest,frozen.manifest)}), f.candidate);
    const result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.changes.entries.length, 100);
    assert.equal(result.changes.total, 105);
    assert.equal(result.changes.omitted, 5);
    assert.equal(result.changes.entries[99].path, 'new-099.txt');
});

test('a recorded ready assessment cannot override deleted, malformed or stale required reviewer evidence', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    const review = f.review();
    f.markReady();
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
    const output = f.c.store.one('SELECT * FROM role_outputs WHERE id=?', 'selected-review-output');
    f.c.store.run('DELETE FROM role_outputs WHERE id=?', output.id);
    assert.equal(f.c.inspectChange(f.workId).reviewReady, true, 'The legacy assessment itself is unchanged');
    const missing = f.c.inspectChangeResult(f.workId);
    assert.equal(missing.reviewReady, false);
    assert.equal(missing.reviews.entries[0].state, 'unavailable');
    assert.match(missing.blocked.join(' '), /Required selected review evidence/);
    assert.match(missing.nextAction, /Restore exact evidence/);
    f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', output.id, output.launch, output.raw, output.status, output.data);
    f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?', JSON.stringify({...review.metadata, rawFinalTruncated:true}), output.id);
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, false);
    f.c.store.run('UPDATE role_outputs SET data=? WHERE id=?', output.data, output.id);
    f.c.store.run('UPDATE role_launches SET data=json_set(data,\'$.inputVersions.candidate\',?) WHERE id=?', 'old-candidate', 'selected-review');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'stale');
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, false);
});

for (const mutation of [
    {name:'purpose', target:'launch', change:data=>({...data,purpose:'Another assigned purpose'})},
    {name:'required paths', target:'launch', change:data=>({...data,requiredPaths:['other.txt']})},
    {name:'checkpoint session', target:'run', change:data=>({...data,nativeCheckpoint:{...data.nativeCheckpoint,sessionId:'foreign'}})},
    {name:'checkpoint leaf', target:'run', change:data=>({...data,nativeCheckpoint:{...data.nativeCheckpoint,leafId:''}})},
    {name:'checkpoint byte limit', target:'run', change:data=>({...data,nativeCheckpoint:{...data.nativeCheckpoint,bytes:32*1024*1024+1}})},
    {name:'checkpoint fractional bytes', target:'run', change:data=>({...data,nativeCheckpoint:{...data.nativeCheckpoint,bytes:1.5}})},
    {name:'checkpoint hash', target:'run', change:data=>({...data,nativeCheckpoint:{...data.nativeCheckpoint,sha256:'bad'}})},
]) test('retained selected review refuses a changed '+mutation.name, async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    const review = f.review();
    f.markReady();
    const table = mutation.target === 'launch' ? 'role_launches' : 'runs', id = mutation.target === 'launch' ? 'selected-review' : review.runId;
    const original = f.c.store.one('SELECT data FROM '+table+' WHERE id=?', id).data;
    f.c.store.run('UPDATE '+table+' SET data=? WHERE id=?', JSON.stringify(mutation.change(parse(original))), id);
    const before = ledger(f.c), result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.reviews.entries[0].state, 'unavailable');
    assert.equal(result.reviews.entries[0].outcome, 'unavailable');
    assert.equal(result.reviewReady, false);
    assert.deepEqual(ledger(f.c), before);
});

test('valid retained reviews may report findings already resolved by the existing accepted procedure', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    const review = f.review();
    const finding = {requirementId:'R', severity:'blocking', repair:'substantive', description:'Recorded defect subsequently repaired', evidence:['candidate:file.txt:1']};
    const protocol = {...review.protocol,findings:[finding],outcome:'findings'};
    f.c.store.run('UPDATE role_outputs SET raw=?,data=? WHERE id=?',JSON.stringify(protocol),JSON.stringify({...review.metadata,protocol}),'selected-review-output');
    f.c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)','resolved-observation','selected-review-output',0,f.workId,JSON.stringify({finding}));
    f.c.store.run('INSERT INTO finding_dispositions VALUES(?,?,?,?,?)','resolved-disposition','resolved-observation','selected-review','upheld',JSON.stringify({resolution:'repaired',witnesses:['passing-check']}));
    f.c.store.run('INSERT INTO obligations VALUES(?,?,?)','resolved-obligation',f.workId,JSON.stringify({kind:'finding',state:'resolved',occurrence:'resolved-observation'}));
    f.markReady();
    const result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.reviewReady, true);
    assert.equal(result.reviews.entries[0].outcome, 'findings');
    assert.equal(result.reviews.entries[0].findingCount, 1);
});

test('mechanical carry retains the original reviewer only with its exact confirmation and unchanged other bindings', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)','reviewed-before-correction',f.workId,'candidate',f.base.id,f.base.artifact,f.base.hash,JSON.stringify({manifest:parse(f.base.data).manifest,delta:delta(parse(f.base.data).manifest,parse(f.base.data).manifest)}));
    const review = f.review('selected-review', {inputVersions:{...f.tuple,candidate:'reviewed-before-correction'}});
    const run = f.c.store.one('SELECT * FROM runs WHERE id=?', review.runId);
    f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','confirmer-run',f.workId,run.epoch,run.generation,'SETTLED','retained-not-read','consumed',JSON.stringify({cleanup:'removed'}));
    f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','confirmer',f.workId,'confirmer-run','confirmer',run.epoch,'COMPLETE','none','{}');
    f.c.store.run("UPDATE change_state SET data=json_set(data,'$.carry',json(?)) WHERE work=?", JSON.stringify({before:'reviewed-before-correction',after:f.candidate,confirmation:'confirmer'}), f.workId);
    const originalSelection = JSON.stringify({'behavior-review':'selected-review'});
    f.c.store.run('INSERT INTO remedy_confirmations VALUES(?,?,?,?,?,?,?)','confirmation',f.workId,originalSelection,'reviewed-before-correction',f.candidate,'confirmer',JSON.stringify({fixture:'Exact original carry correspondence, not an executed correction'}));
    f.markReady();
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'carried');
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
    await cancelAndResume(f);
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'carried');
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
    f.c.store.run('DELETE FROM remedy_confirmations WHERE id=?','confirmation');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'stale');
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, false);
    f.c.store.run('INSERT INTO remedy_confirmations VALUES(?,?,?,?,?,?,?)','confirmation',f.workId,originalSelection,'reviewed-before-correction',f.candidate,'confirmer','{}');
    f.c.store.run("UPDATE role_launches SET data=json_set(data,'$.inputVersions.verification',?) WHERE id=?",'old-verification','selected-review');
    assert.equal(f.c.inspectChangeResult(f.workId).reviews.entries[0].state, 'stale');
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, false);
});

test('the byte cap omits oversized or cumulative multibyte identities explicitly rather than truncating them', async () => {
    const {resultEntries} = await import('../../dist/controller/change-result.js');
    const oversized = {path:'한'.repeat(23000),kind:'added'};
    assert.deepEqual(resultEntries([oversized]), {entries:[],total:1,omitted:1});
    const entries = Array.from({length:30},(_,index)=>({path:index+'한'.repeat(1000),kind:'added'}));
    const result = resultEntries(entries);
    assert.ok(result.entries.length > 0 && result.entries.length < entries.length);
    assert.equal(result.total, entries.length);
    assert.equal(result.omitted, entries.length-result.entries.length);
    assert.deepEqual(result.entries, entries.slice(0,result.entries.length));
    assert.ok(result.entries.reduce((bytes,entry)=>bytes+Buffer.byteLength(JSON.stringify(entry)),0)<=64*1024);
});


test('selected verification declaration corruption withholds result readiness without changing legacy admission', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    f.review();
    f.markReady();
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
    const verification = f.c.store.one('SELECT hash FROM change_versions WHERE id=?', f.tuple.verification);
    f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?', 'f'.repeat(64), f.tuple.verification);
    assert.equal(f.c.inspectChange(f.workId).reviewReady, true, 'Existing checksCurrent/admission semantics stay unchanged');
    const before = ledger(f.c), result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.checks.availability, 'unavailable');
    assert.match(result.checks.reason, /declaration identity differs/);
    assert.equal(result.reviewReady, false);
    assert.match(result.blocked.join(' '), /Required selected check evidence/);
    assert.deepEqual(ledger(f.c), before);
    f.c.store.run('UPDATE change_versions SET hash=? WHERE id=?', verification.hash, f.tuple.verification);
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
});

test('inconsistent retained candidate delta withholds result readiness but does not probe a missing artifact', async t => {
    const f = await fixture(t);
    f.receipt('passing-check', 'pass');
    f.review();
    f.markReady();
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true);
    const original = f.c.store.one('SELECT data FROM change_versions WHERE id=?', f.candidate).data;
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?', JSON.stringify({...parse(original),delta:{files:[],directories:{before:[],after:[]}}}), f.candidate);
    assert.equal(f.c.inspectChange(f.workId).reviewReady, true, 'The recorded phase and original procedure assessment stay separate');
    const result = f.c.inspectChangeResult(f.workId);
    assert.equal(result.changes.availability, 'unavailable');
    assert.equal(result.reviewReady, false);
    assert.match(result.blocked.join(' '), /Selected candidate provenance/);
    f.c.store.run('UPDATE change_versions SET data=? WHERE id=?', original, f.candidate);
    await fs.rm(f.artifact, {recursive:true});
    assert.equal(f.c.inspectChangeResult(f.workId).reviewReady, true, 'Artifact existence is explicitly unobserved, not revalidated by this metadata view');
});

for(const oldReceipt of [undefined,{version:3}])test('ready inspection with '+(oldReceipt?'old':'missing')+' Native coverage is a read-only recovery hold',async t=>{
    const f=await fixture(t);f.receipt('passing-current-check','pass');f.review();f.markReady();assert.equal(f.c.inspectChangeResult(f.workId).reviewReady,true);
    // Synthetic retained readiness is the existing fixture's premise; this is
    // display/authority refusal coverage, not Native history qualification.
    const launch=f.c.store.one('SELECT * FROM role_launches WHERE id=?','selected-review'),data=parse(launch.data);
    data.nativeRoleIntent={version:1,launchId:launch.id,role:'reviewer',stage:'fresh-review',inputDigest:'a'.repeat(64),schemaDigest:'b'.repeat(64),requestDigest:'c'.repeat(64),maxNativeTurns:3};
    if(oldReceipt)data.materialAccounting=oldReceipt;
    f.c.store.run('UPDATE role_launches SET data=? WHERE id=?',JSON.stringify(data),launch.id);const before=ledger(f.c);
    const view=f.c.inspectChange(f.workId),result=f.c.inspectChangeResult(f.workId);assert.equal(view.recordedPhase,'REVIEW_READY');assert.equal(view.state,'DELIVERED');assert.equal(view.phase,'BLOCKED');assert.equal(view.reviewReady,false);assert.equal(result.reviewReady,false);assert.match(view.blocked.join(),/material coverage/);assert.match(view.nextAction,/change resume --work/);
    assert.equal(f.c.changeCore.inspectModelPrerequisites(f.workId).stage,'held');await assert.rejects(f.c.changeCore.currentEvidence(f.workId),/material coverage/);assert.deepEqual(ledger(f.c),before);
});


test('owned settled quota facet guides original work without history reads or ledger writes',async t=>{
 const f=await registryWorld(t,'quota-guidance-'),seed=seedPlanningQuota(f.c,f.works[0].workId);
 const tables=f.c.store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name);
 const snapshot=()=>Object.fromEntries(tables.map(name=>[name,f.c.store.all('SELECT * FROM "'+name+'"')]));
 const marker=path.join(f.root,'NO_HISTORY_READ.jsonl');
 for(const table of ['role_launches','runs'])f.c.store.run("UPDATE "+table+" SET data=json_set(data,'$.historyRef',?) WHERE id=?",marker,table==='runs'?seed.run:seed.launch);
 let historyReads=0;const read=fs.readFile,readSync=fsSync.readFileSync,nativeEntries=f.c.changes.nativeEntries;
 const guard=file=>{if(String(file)===marker){historyReads++;throw Error('History read during pure inspection');}};
 fs.readFile=(file,...args)=>{guard(file);return read(file,...args);};fsSync.readFileSync=(file,...args)=>{guard(file);return readSync(file,...args);};
 f.c.changes.nativeEntries=()=>{historyReads++;throw Error('History entries during pure inspection');};
 t.after(()=>{fs.readFile=read;fsSync.readFileSync=readSync;f.c.changes.nativeEntries=nativeEntries;});
 const before=snapshot(),view=f.c.inspectChange(seed.workId),result=f.c.inspectChangeResult(seed.workId),activity=f.c.inspectChangeActivity(seed.workId);
 assert.deepEqual(view.planningFailure.providerFailure,seed.providerFailure);
 assert.deepEqual(result.planningFailure,view.planningFailure);assert.deepEqual(activity.recordedPlanningFailure,view.planningFailure);
 assert.match(view.nextAction,/provider reported a usage-limit rejection/);assert.match(view.nextAction,/Wait and check the account limits/);
 assert.match(view.blocked.join(' '),/Original account limit rejection/);assert.equal(view.reviewReady,false);assert.equal(historyReads,0);assert.deepEqual(snapshot(),before);
});

for(const [label,change]of[
 ['foreign owner session',f=>f.c.store.run("UPDATE role_outputs SET data=json_set(data,'$.providerFailure.ownerSessionId','other') WHERE id=?",f.output)],
 ['malformed facet',f=>f.c.store.run("UPDATE role_outputs SET data=json_set(data,'$.providerFailure.resetsAt','yesterday') WHERE id=?",f.output)],
 ['unexpected facet field',f=>f.c.store.run("UPDATE role_outputs SET data=json_set(data,'$.providerFailure.authorized',1) WHERE id=?",f.output)],
 ['missing checkpoint',f=>f.c.store.run("UPDATE runs SET data=json_remove(data,'$.nativeCheckpoint') WHERE id=?",f.run)],
 ['unsettled run',f=>f.c.store.run("UPDATE runs SET phase='UNKNOWN' WHERE id=?",f.run)],
 ['unknown native cleanup',f=>f.c.store.run("UPDATE role_launches SET data=json_set(data,'$.cleanup','quarantined') WHERE id=?",f.launch)],
 ['unknown run cleanup',f=>f.c.store.run("UPDATE runs SET data=json_set(data,'$.cleanup','quarantined') WHERE id=?",f.run)],
 ['non-error terminal',f=>f.c.store.run("UPDATE role_outputs SET data=json_set(data,'$.terminal','aborted') WHERE id=?",f.output)],
])test('quota display remains generic for '+label,async t=>{
 const world=await registryWorld(t,'quota-guidance-invalid-'),f={...world,...seedPlanningQuota(world.c,world.works[0].workId)};change(f);
 const before=ledger(f.c),view=f.c.inspectChange(f.workId);
 assert.equal(view.planningFailure.providerFailure,undefined);assert.doesNotMatch(view.nextAction,/provider reported a usage-limit rejection/);assert.deepEqual(ledger(f.c),before);
});


test('actual controller collection persists one output facet and keeps intermediate accounting separate',async t=>{
 const f=await registryWorld(t,'quota-collect-'),seed=seedPlanningQuota(f.c,f.works[0].workId);
 const execution={role:'planner',rawFinal:null,rawFinalTruncated:false,protocol:null,issues:['PROVIDER:Original account limit rejection'],exposures:[],terminal:'error',historyRef:null,providerRequests:1,events:[],providerFailure:seed.providerFailure};
 const id=f.c.changes.collect(seed.workId,seed.launch,execution,false);
 assert.deepEqual(JSON.parse(f.c.store.one('SELECT data FROM role_outputs WHERE id=?',id).data).providerFailure,seed.providerFailure);
 assert.equal(JSON.parse(f.c.store.one('SELECT data FROM obligations WHERE id=?','diagnostic-'+seed.launch).data).providerFailure,undefined);
 const intermediate=f.c.changes.collect(seed.workId,seed.launch,execution,false,true);
 assert.equal(JSON.parse(f.c.store.one('SELECT data FROM role_outputs WHERE id=?',intermediate).data).providerFailure,undefined);
 const complete=f.c.changes.collect(seed.workId,seed.launch,{...execution,terminal:'complete'},false);
 assert.equal(JSON.parse(f.c.store.one('SELECT data FROM role_outputs WHERE id=?',complete).data).providerFailure,undefined);
});


for(const [role]of normalQuotaStages)test('normal '+role+' quota reaches current and recorded inspection without history or mutation',async t=>{
 const f=await registryWorld(t,'normal-quota-'),seed=seedNormalQuota(f.c,f.works[0].workId,role),s=f.c.store;
 const tables=s.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name),snapshot=()=>Object.fromEntries(tables.map(name=>[name,s.all('SELECT * FROM "'+name+'"')]));
 let historyReads=0;f.c.changes.nativeEntries=()=>{historyReads++;throw Error('No history reads for quota inspection');};
 const before=snapshot(),view=f.c.inspectChange(seed.workId),result=f.c.inspectChangeResult(seed.workId),activity=f.c.inspectChangeActivity(seed.workId);
 assert.deepEqual(view.providerFailure,{role,launchId:seed.launch,usageLimit:seed.providerFailure});
 assert.deepEqual(result.providerFailure,view.providerFailure);assert.deepEqual(activity.recordedProviderFailure,view.providerFailure);
 assert.equal(view.planningFailure,undefined);assert.equal(result.planningFailure,undefined);assert.equal(activity.recordedPlanningFailure,undefined);
 assert.match(view.nextAction,/Wait and check/);assert.match(view.blocked.join(' '),/Original account limit rejection/);assert.equal(view.reviewReady,false);
 assert.equal(historyReads,0);assert.deepEqual(snapshot(),before);
 const original={launch:s.one('SELECT * FROM role_launches WHERE id=?',seed.launch),state:s.one('SELECT * FROM change_state WHERE work=?',seed.workId),output:s.one('SELECT * FROM role_outputs WHERE id=?',seed.output)};
 for(const [kind,mutate]of[
  ['role',()=>s.run("UPDATE role_launches SET role='planner' WHERE id=?",seed.launch)],
  ['stage',()=>s.run("UPDATE role_launches SET data=json_set(data,'$.stage','source-fit') WHERE id=?",seed.launch)],
  ['resume',()=>s.run("UPDATE change_state SET data=json_set(data,'$.resumeStage','plan') WHERE work=?",seed.workId)],
  ['no facet',()=>s.run("UPDATE role_outputs SET data=json_remove(data,'$.providerFailure') WHERE id=?",seed.output)],
 ]){
  mutate();const held=f.c.inspectChange(seed.workId);assert.equal(held.providerFailure,undefined,kind);assert.equal(held.planningFailure,undefined,kind);assert.equal(f.c.inspectChangeActivity(seed.workId).recordedProviderFailure,undefined,kind);
  s.run('UPDATE role_launches SET role=?,data=? WHERE id=?',original.launch.role,original.launch.data,seed.launch);
  s.run('UPDATE change_state SET data=? WHERE work=?',original.state.data,seed.workId);s.run('UPDATE role_outputs SET data=? WHERE id=?',original.output.data,seed.output);
 }
 assert.deepEqual(snapshot(),before);
});

test('normal quota attribution keeps latest producer and stronger current holds',async t=>{
 const f=await registryWorld(t,'normal-quota-holds-'),seed=seedNormalQuota(f.c,f.works[0].workId,'reviewer'),s=f.c.store;
 const originalWork=s.one('SELECT * FROM works WHERE id=?',seed.workId),originalState=s.one('SELECT * FROM change_state WHERE work=?',seed.workId),originalDiagnostic=s.one('SELECT * FROM obligations WHERE id=?','diagnostic-'+seed.launch);
 s.run("UPDATE works SET state='UNKNOWN' WHERE id=?",seed.workId);assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);assert.match(f.c.inspectChange(seed.workId).nextAction,/execution ownership/);assert.equal(f.c.inspectChangeActivity(seed.workId).recordedProviderFailure,undefined);
 s.run('UPDATE works SET state=? WHERE id=?',originalWork.state,seed.workId);
 const criteria=f.c.changes.criteriaHoldReason;f.c.changes.criteriaHoldReason=()=> 'Controlled current criteria mismatch';
 assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);assert.match(f.c.inspectChange(seed.workId).nextAction,/refresh-criteria/);f.c.changes.criteriaHoldReason=criteria;
 s.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['ModelContextBudgetError: MODEL_CONTEXT_LIMIT: Original required input overflow','ControllerError: PROVIDER:Original account limit rejection']),seed.workId);
 assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);s.run('UPDATE change_state SET data=? WHERE work=?',originalState.data,seed.workId);
 s.run("UPDATE obligations SET data=json_set(data,'$.state','resolved') WHERE id=?",originalDiagnostic.id);assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);s.run('UPDATE obligations SET data=? WHERE id=?',originalDiagnostic.data,originalDiagnostic.id);
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)','later-unrelated',seed.workId,seed.run,'adjudicator',originalWork.epoch,'COMPLETE','none',JSON.stringify({stage:'source-fit'}));
 assert.equal(f.c.inspectChange(seed.workId).providerFailure,undefined);assert.equal(f.c.inspectChangeActivity(seed.workId).recordedProviderFailure,undefined);
});
