import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {managedFixtureInputs, assertCurrentBuild, withInstalledManagedFixture, receiverBase, sourceBase, sourceCandidate, receiverCandidate} from './managed-installed-fixture.mjs';
import {installedInterruption} from './managed-interruption.mjs';
import {installedAgentEndpoint} from './managed-agent-endpoint.mjs';
import {recoverOwnerOriginal} from './managed-owner-recovery.mjs';
import {inspectInstalledManagedResult} from './managed-result-inspection.mjs';

// Only model HTTP answers are scripted; application state is produced by installed commands and SDK tools.
test('installed setup and real managed procedures reach an authorized local branch; incorrect candidates remain unready', {timeout: 240000}, async t => {
    const fixture = await managedFixtureInputs();
    for (const badCandidate of [false, true]) await withInstalledManagedFixture(t, {...fixture, badCandidate}, journey);
    await assertCurrentBuild(fixture.built);
});

async function journey({root, home, project, launcher, run, cli, terminal, badCandidate, roles, reviews, requests, invocations, result, setOrdinaryResponder, setRoleResponseGate}) {
    const request = 'Consumer must export3 using its existing simple implementation.';
    await terminal('managed-work', [
        {wait: 'Model: original', send: '/change start ' + request + '\x1b\r'},
        {wait: 'Start managed work', send: '\r'},
        {wait: badCandidate ? 'Stopped ·' : 'Review-ready result recorded', send: '/quit\x1b\r'}
    ], 80);
    const listed = await cli(['change', 'list'], 'changes'); assert.equal(listed.changes.length, 1);
    const workId = listed.changes[0].workId, view = await cli(['change', 'inspect', '--work', workId], 'inspect');
    const work = await cli(['work', 'inspect', '--work', workId], 'work'); assert.equal(work.source.raw, request);
    assert.equal(view.reviewReady, !badCandidate); assert.ok(view.execution.consumed > 0);
    assert.equal(view.execution.reserved, 0); assert.equal(view.resolution.reserved, 0);
    assert.ok(requests.length > 5); assert.ok(requests.every(request => request.model === 'original'));
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    if (badCandidate) {assert.notEqual(view.phase, 'REVIEW_READY'); assert.ok(view.checks.some(check => check.status === 'fail' && check.data.actual.exitCode === 0)); assert.equal(reviews.length, 0);}
    else {
        assert.equal(view.phase, 'REVIEW_READY'); assert.ok(view.checks.some(check => check.status === 'pass' && check.data.actual.exitCode === 0));
        const author = view.launches.find(launch => launch.role === 'implementer'), reviewer = view.launches.find(launch => launch.role === 'reviewer');
        assert.ok(author && reviewer); assert.notEqual(author.run, reviewer.run);
        assert.equal(reviewer.data.inputVersions.candidate, view.candidateVersion);
        const candidate = view.versions.find(version => version.id === view.candidateVersion);
        assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), sourceCandidate);
        for (const role of ['planner', 'challenger', 'implementer', 'reviewer', 'adjudicator']) assert.ok(roles.includes(role), role);
        const launches = view.launches.filter(launch => ['planner', 'challenger', 'implementer', 'reviewer', 'adjudicator'].includes(launch.role));
        assert.equal(new Set(launches.map(launch => launch.data.nativeSessionId)).size, launches.length);
        assert.equal(new Set(launches.map(launch => launch.data.historyRef)).size, launches.length);
        for (const launch of launches) {assert.ok(launch.data.nativeSessionId && launch.data.historyRef); assert.equal(launch.data.cleanup, 'removed'); await fs.access(launch.data.historyRef);}
        assert.equal(reviews.length, 1); assert.equal(reviews[0].candidateVersion, view.candidateVersion); assert.equal(reviews[0].consumer, sourceCandidate);
    }
    const landing = badCandidate ? null : await landLocalBranch({root, home, project, launcher, workId, view, run, cli, invocations, terminal, requests, reviews});
    result.landing = landing;
    if (!badCandidate) result.agent = await installedAgentEndpoint({root, home, project, terminal, run, cli,
        setOrdinaryResponder, receiverBase, receiverCandidate, sourceBase});
    if (!badCandidate) result.interruption = await installedInterruption({root, home, project, terminal, cli, requests,
        setRoleResponseGate, sourceBase, sourceCandidate});
    const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
    try {
        const data = JSON.parse(db.prepare('SELECT data FROM works WHERE id=?').get(workId).data);
        assert.equal(data.applicationModelBaseline.choice.modelId, 'original');
        assert.equal(data.applicationModelBaseline.choice.provider, 'installed-managed');
        assert.equal(data.applicationModelBaseline.source.kind, 'conversation');
        if (!badCandidate) {
            const selected = JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data);
            const reviewer = view.launches.find(launch => launch.role === 'reviewer');
            assert.equal(reviewer.data.inputVersions.requirements, selected.requirementVersion);
            assert.equal(reviewer.data.inputVersions.contracts, selected.contractsVersion);
        }
    } finally {db.close();}
    return {workId, candidateVersion: view.candidateVersion, intermediate: view.phase, ...result,
        scope: 'Installed owner/local endpoint, SDK agent endpoint and owner interruption; scripted HTTP, no live hosting or agent recovery claim'};
}

