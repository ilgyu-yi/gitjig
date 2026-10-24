// Original application/Pi/SDK consumers with one owned finite native protocol.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {nativeOwnerHistory} from '../pi/native-owner-history.mjs';

const [mode, root, accountRoute, purpose, drift] = process.argv.slice(2);
let networkAttempts = 0;
const denyNetwork = () => {
    networkAttempts++;
    throw Error('ACCOUNT_ROUTE_FIXTURE_NETWORK_REFUSED');
};
globalThis.fetch = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
for (const api of [http, https]) for (const name of ['request', 'get']) api[name] = denyNetwork;
syncBuiltinESMExports();

const home = path.join(root, 'app');
const hostCwd = path.join(root, 'host');
const agentDir = path.join(root, 'agent');
const nativeAccountHome = accountRoute === 'default-home' ? path.join(root, 'native-home') : undefined;
const accountDirectory = nativeAccountHome ? path.join(nativeAccountHome, '.claude') : path.join(root, 'native-account');
const {openController} = await import('../../dist/controller/index.js');

if (mode === 'bootstrap') {
    const controller = await openController({installationHome: home});
    await controller.close();
    assert.equal(networkAttempts, 0);
    process.exit(0);
}
assert.equal(mode, 'exercise');
assert.ok(['provider', 'later-provider', 'summary'].includes(purpose));
assert.equal(process.cwd(), hostCwd);
assert.equal(process.env.HOME, path.join(agentDir, 'home'));
assert.equal(process.env.CLAUDE_CONFIG_DIR, accountDirectory);
assert.equal(process.env.TMPDIR, path.join(home, 'artifacts'));

const executable = path.join(root, 'selected native fixture');
const digest = createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
const {validateStartupConfiguration} = await import('../../dist/app/startup.js');
const {createOwnedClaudeHost} = await import('../../dist/pi/claude-host.js');
const {ApplicationModels} = await import('../../dist/app/models.js');
const bridge = {
    profile: {kind: 'installed-claude-bridge', cwd: hostCwd, agentDir, executable: {file: executable, sha256: digest}},
    nativeAccountDirectory: accountDirectory,
    ...(nativeAccountHome ? {nativeAccountHome} : {}),
};
await validateStartupConfiguration({version: 1, bridge}, [], home);
const owner = await createOwnedClaudeHost({cwd: hostCwd, agentDir, executable: bridge.profile.executable,
    ...(nativeAccountHome ? {nativeAccountHome} : {})});

const events = () => {
    const file = path.join(hostCwd, 'fixture-observation.json');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
};
function mutateRoute() {
    if (drift === 'account-mode') {
        fs.chmodSync(accountDirectory, 0o777);
    } else if (drift === 'account-link') {
        fs.renameSync(accountDirectory, accountDirectory + '.original');
        const replacement = path.join(root, 'redirected-account');
        // Keep the target private: this case isolates canonical-path refusal
        // instead of passing merely because the target is writable by others.
        fs.mkdirSync(replacement, {mode: 0o700});
        fs.symlinkSync(replacement, accountDirectory);
    } else if (drift === 'home-mode') {
        assert.ok(nativeAccountHome);
        fs.chmodSync(nativeAccountHome, 0o777);
    } else if (drift === 'settings-mode') {
        assert.ok(nativeAccountHome);
        fs.chmodSync(path.join(nativeAccountHome, '.claude.json'), 0o644);
    } else if (drift === 'settings-link') {
        assert.ok(nativeAccountHome);
        const settings = path.join(nativeAccountHome, '.claude.json');
        fs.renameSync(settings, settings + '.original');
        fs.symlinkSync(settings + '.original', settings);
    } else {
        throw Error('Unknown controlled drift');
    }
}

const entry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {HostedQuery} = await import(new URL('./host.js', entry));
const originalOptions = HostedQuery.prototype.options;
let controller, models, mutated = false, prepared = 0, attemptedBirths = 0, nativeCallsBeforeDrift;
let outcome, boundaryFailure, failure, cleanupError;
const originalRuns = [];
const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(Error('Account-route fixture deadline')), 18000);
timer.unref();

// Mutate at the actual SDK process hook, after Pi/query preparation. Delegate to
// the original hook: no authority, launch result or cleanup is supplied by this observer.
HostedQuery.prototype.options = function (...args) {
    const options = Reflect.apply(originalOptions, this, args);
    const originalSpawn = options.spawnClaudeCodeProcess;
    const queryPurpose = this.purpose;
    options.spawnClaudeCodeProcess = (...spawnArgs) => {
        const selectedPurpose = purpose === 'later-provider' ? 'provider' : purpose;
        const laterProviderReady = purpose !== 'later-provider' || events().some(event => event.kind === 'query');
        if (queryPurpose === selectedPurpose && laterProviderReady) {
            attemptedBirths++;
            assert.ok(prepared > 0, 'Actual application native-ready precedes the late drift');
            if (!mutated) {
                nativeCallsBeforeDrift = events().filter(event => event.kind === 'query').length;
                mutateRoute();
                mutated = true;
            }
        }
        try {
            return Reflect.apply(originalSpawn, options, spawnArgs);
        } catch (error) {
            if (queryPurpose === selectedPurpose && laterProviderReady) boundaryFailure = String(error);
            throw error;
        }
    };
    return options;
};

