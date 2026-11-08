import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {createOwnedAcceptanceSetup, openHostedAcceptanceSetup, acceptanceContextResources} from '../../dist/platform/hosted-context.js';
import {acceptanceFixture as scope} from '../../.qualification/github-acceptance-setup.js';
import { createContextPublicationClient, openDisabledPublicationClient } from '../../dist/platform/github-publication.js';
import { openGitHubConfigurationReader } from '../../dist/platform/github-configuration.js';

import {base, user, repo, fixture} from './acceptance-fixture.mjs';
const policy = { version: '014-fixture-carrier-v1', allowedMentions: [], knownPrivateLiterals: [], maxTitleBytes: 256, maxBodyBytes: 8192 };
const input = (context, operationId = 'acceptance014_issue') => ({ target: context.target, operationId, carrierPolicy: policy,
    action: { kind: 'create-issue', title: 'Synthetic acceptance: exact publication', body: 'Synthetic fixture only. 한국어와 exact bytes.\nNo project content or notification mentions.' } });

test('actual creation201/readback admits opaque context; actual finite publisher and selected config retain one captured credential', async () => {
    const f = await fixture(); let setup;
    try {
        const options = { ...f.setupOptions }; setup = await createOwnedAcceptanceSetup(options); options.token = 'caller-changed';
        const context = await setup.create(), clients = setup.clients(context), signal = new AbortController().signal;
        assert.equal(context.target.repositoryId, 91234001);
        const h = await clients.publication.preparePublication(input(context), signal);
        const attempt = await clients.publication.invokePreparedPublication(h);
        assert.equal(attempt.outcome, 'confirmed', JSON.stringify(attempt)); assert.equal(f.state.issues.length, 1);
        const target = { ...context.target, visibility: 'private' };
        const plan = await clients.configuration.previewConfiguration({ operationId: 'acceptance014_merge', target, desired: { version: '014', mergeMethods: { squash: false } } });
        const p = await clients.configuration.prepareConfigurationStep({ plan, stepId: 'patch-merge-methods' }, signal);
        assert.equal((await clients.configuration.invokePreparedConfigurationStep(p)).outcome, 'confirmed');
        assert.equal(f.state.repository.allow_squash_merge, false); assert.equal(f.state.repository.allow_rebase_merge, true);
        assert.ok(f.state.calls.every(row => row.auth === 'Bearer fixture-literal-original'));
        const saved = await fs.readFile(path.join(f.root, 'setup.json'), 'utf8');
        assert.ok(!saved.includes('fixture-literal-original')); assert.ok(!saved.includes('must-not-persist-unrelated-response'));
        assert.equal(setup.inspect().counters.repositoryCreates, 1); assert.equal(setup.inspect().counters.issueCreates, 1);
        assert.throws(() => clients.publication.invokePreparedPublication(h), /consumed/);
    } finally { await setup?.close(); await f.close(); }
});

test('collision, excluded/wrong/private/User identity and accepted-create EOF never construct/adopt/retry a context', async () => {
    for (const options of [{ exists: true }, { wrongUser: true }, { createdMutation: { id: scope.excludedId } },
        { createdMutation: { private: false, visibility: 'public' } }, { createdMutation: { node_id: '' } }, { dropCreate: true }]) {
        const f = await fixture(options); let setup;
        try {
            setup = await createOwnedAcceptanceSetup(f.setupOptions);
            await assert.rejects(setup.create(), /unavailable/);
            const before = f.state.calls.length;
            await assert.rejects(setup.create()); assert.equal(f.state.calls.length, before);
            assert.throws(() => setup.clients({ kind: 'local-exact-created-acceptance/v1', credentialSessionId: setup.inspect().credentialSessionId, target: repo() }), /context/);
            if (options.exists || options.wrongUser) assert.equal(f.state.calls.filter(row => row.method === 'POST').length, 0);
            else assert.equal(f.state.calls.filter(row => row.method === 'POST').length, 1);
            if (options.dropCreate) {
                await setup.close(); setup = await createOwnedAcceptanceSetup(f.setupOptions);
                await assert.rejects(setup.reopen(), /unknown creation/); await assert.rejects(setup.create(), /already attempted/);
                assert.equal(f.state.calls.filter(row => row.method === 'POST').length, 1);
            }
        } finally { await setup?.close(); await f.close(); }
    }
    const known = await fixture({ failReadback: true }); let k;
    try {
        k = await createOwnedAcceptanceSetup(known.setupOptions); await assert.rejects(k.create(), /unavailable/);
        assert.equal(k.inspect().creation.status, 201); assert.equal(k.inspect().phase, 'unknown');
        await k.close(); k = await createOwnedAcceptanceSetup(known.setupOptions);
        const actual = await k.reopen(); assert.equal(actual.target.repositoryId, 91234001); assert.equal(k.inspect().phase, 'created');
        assert.equal(known.state.calls.filter(row => row.method === 'POST').length, 1);
    } finally { await k?.close(); await known.close(); }
});

