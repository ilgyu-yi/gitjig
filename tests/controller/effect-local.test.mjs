import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
const execute = promisify(execFile), git = '/opt/homebrew/bin/git', runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
import {scripted,settledRoot,cleanupFixture,withValueCases} from './effect-fixture.mjs';
test('actual reviewed dirty S/C projects to owned bare H; derived C prime is rechecked/reviewed before one conditional forward send', { timeout: 90000 }, async () => {
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/effect-core-'))), home = path.join(root, 'home'), source = path.join(root, 'source'), seed = path.join(root, 'seed'), receiver = path.join(root, 'receiver.git');
    await fs.mkdir(source);
    await fs.mkdir(seed);
    const initial = '// User local choice: 10\n' + Array.from({ length: 8 }, (_, i) => '// Context ' + i + '\n').join('') + 'module.exports=2;\n', dirty = initial.replace('choice: 10', 'choice: 11'), checker = withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`);
    await fs.writeFile(path.join(seed, 'consumer.cjs'), initial);
    await fs.writeFile(path.join(seed, 'check.cjs'), checker);
    await execute(git, ['init', '--initial-branch=main', seed]);
    await execute(git, ['-C', seed, 'add', 'consumer.cjs', 'check.cjs']);
    await execute(git, ['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial K']);
    const K = (await execute(git, ['-C', seed, 'rev-parse', 'HEAD'])).stdout.trim();
    await execute(git, ['init', '--bare', receiver]);
    await execute(git, ['-C', seed, 'push', receiver, 'HEAD:refs/heads/main']);
    await fs.writeFile(path.join(source, 'consumer.cjs'), dirty);
    await fs.writeFile(path.join(source, 'check.cjs'), checker);
    let passed=false;
    let c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git } });
    process.env.TMPDIR = path.join(home, 'artifacts');
    try {
        await c.registerProject({ id: 'P', sourceRoot: source });
        const { targetId } = await c.registerLocalTarget({ projectId: 'P', path: receiver, ref: 'refs/heads/main', basisCommit: K, publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs'] });
        const model = scripted(), begun = await c.beginChange({ projectId: 'P', request: 'Export3; publish only agent delta, keep user local edit local', executionLimit: 64, resolutionLimit: 16 }), ready = await c.driveChange({ workId: begun.workId, model });
        assert.equal(ready.reviewReady, true, JSON.stringify(ready.blocked));
        await assert.rejects(c.prepareIntegration({ workId: begun.workId, targetId, model }), /No actual current owner grant/);
        c.delegateIntegration({ workId: begun.workId, targetId, mode: 'ordinary', operationLimit: 4 });
        const prepared = await c.prepareIntegration({ workId: begun.workId, targetId, model });
        assert.equal(prepared.phase, 'RESERVED', JSON.stringify(prepared));
        const derived = c.inspectChange(begun.workId);
        assert.notEqual(derived.candidateVersion, ready.candidateVersion);
        assert.ok(derived.checks.some(r => r.candidate === derived.candidateVersion && r.status === 'pass'));
        const originalCases=ready.checks.find(r=>r.candidate===ready.candidateVersion&&r.status==='pass'),derivedCases=derived.checks.find(r=>r.candidate===derived.candidateVersion&&r.status==='pass');
        assert.equal(derivedCases.data.caseResults.complete,true);assert.equal(derivedCases.data.parsed.value.cases.length,2);assert.notEqual(originalCases.data.caseDescriptor.cases[0].inputDigest,derivedCases.data.caseDescriptor.cases[0].inputDigest);
        assert.ok(derived.launches.some(l => l.role === 'reviewer' && l.data.inputVersions.candidate === derived.candidateVersion));
        const rootView = derived.versions.find(v => v.id === derived.candidateVersion);
        assert.equal(await fs.readFile(path.join(rootView.artifact, 'consumer.cjs'), 'utf8'), initial.replace('exports=2', 'exports=3'));
        assert.equal((await execute(git, ['--git-dir=' + receiver, 'rev-parse', 'refs/heads/main'])).stdout.trim(), K);
        const evidence = await c.changeCore.currentEvidence(begun.workId), selectedReview = derived.launches.find(l => l.role === 'reviewer' && l.data.inputVersions.candidate === derived.candidateVersion);
        c.store.run('UPDATE role_launches SET status=? WHERE id=?','UNUSABLE',selectedReview.id);
        assert.throws(()=>c.changeCore.assertCurrentEvidence(evidence),/review|roster|eligible|complete/i);
        const stale = await c.dispatchIntegration({operationId:prepared.operationId});
        assert.equal(stale.phase,'REFUSED');assert.equal(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='send'",prepared.operationId).length,0);assert.equal((await execute(git,['--git-dir='+receiver,'rev-parse','refs/heads/main'])).stdout.trim(),K);
        c.store.run('UPDATE role_launches SET status=? WHERE id=?',selectedReview.status,selectedReview.id);
        const recovered = await c.prepareIntegration({workId:begun.workId,targetId,model,operationId:prepared.operationId});assert.equal(recovered.phase,'RESERVED',JSON.stringify(recovered));assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE work=?',begun.workId).n,1);
        const sent = await c.dispatchIntegration({ operationId: prepared.operationId });
        assert.equal(sent.phase, 'CONFIRMED', JSON.stringify(sent));
        assert.equal((await execute(git, ['--git-dir=' + receiver, 'show', 'refs/heads/main:consumer.cjs'])).stdout, initial.replace('exports=2', 'exports=3'));
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), dirty);
        assert.equal(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='send'", prepared.operationId).length, 1);
        await c.close();
        c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git } });
        assert.equal(c.inspectEffect(prepared.operationId).phase, 'CONFIRMED');
        assert.equal((await c.reconcileEffect({ operationId: prepared.operationId })).phase, 'CONFIRMED');
        assert.equal(c.store.all("SELECT * FROM effect_receipts WHERE operation=? AND kind='send'", prepared.operationId).length, 1);
        const receiver2 = path.join(root, 'agent-receiver.git');
        await execute(git, ['init', '--bare', receiver2]);
        await execute(git, ['-C', seed, 'push', receiver2, 'HEAD:refs/heads/main']);
        const target2 = await c.registerLocalTarget({ projectId: 'P', path: receiver2, ref: 'refs/heads/main', basisCommit: K, publicationInventory: ['consumer.cjs', 'check.cjs'], authorizedDeltaPaths: ['consumer.cjs'] });
        await c.close();
        c = await openController({ installationHome: home, runtimeProfile, effectsProfile: { gitBinary: git }, interactionDelegation: { projectIds: ['P'], maxAssignments: 4 }, effectDelegations: [{ projectId: 'P', targetId: target2.targetId, operationLimit: 1 }] });
        const parent = c.createConversation(), agent = scripted((context, turn) => {
            const receipt = (name) => {
                const result = context.messages.filter(m => m.role === 'toolResult' && m.toolName === name).at(-1);
                return JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join(''));
            };
            if (turn === 0)
                return { tool: { name: 'conversation_assign', arguments: { projectId: 'P', instructions: 'Export3 and publish only agent delta; preserve user local edit locally', operation: 'change', resultDependency: true } } };
            if (turn === 1)
                return { tool: { name: 'conversation_wait', arguments: { resultHandles: [receipt('conversation_assign').assignmentId] } } };
            if (turn === 2)
                return { tool: { name: 'conversation_integrate', arguments: { reviewedAssignmentId: receipt('conversation_assign').assignmentId, targetId: target2.targetId } } };
            if (turn === 3)
                return { tool: { name: 'conversation_wait', arguments: { resultHandles: [receipt('conversation_integrate').assignmentId] } } };
            if(turn===4)return {tool:{name:'conversation_assign',arguments:{projectId:'P',instructions:'Second independent reviewed task exports3 using existing consumer',operation:'change',resultDependency:true}}};
            if(turn===5)return {tool:{name:'conversation_wait',arguments:{resultHandles:[receipt('conversation_assign').assignmentId]}}};
            if(turn===6)return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:receipt('conversation_integrate').assignmentId,targetId:target2.targetId}}};
            if(turn===7)return {tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:receipt('conversation_assign').assignmentId,targetId:target2.targetId}}};
            return { text: 'Actual result received; effect alias is not original provenance and cumulative operation cap blocks second child integration' };
        });
        await c.queueConversationInput({ conversationId: parent.conversationId, expectedGeneration: 0, text: 'ROOT create reviewed child and integrate to explicitly granted local target ' + target2.targetId, mode: 'idle' });
        const parentFirst = await c.runConversation({ conversationId: parent.conversationId, model: agent });
        assert.equal(parentFirst.status, 'waiting');
        for (let i = 0; i < 3000; i++) {
            if (c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=? AND phase=?', target2.targetId, 'CONFIRMED').n === 1 && settledRoot(c,parent.conversationId,parentFirst.workId,4))
                break;
            await new Promise(r => setTimeout(r, 10));
        }
        assert.ok(settledRoot(c,parent.conversationId,parentFirst.workId,4),'Final parent response/result/run must actually settle before assertions/close');
        const integrated = c.store.one('SELECT * FROM effect_operations WHERE target=?', target2.targetId);
        assert.equal(integrated?.phase, 'CONFIRMED', JSON.stringify({ integrated, assignments: c.store.all('SELECT * FROM conversation_assignments'), parent: c.inspectConversation(parent.conversationId), runs: c.inspectWork(parentFirst.workId).runs }));
        assert.equal(c.inspectWork(parentFirst.workId).allowance.consumed, 4);
        const alias = c.store.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.effectOperationId')=?", integrated.id);
        assert.equal(alias.state, 'COMPLETE');
        assert.equal(alias.work, integrated.work);
        assert.equal(c.inspectChange(integrated.work).reviewReady, true);
        assert.equal(c.store.one('SELECT root FROM effect_delegations WHERE id=?', integrated.grant_id).root, parentFirst.workId);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n, 0);
        assert.equal((await execute(git, ['--git-dir=' + receiver2, 'show', 'refs/heads/main:consumer.cjs'])).stdout, initial.replace('exports=2', 'exports=3'));
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), dirty);
        const rootHistory=await c.getConversationHistory(parent.conversationId),toolResults=rootHistory.sessionManager.getEntries().filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolName==='conversation_integrate').map(e=>e.message);
        assert.ok(toolResults.some(r=>r.isError&&JSON.stringify(r).includes('Actual completed governed reviewed assignment')));assert.ok(toolResults.some(r=>r.isError&&JSON.stringify(r).includes('Cumulative original-root')));
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations WHERE target=?',target2.targetId).n,1);
        const foreign=c.createConversation(),originalAssignment=c.store.one("SELECT * FROM conversation_assignments WHERE work=? AND json_extract(data,'$.operation')='change'",integrated.work),beforeForeignOperations=c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,beforeForeignAliases=c.store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.operation')='effect-prepare'").n;
        await c.queueConversationInput({conversationId:foreign.conversationId,expectedGeneration:0,text:'Independent owner task has no authority over another original root reviewed task',mode:'idle'});
        const foreignResult=await c.runConversation({conversationId:foreign.conversationId,model:scripted((_context,turn)=>turn===0?{tool:{name:'conversation_integrate',arguments:{reviewedAssignmentId:originalAssignment.id,targetId:target2.targetId}}}:{text:'Foreign original-root integration refused'})});assert.equal(foreignResult.status,'delivered');const foreignHistory=await c.getConversationHistory(foreign.conversationId);assert.ok(foreignHistory.sessionManager.getEntries().some(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.isError&&JSON.stringify(e.message).includes('Captured coordinator outside original owner grant lineage')));assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,beforeForeignOperations);assert.equal(c.store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE json_extract(data,'$.operation')='effect-prepare'").n,beforeForeignAliases);
        const originalWork=c.inspectWork(integrated.work),rootEpoch=c.inspectWork(parentFirst.workId).epoch,other=c.store.all("SELECT * FROM conversation_assignments WHERE source_conversation=? AND json_extract(data,'$.operation')='change'",parent.conversationId).find(a=>a.work!==integrated.work),otherBefore=c.inspectWork(other.work);
        await c.cancelAssignment({assignmentId:alias.id,reason:'Stop this integration task scope without cancelling its original coordinator'});assert.equal(c.inspectWork(integrated.work).state,'CANCELLED');assert.equal(c.inspectWork(integrated.work).epoch,originalWork.epoch+1);assert.equal(c.inspectWork(parentFirst.workId).epoch,rootEpoch);assert.notEqual(c.inspectWork(parentFirst.workId).state,'CANCELLED');assert.deepEqual(c.inspectWork(other.work),otherBefore);assert.equal(c.inspectEffect(integrated.id).phase,'CONFIRMED');assert.equal(c.inspectEffect(integrated.id).transportOutcome,'native-success');assert.equal(c.inspectEffect(integrated.id).observedOutcome,'contains-integration');

        passed=true;
    }
    finally {
        await cleanupFixture(c,root,passed);
    }
});