async function landLocalBranch({root, home, project, launcher, workId, view, run, cli, invocations, terminal, requests, reviews}) {
    const git = await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY ?? '/opt/homebrew/bin/git');
    const seed = path.join(root, 'receiver seed'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(seed, {mode: 0o700});
    for (const name of ['consumer.cjs', 'check.cjs']) await fs.copyFile(path.join(project, name), path.join(seed, name));
    await fs.writeFile(path.join(seed, 'consumer.cjs'), receiverBase);
    const native = (args, label) => run(git, args, label);
    await native(['init', '--initial-branch=main', seed], 'receiver-seed-init');
    await native(['-C', seed, 'add', 'consumer.cjs', 'check.cjs'], 'receiver-seed-add');
    await native(['-C', seed, '-c', 'user.name=Installed Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Original receiver basis'], 'receiver-seed-commit');
    const basis = (await native(['-C', seed, 'rev-parse', 'HEAD'], 'receiver-basis')).trim();
    await native(['init', '--bare', receiver], 'receiver-init');
    await native(['-C', seed, 'push', receiver, 'HEAD:refs/heads/main'], 'receiver-seed-push');
    const head = label => native(['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'], label).then(value => value.trim());
    const targetFile = path.join(root, 'target.json');
    await fs.writeFile(targetFile, JSON.stringify({projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: basis,
        publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs']}), {mode: 0o600});
    const target = await cli(['effect', 'register-target', '--target-profile', targetFile, '--git-binary', git], 'register-receiver');
    const database = path.join(home, 'state/controller.sqlite');
    const read = action => {const db = new DatabaseSync(database, {readOnly: true}); try {return action(db);} finally {db.close();}};
    const operations = () => read(db => db.prepare('SELECT * FROM effect_operations WHERE work=?').all(workId));
    const budgets = () => read(db => db.prepare('SELECT * FROM budgets WHERE lineage=? ORDER BY kind').all(workId));
    const beforeGrant = budgets(); assert.deepEqual(operations(), []);
    const prepare = ['effect', 'prepare-integration', '--work', workId, '--target', target.targetId, '--git-binary', git];
    await run(launcher, prepare, 'refuse-missing-grant', 15000, 2);
    assert.match(invocations.at(-1).stderr, /No actual current owner grant/);
    assert.deepEqual(operations(), []); assert.deepEqual(budgets(), beforeGrant);
    assert.equal(await head('receiver-before-grant'), basis);
    const grant = await cli(['effect', 'delegate-integration', '--work', workId, '--target', target.targetId,
        '--operation-limit', '1', '--scope', 'work', '--mode', 'ordinary'], 'delegate-local');
    const originalGrant = read(db => db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId));
    assert.equal(JSON.parse(originalGrant.data).operationLimit, 1); assert.equal(JSON.parse(originalGrant.data).scope, 'work');
    const prepared = JSON.parse(await run(launcher, prepare, 'prepare-local', 60000));
    assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared)); assert.equal(prepared.workId, workId);
    const derived = await cli(['change', 'inspect', '--work', workId], 'derived-review');
    assert.equal(derived.reviewReady, true); assert.notEqual(derived.candidateVersion, view.candidateVersion);
    const checked = derived.checks.find(check => check.candidate === derived.candidateVersion && check.status === 'pass');
    const original = view.checks.find(check => check.candidate === view.candidateVersion && check.status === 'pass');
    assert.ok(checked && original); assert.equal(checked.data.actual.exitCode, 0);
    assert.equal(checked.data.caseResults.complete, true); assert.equal(checked.data.parsed.value.cases.length, 2);
    assert.notEqual(checked.data.caseDescriptor.cases[0].inputDigest, original.data.caseDescriptor.cases[0].inputDigest);
    const reviewer = derived.launches.find(launch => launch.role === 'reviewer' && launch.data.inputVersions.candidate === derived.candidateVersion);
    assert.ok(reviewer); assert.equal(reviewer.data.cleanup, 'removed');
    const priorReviewer = view.launches.find(launch => launch.role === 'reviewer');
    assert.notEqual(reviewer.run, priorReviewer.run);
    assert.notEqual(reviewer.data.nativeSessionId, priorReviewer.data.nativeSessionId);
    const selected = read(db => JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data));
    assert.equal(reviewer.data.inputVersions.requirements, selected.requirementVersion);
    assert.equal(reviewer.data.inputVersions.contracts, selected.contractsVersion);
    const recovery = await recoverOwnerOriginal({workId, targetId: target.targetId, prepared, read, budgets, cli, terminal, requests, reviews, head});
    const expectedGrant = read(db => db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId));
    const reprepared = JSON.parse(await run(launcher, [...prepare, '--operation', prepared.operationId], 'reprepare-original', 60000));
    assert.equal(reprepared.phase, 'RESERVED', JSON.stringify(reprepared));
    assert.equal(reprepared.operationId, prepared.operationId);
    const final = await cli(['change', 'inspect', '--work', workId], 'final-current-procedures');
    assert.equal(final.reviewReady, true);
    const finalCandidate = final.versions.find(version => version.id === final.candidateVersion);
    assert.equal(await fs.readFile(path.join(finalCandidate.artifact, 'consumer.cjs'), 'utf8'), receiverCandidate);
    const current = read(db => JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(workId).data));
    const finalReview = final.launches.find(launch => launch.id === current.selection.general);
    assert.ok(finalReview);
    assert.equal(final.candidateVersion, derived.candidateVersion);
    assert.deepEqual(final.checks, derived.checks); assert.deepEqual(final.launches, derived.launches);
    assert.equal(finalReview.data.inputVersions.candidate, final.candidateVersion);
    assert.equal(finalReview.data.inputVersions.requirements, current.requirementVersion);
    assert.equal(finalReview.data.inputVersions.contracts, current.contractsVersion);
    assert.equal(finalReview.data.cleanup, 'removed');
    const finalCheck = final.checks.find(check => check.candidate === final.candidateVersion && check.status === 'pass');
    assert.ok(finalCheck); assert.equal(finalCheck.data.actual.exitCode, 0); assert.equal(finalCheck.data.caseResults.complete, true);
    assert.ok(reviews.some(review => review.candidateVersion === final.candidateVersion && review.consumer === receiverCandidate));
    assert.equal(JSON.parse(operations()[0].data).clientRoot, recovery.clientRoot);
    assert.equal(await head('receiver-before-dispatch'), basis);
    const sent = await cli(['effect', 'dispatch', '--operation', prepared.operationId, '--git-binary', git], 'dispatch-local');
    assert.equal(sent.phase, 'CONFIRMED', JSON.stringify(sent)); assert.equal(sent.operationId, prepared.operationId);
    const committed = await head('receiver-after-dispatch'); assert.notEqual(committed, basis);
    assert.equal(await native(['--git-dir=' + receiver, 'show', 'refs/heads/main:consumer.cjs'], 'receiver-result'), receiverCandidate);
    assert.equal(sent.integrationCommit, committed);
    assert.equal(await native(['--git-dir=' + receiver, 'diff', '--name-only', basis, committed], 'receiver-delta'), 'consumer.cjs\n');
    assert.equal(await native(['--git-dir=' + receiver, 'show', committed + ':check.cjs'], 'receiver-check-final'), await native(['--git-dir=' + receiver, 'show', basis + ':check.cjs'], 'receiver-check-basis'));
    await native(['--git-dir=' + receiver, 'merge-base', '--is-ancestor', basis, committed], 'receiver-ancestry');
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    const retained = operations(); assert.equal(retained.length, 1); assert.equal(retained[0].grant_id, grant.delegationId);
    const clientRoot = JSON.parse(retained[0].data).clientRoot; assert.ok(path.isAbsolute(clientRoot));
    const used = budgets();
    const reconciled = await cli(['effect', 'reconcile', '--operation', prepared.operationId, '--git-binary', git], 'reconcile-local');
    const repeated = await cli(['effect', 'dispatch', '--operation', prepared.operationId, '--git-binary', git], 'repeat-local');
    for (const result of [reconciled, repeated]) {assert.equal(result.phase, 'CONFIRMED'); assert.equal(result.operationId, prepared.operationId);}
    assert.equal(await head('receiver-after-repeat'), committed);
    assert.equal(operations().length, 1); assert.equal(JSON.parse(operations()[0].data).clientRoot, clientRoot);
    read(db => {
        assert.deepEqual(db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(grant.delegationId), expectedGrant);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='send'").get(prepared.operationId).n, 1);
    });
    for (const row of budgets()) {const prior = used.find(value => value.kind === row.kind); assert.equal(row.lim, prior.lim); assert.ok(row.consumed >= prior.consumed); assert.equal(row.reserved, 0);}
    const resultInspection = await inspectInstalledManagedResult({root, project, workId, view: final,
        operationId: prepared.operationId, read, terminal, requests, reviews, sourceBase});
    return {endpoint: 'CONFIRMED', operationId: prepared.operationId, targetId: target.targetId, grantId: grant.delegationId,
        basis, committed, clientRoot, recovery, resultInspection, candidateVersion: final.candidateVersion, scope: 'Explicitly delegated private local bare branch; one send, actual current procedures, no hosted PR claim'};
}