test('unknown/serialized context, wrong target, unsupported origins/query/ref and closed handle cannot use callback seams', async () => {
    const f = await fixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup(f.setupOptions); const c = await setup.create(); const clients = setup.clients(c), n = f.state.calls.length;
        assert.throws(() => createContextPublicationClient(structuredClone(c)), /context/);
        assert.throws(() => clients.publication.preparePublication({ ...input(c), target: { ...c.target, repositoryId: 4 } }, AbortSignal.abort()), /differs/);
        const resources = acceptanceContextResources(c);
        assert.throws(() => { resources.start = () => { throw Error('untrusted replacement'); }; }, TypeError);
        assert.throws(() => resources.start(new URL('https://example.invalid/user'), { method: 'GET' }), /scope/);
        assert.throws(() => resources.start(new URL('https://api.github.com/graphql'), { method: 'POST', body: Buffer.from(JSON.stringify({ query: 'query Other { viewer { login } }' })) }), /query body/);
        assert.throws(() => clients.observeTargetPolicy({ expectedUserId: scope.ownerId, target: { ...c.target, visibility: 'private' }, branch: 'not-approved' }), /finite branch/);
        assert.equal(f.state.calls.length, n);
        const h = await clients.publication.preparePublication(input(c), new AbortController().signal);
        await setup.close(); assert.throws(() => clients.publication.invokePreparedPublication(h), /closed/);
        assert.equal(f.state.issues.length, 0);
        await assert.rejects(openHostedAcceptanceSetup({}), /credential|argument|undefined|token/i);
        const disabled = openDisabledPublicationClient({ token: 'literal-unused' });
        await assert.rejects(disabled.preparePublication(input(c), AbortSignal.abort()), /DISABLED/);
        const config = openGitHubConfigurationReader({ token: 'literal-unused' }); assert.throws(() => { config.activation = 'created-private-local-acceptance'; }, TypeError);
        await assert.rejects(config.prepareConfigurationStep({ plan: { target: { visibility: 'private' } } }, AbortSignal.abort()), /DISABLED/);
    } finally { await setup?.close(); await f.close(); }
});

test('native lower-level API read cap and mutation cap survive known-created reopen; no allowance reset or old-context reuse', async () => {
    const f = await fixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup(f.setupOptions); const c = await setup.create();
        const client = setup.clients(c), h = await client.publication.preparePublication(input(c), new AbortController().signal);
        assert.equal((await client.publication.invokePreparedPublication(h)).outcome, 'confirmed');
        await setup.close();
        const child = spawn(process.execPath, [new URL('./acceptance-restart-child.mjs', import.meta.url).pathname, f.setupOptions.origin, f.root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        try {
            const ready = await Promise.race([once(child, 'message', { signal: AbortSignal.timeout(5000) }).then(([m]) => m), once(child, 'exit').then(() => { throw Error('Owned restart child exited before receipt'); })]);
            assert.equal(ready.kind, 'known-created-reopened'); assert.equal(ready.counters.issueCreates, 1);
            const exit = once(child, 'exit'); child.kill('SIGKILL'); const [, signal] = await exit; assert.equal(signal, 'SIGKILL');
        } finally { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } }
        setup = await createOwnedAcceptanceSetup(f.setupOptions); const c2 = await setup.reopen();
        assert.notEqual(c2.credentialSessionId, c.credentialSessionId); assert.equal(setup.inspect().counters.issueCreates, 1);
        assert.throws(() => setup.clients(c), /Different/);
        const c2client = setup.clients(c2), second = await c2client.publication.preparePublication(input(c2, 'acceptance014_issue_second'), new AbortController().signal);
        assert.throws(() => c2client.publication.invokePreparedPublication(second), /allowance/);
        assert.equal(f.state.issues.length, 1);
        const resources = acceptanceContextResources(c2);
        while (setup.inspect().counters.reads < 400) await resources.start(new URL('https://api.github.com/user'), { method: 'GET' }).response;
        const count = f.state.calls.length;
        assert.throws(() => resources.start(new URL('https://api.github.com/user'), { method: 'GET' }), /allowance/);
        assert.equal(f.state.calls.length, count);
        assert.equal(setup.inspect().counters.reads, 400);
    } finally { await setup?.close(); await f.close(); }
});

