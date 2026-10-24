import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createOwnedAcceptanceSetup, createdAcceptanceSession} from '../../dist/platform/hosted-context.js';
import { openGitHubHttpsGit } from '../../dist/effects/native-git.js';
import { gitFixture, command, commit, files } from './acceptance-git-fixture.mjs';

const target = (context, ref = 'refs/heads/main') => ({ ...context.target, ref });
test('opaque created context binds actual REST+supervised TLS Git credential and exact native conditional push without local/raw escape', async t => {
    const f = await gitFixture(); let setup;
    try {
        const options = { ...f.setupOptions, ownedHttps: { ...f.ownedHttps } };
        setup = await createOwnedAcceptanceSetup(options); options.token = 'caller-changed'; options.ownedHttps.origin = 'https://example.invalid';
        const c = await setup.create(), session = createdAcceptanceSession(c);
        assert.equal(session, createdAcceptanceSession(c)); assert.equal(session.activation, 'created-private-local-acceptance');
        assert.equal(session.credentialSessionId, c.credentialSessionId); assert.throws(() => createdAcceptanceSession(structuredClone(c)), /context/);
        const client = await session.openNativeGit(f.profile('client'));
        for (const name of ['registerLocalTarget', 'observeLocalRef', 'prepareForwardSend', 'spawnPreparedForwardSend', 'start', 'run', 'initialize']) assert.equal(client[name], undefined, name);
        await client.fetchHttpsBasis(target(c), f.B);
        const operationId = 'acceptance014_native', I = await commit(f.gitRoot, path.join(client.root, 'client.git'), f.B, 'synthetic-changed', operationId);
        const built = await client.buildIntegration({ operationId, head: I, expectedBase: f.B }); assert.equal(built.kind, 'candidate', JSON.stringify(built));
        const input = { operationId, target: target(c), expectedBase: f.B, integrationCommit: built.commit };
        const h = await client.prepareHttpsForwardSend(input, new AbortController().signal);
        assert.equal(h.credentialSessionId, c.credentialSessionId);
        assert.equal((await client.spawnPreparedHttpsForwardSend(h)).transport, 'native-success');
        assert.equal((await command(f.gitRoot, f.receiver, ['rev-parse', input.target.ref])).toString().trim(), I);
        assert.equal((await client.reconcileHttpsForward(input)).kind, 'contains-integration');
        assert.throws(() => client.spawnPreparedHttpsForwardSend(h), /consumed/);
        assert.equal(setup.inspect().counters.nativePushes, 1);
        assert.ok(f.requests.every(r => r.authorized)); assert.ok(f.state.calls.every(r => r.auth === 'Bearer fixture-literal-original'));
        await assert.rejects(openGitHubHttpsGit(), /Explicit normal Git profile and captured credential required/);
        await setup.close();
        for (const file of [...await files(f.root), ...await files(client.root)]) {
            const bytes = await fs.readFile(file); assert.equal(bytes.includes('fixture-literal-original'), false, file);
            assert.equal(bytes.includes(Buffer.from('x-access-token:fixture-literal-original').toString('base64')), false, file);
        }
        t.diagnostic(JSON.stringify({ fixture: f.gitRoot, nativePushes: 1, observedI: I, nativeRequests: f.requests.length, production: 'owned exact-created fixture only; no normal or live qualification' }));
    } finally { await setup?.close(); await f.close(); }
});

