import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { capture } from '../../dist/controller/capture.js';
import { prepareCapturedInput } from '../../dist/controller/input-context.js';
import { openController } from '../../dist/controller/index.js';
import { projectProtection } from '../../dist/controller/protection.js';
import { modelConfigurationIdentity } from '../../dist/pi/model-identity.js';
import { translator } from '../../dist/ui/i18n.js';
import { interruptedRuntimeMatches } from '../../dist/controller/interrupted-native-preview.js';

test('interrupted runtime compares saved values without depending on key order', ()=>{
    const original={captureDigest:'capture',runtimeProfile:{dockerBinary:'/bin/docker',dockerContext:'owned',image:'image'}};
    assert.equal(interruptedRuntimeMatches(original,{image:'image',dockerContext:'owned',dockerBinary:'/bin/docker',dockerConfigDirectory:undefined}),true);
    assert.equal(interruptedRuntimeMatches(original,{...original.runtimeProfile,dockerContext:'different'}),false);
    assert.equal(interruptedRuntimeMatches(original,undefined),false);
    assert.equal(interruptedRuntimeMatches({...original,captureDigest:null},undefined),true);
});

test('cold preview verifies the original single captured user entry without exposing executable history', async () => {
    const root = await temporaryDirectory('interrupted-native-preview'), home = path.join(root, 'app');
    const project = path.join(root, 'project'), staging = path.join(root, 'captured');
    await fs.mkdir(project);
    await fs.mkdir(staging);
    await fs.writeFile(path.join(project, 'source.txt'), 'captured original file');
    const c = await openController({ installationHome: home });
    try {
        await c.registerProject({ id: 'P', sourceRoot: project });
        const { conversationId } = c.createConversation({ projectId: 'P' });
        const request = await c.queueConversationInputWithContext({ conversationId, expectedGeneration: 0, mode: 'idle', text: 'Review @source.txt' });
        const input = c.store.one('SELECT * FROM conversation_inputs WHERE id=?', request.inputId);
        const manifest = await capture(project, staging, { maxEntries: 32, maxBytes: 1048576, timeoutMs: 1000 }).result;
        const sessions = path.join(home, 'state/sessions');
        await fs.mkdir(sessions, { mode: 0o700 });
        const manager = SessionManager.create(project, sessions), historyRef = manager.getSessionFile(), nativeSessionId = manager.getSessionId();
        const data = { kind: 'ordinary-conversation', conversation: conversationId, initialInputId: input.id, raw: input.text,
            inputContext: JSON.parse(input.data).context, allocatedNative: true, nativePromptAttempted: true,
            nativeInputObserved: true, attainedCapture: true, manifest, historyRef, nativeSessionId, cleanup: 'removed' };
        c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', 'P', input.source, null, 'W', 'INTERRUPTED', 1, 1, null, '{}');
        c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'RUNNING', staging, 'consumed', JSON.stringify(data));
        c.store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', 'L', 'W', 'R', 1, 1, 'RELEASED', '{}');
        c.store.run('UPDATE conversations SET generation=1 WHERE id=?', conversationId);
        c.store.run("UPDATE conversation_state SET resource='UNKNOWN',work='W',data=? WHERE conversation=?", JSON.stringify({ runId: 'R' }), conversationId);
        c.store.run("UPDATE conversation_inputs SET work='W',generation=1,state='INITIAL_RESERVED' WHERE id=?", input.id);
        const prepared = await prepareCapturedInput(c.store, path.join(home, 'state'), input.id, {
            identity: { conversationId, workId: 'W', runId: 'R', launchId: null, generation: 1, directionRevision: 1, initialInputId: input.id }, kind: 'initial',
        });
        const retained = { ...data, initialInputComparison: prepared.comparison };
        c.store.run("UPDATE runs SET phase='INTERRUPTED',data=? WHERE id='R'", JSON.stringify(retained));
        c.store.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id=?", input.id);
        c.store.run('INSERT INTO observations VALUES(?,?,?)', 'O', 'R', JSON.stringify({ type: 'native-user-boundary', initialInputId: input.id }));
        const append = content => manager.appendMessage({ role: 'user', content, timestamp: Date.now() });
        append(prepared.text);
        const original = await fs.readFile(historyRef, 'utf8');
        const preview = await c.getInterruptedConversationPreview(conversationId);
        assert.equal(preview.getSessionFile(), undefined);
        assert.equal(preview.getSessionId(), nativeSessionId);
        assert.ok(preview.getEntries().some(entry => entry.type === 'message' && entry.message.content === prepared.text));
        assert.equal(await c.getConversationHistory(conversationId), null);
        assert.equal(c.inspectConversationInputs(conversationId)[0].retryEligible, false);
        assert.equal(await fs.readFile(historyRef, 'utf8'), original);
        append(prepared.text);
        assert.equal(await c.getInterruptedConversationPreview(conversationId), undefined);
        await fs.writeFile(historyRef, original.replace('captured original file', 'changed file content'));
        assert.equal(await c.getInterruptedConversationPreview(conversationId), undefined);
        await fs.writeFile(historyRef, original);
        const [header, ...entries] = original.trimEnd().split('\n');
        await fs.writeFile(historyRef, [JSON.stringify({ ...JSON.parse(header), parentSession: '/prior/session.jsonl' }), ...entries].join('\n') + '\n');
        assert.equal(await c.getInterruptedConversationPreview(conversationId), undefined);
        await fs.writeFile(historyRef, original);
        c.store.run("UPDATE runs SET data=? WHERE id='R'", JSON.stringify({ ...retained, modelDispatchAttempted: true }));
        assert.equal(await c.getInterruptedConversationPreview(conversationId), undefined);
        c.store.run("UPDATE runs SET data=? WHERE id='R'", JSON.stringify(retained));

        const nextStaging = path.join(root, 'captured-again');
        await fs.mkdir(nextStaging, { mode: 0o700 });
        await fs.writeFile(path.join(project, 'source.txt'), 'changed project file');
        const nextCapture = await capture(project, nextStaging, { maxEntries: 32, maxBytes: 1048576, timeoutMs: 1000 }).result;
        const successor = { kind: data.kind, conversation: conversationId, initialInputId: input.id,
            attainedCapture: true, manifest: nextCapture, cleanup: 'not-allocated', outcome: 'unavailable',
            interruptedInputRetry: { runId: 'R', sourceId: input.source } };
        c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R2', 'W', 1, 2, 'SETTLED', nextStaging, 'consumed', JSON.stringify(successor));
        c.store.run("UPDATE works SET generation=2 WHERE id='W'");
        c.store.run("UPDATE conversation_state SET data=json_set(data,'$.runId','R2') WHERE conversation=?", conversationId);
        const [held] = c.inspectConversationInputs(conversationId);
        assert.deepEqual([held.interruptedBoundary, held.inputId, held.runId, held.retryEligible, held.withdrawEligible],
            ['captureChanged', input.id, 'R2', false, false]);
        for (const changed of [{ modelDispatchAttempted: true }, { nativePromptAttempted: true }, { cleanup: 'quarantined' }, { manifest },
            { interruptedInputRetry: { runId: 'different', sourceId: input.source } }]) {
            c.store.run("UPDATE runs SET data=? WHERE id='R2'", JSON.stringify({ ...successor, ...changed }));
            assert.equal(c.inspectConversationInputs(conversationId)[0].interruptedBoundary, undefined);
        }
    } finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

for (const [entryPoint,locale,exhausted] of [[null,'en'],['error','ko'],['ready','ko'],['ready','en'],['ready','en',true],['ready','ko',true]]) test(entryPoint
    ? exhausted ? `${locale} terminal reviews the exact pre-dispatch original after Back and explicit allowance extension`
        : `${locale} terminal opens exact interrupted request from /${entryPoint} and preserves it on Back`
    : 'reviewed first unsent request reserves one fresh attempt under its original input and work', async () => {
    const root = await temporaryDirectory('interrupted-native-retry'), home = path.join(root, 'app');
    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let controller = await openController({ installationHome: home });
    try {
        const { store } = controller;
        const { conversationId } = controller.createConversation();
        if (entryPoint) controller.setConversationLanguage({conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        const text = 'Continue this exact request';
        const { inputId } = await controller.queueConversationInput({ conversationId, expectedGeneration: 0, mode: 'idle', text });
        const input = store.one('SELECT * FROM conversation_inputs WHERE id=?', inputId);
        const directory = path.join(home, 'state/sessions');
        await fs.mkdir(directory, { mode: 0o700 });
        const original = SessionManager.create(root, directory), file = original.getSessionFile();
        original.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
        const bytes = await fs.readFile(file, 'utf8');
        const calls = [];
        const provider = 'retry-' + randomUUID(), api = 'api-' + provider;
        const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const model = { provider, modelId: 'fixture', definition: { api, apiKey: 'fixture-only', baseUrl: 'http://unused.invalid',
            models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], cost, contextWindow: 100000, maxTokens: 2000 }],
            streamSimple(m, context) {
                calls.push(context.messages.filter(message => message.role === 'user'));
                const stream = createAssistantMessageEventStream();
                const message = { role: 'assistant', content: [{ type: 'text', text: 'Continued once' }], api: m.api, provider: m.provider, model: m.id,
                    usage: { ...cost, cost: { ...cost, total: 0 }, totalTokens: 0 }, stopReason: 'stop', timestamp: Date.now() };
                queueMicrotask(() => { stream.push({ type: 'done', reason: 'stop', message }); stream.end(message); });
                return stream;
            } } };
        const data = { kind: 'ordinary-conversation', conversation: conversationId, initialInputId: inputId, raw: text,
            modelIdentity: createHash('sha256').update(JSON.stringify(modelConfigurationIdentity(model))).digest('hex'),
            projectProtection: projectProtection(store, null), nativePromptAttempted: true, nativeInputObserved: true,
            allocatedNative: true, historyRef: file, nativeSessionId: original.getSessionId(), cleanup: 'unbound' };
        store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)', 'W', null, input.source, null, 'W', 'INTERRUPTED', 1, 1, null,
            JSON.stringify({ kind: 'ordinary-conversation', conversation: conversationId, delegation: { rootWorkId: 'W', projectIds: [], maxAssignments: 8 } }));
        store.run('INSERT INTO requirements VALUES(?,?,?,?)', 'W', 1, text, JSON.stringify({ status: 'unconfirmed' }));
        store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', 'W', 'execution', exhausted ? 1 : 3, 1, 0);
        store.run('INSERT INTO budgets VALUES(?,?,?,?,?)', 'W', 'resolution', 2, 0, 0);
        store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', 'R', 'W', 1, 1, 'INTERRUPTED', path.join(home, 'inputs/R'), 'consumed', JSON.stringify(data));
        store.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)', 'L', 'W', 'R', 1, 1, 'RELEASED', '{}');
        store.run('INSERT INTO observations VALUES(?,?,?)', 'O', 'R', JSON.stringify({ type: 'native-user-boundary', initialInputId: inputId }));
        store.run('UPDATE conversations SET generation=1 WHERE id=?', conversationId);
        store.run("UPDATE conversation_state SET resource='UNKNOWN',work='W',data=json_set(data,'$.runId','R') WHERE conversation=?", conversationId);
        store.run("UPDATE conversation_inputs SET work='W',generation=1,state='RECONCILIATION_REQUIRED' WHERE id=?", inputId);

        const current = () => controller.inspectInterruptedConversationInputRetry(conversationId);
        let reviewed = await current();
        if (!exhausted) assert.equal(reviewed?.inputId, inputId);
        if (entryPoint) {
            const tr = translator(locale), draft = exhausted ? 'Separate unsent draft 한국어' : '/'+entryPoint;
            if (exhausted) controller.setDraft({conversationId, expectedRevision:0, text:draft});
            const tables = ['works','runs','budgets',...(exhausted ? ['observations','capacity_leases'] : []),'conversation_inputs'];
            const queries = tables.map(table => {
                const sql = `SELECT * FROM ${table} ORDER BY rowid`;
                return {sql, rows:store.all(sql).map(Object.values)};
            });
            if (exhausted)
                queries.push({sql:'SELECT * FROM sources WHERE id=?',params:[input.source],rows:[Object.values(store.one('SELECT * FROM sources WHERE id=?',input.source))]});
            if (!exhausted) assert.equal((await current())?.inputId,inputId);
            await controller.close();
            const spec = path.join(root,'error-recovery.json'), output = spec+'.terminal';
            const step = (wait,send,observations=queries) => ({wait,send,queries:observations,assertDraft:draft,expectedSelected:conversationId,expectedInputs:1});
            const original = tr(entryPoint==='error' ? 'error.originalInput' : 'ready.interruptedRequestNext');
            const allowance = tr('input.recoveryReviewAllowance'), held = tr('input.recoveryAllowanceRequired');
            const execution = tr('workRecovery.execution'), kind = tr('workRecovery.executionKind');
            const confirmation = tr('workRecovery.confirmAllowance', {additional:4,kind});
            const workTitle = tr('workRecovery.title', {id:'W',state:'INTERRUPTED'});
            const afterExtension = queries.filter(query => query.sql !== 'SELECT * FROM budgets ORDER BY rowid').concat(
                {sql:"SELECT kind,lim,consumed,reserved FROM budgets WHERE lineage='W' ORDER BY kind",rows:[['execution',5,1,0],['resolution',2,0,0]]},
                {sql:"SELECT COUNT(*) FROM sources WHERE json_extract(origin,'$.kind')='owner-budget-extension'",rows:[[1]]},
            );
            const steps = exhausted ? [
                step('/ready','\x07t'),
                step(original,original+'\r'),
                step(tr('input.recoveryAllowanceNext'),'\r'),
                step(held,allowance+'\r'),
                step(workTitle,'\x1b'),
                step(tr('input.recoveryAllowanceNext'),'\r'),
                step(held,allowance+'\r'),
                step(workTitle,execution+'\r'),
                step(tr('workRecovery.additional',{kind,available:0}),'\r'),
                step(tr('workRecovery.allowanceReason'),'Review allowance for exact original\r'),
                step(tr('review.openConfirmation'),'\r'),
                step(confirmation,confirmation+'\r'),
                step(tr('workRecovery.extended',{kind}),'\x1b',afterExtension),
                step(tr('input.recoveryPreDispatchNext'),'\r',afterExtension),
                step(tr('input.recoveryPreDispatchRetry'),'\x1b',afterExtension),
                step(tr('input.recoveryPreDispatchNext'),'\x1b',afterExtension),
                step('/ready','\x07q',afterExtension),
            ] : [
                {wait:'/ready',send:draft+'\r'},
                step(original,original+'\r'),
                step(tr('input.recoveryPreDispatchNext'), '\r'),
                step(tr('input.recoveryPreDispatchRetry'), '\x1b'),
                step(tr('input.recoveryPreDispatchNext'), '\x1b'),
                ...(entryPoint==='error' ? [step(original, '\x1b'),step('/ready','\x07q')] : [
                    {...step(original,'\r'),expectedInputs:2,mutations:[{
                        sql:"INSERT INTO conversation_inputs SELECT 'another-unresolved',conversation,generation,NULL,source,state,mode,text,'{}' FROM conversation_inputs WHERE id=?",params:[inputId],
                    }]},
                    {wait:tr('ready.heldNext'),send:'\x1b',assertDraft:draft,expectedInputs:2,queries:queries.slice(0,-1)},
                    {wait:'/ready',send:'\x07q',assertDraft:draft,expectedInputs:2,queries:queries.slice(0,-1)},
                ]),
            ];
            const guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
            const entry = [process.execPath,...guard,'--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js'];
            await fs.writeFile(spec,JSON.stringify({command:[...entry,'conversation','ui','--home',home,'--conversation',conversationId],
                env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
                steps,database:path.join(home,'state/controller.sqlite'),output,timeoutSeconds:10,columns:180,rows:50,noForceKill:true}));
            try {
                const result = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',spec],{timeout:15000})).stdout);
                assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
                assert.match(await fs.readFile(output,'utf8'),/Continue this exact request/);
                assert.equal(await fs.readFile(file,'utf8'),bytes);
            } catch (error) {
                const tail = (await fs.readFile(output,'utf8').catch(()=>'')).slice(-5000);
                throw new Error(tail,{cause:error});
            }
            assert.equal(calls.length,0);
            return;
        }
        const retry = (overrides = {}) => controller.retryInterruptedConversationInput({ conversationId, inputId, expectedContext: reviewed.fingerprint, model, ...overrides });
        assert.throws(() => controller.runConversation({ conversationId, initialInputId: inputId, model }), /NATIVE_INPUT_RECOVERY_REQUIRED/);
        await assert.rejects(retry({ expectedContext: 'stale' }), /changed/);
        await assert.rejects(retry({ model: { ...model, modelId: 'different' } }), {
            code: 'INTERRUPTED_INPUT_BINDING_CHANGED', reason: 'model', inputId, workId: 'W', runId: 'R',
        });
        await assert.rejects(retry({ signal: AbortSignal.abort(new Error('Cancelled before admission')) }), /Cancelled before admission/);
        original.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
        assert.equal(await current(), undefined);
        await assert.rejects(retry(), /changed/);
        await fs.writeFile(file, bytes);
        await assert.rejects(retry(), /changed/);
        const recovered = { ...data, cleanup: 'not-allocated', unbound: true, recoveredAt: Date.now() };
        const recordRun = record => store.run("UPDATE runs SET data=? WHERE id='R'", JSON.stringify(record));
        recordRun(recovered);
        assert.equal((await current())?.state, 'ready');
        for (const conflict of [{ unbound: undefined }, { recoveredAt: undefined }, { containerId: 'runtime' }, { attainedCapture: true }, { manifest: {} }]) {
            recordRun({ ...recovered, ...conflict });
            assert.equal(await current(), undefined);
        }
        recordRun(data);
        reviewed = await current();
        store.run("UPDATE budgets SET lim=1 WHERE lineage='W' AND kind='execution'");
        assert.deepEqual(await current(), { state: 'exhausted', inputId, workId: 'W', witness: reviewed.witness });
        await assert.rejects(retry(), /allowance changed/);
        store.run("UPDATE budgets SET reserved=1 WHERE lineage='W' AND kind='execution'");
        assert.equal(await current(), undefined);
        store.run("UPDATE budgets SET reserved=0,lim=0 WHERE lineage='W' AND kind='execution'");
        assert.equal(await current(), undefined);
        store.run("UPDATE budgets SET lim=1 WHERE lineage='W' AND kind='execution'");
        original.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
        assert.equal(await current(), undefined);
        await fs.writeFile(file, bytes);
        const restored = await current();
        assert.equal(restored.state, 'exhausted');
        controller.extendWorkAllowance({ expected: controller.inspectWorkAllowance('W'), kind: 'execution',
            additional: 3, reason: 'Continue the original request' });
        await assert.rejects(retry(), /allowance changed/);
        assert.equal(calls.length, 0);
        reviewed = await current();
        assert.equal(reviewed.state, 'ready');
        assert.equal(reviewed.witness, restored.witness);
        const attempts = await Promise.allSettled([retry(), retry()]);
        const [successful, extra] = attempts.filter(attempt => attempt.status === 'fulfilled');
        assert.ok(successful && !extra, JSON.stringify(attempts));
        const result = successful.value;
        assert.equal(result.status, 'delivered', result.failure);
        assert.equal(result.workId, 'W');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].length, 1);
        assert.equal(calls[0][0].content[0].text, text);
        assert.equal(await fs.readFile(file, 'utf8'), bytes);
        const next = JSON.parse(store.one('SELECT data FROM runs WHERE id=?', result.runId).data);
        assert.equal(next.interruptedInputRetry.runId, 'R');
        assert.equal(next.initialInputId, inputId);
        assert.equal(next.modelDispatchAttempted, true);
        assert.notEqual(next.historyRef, file);
        assert.deepEqual({ ...controller.inspectWork('W').allowance }, { limit: 4, consumed: 2, reserved: 0 });
        assert.deepEqual(store.all('SELECT id,state FROM conversation_inputs').map(row => ({ ...row })), [{ id: inputId, state: 'CONSUMED' }]);
        assert.equal((await controller.getConversationHistory(conversationId)).sessionManager.getSessionId(), next.nativeSessionId);
        await controller.close();
        controller = await openController({ installationHome: home });
        assert.equal((await controller.getConversationHistory(conversationId)).sessionManager.getSessionId(), next.nativeSessionId);
        const followUp = 'A new request in the conversation';
        await controller.queueConversationInput({ conversationId, expectedGeneration: controller.inspectConversation(conversationId).generation, mode: 'idle', text: followUp });
        const continued = await controller.runConversation({ conversationId, model });
        assert.equal(continued.status, 'delivered', continued.failure);
        assert.deepEqual(calls[1].map(message => message.content[0].text), [text, followUp]);
        assert.equal(controller.store.one("SELECT data FROM runs WHERE id='R'").data, JSON.stringify(data));
        assert.equal(await fs.readFile(file, 'utf8'), bytes);
    } finally {
        await controller.close();
        if (previousTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTmp;
        await fs.rm(root, { recursive: true, force: true });
    }
});