test('actual close aborts/joins stalled native call; deadline expiry and distinct same-User insufficient credential never uplift capability', async () => {
    const f = await fixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup(f.setupOptions); const c = await setup.create();
        const negativeOptions = { token: 'fixture-negative-metadata' }, negative = setup.negativeCapability(c, negativeOptions); negativeOptions.token = 'fixture-literal-original';
        const obs = await negative.observePublicationCapability({ expectedUserId: scope.ownerId, target: { ...c.target, visibility: 'private' }, action: 'create-issue' });
        assert.notEqual(obs.state, 'matched'); assert.equal(obs.activation, 'disabled');
        assert.notEqual(negative.credentialSessionId, c.credentialSessionId); assert.equal(negative.scope, 'read-only-negative-never-sending-fallback');
        assert.equal((await setup.clients(c).observePublicationCapability({ expectedUserId: scope.ownerId, target: { ...c.target, visibility: 'private' }, action: 'create-issue' })).state, 'matched');
        assert.equal(f.state.calls.filter(row => row.auth === 'Bearer fixture-negative-metadata').length, 2);
        f.state.stall = true;
        const pending = acceptanceContextResources(c).start(new URL('https://api.github.com/user'), { method: 'GET' }).response;
        const settled = pending.then(() => 'unexpected', () => 'aborted'); await f.entered; await setup.close(); assert.equal(await settled, 'aborted');
        assert.equal(f.state.calls.filter(row => row.method === 'POST').length, 1);
    } finally { await setup?.close(); await f.close(); }
    const short = await fixture(); let s;
    try { s = await createOwnedAcceptanceSetup({ ...short.setupOptions, lifetimeMs: 1 }); await new Promise(r => setTimeout(r, 5)); assert.throws(() => s.create(), /expired/); assert.equal(short.state.calls.length, 0); }
    finally { await s?.close(); await short.close(); }
    const active = await fixture(); let a;
    try {
        a = await createOwnedAcceptanceSetup({ ...active.setupOptions, lifetimeMs: 500 }); const c = await a.create();
        active.state.stall = true; const started = performance.now();
        await assert.rejects(acceptanceContextResources(c).start(new URL('https://api.github.com/user'), { method: 'GET' }).response, /unavailable/);
        assert.ok(performance.now() - started < 1500, 'global setup deadline must cancel the actual in-flight HTTP request, not wait its10s native timeout');
        assert.equal(a.inspect().counters.reads, 4);
    } finally { await a?.close(); await active.close(); }
});

test('fresh and unknown setup expose no internal context/request helpers; reflected construction cannot inject a producer', async () => {
    const names = ['context','request','start','prepareSetup','createOnce','reopenKnown','save','live','remainingMs','own','nativeIntent','createFixtureBranchesOnce'];
    const f = await fixture(); let setup;
    try {
        setup = await createOwnedAcceptanceSetup(f.setupOptions);
        for (const name of names) assert.equal(setup[name], undefined, name);
        assert.equal(f.state.calls.length, 0);
        assert.throws(() => Reflect.construct(setup.constructor, [{}, path.join(f.directory, 'must-not-be-created'), 'https://api.github.com', () => { throw Error('Injected producer ran'); }, 3600000, async () => {}]), /factory construction/);
        assert.equal(f.state.calls.length, 0);
        await assert.rejects(fs.stat(path.join(f.directory, 'must-not-be-created')), { code: 'ENOENT' });
        const context = await setup.create(); assert.equal(context.target.repositoryId, 91234001);
        for (const name of names) assert.equal(setup[name], undefined, name);
    } finally { await setup?.close(); await f.close(); }
    const lost = await fixture({ dropCreate: true });
    try {
        setup = await createOwnedAcceptanceSetup(lost.setupOptions); await assert.rejects(setup.create());
        assert.equal(setup.inspect().phase, 'unknown');
        for (const name of names) assert.equal(setup[name], undefined, name);
        await assert.rejects(setup.reopen(), /known creation/);
        assert.equal(lost.state.calls.filter(call => call.method === 'POST').length, 1);
    } finally { await setup?.close(); await lost.close(); }
});
