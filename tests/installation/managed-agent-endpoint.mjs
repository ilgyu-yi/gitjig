import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export async function installedAgentEndpoint({root, home, project, terminal, run, cli, setOrdinaryResponder, receiverBase, receiverCandidate, sourceBase, prepareCoordinator}) {
    const git = await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY ?? '/opt/homebrew/bin/git');
    const seed = path.join(root, 'receiver seed'), receiver = path.join(root, 'agent-receiver.git');
    await run(git, ['init', '--bare', receiver], 'agent-receiver-init');
    await run(git, ['-C', seed, 'push', receiver, 'HEAD:refs/heads/main'], 'agent-receiver-basis');
    const basis = (await run(git, ['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'], 'agent-basis')).trim();
    const file = path.join(root, 'agent-target.json');
    await fs.writeFile(file, JSON.stringify({projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: basis,
        publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs']}), {mode: 0o600});
    const {targetId} = await cli(['effect', 'register-target', '--target-profile', file, '--git-binary', git], 'agent-register-target');
    const original = prepareCoordinator ? await prepareCoordinator({targetId,git}) : null;
    let turn = original?.assignmentAlreadyRestored?2:0, assigned, integrated;
    const coordinatorRequests = [];
    const content = value => typeof value === 'string' ? value : value.filter(part => part.type === 'text').map(part => part.text).join('');
    setOrdinaryResponder(body => {
        assert.ok(turn < (original?.assignmentId?8:5), 'Finite coordinator HTTP turn budget');
        const names = new Map(body.messages.flatMap(message => (message.tool_calls ?? []).map(call => [call.id, call.function.name])));
        const results = body.messages.filter(message => message.role === 'tool').map(message => ({
            name: names.get(message.tool_call_id), value: JSON.parse(content(message.content))
        }));
        const receipt = name => {
            const row = results.findLast(result => result.name === name); assert.ok(row, 'Actual SDK tool result: ' + name);
            assert.equal(typeof row.value.assignmentId, 'string'); return row.value;
        };
        const declared = body.tools.map(tool => tool.function.name);
        for (const name of ['conversation_assign', 'conversation_wait', 'conversation_integrate']) assert.ok(declared.includes(name));
        coordinatorRequests.push({turn, results});
        if(original?.assignmentId){
            const value=name=>{const row=results.findLast(result=>result.name===name);assert.ok(row,'Actual SDK recovery result '+name);return row.value;};
            switch(turn++){
                case 0:return{tool:{name:'conversation_status',arguments:{conversationId:original.assignment.target}}};
                case 1:{const observed=value('conversation_status');return{tool:{name:'conversation_recover_assignment',arguments:{assignmentId:original.assignmentId,expectedWorkEpoch:observed.workEpoch,observedDirectionRevision:observed.directionRevision,reason:'Restore same installed inherited task'}}};}
                case 2:assert.equal(value('conversation_recover_assignment').state,'RECOVERY_READY');return{tool:{name:'conversation_status',arguments:{conversationId:original.assignment.target}}};
                case 3:return{tool:{name:'conversation_assign',arguments:{conversationId:original.assignment.target,observedDirectionRevision:value('conversation_status').directionRevision,projectId:'P',instructions:'Export3 using the existing consumer; publish only agent delta and keep the user local edit local',operation:'change',resultDependency:true}}};
                case 4:assigned=receipt('conversation_assign');assert.equal(assigned.assignmentId,original.assignmentId);return{tool:{name:'conversation_wait',arguments:{resultHandles:[assigned.assignmentId]}}};
                case 5:return{tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:assigned.assignmentId,targetId}}};
                case 6:integrated=receipt('conversation_integrate');return{tool:{name:'conversation_wait',arguments:{resultHandles:[integrated.assignmentId]}}};
                case 7:return{text:'INSTALLED_AGENT_ENDPOINT_RECEIVED'};
            }
        }
        switch (turn++) {
            case 0: return {tool: {name: 'conversation_assign', arguments: {projectId: 'P', instructions: 'Export3 using the existing consumer; publish only agent delta and keep the user local edit local', operation: 'change', resultDependency: true}}};
            case 1: assigned = receipt('conversation_assign'); return {tool: {name: 'conversation_wait', arguments: {resultHandles: [assigned.assignmentId]}}};
            case 2: return {tool: {name: 'conversation_integrate', arguments: {reviewedAssignmentId: assigned.assignmentId, targetId}}};
            case 3: integrated = receipt('conversation_integrate'); return {tool: {name: 'conversation_wait', arguments: {resultHandles: [integrated.assignmentId]}}};
            case 4: return {text: 'INSTALLED_AGENT_ENDPOINT_RECEIVED'};
        }
    });
    const args = ['conversation', 'ui', '--delegate-projects', 'P', '--max-assignments', '2', '--delegate-integrations', 'P:' + targetId + ':1', '--git-binary', git,...(original?['--conversation',original.conversationId]:[])];
    await terminal('agent-coordinator', [
        ...(original?original.steps:[{wait: 'Model: original', send: '\x15/new root\x1b\r'},
        {wait: 'Independent conversation opened · unbound', send: '/model installed-managed/original\x1b\r'}]),
        {wait: original?.readyWait??'Model: original',...(original?.readyQueries?{queries:original.readyQueries}:{}),send: 'Create one reviewed export3 child and integrate it to the explicitly delegated local target ' + targetId + '\r'},
        {wait: 'INSTALLED_AGENT_ENDPOINT_RECEIVED', waitIdle: true, send: '/quit\x1b\r'}
    ], 70, args);
    assert.equal(turn, original?.assignmentId?8:5); assert.ok(assigned && integrated);
    const db = new DatabaseSync(path.join(home, 'state/controller.sqlite'), {readOnly: true});
    let result;
    try {
        const assignment = db.prepare('SELECT * FROM conversation_assignments WHERE id=?').get(assigned.assignmentId);
        const alias = db.prepare('SELECT * FROM conversation_assignments WHERE id=?').get(integrated.assignmentId);
        assert.equal(assignment.state, 'COMPLETE'); assert.equal(alias.state, 'COMPLETE'); assert.equal(alias.work, assignment.work);
        const aliasData = JSON.parse(alias.data), operation = db.prepare('SELECT * FROM effect_operations WHERE id=?').get(aliasData.effectOperationId);
        assert.equal(operation.phase, 'CONFIRMED'); assert.equal(operation.work, assignment.work); assert.equal(operation.target, targetId);
        const data = JSON.parse(operation.data), grant = db.prepare('SELECT * FROM effect_delegations WHERE id=?').get(operation.grant_id), grantData = JSON.parse(grant.data);
        const parent = db.prepare('SELECT * FROM conversation_state WHERE conversation=?').get(assignment.source_conversation);
        assert.equal(grant.root, original?.rootWorkId??parent.work); assert.notEqual(operation.work, parent.work);
        if(original){assert.equal(parent.work,original.workId);assert.equal(grant.id,original.grantId);}
        assert.equal(grantData.scope, 'delegation-lineage'); assert.equal(grantData.operationLimit, 1);
        assert.equal(data.reviewedAssignmentId, assignment.id); assert.equal(data.origin.identity.workId, parent.work);
        assert.equal(data.origin.identity.conversationId, assignment.source_conversation);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM effect_receipts WHERE operation=? AND kind='send'").get(operation.id).n, 1);
        const completed = JSON.parse(db.prepare('SELECT data FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(assignment.source_conversation).data).result;
        assert.equal(completed.status, 'delivered');
        const settled = db.prepare('SELECT * FROM runs WHERE id=?').get(completed.runId); assert.equal(settled.work, parent.work); assert.equal(settled.phase, 'SETTLED');
        assert.equal(parent.resource, 'IDLE');
        const change = await cli(['change', 'inspect', '--work', assignment.work], 'agent-child-current'); assert.equal(change.reviewReady, true);
        assert.ok(change.checks.some(check => check.candidate === change.candidateVersion && check.status === 'pass' && check.data.actual.exitCode === 0 && check.data.caseResults.complete && !check.data.caseResults.mismatches.length));
        const selected = JSON.parse(db.prepare('SELECT data FROM change_state WHERE work=?').get(assignment.work).data);
        const review = change.launches.find(launch => launch.id === selected.selection.general); assert.ok(review);
        assert.equal(review.data.inputVersions.candidate, change.candidateVersion);
        const work=db.prepare('SELECT epoch FROM works WHERE id=?').get(assignment.work),author=change.launches.find(launch=>launch.role==='implementer');assert.ok(author);assert.notEqual(review.run,author.run);assert.equal(db.prepare('SELECT epoch FROM runs WHERE id=?').get(review.run).epoch,work.epoch);
        assertAgentStanding(db, {parentWork: parent.work, grant, review, selected,priorOutcomes:original?.priorOutcomes??(original?['delivered']:[])}); assert.equal(review.data.cleanup, 'removed'); await fs.access(review.data.historyRef);
        const candidate = change.versions.find(version => version.id === change.candidateVersion);
        assert.equal(await fs.readFile(path.join(candidate.artifact, 'consumer.cjs'), 'utf8'), receiverCandidate);
        const head = (await run(git, ['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'], 'agent-final-head')).trim(); assert.equal(head, data.integrationCommit);
        assert.equal(await run(git, ['--git-dir=' + receiver, 'show', head + ':consumer.cjs'], 'agent-final-consumer'), receiverCandidate);
        assert.equal(await run(git, ['--git-dir=' + receiver, 'show', basis + ':consumer.cjs'], 'agent-original-consumer'), receiverBase);
        assert.equal(await run(git, ['--git-dir=' + receiver, 'diff', '--name-only', basis, head], 'agent-exact-delta'), 'consumer.cjs\n');
        assert.equal(await fs.readFile(path.join(project, 'consumer.cjs'), 'utf8'), sourceBase);
        const interrupted=db.prepare("SELECT id,phase,reservation,data FROM runs WHERE phase!='SETTLED' ORDER BY id").all();assert.deepEqual(interrupted.map(row=>row.id),[...(original?.retainedInterruptedRunIds??[])].sort());for(const row of interrupted){assert.equal(row.phase,'INTERRUPTED');assert.equal(row.reservation,'consumed');assert.equal(JSON.parse(row.data).cleanup,'removed');}
        assert.equal(db.prepare("SELECT COUNT(*) n FROM capacity_leases WHERE state!='RELEASED'").get().n, 0);
        result = {parentWork: parent.work, parentConversation: assignment.source_conversation, assignmentId: assignment.id, workId: assignment.work,
            aliasId: alias.id, operationId: operation.id, grantId: grant.id, targetId, head, candidateVersion: change.candidateVersion, coordinatorRequests,
            scope: 'Actual installed SDK assign/wait/integrate/wait, child engine procedures, authorized private local branch and settled parent; scripted HTTP answers, no live hosting or agent recovery claim'};
    } finally {db.close(); setOrdinaryResponder(null);}
    await fs.writeFile(path.join(root, 'agent-endpoint.json'), JSON.stringify(result, null, 2), {mode: 0o600});
    return result;
}

// Independently executable, read-only standing checks over the actual retained run.
export function assertAgentStanding(db, {parentWork, grant, review, selected,priorOutcomes=[]}) {
    assert.equal(JSON.parse(grant.data).mode, 'ordinary');
    assert.equal(review.data.inputVersions.requirements, selected.requirementVersion);
    assert.equal(review.data.inputVersions.contracts, selected.contractsVersion);
    const turns = db.prepare('SELECT * FROM runs WHERE work=? ORDER BY rowid').all(parentWork);
    assert.deepEqual(turns.map(run => JSON.parse(run.data).outcome), [...priorOutcomes,'waiting', 'waiting', 'delivered']);
    assert.ok(turns.every(run => run.phase === 'SETTLED' && run.reservation === 'consumed'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM budgets WHERE reserved!=0').get().n, 0);
}
