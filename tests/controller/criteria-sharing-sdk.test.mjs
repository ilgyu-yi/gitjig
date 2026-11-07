/** Actual Controller assembly and Pi request guard; controlled provider, no engine/account. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {criteriaWorld} from './criteria-refresh-fixture.mjs';

test('actual refreshed role reaches the SDK guard with exact previous criteria and unchanged 128000 output reserve', async t => {
    const f = await criteriaWorld(t), invocationHome = process.env.HOME;
    const home = path.join(f.root, 'operator-home'); await fs.mkdir(home, {mode: 0o700}); process.env.HOME = home;
    t.after(() => { if (invocationHome === undefined) delete process.env.HOME; else process.env.HOME = invocationHome; });
    const load = relative => import(pathToFileURL(path.join(f.payload, 'dist', relative)));
    const {initializePiHost} = await load('pi/index.js'), {runRole} = await load('workflow/index.js');
    const {assertModelContextBudget} = await load('pi/context-budget.js');
    const {roleFraming} = await load('workflow/role-framing.js');
    const {restorePreviousCriteriaText} = await load('workflow/criteria-text.js');
    const prior = f.c.changes.version(JSON.parse(f.c.store.one('SELECT data FROM change_state WHERE work=?', f.workId).data).contractsVersion);
    await f.change('PRINCIPLES.md', '\nControlled current clarification; preserve the original requirements.\n');
    await f.c.refreshChangeCriteria({workId: f.workId, reason: 'Exercise actual role request framing after a small criteria revision'});
    const body = await f.c.changes.bundle(f.workId, {stage: 'planning'}, 'planner'), before = f.ledger();
    const stateRoot = path.join(f.root, 'role-state'), artifactRoot = path.join(f.root, 'role-artifacts'), invocationTmp = process.env.TMPDIR;
    await fs.mkdir(stateRoot, {mode: 0o700}); await fs.mkdir(artifactRoot, {mode: 0o700}); process.env.TMPDIR = artifactRoot;
    t.after(() => { if (invocationTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = invocationTmp; });
    const host = await initializePiHost({stateRoot, artifactRoot});
    const fail = async () => assert.fail('This request-only control must not execute a project tool');
    const operations = {workspaceRoot: path.join(f.root, 'project'), validatePath: p => path.resolve(f.root, 'project', p),
        readFile: fail, writeFile: fail, access: fail, mkdir: fail, exec: fail};
    let calls = 0;
    const observed = [], model = {provider: 'criteria-capacity-fixture', modelId: 'original', definition: {
        api: 'criteria-capacity-fixture', apiKey: 'DUMMY_NO_NETWORK', baseUrl: 'http://unused.invalid',
        models: [{id: 'original', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 128000}],
        streamSimple(selected, context) {
            calls++;
            const budget = assertModelContextBudget(selected, context); observed.push(budget);
            const strings = v => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
            assert.ok(strings(context).some(text => text.includes('Final RoleOutput JSON Schema: ' + JSON.stringify(roleFraming('planner', body).schema))), 'Ordinary provider still receives the complete inline schema');
            const text = context.messages.find(m => m.role === 'user').content.filter(p => p.type === 'text').map(p => p.text).join('');
            const actual = JSON.parse(text.split('\n')[1]);
            assert.equal(actual.contracts, body.contracts);
            assert.equal(restorePreviousCriteriaText(actual.context.criteriaRefresh.previous.text, actual.contracts), prior.data.text);
            assert.deepEqual(actual.context.criteriaRefresh, body.context.criteriaRefresh);
            const stream = createAssistantMessageEventStream();
            const message = {role: 'assistant', content: [], api: selected.api, provider: selected.provider, model: selected.id,
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: 'error', errorMessage: 'CONTROLLED_STOP_AFTER_CONTEXT_OBSERVATION', timestamp: Date.now()};
            queueMicrotask(() => {stream.push({type: 'error', reason: 'error', error: message}); stream.end(message);});
            return stream;
        },
    }};
    const run = (inputBundle, suffix) => runRole({launchId: 'controlled-criteria-' + suffix, role: 'planner', inputBundle, operations, host, model,
        timeoutMs: 5000, maxProviderRequests: 1, assertEntry() {}, beforeModelRequest: async () => {}});
    const repeated = structuredClone(body); repeated.context.criteriaRefresh.previous.text = prior.data.text;
    const rejected = await run(repeated, 'repeated');
    assert.equal(calls, 0); assert.match(rejected.issues.join(), /MODEL_CONTEXT_LIMIT/);
    const shared = await run(body, 'shared');
    assert.equal(calls, 1); assert.equal(observed[0].outputReserve, 128000); assert.equal(observed[0].contextWindow, 200000);
    assert.match(shared.issues.join(), /CONTROLLED_STOP_AFTER_CONTEXT_OBSERVATION/);
    assert.equal(shared.usable, false, 'Controlled transport does not invent an accepted planning result');
    assert.deepEqual(f.ledger(), before);
    f.pass();
});
