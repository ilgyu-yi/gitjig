import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';

// Controlled Pi responses and real capture/check/repair/review boundaries; no paid model.
test('captured4 closes an actual failed check after consumer-only repair and cold reopening', {timeout: 60000}, async t => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent), 'Explicit shared runtime fixture root required');
    assert.equal(await fs.realpath(parent), parent);
    const checkout = await fs.realpath('.');
    assert.ok(parent !== checkout && !parent.startsWith(checkout + path.sep));
    const runtimeProfile = {
        dockerBinary: process.env.GITJIG_DOCKER_BINARY,
        dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,
        dockerContext: process.env.GITJIG_DOCKER_CONTEXT,
        image: process.env.GITJIG_RUNTIME_IMAGE,
    };
    assert.ok(Object.values(runtimeProfile).every(Boolean), 'Explicit pinned runtime profile required');
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'expectation-inputs-')));
    const home = path.join(root, 'home'), source = path.join(root, 'source');
    await fs.mkdir(source);
    const checker = withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n");
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), checker);
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let c, workId, wrongWrites = 0;
    const model = scripted(), originalStream = model.definition.streamSimple;
    model.definition.streamSimple = function(selected, context, options) {
        const stream = createAssistantMessageEventStream();
        void (async () => {
            const original = await originalStream.call(this, selected, context, options).result();
            const text = context.messages.find(message => message.role === 'user')?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
            const message = {...original, content: original.content.map(part => {
                if (text.startsWith('Perform the assigned implementer task') && part.type === 'toolCall' && part.name === 'write' && part.arguments.path === 'consumer.cjs') {
                    wrongWrites++;
                    return {...part, arguments: {...part.arguments, content: 'module.exports=4;\n'}};
                }
                return part;
            })};
            stream.push(['error', 'aborted'].includes(message.stopReason) ? {type: 'error', reason: message.stopReason, error: message} : {type: 'done', reason: message.stopReason, message});
            stream.end(message);
        })().catch(error => {
            const message = {role: 'assistant', content: [], api: selected.api, provider: selected.provider, model: selected.id, usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}, stopReason: 'error', errorMessage: String(error), timestamp: Date.now()};
            stream.push({type: 'error', reason: 'error', error: message});stream.end(message);
        });
        return stream;
    };
    try {
        c = await openController({installationHome: home, runtimeProfile});
        await c.registerProject({id: 'P', sourceRoot: source});
        ({workId} = await c.beginChange({projectId: 'P', request: 'Consumer must export3. Preserve the original check.cjs oracle.'}));
        let view = await c.planChange({workId, model});
        assert.equal(view.phase, 'PLAN_READY', JSON.stringify(view.blocked));
        const accepted = c.changeCore.version(view.planVersion);
        const judge = c.store.one('SELECT data FROM role_launches WHERE id=?', accepted.data.decisionLaunch);
        assert.equal(JSON.parse(judge.data).planningVerificationProfile.version, 4);
        assert.deepEqual(accepted.data.plan.verification.checks[0].expectationPaths, ['check.cjs']);
        await c.implementChange({workId, model});
        assert.equal(wrongWrites, 1);
        view = await c.checkChange({workId});
        assert.equal(view.phase, 'REPAIR_REQUIRED', JSON.stringify(view.blocked));
        const failed = c.store.one("SELECT * FROM check_runs WHERE work=? AND status='fail'", workId);
        const obligation = c.store.all('SELECT * FROM obligations WHERE work=?', workId).find(row => JSON.parse(row.data).kind === 'check');
        assert.ok(failed && obligation);
        const expectations = JSON.parse(failed.data).expectations;
        assert.equal(expectations.length, 1);
        assert.equal(expectations[0].path, 'check.cjs');
        await c.close();
        c = await openController({installationHome: home, runtimeProfile});
        view = await c.repairChange({workId, model});
        assert.equal(view.phase, 'CANDIDATE_CAPTURED', JSON.stringify(view.blocked));
        const candidate = c.changeCore.version(view.candidateVersion);
        assert.deepEqual(candidate.data.delta.files.map(file => file.path), ['consumer.cjs']);
        view = await c.checkChange({workId});
        assert.equal(view.phase, 'CHECKED', JSON.stringify(view.blocked));
        const passed = c.store.one("SELECT * FROM check_runs WHERE work=? AND status='pass' ORDER BY rowid DESC LIMIT 1", workId);
        assert.deepEqual(JSON.parse(passed.data).expectations, expectations);
        assert.deepEqual(c.store.one('SELECT * FROM check_runs WHERE id=?', failed.id), failed);
        assert.equal(JSON.parse(c.store.one('SELECT data FROM obligations WHERE id=?', obligation.id).data).state, 'resolved');
        view = await c.driveChange({workId, model});
        assert.equal(view.reviewReady, true, JSON.stringify(view.blocked));
        assert.equal(view.execution.reserved, 0);
        assert.equal(await fs.readFile(path.join(candidate.artifact, 'check.cjs'), 'utf8'), checker);
        assert.equal(await fs.readFile(path.join(source, 'consumer.cjs'), 'utf8'), 'module.exports=2;\n');
        await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({workId, failedCheck: failed.id, passingCheck: passed.id, expectations, final: view}, null, 2));
    } finally {
        await c?.close();
        if (originalTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = originalTmp;
        t.diagnostic('Retained owned runtime evidence ' + root);
    }
});
