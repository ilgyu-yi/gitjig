import {validateRuntimeProfile} from '../../dist/execution/container-scope.js';
import {applyCurrentVerificationFixture} from '../workflow/current-verification-fixture.mjs';
import test from 'node:test';
import {withAssignedReports} from '../pi/assigned-report-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import {withValueCases,cleanupFixture} from './effect-fixture.mjs';
// Finite actual consumer claims; integer2 remains the independent reviewer-discovered hole.
const valueCases=(id,expected)=>[
 {id:id+'-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Actual owner value claim is accepted',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected),fixturePaths:[]},expected:{kind:'return',value:String(expected)}},
 {id:id+'-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Contradictory value claim is rejected by actual consumer comparison',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(expected===3?4:3),fixturePaths:[]},expected:{kind:'rejection',value:String(expected)}}];
const integerCases=[
 {id:'integer1-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Actual integer1 returns the required3',consumerPaths:['consumer.cjs'],input:{literalUtf8:'{"integer":1,"claim":3}',fixturePaths:[]},expected:{kind:'return',value:'3'}},
 {id:'integer1-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Contradictory claim4 for actual integer1 is rejected; reviewer separately probes integer2',consumerPaths:['consumer.cjs'],input:{literalUtf8:'{"integer":1,"claim":4}',fixturePaths:[]},expected:{kind:'rejection',value:'3'}}];
const integerChecker="const d=JSON.parse(require('fs').readFileSync('/input/verification-cases.json','utf8'));const consume=require('./consumer.cjs');const cases=d.cases.map(c=>{const input=JSON.parse(c.declaration.input.literalUtf8),actual=consume(input.integer);return{id:c.id,inputDigest:c.inputDigest,observed:{kind:actual===input.claim?'return':'rejection',value:String(actual)}}});console.log(JSON.stringify({version:1,cases,assertions:[{id:'integer1',passed:consume(1)===3}]}));\n";
const shellLiteral=code=>"'"+code.replaceAll("'","'\\''")+"'";