try {
    controller = await openController({installationHome: home});
    await controller.adoptModelResource(owner);
    models = new ApplicationModels(controller);
    models.install();
    controller.subscribeInteraction(event => { if (event.type === 'native-ready') prepared++; });
    const selected = (await owner.models()).find(model => model.id !== 'claude-opus-5-5' && model.reasoning);
    assert.ok(selected, 'A genuine catalogue model is used');
    const choice = await models.choice('claude-bridge', selected.id, 'high');
    const {conversationId} = await models.newConversation({choice});
    const run = async text => {
        const view = controller.inspectConversation(conversationId);
        await controller.queueConversationInput({conversationId, expectedGeneration: view.generation, text, mode: 'idle'});
        return controller.runConversation({conversationId, ...models.conversationOperation(conversationId), signal: deadline.signal});
    };
    const action = async () => {
        if (purpose === 'provider') return run('B_NATIVE_ROUTE_DRIFT');
        if (purpose === 'later-provider') {
            const prior = await run('B_NATIVE_TURN_1');
            assert.equal(prior.status, 'delivered');
            assert.equal(prior.cleanup, 'unbound');
            originalRuns.push(controller.store.one('SELECT * FROM runs WHERE id=?', prior.runId));
            return run('B_NATIVE_ROUTE_DRIFT');
        }
        for (const text of ['B_NATIVE_TURN_1', 'B_NATIVE_TURN_2', 'B_NATIVE_TURN_3_LONG\n' + 'x'.repeat(88000)]) {
            const prior = await run(text);
            assert.equal(prior.status, 'delivered');
            assert.equal(prior.cleanup, 'unbound');
            originalRuns.push(controller.store.one('SELECT * FROM runs WHERE id=?', prior.runId));
        }
        assert.equal(events().filter(event => event.kind === 'query').length, 3);
        return controller.compactConversation({conversationId,
            expectedGeneration: controller.inspectConversation(conversationId).generation,
            ...models.conversationOperation(conversationId), instructions: 'Preserve the original first two turns.', signal: deadline.signal});
    };
    try { outcome = await action(); } catch (error) { outcome = {error: String(error)}; }
    assert.equal(mutated, true, 'Drift reached the actual selected SDK birth boundary');
    assert.equal(attemptedBirths, 1, 'No implicit retry of a refused native birth');
    assert.notEqual(outcome.status, 'delivered', 'Invalid account metadata cannot dispatch');
    assert.match(boundaryFailure, /account|configuration|home|metadata/i,
        'The original birth hook refused the changed metadata even when compaction wraps its error');
    assert.doesNotMatch(JSON.stringify({outcome, boundaryFailure}), /cleanup[\s":_-]*unknown|quarantin|LAUNCH_ABSENT/i,
        'A known pre-birth refusal is not physical-process uncertainty');
    assert.equal(nativeCallsBeforeDrift, purpose === 'provider' ? 0 : purpose === 'later-provider' ? 1 : 3);
    assert.equal(events().filter(event => event.kind === 'query').length, nativeCallsBeforeDrift,
        'The fake native was not reached after metadata drift');
    assert.equal(events().filter(event => event.summary).length, 0);
    for (const prior of originalRuns)
        assert.deepEqual(controller.store.one('SELECT * FROM runs WHERE id=?', prior.id), prior, 'Earlier settled run evidence is unchanged');
    assert.equal(controller.store.one("SELECT COUNT(*) AS n FROM capacity_leases WHERE state!='RELEASED'").n, 0);
    assert.equal(controller.store.one('SELECT COUNT(*) AS n FROM budgets WHERE reserved!=0').n, 0);
    assert.equal(controller.store.one("SELECT COUNT(*) AS n FROM runs WHERE phase!='SETTLED'").n, 0);
} catch (error) {
    failure = error;
} finally {
    HostedQuery.prototype.options = originalOptions;
    if (failure && !deadline.signal.aborted) deadline.abort(failure);
    try { await controller?.close(); } catch (error) { cleanupError = error; }
    try { await owner.close(); } catch (error) { cleanupError ??= error; }
    clearTimeout(timer);
    const journals = await nativeOwnerHistory(path.join(home, 'state/runtime/native-owners/v1')).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify({complete: !failure && !cleanupError,
        accountRoute, purpose, drift, mutated, prepared, attemptedBirths, nativeCallsBeforeDrift,
        queries: events().filter(event => event.kind === 'query'), journals,
        networkAttempts, outcome, originalNativeFailure: boundaryFailure,
        applicationFailure: outcome?.failure ?? outcome?.error ?? null,
        failure: failure ? String(failure) : null,
        cleanupError: cleanupError ? String(cleanupError) : null}, null, 2), {mode: 0o600});
}
assert.equal(networkAttempts, 0);
if (failure) throw failure;
if (cleanupError) throw cleanupError;