test('exact target/ref and session binding refuse before network; aborted native attempts consume12/64 caps and survive reopen', async () => {
    const f = await gitFixture(); let setup;
    try {
        const options = { ...f.setupOptions, ownedHttps: f.ownedHttps }; setup = await createOwnedAcceptanceSetup(options);
        const c = await setup.create(), client = await setup.openNativeGit(c, f.profile('client'));
        const before = f.requests.length;
        assert.throws(() => client.observeHttpsRef({ ...target(c), repositoryId: 77 }), /differs/);
        assert.throws(() => client.observeHttpsRef(target(c, 'refs/heads/other')), /branch/);
        assert.throws(() => client.spawnPreparedHttpsForwardSend({}), /Foreign/);
        assert.equal(f.requests.length, before); assert.equal(setup.inspect().counters.nativePushes, 0);
        await client.fetchHttpsBasis(target(c), f.B);
        const I = await commit(f.gitRoot, path.join(client.root, 'client.git'), f.B, 'cap-input', 'cap');
        const prepared = [];
        for (let i = 0; i < 13; i++) {
            const abort = new AbortController(); const h = await client.prepareHttpsForwardSend({ operationId: 'cap' + i, target: target(c), expectedBase: f.B, integrationCommit: I }, abort.signal);
            abort.abort(); prepared.push(h);
        }
        const receive = f.requests.filter(r => r.path.includes('git-receive-pack')).length;
        for (const h of prepared.slice(0, 12)) assert.equal((await client.spawnPreparedHttpsForwardSend(h)).handoff, 'not-started');
        assert.throws(() => client.spawnPreparedHttpsForwardSend(prepared[12]), /allowance/);
        assert.equal(f.requests.filter(r => r.path.includes('git-receive-pack')).length, receive);
        assert.equal(setup.inspect().counters.nativePushes, 12);
        while (setup.inspect().counters.nativeOperations < 64) await assert.rejects(client.observeHttpsRef(target(c), AbortSignal.abort()));
        const capCount = f.requests.length; assert.throws(() => client.observeHttpsRef(target(c)), /allowance/); assert.equal(f.requests.length, capCount);
        await setup.close(); setup = await createOwnedAcceptanceSetup(options); const c2 = await setup.reopen();
        assert.equal(setup.inspect().counters.nativePushes, 12); assert.equal(setup.inspect().counters.nativeOperations, 64);
        assert.throws(() => setup.openNativeGit(c2, f.profile('second')), /allowance/);
        assert.equal((await command(f.gitRoot, f.receiver, ['rev-parse', 'refs/heads/main'])).toString().trim(), f.B);
    } finally { await setup?.close(); await f.close(); }
});

test('context close owns native opener/observation admission and accepted-but-stalled push cleanup; uncertainty is not resent', async () => {
    const first = await gitFixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup({ ...first.setupOptions, ownedHttps: first.ownedHttps }); const c = await setup.create();
        let settled = false; const opening = setup.openNativeGit(c, first.profile('opening')).finally(() => settled = true);
        const outcome = opening.then(() => 'unexpected', () => 'closed'); await setup.close(); assert.equal(await outcome, 'closed'); assert.equal(settled, true);
        assert.equal(first.requests.length, 0);
    } finally { await setup?.close(); await first.close(); }
    const f = await gitFixture(); let second;
    try {
        second = await createOwnedAcceptanceSetup({ ...f.setupOptions, ownedHttps: f.ownedHttps }); const c = await second.create(), client = await second.openNativeGit(c, f.profile('client'));
        await client.fetchHttpsBasis(target(c), f.B); const operationId = 'unknown', I = await commit(f.gitRoot, path.join(client.root, 'client.git'), f.B, 'unknown-content', operationId);
        const input = { operationId, target: target(c), expectedBase: f.B, integrationCommit: I }, h = await client.prepareHttpsForwardSend(input, new AbortController().signal);
        f.gitState.dropAfterReceive = true; const accepted = f.barrier(); const sending = client.spawnPreparedHttpsForwardSend(h); await accepted;
        await second.close(); const result = await sending; assert.equal(result.transport, 'uncertain');
        assert.equal((await command(f.gitRoot, f.receiver, ['rev-parse', 'refs/heads/main'])).toString().trim(), I);
        assert.equal(second.inspect().counters.nativePushes, 1);
        assert.throws(() => client.spawnPreparedHttpsForwardSend(h), /consumed/);
        const receives = f.requests.filter(r => r.path.endsWith('/git-receive-pack')).length; assert.equal(receives, 1);
    } finally { await second?.close(); await f.close(); }
});
