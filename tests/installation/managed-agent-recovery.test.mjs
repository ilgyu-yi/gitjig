import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {managedFixtureInputs, assertCurrentBuild, withInstalledManagedFixture, receiverBase, receiverCandidate, sourceBase} from './managed-installed-fixture.mjs';

test('installed coordinator recovers its original cancelled task and definitely-unsent integration using observed SDK operands', {timeout: 240000}, async t => {
    const fixture = await managedFixtureInputs();
    await withInstalledManagedFixture(t, fixture, recoverAgent);
    await assertCurrentBuild(fixture.built);
});

async function recoverAgent({root, home, project, terminal, run, cli, requests, result, setOrdinaryResponder, setRoleResponseGate}) {
    const git = await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY ?? '/opt/homebrew/bin/git');
    const seed = path.join(root, 'recovery seed'), receiver = path.join(root, 'recovery-receiver.git');
    await fs.mkdir(seed, {mode: 0o700});
    await fs.writeFile(path.join(seed, 'consumer.cjs'), receiverBase);
    await fs.copyFile(path.join(project, 'check.cjs'), path.join(seed, 'check.cjs'));
    await run(git, ['init', '--initial-branch=main', seed], 'recovery-seed-init');
    await run(git, ['-C', seed, 'add', 'consumer.cjs', 'check.cjs'], 'recovery-seed-add');
    await run(git, ['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Original recovery basis'], 'recovery-seed-commit');
    const basis = (await run(git, ['-C', seed, 'rev-parse', 'HEAD'], 'recovery-basis')).trim();
    await run(git, ['init', '--bare', receiver], 'recovery-receiver-init');
    await run(git, ['-C', seed, 'push', receiver, 'HEAD:refs/heads/main'], 'recovery-seed-push');
    const head = async label => (await run(git, ['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'], label)).trim();
    const targetFile = path.join(root, 'recovery-target.json');
    await fs.writeFile(targetFile, JSON.stringify({projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: basis,
        publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs']}), {mode: 0o600});
    const {targetId} = await cli(['effect', 'register-target', '--target-profile', targetFile, '--git-binary', git], 'recovery-register-target');
    const args = ['conversation', 'ui', '--delegate-projects', 'P', '--max-assignments', '2', '--delegate-integrations', 'P:' + targetId + ':1', '--git-binary', git];
    const instructions = 'Export3 using the existing consumer; publish only agent delta and keep the user local edit local';
    let phase = 'initial', turn = 0, rootView, assigned, integrated, observed, recovered, closed = false;
    const turns = [], textOf = content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
    setOrdinaryResponder(body => {
        assert.ok(turn < (phase === 'initial' ? 5 : 7), 'Finite coordinator phase');
        const names = new Map(body.messages.flatMap(message => (message.tool_calls ?? []).map(call => [call.id, call.function.name])));
        const returned = body.messages.filter(message => message.role === 'tool').map(message => ({name: names.get(message.tool_call_id), value: JSON.parse(textOf(message.content))}));
        const receipt = name => {const value = returned.findLast(item => item.name === name); assert.ok(value, 'Actual returned SDK result: ' + name); return value.value;};
        turns.push({phase, turn, returned});
        const tool = (name, arguments_) => ({tool: {name, arguments: arguments_}});
        if (phase === 'initial') switch (turn++) {
            case 0: return tool('conversation_status', {});
            case 1: rootView = receipt('conversation_status').find(view => view.projectId === null && view.state === 'RUNNING' && view.workId); assert.ok(rootView); return tool('conversation_assign', {projectId: 'P', instructions, operation: 'change', resultDependency: true});
            case 2: assigned = receipt('conversation_assign'); return tool('conversation_wait', {resultHandles: [assigned.assignmentId]});
            case 3: return tool('conversation_integrate', {reviewedAssignmentId: assigned.assignmentId, targetId});
            case 4: integrated = receipt('conversation_integrate'); return tool('conversation_wait', {resultHandles: [integrated.assignmentId]});
        }
        else switch (turn++) {
            case 0: assert.equal(receipt('conversation_assign').assignmentId, assigned.assignmentId); return tool('conversation_status', {conversationId: assigned.conversationId});
            case 1: observed = receipt('conversation_status'); assert.ok(Number.isSafeInteger(observed.workEpoch)); return tool('conversation_recover_assignment', {assignmentId: assigned.assignmentId, expectedWorkEpoch: observed.workEpoch, observedDirectionRevision: observed.directionRevision, reason: 'Recover this original cancelled task under the same current coordinator'});
            case 2: recovered = receipt('conversation_recover_assignment'); assert.equal(recovered.assignmentId, assigned.assignmentId); return tool('conversation_assign', {conversationId: assigned.conversationId, observedDirectionRevision: recovered.directionRevision, projectId: 'P', instructions, operation: 'change', resultDependency: true});
            case 3: assert.equal(receipt('conversation_assign').assignmentId, assigned.assignmentId); return tool('conversation_wait', {resultHandles: [assigned.assignmentId]});
            case 4: return tool('conversation_integrate', {reviewedAssignmentId: assigned.assignmentId, targetId});
            case 5: {const renewed = receipt('conversation_integrate'); assert.equal(renewed.operationId, integrated.operationId); assert.equal(renewed.assignmentId, integrated.assignmentId); return tool('conversation_wait', {resultHandles: [integrated.assignmentId]});}
            case 6: return {text: 'AGENT_ORIGINAL_RECOVERY_DELIVERED'};
        }
    });
    const heldFile = path.join(root, 'derived-review-held');
    setRoleResponseGate(async ({text, response}) => {
        if (!text.startsWith('Perform the assigned reviewer task') || !text.includes(receiverCandidate)) return;
        const body = JSON.parse(text.split('\n')[1]);
        await fs.writeFile(path.join(root, 'held-derived-review.json'), JSON.stringify({candidateVersion: body.context.candidateVersion, scope: body.requiredScope}), {mode: 0o600});
        await fs.writeFile(heldFile, 'actual-derived-review-awaiting-response', {mode: 0o600});
        await new Promise(resolve => {if (response.destroyed) {closed = true; resolve();} else response.once('close', () => {closed = true; resolve();});});
    });
    try {
        await terminal('agent-recovery-interrupt', [
            {wait: 'Model: original', send: '\x15/new root\x1b\r'},
            {wait: 'Independent conversation opened · unbound', send: '/model installed-managed/original\x1b\r'},
            {wait: 'Model: original', send: 'Create one reviewed export3 child and integrate it to the delegated local target ' + targetId + '\r'},
            {wait: 'INPUT · WAITING', waitFiles: [{path: heldFile, value: 'actual-derived-review-awaiting-response'}], send: '/quit\x1b\r'}
        ], 75, args);
    } finally {setRoleResponseGate(null);}
    assert.equal(closed, true); assert.equal(turn, 5); assert.ok(rootView && assigned && integrated);
    Object.assign(result, {parentWork: rootView.workId, parentConversation: rootView.conversationId, assignmentId: assigned.assignmentId, operationId: integrated.operationId, aliasId: integrated.assignmentId});
    const database = path.join(home, 'state/controller.sqlite'), read = fn => {const db = new DatabaseSync(database, {readOnly: true}); try {return fn(db);} finally {db.close();}};
    const one = (table, id) => read(db => db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id));
    const operation = () => one('effect_operations', integrated.operationId);
    const retainedView = await cli(['effect', 'inspect', '--operation', integrated.operationId], 'recovery-original-effect');
    const original = operation(); assert.equal(original.work, retainedView.workId);
    const clientRoot = JSON.parse(original.data).clientRoot, marker = path.join(clientRoot, 'native-owner.json');
    const markerBytes = await fs.readFile(marker), markerStat = await fs.stat(marker), clientStat = await fs.stat(clientRoot);
    const originalGrant = one('effect_delegations', original.grant_id);
    assert.equal(original.phase, 'REFUSED'); assert.equal(retainedView.transportOutcome, null);
    for (const key of ['dispatchRun', 'confirmed']) assert.equal(Object.hasOwn(JSON.parse(original.data), key), false);
    assert.equal(await head('recovery-unsent-head'), basis);
    read(db => {assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind IN ('send','native-preflight','readback','reconciliation')").get(original.id).n, 0);});
    const requestsBeforeOwner = requests.length;
    await cli(['work', 'cancel', '--work', rootView.workId], 'cancel-original-root');
    const cancelled = one('conversation_assignments', assigned.assignmentId), alias = one('conversation_assignments', integrated.assignmentId);
    assert.equal(cancelled.state, 'CANCELLED'); assert.equal(alias.state, 'CANCELLED');
    assert.equal(JSON.parse(cancelled.data).cancellationSource, JSON.parse(alias.data).cancellationSource);
    const cancellation = one('sources', JSON.parse(alias.data).cancellationSource); assert.equal(JSON.parse(cancellation.origin).kind, 'owner-task-cancel');
    const child = one('works', original.work), parent = one('works', rootView.workId);
    assert.equal(child.state, 'CANCELLED'); assert.equal(parent.state, 'CANCELLED');
    const budgets = () => read(db => db.prepare('SELECT * FROM budgets ORDER BY rowid').all());
    const beforeOwner = budgets();
    await terminal('recover-original-root-and-ceiling', [
        {wait: 'Model: original', send: '\x15/work ' + rootView.workId + '\x1b\r'},
        {wait: 'Work recovery · #', send: 'Review original conversation admission\r'},
        {wait: 'Owner reason to recover original conversation admission', send: 'Restore the original coordinator and retain cancelled children\r'},
        {wait: 'Review exact original conversation admission', send: '\x1b'},
        {wait: 'Confirm original conversation admission recovery', send: 'Recover this original conversation admission\r'},
        {wait: 'admission recovered', send: '\x15/work ' + rootView.workId + '\x1b\r'},
        {wait: 'Work recovery · #', send: 'Extend shared execution allowance\r'},
        {wait: 'Additional execution units', send: '\x154\r'},
        {wait: 'Owner reason for this bounded work allowance extension', send: 'Allow the additional recovery turns while retaining prior use\r'},
        {wait: 'Extend execution · #', send: '\r'},
        {wait: 'Shared execution allowance extended', send: '\x15/work ' + retainedView.workId + '\x1b\r'},
        {wait: 'Work recovery · #', send: 'Extend shared resolution allowance\r'},
        {wait: 'Additional resolution units', send: '\x154\r'},
        {wait: 'Owner reason for this bounded work allowance extension', send: 'Permit mandatory recovered-task planning and review while retaining used resolution\r'},
        {wait: 'Extend resolution · #', send: '\r'},
        {wait: 'Shared resolution allowance extended', send: '\x15/repo\x1b\r'},
        {wait: 'Repository management · owner actions', send: 'Integration targets\r'},
        {wait: 'Integration targets · retained observations', send: targetId + '\r'},
        {wait: 'Original integration target · actions', send: 'Delegate ordinary integration to owner work\r'},
        {wait: 'Integration delegation · select original owner work', send: rootView.workId + '\r'},
        {wait: 'Original integration delegation held', send: '\x1b'},
        {wait: 'Original grant is stale', send: 'Review renewal of this original grant\r'},
        {wait: 'Owner reason to renew the same integration grant', send: 'Keep this original lineage grant and its cumulative operation ceiling\r'},
        {wait: 'Review exact original grant renewal', send: '\x1b'},
        {wait: 'Confirm exact original grant renewal', send: 'Renew this original grant\r'},
        {wait: 'Original integration grant renewed', send: '\x1b'},
        {wait: 'Integration delegation · select original owner work', send: 'Back\r'},
        {wait: 'Integration targets · retained observations', send: 'Back\r'},
        {wait: 'Repository management · owner actions', send: 'Close\r'},
        {wait: 'INPUT · IDLE', send: '\x15/quit\x1b\r'}
    ], 30, args);
    assert.equal(requests.length, requestsBeforeOwner);
    const renewedGrant = one('effect_delegations', original.grant_id);
    assert.equal(renewedGrant.epoch, originalGrant.epoch + 1);
    assert.equal(JSON.parse(renewedGrant.data).operationLimit, 1);
    for (const row of budgets()) {const before = beforeOwner.find(value => value.lineage === row.lineage && value.kind === row.kind); assert.equal(row.consumed, before.consumed); assert.equal(row.reserved, before.reserved); assert.equal(row.lim, before.lim + (row.lineage === parent.lineage && row.kind === 'execution' || row.lineage === child.lineage && row.kind === 'resolution' ? 4 : 0));}
    assert.equal(one('conversation_assignments', assigned.assignmentId).state, 'CANCELLED');
    assert.equal(operation().phase, 'REFUSED');
    phase = 'recover'; turn = 0;
    await terminal('agent-recover-same-originals', [
        {wait: 'Model: original', send: 'Recover the original task and its definitely-unsent integration; keep export3 and the original source.\r'},
        {wait: 'AGENT_ORIGINAL_RECOVERY_DELIVERED', waitIdle: true, send: '/quit\x1b\r'}
    ], 90, args);
    assert.equal(turn, 7);
    const final = operation(), data = JSON.parse(final.data);
    assert.equal(final.phase, 'CONFIRMED');
    for (const key of ['id', 'work', 'target', 'grant_id']) assert.equal(final[key], original[key]);
    assert.equal(data.clientRoot, clientRoot);
    assert.equal(one('conversation_assignments', assigned.assignmentId).state, 'COMPLETE');
    assert.equal(one('conversation_assignments', integrated.assignmentId).state, 'COMPLETE');
    assert.equal(one('conversation_assignments', assigned.assignmentId).work, child.id);
    assert.deepEqual(await fs.readFile(marker), markerBytes);
    for (const [file, prior] of [[marker, markerStat], [clientRoot, clientStat]]) {const after = await fs.stat(file); assert.equal(after.dev, prior.dev); assert.equal(after.ino, prior.ino);}
    read(db => {assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations WHERE grant_id=?').get(original.grant_id).n, 1);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='send'").get(original.id).n, 1);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='agent-reauthorization'").get(original.id).n, 1);});
    const finalChild = await cli(['change', 'inspect', '--work', child.id], 'recovered-agent-child'); assert.equal(finalChild.reviewReady, true);
    assert.ok(finalChild.checks.some(check => check.candidate === finalChild.candidateVersion && check.status === 'pass' && check.data.actual.exitCode === 0 && check.data.caseResults.complete));
    read(db => {
        const selected = JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(child.id).data);
        const review = finalChild.launches.find(launch => launch.id === selected.selection.general); assert.ok(review);
        assert.equal(review.status, 'COMPLETE'); assert.equal(review.data.cleanup, 'removed');
        assert.equal(review.data.inputVersions.candidate, finalChild.candidateVersion);
        assert.equal(review.data.inputVersions.requirements, selected.requirementVersion);
        assert.equal(review.data.inputVersions.contracts, selected.contractsVersion);
        const completed = JSON.parse(db.prepare('SELECT data FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(rootView.conversationId).data).result;
        assert.equal(completed.status, 'delivered');
        const settled = db.prepare('SELECT * FROM runs WHERE id=?').get(completed.runId);
        assert.equal(settled.work, parent.id); assert.equal(settled.phase, 'SETTLED');
        const inherited = db.prepare("SELECT * FROM conversation_inputs WHERE conversation=? AND json_extract(data,'$.inheritedOwnerSource') IS NOT NULL").all(assigned.conversationId);
        assert.ok(inherited.length > 0, 'Actual later canonical owner source inherited by original child');
        for (const input of inherited) {
            const provenance = JSON.parse(input.data);
            assert.equal(provenance.assignment, assigned.assignmentId); assert.equal(provenance.parentConversation, rootView.conversationId);
            assert.equal(input.source, provenance.inheritedOwnerSource);
            const source = db.prepare('SELECT * FROM sources WHERE id=?').get(input.source); assert.equal(input.text, source.raw);
            const direction = db.prepare('SELECT * FROM conversation_directions WHERE conversation=? AND source=?').get(assigned.conversationId, input.source);
            const decision = JSON.parse(direction.data); assert.equal(decision.inherited, true); assert.equal(decision.effectHold, false);
            assert.equal(decision.decision.inputId, input.id);
            const launch = db.prepare('SELECT * FROM role_launches WHERE id=?').get(decision.decision.launch);
            assert.equal(launch.work, child.id); assert.equal(launch.role, 'adjudicator'); assert.equal(launch.status, 'COMPLETE');
            assert.ok(['source-fit', 'planning-adjudication'].includes(JSON.parse(launch.data).stage));
        }
    });
    assert.equal(await head('recovered-agent-head'), data.integrationCommit);
    assert.equal(await run(git, ['--git-dir=' + receiver, 'show', 'refs/heads/main:consumer.cjs'], 'recovered-agent-consumer'), receiverCandidate);
    assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
    for (const row of budgets()) {const before = beforeOwner.find(value => value.lineage === row.lineage && value.kind === row.kind); assert.ok(row.consumed >= before.consumed); assert.equal(row.reserved, 0);}
    Object.assign(result, {parentWork: parent.id, workId: child.id, assignmentId: assigned.assignmentId, operationId: final.id, aliasId: integrated.assignmentId,
        grantId: final.grant_id, clientRoot, observed, recovered, turns, scope: 'Installed original coordinator/task/native-origin recovery through public owner decisions and actual SDK procedures; scripted HTTP, private local branch only'});
    await fs.writeFile(path.join(root, 'agent-recovery.json'), JSON.stringify(result, null, 2), {mode: 0o600});
    return result;
}
