import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import {withAssignedReports} from '../pi/assigned-report-fixture.mjs';
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
test('cap2 A→B→C nested WAIT preserves B assignment pending until C and authorized B continuation actually finish', { timeout: 15000 }, async () => {
    const runtimeProfile = { dockerBinary: '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, image: process.env.GITJIG_RUNTIME_IMAGE };
    assert.ok(runtimeProfile.image && runtimeProfile.dockerContext);
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/nested-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'read.txt'), 'healthy');
    let c = await openController({ installationHome: home, runtimeProfile, interactionDelegation: { projectIds: ['P'], maxAssignments: 4 } });
    await c.registerProject({ id: 'P', sourceRoot: source });
    process.env.TMPDIR = path.join(home, 'artifacts');
    let releaseC, enteredC;
    let barrier = new Promise(r => releaseC = r), entered = new Promise(r => enteredC = r);
    const model = withAssignedReports({ provider: 'nested-wait', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'nested-wait-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }], streamSimple(m, context) {
                const texts = context.messages.filter(x => x.role === 'user').map(x => typeof x.content === 'string' ? x.content : x.content.filter(v => v.type === 'text').map(v => v.text).join('')), first = texts[0], latest = texts.at(-1);
                const stream = createAssistantMessageEventStream();
                void (async () => {
                    let tool, reply = 'Final actual result ' + first;
                    const scoped = latest.startsWith('Scope Q read');
                    if (scoped && context.messages.at(-1).role === 'user')
                        tool = { name: 'read', args: { path: 'read.txt' } };
                    if (!latest.startsWith('Authorized dependency results ready:') && !latest.startsWith('Manual follow-up') && !first.startsWith('D unrelated') && !scoped) {
                        if (first === 'C final observer') {
                            enteredC();
                            await barrier;
                        }
                        else {
                            const previous = context.messages.filter(x => x.role === 'toolResult').at(-1);
                            if (!previous)
                                tool = { name: 'conversation_assign', args: { projectId: 'P', instructions: first.startsWith('A ') ? 'B spawn C and WAIT' : 'C final observer', resultDependency: true } };
                            else {
                                const receipt = JSON.parse(previous.content.find(v => v.type === 'text').text);
                                tool = { name: 'conversation_wait', args: { resultHandles: [receipt.assignmentId] } };
                            }
                        }
                    }
                    const message = { role: 'assistant', content: tool ? [{ type: 'toolCall', id: 'T' + Math.random(), name: tool.name, arguments: tool.args }] : [{ type: 'text', text: reply }], api: m.api, provider: m.provider, model: m.id, usage, stopReason: tool ? 'toolUse' : 'stop', timestamp: Date.now() };
                    stream.push({ type: 'done', reason: message.stopReason, message });
                    stream.end(message);
                })();
                return stream;
            } } });
    try {
        const parent = c.createConversation();
        await c.queueConversationInput({ conversationId: parent.conversationId, expectedGeneration: 0, text: 'A root', mode: 'idle' });
        const first = await c.runConversation({ conversationId: parent.conversationId, model });
        assert.equal(first.status, 'waiting');
        await entered;
        for (let i = 0; i < 100 && c.store.all("SELECT * FROM conversation_state WHERE resource='WAITING'").length < 2; i++)
            await new Promise(r => setTimeout(r, 10));
        const assignments = c.store.all('SELECT * FROM conversation_assignments ORDER BY rowid');
        assert.equal(assignments.length, 2);
        assert.equal(assignments[0].state, 'WAITING');
        assert.notEqual(assignments[1].state, 'COMPLETE');
        assert.equal(c.inspectNotifications(parent.conversationId).filter(n=>n.kind==='result-ready'||n.kind===undefined).length, 0);
        assert.equal(c.inspectWork(first.workId).allowance.consumed, 1);
        assert.ok(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state='ADMITTED'").n <= 2);
        releaseC();
        for (let i = 0; i < 300; i++) {
            if (c.inspectWork(first.workId).allowance.consumed === 2 && c.store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE state='COMPLETE'").n === 2)
                break;
            await new Promise(r => setTimeout(r, 10));
        }
        assert.equal(c.inspectWork(first.workId).allowance.consumed, 2);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM conversation_assignments WHERE state='COMPLETE'").n, 2);
        const child = c.inspectConversation(assignments[0].target);
        assert.equal(c.inspectWork(child.workId).allowance.consumed, 2);
        assert.equal(c.inspectNotifications(parent.conversationId).filter(n=>n.kind==='result-ready'||n.kind===undefined).length, 1);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n, 0);
        const destination = c.createConversation({ projectId: 'P' }), oldChild = c.inspectConversation(assignments[0].target), originBefore = c.inspectWork(oldChild.workId).source;
        c.setConversationParent({ childId: oldChild.conversationId, parentId: destination.conversationId, expectedRevision: oldChild.relationRevision });
        await c.queueConversationInput({ conversationId: oldChild.conversationId, expectedGeneration: oldChild.generation, text: 'Manual follow-up B after reparent', mode: 'idle' });
        assert.equal((await c.runConversation({ conversationId: oldChild.conversationId, model })).status, 'delivered');
        const results = c.store.all('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid', oldChild.conversationId);
        assert.equal(results.length, 2);
        assert.equal(results[1].previous, results[0].id);
        assert.equal(c.inspectNotifications(parent.conversationId).filter(n=>n.kind==='result-ready'||n.kind===undefined).length, 2);
        assert.equal(c.inspectNotifications(destination.conversationId).filter(n=>n.kind==='result-ready'||n.kind===undefined).length, 1);
        assert.deepEqual(c.inspectWork(oldChild.workId).source, originBefore);
        barrier = new Promise(r => releaseC = r);
        entered = new Promise(r => enteredC = r);
        const cancelParent = c.createConversation(), unrelated = c.createConversation();
        await c.queueConversationInput({ conversationId: unrelated.conversationId, expectedGeneration: 0, text: 'D unrelated actual work', mode: 'idle' });
        const unrelatedResult = await c.runConversation({ conversationId: unrelated.conversationId, model });
        await c.queueConversationInput({ conversationId: cancelParent.conversationId, expectedGeneration: 0, text: 'A cancellation origin', mode: 'idle' });
        const cancelWaiting = await c.runConversation({ conversationId: cancelParent.conversationId, model });
        await entered;
        for (let i = 0; i < 100 && !c.store.one("SELECT id FROM conversation_assignments WHERE source_conversation=? AND state='WAITING'", cancelParent.conversationId); i++)
            await new Promise(r => setTimeout(r, 10));
        const owned = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', cancelParent.conversationId), ownedChild = c.inspectConversation(owned.target), originBeforeCancel = c.inspectWork(owned.work).source;
        c.setConversationParent({ childId: owned.target, parentId: unrelated.conversationId, expectedRevision: ownedChild.relationRevision });
        const cancelled = await c.cancelAssignment({ assignmentId: owned.id, reason: 'Cancel assigned subtree using origin, not new parent' });
        assert.ok(cancelled.workIds.includes(owned.work));
        assert.equal(cancelled.workIds.length, 2);
        assert.equal(c.inspectWork(unrelatedResult.workId).state, 'ACTIVE');
        assert.equal(c.inspectWork(unrelatedResult.workId).epoch, 1);
        assert.equal(c.inspectWork(cancelWaiting.workId).state, 'ACTIVE');
        assert.deepEqual(c.inspectWork(owned.work).source, originBeforeCancel);
        releaseC();
        for (let i = 0; i < 100 && c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state='ADMITTED'").n; i++)
            await new Promise(r => setTimeout(r, 10));
        for (const work of cancelled.workIds)
            assert.equal(c.inspectWork(work).state, 'CANCELLED');
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', owned.id).state, 'CANCELLED');
        assert.equal(c.inspectWork(cancelWaiting.workId).allowance.consumed, 1);
        const qSource = path.join(root, 'Q');
        await fs.mkdir(qSource);
        await fs.writeFile(path.join(qSource, 'read.txt'), 'Q-FRESH-OWNED-SCOPE');
        await c.registerProject({ id: 'Q', sourceRoot: qSource });
        const oldScoped = c.inspectConversation(oldChild.conversationId), oldWork = c.inspectWork(oldScoped.workId), oldImpacts = c.interactionCore.impacts(oldWork.workId).length, oldHistory = oldScoped.historyRef;
        await c.close();
        c = await openController({ installationHome: home, runtimeProfile, interactionDelegation: { projectIds: ['Q'], maxAssignments: 4 } });
        const rebound = c.setConversationProject({ conversationId: oldScoped.conversationId, projectId: 'Q', expectedGeneration: oldScoped.generation });
        assert.equal(rebound.projectId, 'Q');
        assert.equal(rebound.historyRef, oldHistory);
        await c.queueConversationInput({ conversationId: rebound.conversationId, expectedGeneration: rebound.generation, text: 'Scope Q read with older P history retained', mode: 'idle' });
        const scopedResult = await c.runConversation({ conversationId: rebound.conversationId, model });
        assert.equal(scopedResult.status, 'delivered');
        assert.notEqual(scopedResult.workId, oldWork.workId);
        const newWork = c.store.one('SELECT * FROM works WHERE id=?', scopedResult.workId), newData = JSON.parse(newWork.data);
        assert.equal(newWork.project, 'Q');
        assert.equal(newWork.predecessor, oldWork.workId);
        assert.equal(newData.assignmentId, null);
        assert.deepEqual(newData.delegation.projectIds, ['Q']);
        assert.equal(newData.delegation.rootWorkId, newWork.id);
        assert.equal(newData.scopeTransition.priorProjectId, 'P');
        assert.equal(newData.scopeTransition.projectId, 'Q');
        assert.deepEqual(c.inspectWork(oldWork.workId).source, oldWork.source);
        assert.equal(c.interactionCore.impacts(oldWork.workId).length, oldImpacts);
        const scopeObs = c.store.all('SELECT data FROM observations WHERE run=?', scopedResult.runId);
        assert.ok(scopeObs.some(row => row.data.includes('Q-FRESH-OWNED-SCOPE')));
        assert.equal(c.inspectConversation(rebound.conversationId).historyRef, oldHistory);
    }
    finally {
        releaseC();
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