const runtimeProfile = { dockerBinary: process.env.GITJIG_DOCKER_BINARY ?? '/opt/homebrew/bin/docker', dockerContext: process.env.GITJIG_DOCKER_CONTEXT, dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
test('ordinary native assign-change → WAIT releases cap → existing governed actual candidate/check/review → authorized result continuation', { timeout: 60000 }, async t => {
    assert.ok(runtimeProfile.dockerContext && runtimeProfile.image && runtimeProfile.dockerConfigDirectory && path.isAbsolute(runtimeProfile.dockerConfigDirectory), 'Actual explicit runtime with private Docker configuration required');
    await validateRuntimeProfile(runtimeProfile);
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT ?? path.resolve('.runtime-fixtures');
    assert.ok(path.isAbsolute(parent), 'Absolute shared runtime fixture root required');
    await fs.mkdir(parent, { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'interaction-'))), home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n`));
    t.diagnostic('Interaction runtime fixture: ' + root);
    let c = await openController({ installationHome: home, runtimeProfile, interactionDelegation: { projectIds: ['P'], maxAssignments: 4 } });
    let abortClose, reopenPromise;
    const closeOnAbort = () => { abortClose = c.close(); void abortClose.catch(() => {}); };
    t.signal.addEventListener('abort', closeOnAbort, { once: true });
    t.after(async () => {
        t.signal.removeEventListener('abort', closeOnAbort);
        try { if (reopenPromise) await (await reopenPromise).close(); await c.close(); }
        finally { await abortClose; }
    });
    if (t.signal.aborted) closeOnAbort();
    t.signal.throwIfAborted();
    process.env.TMPDIR = path.join(home, 'artifacts');
    await c.registerProject({ id: 'P', sourceRoot: source });
    const turns = new Map();
    let identityProbeWork, identityProbeConversation;
    let retryAuthorized = false;
    let retryMode = false;
    const parentTurns = new Map();
    let harvestMode = null;
    let interventionMode = false;
    let criteriaMode = false;
    const reproductionCommand = `node -e "console.log(JSON.stringify({version:1,assertions:[{id:'integer2',passed:require('./consumer.cjs')(2)===3}]}))"`;
    let parentCalls = 0;
    const parentInputs = [];
    const model = withAssignedReports({ provider: 'interaction-runtime', modelId: 'fixture', definition: { apiKey: 'fixture-key', baseUrl: 'http://unused.invalid', api: 'interaction-runtime-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 20000 }], streamSimple(m, context) {
                const first = context.messages.find(message => message.role === 'user'), text = typeof first.content === 'string' ? first.content : first.content.filter(v => v.type === 'text').map(v => v.text).join('');
                let providerError = false;
                let tool, reply = 'Dependency result received without changing owner source';
                if (text.startsWith('Perform the assigned ')) {
                    const role = text.match(/assigned (\w+) task/)[1], body = JSON.parse(text.split('\n')[1]), turn = turns.get(text) ?? 0;
                    turns.set(text, turn + 1);
                    const result = { version: 1, summary: 'Actual candidate evidence', findings: [], assessedScope: body.requiredScope };
                    if (role === 'planner')
                        result.plan = { intent: 'Produce value3', requirements: [{ id: 'R1', text: 'Consumer value must be3', source: body.context.ownerSource }], approach: 'Change literal export', simplerAlternative: 'Existing one-line export', factualSources: ['base:consumer.cjs'], verification: { checks: [{ id: 'value', guaranteeIds: ['R1'], command: 'node check.cjs', assertions: ['three'], timeoutMs: 1000, fixturePaths: ['check.cjs', 'consumer.cjs'], expectationPaths: ['check.cjs'] }], requiredPaths: ['consumer.cjs', 'check.cjs'], reviewRoles: [{ key: 'general', kind: 'reviewer', purpose: 'Inspect actual value and check', requiredPaths: ['consumer.cjs', 'check.cjs'] }] }, ambiguities: [] };
                    if (interventionMode && role === 'planner') {
                        result.plan.intent = 'Return3 for every integer';
                        result.plan.requirements[0].text = 'Consumer returns3 for every integer including2';
                        result.plan.verification.checks[0].assertions = ['integer1'];
                    }
                    if (role === 'challenger')
                        result.alternatives = ['Reuse existing literal export'];
                    if (role === 'adjudicator') {
                        result.decisions = (body.context.occurrences ?? []).map(o => ({ occurrenceId: o.id, disposition: 'rejected', reason: 'This fixture claim is unsupported by current consumer value3 and actual checker receipt', witnesses: body.context.checks.filter(c => c.status === 'pass').map(c => c.id) }));
                        result.inputDecisions = (body.context.sourceInputChain ?? []).filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'explanation', reason: 'Actual source asks to look again and preserve F1; no requirement change', requirementIds: ['R1'] }));
                        if (body.context.stage === 'planning-adjudication') {
                            result.planAccepted = true;
                            result.acceptedPlan = body.context.planProposal;
                        }
                    }
                    if ((role === 'implementer' || role === 'repairer') && turn === 0)
                        tool = { name: 'write', args: { path: 'consumer.cjs', content: retryMode && role === 'implementer' ? 'module.exports=2;\n' : 'module.exports=3;\n' } };
                    if (role === 'reviewer') {
                        result.outcome = 'clear';
                        if (harvestMode && turn < (harvestMode === 'normal' ? 2 : 1))
                            result.findings = [{ requirementId: 'R1', severity: 'blocking', repair: 'unknown', description: 'F1 must remain from earlier actual assistant entry', evidence: ['candidate:consumer.cjs'] }];
                    }
                    if (interventionMode) {
                        const defective = text.includes('\nmodule.exports=n=>n === 2 ? 2 : 3;\n');
                        if ((role === 'implementer' || role === 'repairer') && turn === 0)
                            tool = { name: 'write', args: { path: 'consumer.cjs', content: role === 'implementer' ? 'module.exports=n=>n === 2 ? 2 : 3;\n' : 'module.exports=n=>3;\n' } };
                        if (role === 'reviewer' && defective) {
                            if (turn === 0)
                                tool = { name: 'bash', id: 'integer2-proof', args: { command: reproductionCommand } };
                            else
                                result.findings = [{ requirementId: 'R1', severity: 'blocking', repair: 'substantive', description: 'Existing R1 fails for integer2; actual frozen candidate returns2', evidence: ['candidate:consumer.cjs', 'integer2-proof'], reproduction: { toolCallId: 'integer2-proof', command: reproductionCommand, assertions: ['integer2'], expectationPaths: [] } }];
                        }
                        if (role === 'adjudicator') {
                            result.decisions = (body.context.occurrences ?? []).map(o => ({ occurrenceId: o.id, disposition: 'upheld', ...(defective ? {} : { resolution: 'repaired' }), reason: defective ? 'Actual integer2 reproduction violates unchanged R1' : 'Distinct repaired consumer now returns3 for integer2 with bound actual rerun and fresh review', witnesses: body.context.checks.filter(c => c.status === 'pass').map(c => c.id) }));
                            result.inputDecisions = (body.context.sourceInputChain ?? []).filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'explanation', reason: 'Human asks to examine existing all-integer R1 including2, without changing that criterion', requirementIds: ['R1'] }));
                        }
                    }
                    if (criteriaMode) {
                        const revision = body.context.sourceInputChain.find(i => i.text.includes('value4')), expected = revision ? 4 : 3;
                        if (role === 'planner')
                            result.plan = { intent: 'Consumer exports value' + expected, requirements: [{ id: 'R1', text: 'Consumer exports value' + expected, source: revision?.source ?? body.context.ownerSource }], approach: 'Change existing literal', simplerAlternative: 'One literal export', factualSources: ['base:consumer.cjs'], verification: { checks: [{ id: 'value' + expected, guaranteeIds: ['R1'], command: `node -e 'console.log(JSON.stringify({version:1,assertions:[{id:"value",passed:require("./consumer.cjs")===${expected}}]}))'`, assertions: ['value'], timeoutMs: 1000, fixturePaths: ['consumer.cjs'], expectationPaths: [] }], requiredPaths: ['consumer.cjs'], reviewRoles: [{ key: 'general', kind: 'reviewer', purpose: 'Check current owner-required value', requiredPaths: ['consumer.cjs'] }] }, ambiguities: [] };
                        if (role === 'adjudicator')
                            result.inputDecisions = body.context.sourceInputChain.filter(i => i.data.effectHold).map(i => ({ inputId: i.input_id, directionRevision: i.revision, impact: 'scope-change', reason: 'Owner explicitly changed criterion to value4', requirementIds: ['R1'] }));
                        if ((role === 'implementer' || role === 'repairer') && turn === 0)
                            tool = { name: 'write', args: { path: 'consumer.cjs', content: `module.exports=${expected};\n` } };
                    }
                    if (retryMode && role === 'repairer' && !retryAuthorized) {
                        providerError = true;
                        tool = undefined;
                    }
                    if(role==='planner'){
                        const check=result.plan.verification.checks[0];
                        check.cases=interventionMode?structuredClone(integerCases):valueCases(check.id,criteriaMode&&body.context.sourceInputChain.some(i=>i.text.includes('value4'))?4:3);
                        if(criteriaMode){const expected=body.context.sourceInputChain.some(i=>i.text.includes('value4'))?4:3;check.command='node -e '+shellLiteral(withValueCases(`console.log(JSON.stringify({version:1,assertions:[{id:'value',passed:require('./consumer.cjs')===${expected}}]}));`));}
                    }
                    applyCurrentVerificationFixture(result, body.context);
                    reply = JSON.stringify(result);
                }
                else {
                    parentCalls++;
                    const parentTurn = parentTurns.get(text) ?? 0;
                    parentTurns.set(text, parentTurn + 1);
                    const latest = context.messages.filter(message => message.role === 'user').at(-1);
                    const latestText = typeof latest.content === 'string' ? latest.content : latest.content.filter(v => v.type === 'text').map(v => v.text).join('');
                    parentInputs.push(latestText);
                    if (latestText.startsWith('Authorized dependency results ready:') || latestText.startsWith('Explicitly resumed authorized dependency outcomes (outcome is not success):'))
                        reply = 'Received actual governed result';
                    else if (retryMode && latestText === 'Retry the retained governed assignment' && context.messages.findLastIndex(message => message.role === 'user') > context.messages.findLastIndex(message => message.role === 'toolResult')) {
                        const original = context.messages.find(message => message.role === 'toolResult' && message.toolName === 'conversation_assign'), receipt = JSON.parse(original.content.find(v => v.type === 'text').text);
                        tool = { name: 'conversation_assign', args: { conversationId: receipt.conversationId, observedDirectionRevision: receipt.directionRevision, projectId: 'P', instructions: 'Continue actual consumer repair without changing R1', operation: 'change', resultDependency: true } };
                    }
                    else if (parentTurn === 0)
                        tool = { name: 'conversation_assign', args: { projectId: 'P', instructions: 'Change consumer export to3 and verify actual check', operation: 'change', resultDependency: true } };
                    else {
                        const result = context.messages.filter(message => message.role === 'toolResult').at(-1), payload = JSON.parse(result.content.find(v => v.type === 'text').text);
                        tool = { name: 'conversation_wait', args: { resultHandles: [payload.assignmentId] } };
                    }
                }
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    const message = { role: 'assistant', content: providerError ? [] : tool ? [{ type: 'toolCall', id: tool.id ?? 'T' + Math.random(), name: tool.name, arguments: tool.args }] : [{ type: 'text', text: reply }], api: m.api, provider: m.provider, model: m.id, usage, stopReason: providerError ? 'error' : tool ? 'toolUse' : 'stop', ...(providerError ? { errorMessage: 'controlled first repair provider unavailable' } : {}), timestamp: Date.now() };
                    stream.push({ type: 'done', reason: message.stopReason, message });
                    stream.end(message);
                });
                return stream;
            } } });
    const deliveredContinuation = (conversationId, workId, assignmentId) => {
        const state = JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?', conversationId).data), continuation = state.explicitContinuation;
        assert.equal(continuation.sourceIdentity.workId, workId);
        assert.deepEqual(continuation.waitHandles, [assignmentId]);
        const run = c.store.one('SELECT * FROM runs WHERE id=? AND work=?', continuation.newRunId, workId);
        assert.ok(run, 'The actual original continuation must have an admitted run');
        assert.equal(run.phase, 'SETTLED'); assert.equal(run.reservation, 'consumed');
        assert.equal(JSON.parse(run.data).outcome, 'delivered');
        return run.id;
    };
    let passed=false;
    try {
        const parent = c.createConversation();
        await c.queueConversationInput({ conversationId: parent.conversationId, expectedGeneration: 0, text: 'ROOT create governed child', mode: 'idle' });
        const first = await c.runConversation({ conversationId: parent.conversationId, model });
        assert.equal(first.status, 'waiting', JSON.stringify(c.store.all('SELECT data FROM observations')));
        for (let i = 0; i < 500; i++) {
            const assignments = c.store.all('SELECT * FROM conversation_assignments');
            if (assignments.length === 1 && assignments[0].state === 'COMPLETE' && c.inspectWork(first.workId).allowance.consumed === 2)
                break;
            await new Promise(r => setTimeout(r, 20));
        }
        await c.ordinaryCore.drain();
        const assignment = c.store.one('SELECT * FROM conversation_assignments');
        assert.equal(assignment.state, 'COMPLETE', assignment.data);
        deliveredContinuation(parent.conversationId, first.workId, assignment.id);
        assert.equal(c.inspectChange(assignment.work).reviewReady, true, JSON.stringify(c.inspectChange(assignment.work)));
        assert.equal(c.inspectWork(first.workId).allowance.consumed, 2, JSON.stringify({ state: c.store.one('SELECT * FROM conversation_state WHERE conversation=?', parent.conversationId), parentInputs, runs: c.inspectWork(first.workId).runs }));
        assert.equal(c.inspectNotifications(parent.conversationId).length, 1);
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        assert.ok(c.listConversations().length >= 7);
        const origin = c.inspectWork(assignment.work).source.origin;
        assert.equal(origin.kind, 'agent-governed-assignment');
        assert.equal(origin.actor.workId, first.workId);
        assert.equal(c.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state IN ('ADMITTED','QUARANTINED')").n, 0);
        for (const world of ['normal', 'invalidated']) {
            harvestMode = world;
            let steered = 0;
            const pending = [];
            const unsubscribe = c.subscribeInteraction(event => {
                if (event.type !== 'native-ready')
                    return;
                const registration = c.getNativeHandle(event.conversationId);
                if (!c.inspectConversation(event.conversationId).label.startsWith('reviewer'))
                    return;
                registration.session.subscribe(native => {
                    if (native.type !== 'message_end' || native.message.role !== 'assistant' || steered >= (world === 'normal' ? 2 : 1))
                        return;
                    const raw = native.message.content.filter(item => item.type === 'text').map(item => item.text).join('');
                    if (!raw.includes('F1 must remain'))
                        return;
                    steered++;
                    if (world === 'normal')
                        pending.push(registration.session.steer('Look again; preserve actual F1'));
                    else
                        pending.push(c.queueConversationInput({ conversationId: event.conversationId, expectedGeneration: event.generation, text: 'Look again; preserve actual F1', mode: 'steer' }));
                });
            });
            const begun = await c.beginChange({ projectId: 'P', request: 'Native F1 harvest ' + world });
            await c.planChange({ workId: begun.workId, model });
            await c.implementChange({ workId: begun.workId, model });
            await c.checkChange({ workId: begun.workId });
            const reviewed = await c.reviewChange({ workId: begun.workId, model });
            await Promise.all(pending);
            unsubscribe();
            assert.equal(steered, world === 'normal' ? 2 : 1);
            const f1 = reviewed.occurrences.filter(o => o.data.finding?.description === 'F1 must remain from earlier actual assistant entry');
            assert.equal(f1.length, world === 'normal' ? 2 : 1, JSON.stringify(reviewed));
            assert.equal(c.changeCore.pending(begun.workId).filter(o => o.kind === 'finding').length, world === 'normal' ? 2 : 1);
            assert.equal(reviewed.reviewReady, false);
            const review = reviewed.launches.filter(l => l.role === 'reviewer').at(-1);
            assert.equal(review.status, world === 'normal' ? 'COMPLETE' : 'UNUSABLE');
            const count = reviewed.occurrences.length, entries = await c.changeCore.nativeEntries(review.run);
            c.changeCore.harvestEntries(begun.workId, review.id, 'reviewer', entries, { role: 'reviewer', providerRequests: 1, historyRef: review.data.historyRef, events: [] }, null);
            assert.equal(c.inspectChange(begun.workId).occurrences.length, count);
            harvestMode = null;
            const final = world === 'normal' ? await c.resolveChange({ workId: begun.workId, model }) : await c.driveChange({ workId: begun.workId, model });
            assert.equal(final.reviewReady, true, JSON.stringify(final));
            assert.equal(c.interactionCore.impacts(begun.workId).some(i => i.data.effectHold), false);
            identityProbeWork = begun.workId;
            const lastReview = final.launches.filter(l => l.role === 'reviewer' && l.status === 'COMPLETE').at(-1);
            identityProbeConversation = c.store.one("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", lastReview.run).conversation;
        }
        const beforeQuestion = c.inspectChange(identityProbeWork), heldInput = await c.queueConversationInput({ conversationId: identityProbeConversation, expectedGeneration: c.inspectConversation(identityProbeConversation).generation, text: '왜 이 접근을 선택했나? 설명해 달라.', mode: 'idle' });
        assert.equal(c.inspectChange(identityProbeWork).reviewReady, false);
        assert.equal((await c.runConversation({ conversationId: identityProbeConversation, model })).status, 'delivered');
        assert.notEqual(c.inspectConversation(identityProbeConversation).workId, identityProbeWork);
        assert.ok(c.interactionCore.impacts(identityProbeWork).some(i => i.input_id === heldInput.inputId && i.data.effectHold));
        assert.equal(c.inspectChange(assignment.work).reviewReady, true);
        await c.close();
        t.signal.throwIfAborted();
        reopenPromise = openController({ installationHome: home, runtimeProfile, interactionDelegation: { projectIds: ['P'], maxAssignments: 4 } });
        c = await reopenPromise;
        t.signal.throwIfAborted();
        assert.ok(c.interactionCore.impacts(identityProbeWork).some(i => i.input_id === heldInput.inputId && i.data.effectHold));
        assert.equal(c.inspectChange(identityProbeWork).reviewReady, false);
        const afterFit = await c.driveChange({ workId: identityProbeWork, model });
        assert.equal(afterFit.reviewReady, true, JSON.stringify(afterFit));
        assert.equal(afterFit.checks.length, beforeQuestion.checks.length);
        assert.equal(afterFit.launches.filter(l => l.role === 'reviewer').length, beforeQuestion.launches.filter(l => l.role === 'reviewer').length);
        assert.equal(c.interactionCore.impacts(identityProbeWork).find(i => i.input_id === heldInput.inputId).data.affectedWorkId, identityProbeWork);
        retryMode = true;
        const retryParent = c.createConversation();
        await c.queueConversationInput({ conversationId: retryParent.conversationId, expectedGeneration: 0, text: 'ROOT governed retry consumer', mode: 'idle' });
        const waiting = await c.runConversation({ conversationId: retryParent.conversationId, model });
        for (let i = 0; i < 300 && !c.store.one("SELECT id FROM conversation_assignments WHERE source_conversation=? AND state='UNAVAILABLE'", retryParent.conversationId); i++)
            await new Promise(r => setTimeout(r, 10));
        const failed = c.store.one('SELECT * FROM conversation_assignments WHERE source_conversation=?', retryParent.conversationId), failedView = c.inspectChange(failed.work), oldOrigin = c.inspectWork(failed.work).source;
        assert.equal(failed.state, 'UNAVAILABLE');
        assert.equal(failedView.phase, 'BLOCKED');
        assert.ok(c.changeCore.pending(failed.work).some(o => o.kind === 'check'));
        await c.ordinaryCore.drain();
        const failedInspectionRun = deliveredContinuation(retryParent.conversationId, waiting.workId, failed.id);
        assert.equal(c.inspectWork(waiting.workId).allowance.consumed, 2, 'Original failed-result inspection is charged once before the explicit owner retry');
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE id=?', failed.id).state, 'UNAVAILABLE');
        retryAuthorized = true;
        await c.queueConversationInput({ conversationId: retryParent.conversationId, expectedGeneration: c.inspectConversation(retryParent.conversationId).generation, text: 'Retry the retained governed assignment', mode: 'idle' });
        assert.equal((await c.runConversation({ conversationId: retryParent.conversationId, model })).status, 'waiting');
        for (let i = 0; i < 500; i++) {
            if (c.store.one('SELECT state FROM conversation_assignments WHERE id=?', failed.id).state === 'COMPLETE' && c.inspectWork(waiting.workId).allowance.consumed === 4)
                break;
            await new Promise(r => setTimeout(r, 10));
        }
        await c.ordinaryCore.drain();
        const repaired = c.store.one('SELECT * FROM conversation_assignments WHERE id=?', failed.id);
        assert.notEqual(deliveredContinuation(retryParent.conversationId, waiting.workId, failed.id), failedInspectionRun);
        assert.equal(c.inspectWork(waiting.workId).allowance.consumed, 4);
        assert.equal(repaired.state, 'COMPLETE', repaired.data);
        assert.equal(repaired.work, failed.work);
        assert.equal(c.inspectChange(failed.work).reviewReady, true, JSON.stringify(c.inspectChange(failed.work)));
        assert.deepEqual(c.inspectWork(failed.work).source, oldOrigin);
        assert.ok(c.inspectChange(failed.work).execution.consumed > failedView.execution.consumed);
        assert.equal(c.inspectChange(failed.work).execution.limit, failedView.execution.limit);
        assert.equal(c.changeCore.pending(failed.work).length, 0);
        assert.equal(c.store.one('SELECT COUNT(*) AS n FROM conversation_assignments WHERE source_conversation=?', retryParent.conversationId).n, 1);
        retryMode = false;
        interventionMode = true;
        await fs.writeFile(path.join(source, 'check.cjs'), integerChecker);
        const intervention = await c.beginChange({ projectId: 'P', request: 'Consumer must return3 for every integer including2', resolutionLimit: 16, executionLimit: 32 });
        await c.planChange({ workId: intervention.workId, model });
        await c.implementChange({ workId: intervention.workId, model });
        await c.checkChange({ workId: intervention.workId });
        const bad = c.inspectChange(intervention.workId), pendingIntervention = [];
        let reviewerInput, liveReview;
        const off = c.subscribeInteraction(event => {
            if (event.type !== 'native-ready' || !c.inspectConversation(event.conversationId).label.startsWith('reviewer'))
                return;
            const registration = c.getNativeHandle(event.conversationId);
            if (registration.identity.workId !== intervention.workId)
                return;
            liveReview = registration.identity;
            registration.session.subscribe(native => {
                if (native.type !== 'message_end' || native.message.role !== 'assistant' || reviewerInput)
                    return;
                const raw = native.message.content.filter(item => item.type === 'text').map(item => item.text).join('');
                if (!raw.includes('Existing R1 fails'))
                    return;
                reviewerInput = { pending: true };
                pendingIntervention.push(c.queueConversationInput({ conversationId: event.conversationId, expectedGeneration: event.generation, text: '기존 R1은 정수2에서도3이다. 이 실제 실패를 빠뜨리지 말고 고쳐라.', mode: 'steer' }).then(receipt => reviewerInput = receipt));
            });
        });
        const interruptedReview = await c.reviewChange({ workId: intervention.workId, model });
        await Promise.all(pendingIntervention);
        off();
        assert.ok(reviewerInput?.inputId, JSON.stringify({ bad, interruptedReview }));
        assert.equal(interruptedReview.reviewReady, false);
        const actualInput = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', reviewerInput.inputId);
        assert.equal(actualInput.text, '기존 R1은 정수2에서도3이다. 이 실제 실패를 빠뜨리지 말고 고쳐라.');
        assert.equal(actualInput.state, 'CONSUMED');
        assert.ok(c.interactionCore.impacts(intervention.workId).some(i => i.input_id === reviewerInput.inputId && i.data.effectHold));
        assert.ok(interruptedReview.occurrences.some(o => o.data.finding?.description.startsWith('Existing R1 fails')));
        assert.ok(c.changeCore.pending(intervention.workId).some(o => o.kind === 'check' && o.check.assertions.includes('integer2')));
        const converged = await c.driveChange({ workId: intervention.workId, model });
        assert.equal(converged.reviewReady, true, JSON.stringify(converged));
        assert.notEqual(converged.candidateVersion, bad.candidateVersion);
        assert.ok(converged.launches.some(l => l.role === 'repairer'));
        const reviews = converged.launches.filter(l => l.role === 'reviewer');
        assert.ok(reviews.length >= 3);
        assert.notEqual(reviews.at(-1).run, liveReview.runId);
        assert.equal(reviews.at(-1).data.inputVersions.candidate, converged.candidateVersion);
        assert.ok(converged.checks.some(check => check.candidate === converged.candidateVersion && check.status === 'pass' && check.data.check.assertions.includes('integer2')));
        assert.ok(converged.dispositions.some(d => d.data.disposition === 'upheld' && d.data.resolution === 'repaired'));
        assert.equal(converged.occurrences.filter(o => o.data.finding?.description.startsWith('Existing R1 fails')).length, interruptedReview.occurrences.filter(o => o.data.finding?.description.startsWith('Existing R1 fails')).length + 1);
        assert.ok(converged.execution.consumed > bad.execution.consumed);
        assert.equal(converged.execution.limit, 32);
        assert.equal(c.changeCore.pending(intervention.workId).length, 0);
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        interventionMode = false;
        criteriaMode = true;
        const criteria = await c.beginChange({ projectId: 'P', request: 'Consumer exports value3', resolutionLimit: 20, executionLimit: 60 });
        const value3 = await c.driveChange({ workId: criteria.workId, model });
        assert.equal(value3.reviewReady, true, JSON.stringify(value3));
        const oldReview = value3.launches.filter(l => l.role === 'reviewer').at(-1), oldConversation = c.store.one("SELECT conversation FROM conversation_state WHERE json_extract(data,'$.runId')=?", oldReview.run).conversation;
        const revisedInput = await c.queueConversationInput({ conversationId: oldConversation, expectedGeneration: c.inspectConversation(oldConversation).generation, text: 'Change requirement: consumer must now export value4 instead of value3.', mode: 'idle' });
        assert.equal(c.inspectChange(criteria.workId).reviewReady, false);
        const value4 = await c.driveChange({ workId: criteria.workId, model });
        assert.equal(value4.reviewReady, true, JSON.stringify(value4));
        assert.equal(value4.workId, value3.workId);
        assert.notEqual(value4.planVersion, value3.planVersion);
        assert.notEqual(value4.verificationVersion, value3.verificationVersion);
        assert.notEqual(value4.candidateVersion, value3.candidateVersion);
        const currentPlan = c.changeCore.version(value4.planVersion).data.plan;
        assert.equal(currentPlan.requirements[0].source, c.store.one('SELECT source FROM conversation_inputs WHERE id=?', revisedInput.inputId).source);
        assert.equal(await fs.readFile(path.join(c.changeCore.version(value4.candidateVersion).artifact, 'consumer.cjs'), 'utf8'), 'module.exports=4;\n');
        assert.ok(value4.checks.some(check => check.candidate === value4.candidateVersion && check.verification === value4.verificationVersion && check.check_id === 'value4' && check.status === 'pass'));
        assert.ok(value4.launches.some(l => l.role === 'reviewer' && l.data.inputVersions.candidate === value4.candidateVersion && l.data.inputVersions.plan === value4.planVersion && l.id !== oldReview.id));
        const impact = c.interactionCore.impacts(criteria.workId).find(i => i.input_id === revisedInput.inputId);
        assert.equal(impact.data.decision.impact, 'scope-change');
        assert.equal(impact.data.effectHold, false);
        assert.equal(value4.execution.limit, value3.execution.limit);
        assert.ok(value4.execution.consumed > value3.execution.consumed);
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        criteriaMode = false;
        t.signal.throwIfAborted();
        passed=true;
    }
    finally {
        await cleanupFixture(c,root,passed && !t.signal.aborted);
        await abortClose;
    }
});
